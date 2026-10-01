"""Postgres schema, reference tables, and bulk upserts."""
from __future__ import annotations

import pandas as pd
from psycopg2.extras import execute_values
from sqlalchemy import create_engine

from .config import TOPICS_CSV, database_url
from .transform import CASE_COLUMNS, clean_text

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS cases (
    case_id               TEXT PRIMARY KEY,
    open_date             TIMESTAMPTZ NOT NULL,
    close_date            TIMESTAMPTZ,
    target_close_date     TIMESTAMPTZ,
    case_topic            TEXT,
    service_name          TEXT,
    assigned_department   TEXT,
    assigned_team         TEXT,
    case_status           TEXT,
    closure_reason        TEXT,
    closure_comments      TEXT,
    on_time               TEXT,
    report_source         TEXT,
    full_address          TEXT,
    street_number         TEXT,
    street_name           TEXT,
    zip_code              TEXT,
    neighborhood          TEXT,
    public_works_district TEXT,
    city_council_district TEXT,
    fire_district         TEXT,
    police_district       TEXT,
    ward                  INTEGER,
    precinct              INTEGER,
    longitude             DOUBLE PRECISION,
    latitude              DOUBLE PRECISION,
    source_dataset        TEXT,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cases_open_date_idx ON cases (open_date);
CREATE INDEX IF NOT EXISTS cases_neighborhood_idx ON cases (neighborhood);

CREATE TABLE IF NOT EXISTS topic_categories (
    case_topic        TEXT PRIMARY KEY,
    umbrella_category TEXT NOT NULL
);
"""


def get_engine():
    return create_engine(database_url(), pool_pre_ping=True)


def ensure_schema(engine, rebuild: bool = False):
    with engine.begin() as conn:
        if rebuild:
            print("Dropping and recreating the cases table")
            conn.exec_driver_sql("DROP TABLE IF EXISTS cases")
        else:
            columns = {row[0] for row in conn.exec_driver_sql(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = 'cases'"
            )}
            if columns and "source_dataset" not in columns:
                raise RuntimeError(
                    "The cases table predates this pipeline. Run once with --rebuild to recreate it."
                )
        conn.exec_driver_sql(SCHEMA_SQL)


def read_topic_categories() -> dict[str, str]:
    df = pd.read_csv(TOPICS_CSV)
    return {clean_text(t): c for t, c in zip(df["case_topic"], df["umbrella_category"])}


def sync_topic_categories(engine) -> int:
    """The CSV in the repo is the source of truth; mirror it into Postgres for SQL exploration."""
    topics = read_topic_categories()
    raw = engine.raw_connection()
    try:
        with raw.cursor() as cur:
            cur.execute("DELETE FROM topic_categories")
            execute_values(cur, "INSERT INTO topic_categories (case_topic, umbrella_category) VALUES %s",
                           list(topics.items()))
        raw.commit()
    finally:
        raw.close()
    return len(topics)


def _py(value):
    if value is None:
        return None
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.to_pydatetime()
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(value, "item"):  # numpy scalar -> python
        return value.item()
    return value


def upsert_cases(engine, df: pd.DataFrame, batch_size: int = 1000) -> int:
    if df.empty:
        return 0
    cols = CASE_COLUMNS
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "case_id")
    sql = (
        f"INSERT INTO cases ({', '.join(cols)}) VALUES %s "
        f"ON CONFLICT (case_id) DO UPDATE SET {updates}, updated_at = NOW()"
    )
    rows = [tuple(_py(v) for v in row) for row in df[cols].itertuples(index=False, name=None)]

    raw = engine.raw_connection()
    try:
        with raw.cursor() as cur:
            for start in range(0, len(rows), batch_size):
                execute_values(cur, sql, rows[start:start + batch_size], page_size=batch_size)
        raw.commit()
    finally:
        raw.close()
    return len(rows)
