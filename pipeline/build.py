"""Aggregate Postgres into the static JSON files the map reads."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from .config import (CATEGORIES, DATA_START, MIN_RT_SAMPLE, OUTPUT_DIR, RATE_GROUPS,
                     RECENT_DAYS)
from .load import read_topic_categories
from .transform import clean_text

CASES_SQL = """
    SELECT case_id, open_date, close_date, target_close_date, case_topic, case_status,
           on_time, assigned_department, full_address, closure_comments, neighborhood,
           latitude, longitude
    FROM cases
    WHERE open_date >= %(start)s
"""

POPULATION_SQL = "SELECT neighborhood, population FROM neighborhood_population"


def _write(name: str, payload) -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / name
    text = json.dumps(payload, separators=(",", ":"), allow_nan=False)
    path.write_text(text, encoding="utf-8")
    return len(text)


def _epoch(series: pd.Series) -> list:
    return [None if pd.isna(v) else int(v.timestamp()) for v in series]


def build(engine) -> dict:
    cases = pd.read_sql(CASES_SQL, engine, params={"start": DATA_START})
    populations = pd.read_sql(POPULATION_SQL, engine)
    now = datetime.now(timezone.utc)

    for col in ["open_date", "close_date", "target_close_date"]:
        cases[col] = pd.to_datetime(cases[col], utc=True)

    topic_map = read_topic_categories()
    cases["topic_key"] = cases["case_topic"].map(clean_text)
    cases["category"] = cases["topic_key"].map(topic_map).fillna("Other")
    unmapped = (
        cases.loc[~cases["topic_key"].isin(topic_map.keys()) & cases["topic_key"].notna(), "topic_key"]
        .value_counts()
    )
    cases["cat_idx"] = cases["category"].map({c: i for i, c in enumerate(CATEGORIES)}).fillna(len(CATEGORIES) - 1).astype(int)
    cases["is_closed"] = cases["case_status"].fillna("").str.lower().eq("closed")
    cases["hours"] = (cases["close_date"] - cases["open_date"]).dt.total_seconds() / 3600

    # ---- neighborhood_stats.json ----
    mapped = cases[cases["neighborhood"].notna()]
    counts = {}
    for name, group in mapped.groupby("neighborhood"):
        table = [[0, 0] for _ in CATEGORIES]
        for (cat, closed), n in group.groupby(["cat_idx", "is_closed"]).size().items():
            table[cat][1 if closed else 0] = int(n)
        counts[name] = table

    # Median response time for every combination of categories (bitmask 1..2^n - 1).
    response_times = {}
    closed = mapped[mapped["is_closed"] & (mapped["hours"] >= 0)]
    for name, group in closed.groupby("neighborhood"):
        per_cat = [group.loc[group["cat_idx"] == i, "hours"].to_numpy() for i in range(len(CATEGORIES))]
        medians = [None] * (1 << len(CATEGORIES))
        for mask in range(1, 1 << len(CATEGORIES)):
            values = np.concatenate([per_cat[i] for i in range(len(CATEGORIES)) if mask & (1 << i)])
            if len(values) >= MIN_RT_SAMPLE:
                medians[mask] = round(float(np.median(values)), 1)
        response_times[name] = medians

    stats_size = _write("neighborhood_stats.json", {"counts": counts, "responseHours": response_times})

    # ---- recent_cases.json (drill-down pins) ----
    recent = cases[
        (cases["open_date"] >= pd.Timestamp(now - timedelta(days=RECENT_DAYS)))
        & cases["latitude"].notna() & cases["longitude"].notna()
    ].sort_values("open_date")

    topics = sorted(recent["topic_key"].fillna("Unknown").unique().tolist())
    depts = sorted(recent["assigned_department"].fillna("").unique().tolist())
    topic_idx = {t: i for i, t in enumerate(topics)}
    dept_idx = {d: i for i, d in enumerate(depts)}

    def on_time_code(v):
        if not isinstance(v, str):
            return None
        return 0 if "over" in v.lower() else 1

    rows = []
    for r, open_ts, close_ts, target_ts in zip(
        recent.itertuples(index=False),
        _epoch(recent["open_date"]), _epoch(recent["close_date"]), _epoch(recent["target_close_date"]),
    ):
        notes = r.closure_comments[:400] if isinstance(r.closure_comments, str) else None
        rows.append([
            r.case_id,
            round(float(r.latitude), 6),
            round(float(r.longitude), 6),
            topic_idx[r.topic_key if isinstance(r.topic_key, str) else "Unknown"],
            int(r.cat_idx),
            1 if r.is_closed else 0,
            open_ts,
            close_ts if r.is_closed else None,
            target_ts,
            on_time_code(r.on_time),
            dept_idx[r.assigned_department if isinstance(r.assigned_department, str) else ""],
            r.full_address if isinstance(r.full_address, str) else None,
            notes,
        ])

    recent_size = _write("recent_cases.json", {
        "fields": ["id", "lat", "lng", "topic", "category", "closed", "opened", "closedAt",
                   "target", "onTime", "department", "address", "notes"],
        "topics": topics,
        "departments": depts,
        "rows": rows,
    })

    # ---- meta.json ----
    pop = {n: int(p) for n, p in zip(populations["neighborhood"], populations["population"]) if pd.notna(p)}
    data_through = cases["open_date"].max()
    meta = {
        "generatedAt": now.isoformat(timespec="seconds"),
        "dataStart": DATA_START,
        "dataThrough": None if pd.isna(data_through) else data_through.isoformat(),
        "totalCases": int(len(cases)),
        "casesWithoutNeighborhood": int(cases["neighborhood"].isna().sum()),
        "recentDays": RECENT_DAYS,
        "categories": CATEGORIES,
        "populations": pop,
        "rateGroups": RATE_GROUPS,
        "minResponseSample": MIN_RT_SAMPLE,
        "unmappedTopics": {k: int(v) for k, v in unmapped.items()},
    }
    _write("meta.json", meta)

    print(f"Built {len(counts)} neighborhoods ({stats_size / 1024:.0f} KB), "
          f"{len(rows)} recent cases ({recent_size / 1024:.0f} KB), {len(cases)} total cases")
    if len(unmapped):
        print(f"Topics not in topic_categories.csv (shown as Other): {meta['unmappedTopics']}")
    return meta
