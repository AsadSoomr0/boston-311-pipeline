import os
import requests
import pandas as pd
from datetime import datetime, timedelta
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

CKAN_RESOURCE_ID = "1a0b420d-99f1-4887-9851-990b2a5a6e17"
CKAN_URL = "https://data.boston.gov/api/3/action/datastore_search_sql"
DB_CONN = os.getenv("NEON_DATABASE_URL")

COLUMN_MAP = {
    "case_enquiry_id": "case_id",
    "open_dt": "open_date",
    "closed_dt": "close_date",
    "sla_target_dt": "target_close_date",
    "type": "case_topic",
    "case_title": "service_name",
    "department": "assigned_department",
    "queue": "assigned_team",
    "location": "full_address",
    "location_street_name": "street_name",
    "location_zipcode": "zip_code",
    "pwd_district": "public_works_district",
    "source": "report_source",
    "on_time": "on_time",
    "case_status": "case_status",
    "closure_reason": "closure_reason",
    "neighborhood": "neighborhood",
    "city_council_district": "city_council_district",
    "fire_district": "fire_district",
    "police_district": "police_district",
    "ward": "ward",
    "precinct": "precinct",
    "latitude": "latitude",
    "longitude": "longitude",
}


def fetch_new_cases(engine):
    with engine.connect() as conn:
        result = conn.execute(text("SELECT MAX(open_date) FROM cases"))
        last_open_date = result.scalar()

    if last_open_date is None:
        last_open_date = datetime.now() - timedelta(days=1)

    since_str = last_open_date.strftime("%Y-%m-%d %H:%M:%S")

    sql = f"""
        SELECT * FROM "{CKAN_RESOURCE_ID}"
        WHERE open_dt > '{since_str}'
        ORDER BY open_dt ASC
        LIMIT 5000
    """
    response = requests.get(CKAN_URL, params={"sql": sql}, timeout=60)
    response.raise_for_status()
    records = response.json()["result"]["records"]

    print(f"Fetched {len(records)} new/updated cases since {since_str}")
    return records


def load_new_cases(engine, records):
    if not records:
        print("No new records to load.")
        return

    df = pd.DataFrame(records)
    df = df.rename(columns=COLUMN_MAP)
    df = df[[col for col in COLUMN_MAP.values() if col in df.columns]]

    df["open_date"] = pd.to_datetime(df["open_date"], errors="coerce")
    df["close_date"] = pd.to_datetime(df["close_date"], errors="coerce")
    df["target_close_date"] = pd.to_datetime(df["target_close_date"], errors="coerce")
    df["ward"] = df["ward"].astype(str).str.extract(r"(\d+)")
    df["precinct"] = df["precinct"].astype(str).str.extract(r"(\d+)")

    success_count = 0
    error_count = 0

    with engine.begin() as conn:
        for _, row in df.iterrows():
            row_dict = {k: (None if pd.isna(v) else v) for k, v in row.to_dict().items()}

            columns = ", ".join(row_dict.keys())
            placeholders = ", ".join(f":{col}" for col in row_dict.keys())
            update_clause = ", ".join(f"{col} = EXCLUDED.{col}" for col in row_dict.keys() if col != "case_id")

            upsert_sql = f"""
                INSERT INTO cases ({columns})
                VALUES ({placeholders})
                ON CONFLICT (case_id) DO UPDATE SET {update_clause}
            """
            try:
                conn.execute(text(upsert_sql), row_dict)
                success_count += 1
            except Exception as e:
                error_count += 1
                print(f"Skipped case_id={row_dict.get('case_id')} due to error: {e}")

    print(f"Upserted {success_count} cases, skipped {error_count} due to errors.")


if __name__ == "__main__":
    engine = create_engine(DB_CONN)
    records = fetch_new_cases(engine)
    load_new_cases(engine, records)