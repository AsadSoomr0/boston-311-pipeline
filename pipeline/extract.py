"""Pull raw 311 records from the Analyze Boston CKAN datastore."""
from __future__ import annotations

import time

import pandas as pd
import requests

from .config import CKAN_SQL_URL, LEGACY_RESOURCE, NEW_SYSTEM_RESOURCE, PAGE_SIZE


def _query(sql: str, retries: int = 3) -> list[dict]:
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(CKAN_SQL_URL, params={"sql": sql}, timeout=120)
            resp.raise_for_status()
            body = resp.json()
            if not body.get("success"):
                raise RuntimeError(body.get("error"))
            return body["result"]["records"]
        except Exception as exc:  # network blips are common on this API
            if attempt == retries:
                raise
            print(f"  CKAN request failed ({exc}), retrying in {5 * attempt}s")
            time.sleep(5 * attempt)
    return []


def fetch_since(resource_id: str, date_column: str, since: str) -> pd.DataFrame:
    """Every record whose open date is on or after `since`, paged by _id."""
    pages, offset = [], 0
    while True:
        sql = (
            f'SELECT * FROM "{resource_id}" '
            f"WHERE \"{date_column}\" >= '{since}' "
            f'ORDER BY "_id" LIMIT {PAGE_SIZE} OFFSET {offset}'
        )
        records = _query(sql)
        if records:
            pages.append(pd.DataFrame(records))
        if len(records) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return pd.concat(pages, ignore_index=True) if pages else pd.DataFrame()


def fetch_new_system(since: str) -> pd.DataFrame:
    return fetch_since(NEW_SYSTEM_RESOURCE, "open_date", since)


def fetch_legacy(since: str) -> pd.DataFrame:
    return fetch_since(LEGACY_RESOURCE, "open_dt", since)
