"""Entry point: ingest from Analyze Boston, upsert into Postgres, build the static site data.

    python -m pipeline.run                  # daily: re-pull the last 60 days (weekly full re-sync on Sundays)
    python -m pipeline.run --full           # re-pull everything since DATA_START
    python -m pipeline.run --rebuild        # one-time: recreate the cases table, then full load
    python -m pipeline.run --since 2026-08-01
    python -m pipeline.run --skip-ingest    # only rebuild frontend/data from what's in Postgres
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

import pandas as pd

from . import extract, transform
from .build import build
from .config import DATA_START, LOOKBACK_DAYS
from .load import ensure_schema, get_engine, sync_topic_categories, upsert_cases


def pick_since(args) -> str:
    if args.since:
        return args.since
    today = datetime.now(timezone.utc)
    if args.full or args.rebuild or today.weekday() == 6:
        return DATA_START
    lookback = (today - timedelta(days=LOOKBACK_DAYS)).date().isoformat()
    return max(lookback, DATA_START)


def ingest(engine, since: str) -> int:
    resolver = transform.NeighborhoodResolver()
    frames, failures = [], []

    for label, fetch, clean in [
        ("new system", extract.fetch_new_system, transform.transform_new_system),
        ("legacy", extract.fetch_legacy, transform.transform_legacy),
    ]:
        try:
            raw = fetch(since)
            df = clean(raw)
            print(f"  {label}: {len(raw)} fetched, {len(df)} kept")
            frames.append(df)
        except Exception as exc:
            print(f"  {label}: FAILED ({exc})")
            failures.append(label)

    if len(failures) == 2:
        raise RuntimeError("Both 311 feeds failed; not updating anything")

    combined = pd.concat(frames, ignore_index=True).drop_duplicates(subset="case_id", keep="last")
    combined = resolver.apply(combined)
    written = upsert_cases(engine, combined)
    print(f"  upserted {written} cases")
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", help="re-pull cases opened on or after this date (YYYY-MM-DD)")
    parser.add_argument("--full", action="store_true", help="re-pull everything since DATA_START")
    parser.add_argument("--rebuild", action="store_true", help="drop and recreate the cases table first")
    parser.add_argument("--skip-ingest", action="store_true", help="only build the static JSON")
    parser.add_argument("--skip-build", action="store_true", help="only ingest")
    args = parser.parse_args(argv)

    engine = get_engine()
    ensure_schema(engine, rebuild=args.rebuild)
    print(f"Synced {sync_topic_categories(engine)} topic mappings")

    if not args.skip_ingest:
        since = pick_since(args)
        print(f"Ingesting cases opened since {since}")
        ingest(engine, since)

    if not args.skip_build:
        build(engine)


if __name__ == "__main__":
    main()
