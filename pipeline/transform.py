"""Normalize both 311 feeds into the `cases` table shape."""
from __future__ import annotations

import json
import re

import pandas as pd
from shapely.geometry import Point, shape
from shapely.prepared import prep

from .config import GEOJSON_PATH, PLACEHOLDER_COORDS

CASE_COLUMNS = [
    "case_id", "open_date", "close_date", "target_close_date",
    "case_topic", "service_name", "assigned_department", "assigned_team",
    "case_status", "closure_reason", "closure_comments", "on_time",
    "report_source", "full_address", "street_number", "street_name", "zip_code",
    "neighborhood", "public_works_district", "city_council_district",
    "fire_district", "police_district", "ward", "precinct",
    "longitude", "latitude", "source_dataset",
]

LEGACY_COLUMN_MAP = {
    "case_enquiry_id": "case_id",
    "open_dt": "open_date",
    "closed_dt": "close_date",
    "sla_target_dt": "target_close_date",
    "type": "case_topic",
    "case_title": "service_name",
    "department": "assigned_department",
    "queue": "assigned_team",
    "case_status": "case_status",
    "closure_reason": "closure_comments",
    "on_time": "on_time",
    "source": "report_source",
    "location": "full_address",
    "location_street_name": "street_name",
    "location_zipcode": "zip_code",
    "neighborhood": "neighborhood",
    "pwd_district": "public_works_district",
    "city_council_district": "city_council_district",
    "fire_district": "fire_district",
    "police_district": "police_district",
    "ward": "ward",
    "precinct": "precinct",
    "latitude": "latitude",
    "longitude": "longitude",
}

TEXT_COLUMNS = [
    "case_id", "case_topic", "service_name", "assigned_department", "assigned_team",
    "case_status", "closure_reason", "closure_comments", "on_time", "report_source",
    "full_address", "street_number", "street_name", "zip_code", "neighborhood",
    "public_works_district", "city_council_district", "fire_district", "police_district",
]


def clean_text(value):
    """Strip and collapse whitespace ("Heat - Excessive  Insufficient" -> single spaces)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def parse_ward(value):
    digits = re.sub(r"\D", "", str(value)) if value is not None else ""
    return int(digits) if digits else None


def parse_precinct(value):
    """Precinct codes look like '0502A' (ward 05, precinct 02). Keep the precinct part."""
    digits = re.sub(r"\D", "", str(value)) if value is not None else ""
    if not digits:
        return None
    return int(digits[2:4]) if len(digits) >= 4 else int(digits)


def _to_utc(series: pd.Series, local_tz: str | None) -> pd.Series:
    if local_tz is None:
        return pd.to_datetime(series, errors="coerce", format="mixed", utc=True)
    # Naive legacy timestamps are Boston local time, so localize before converting.
    parsed = pd.to_datetime(series, errors="coerce", format="mixed")
    if parsed.dt.tz is None:
        parsed = parsed.dt.tz_localize(local_tz, ambiguous="NaT", nonexistent="shift_forward")
    return parsed.dt.tz_convert("UTC")


def _finish(df: pd.DataFrame, local_tz: str | None, source: str) -> pd.DataFrame:
    for col in CASE_COLUMNS:
        if col not in df.columns:
            df[col] = None
    df = df[CASE_COLUMNS].copy()
    df["source_dataset"] = source

    for col in ["open_date", "close_date", "target_close_date"]:
        df[col] = _to_utc(df[col], local_tz)

    for col in TEXT_COLUMNS:
        df[col] = df[col].map(clean_text)

    df["ward"] = df["ward"].map(parse_ward)
    df["precinct"] = df["precinct"].map(parse_precinct)
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")

    placeholder = [
        (round(lat, 4), round(lng, 4)) in PLACEHOLDER_COORDS
        for lat, lng in zip(df["latitude"].fillna(0), df["longitude"].fillna(0))
    ]
    df.loc[placeholder, ["latitude", "longitude"]] = None

    df = df.dropna(subset=["case_id", "open_date"])
    return df.drop_duplicates(subset="case_id", keep="last")


def transform_new_system(raw: pd.DataFrame) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame(columns=CASE_COLUMNS)
    return _finish(raw.copy(), local_tz=None, source="new_system")


def transform_legacy(raw: pd.DataFrame) -> pd.DataFrame:
    if raw.empty:
        return pd.DataFrame(columns=CASE_COLUMNS)
    df = raw.rename(columns=LEGACY_COLUMN_MAP)
    return _finish(df, local_tz="America/New_York", source="legacy")


class NeighborhoodResolver:
    """Point-in-polygon lookup against the same GeoJSON the map draws."""

    def __init__(self, geojson_path=GEOJSON_PATH):
        with open(geojson_path) as f:
            features = json.load(f)["features"]
        self.polygons = [
            (feat["properties"]["name"], prep(shape(feat["geometry"])))
            for feat in features
        ]
        self.names = {name for name, _ in self.polygons}

    def lookup(self, lat, lng):
        if pd.isna(lat) or pd.isna(lng):
            return None
        point = Point(lng, lat)
        for name, polygon in self.polygons:
            if polygon.contains(point):
                return name
        return None

    def apply(self, df: pd.DataFrame) -> pd.DataFrame:
        """Fix rows whose neighborhood isn't a map name (e.g. 'South Boston / South Boston Waterfront')."""
        needs_fix = ~df["neighborhood"].isin(self.names)
        df.loc[needs_fix, "neighborhood"] = [
            self.lookup(lat, lng)
            for lat, lng in zip(df.loc[needs_fix, "latitude"], df.loc[needs_fix, "longitude"])
        ]
        return df
