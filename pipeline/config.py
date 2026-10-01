"""Shared settings for the Boston 311 pipeline (used by GitHub Actions and Airflow)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
OUTPUT_DIR = FRONTEND_DIR / "data"
GEOJSON_PATH = FRONTEND_DIR / "boston_neighborhoods.json"
TOPICS_CSV = Path(__file__).resolve().parent / "topic_categories.csv"

CKAN_SQL_URL = "https://data.boston.gov/api/3/action/datastore_search_sql"
PAGE_SIZE = 5000

# Boston is mid-migration between two 311 systems, so cases are split across two resources.
NEW_SYSTEM_RESOURCE = "254adca6-64ab-4c5c-9fc0-a6da622be185"  # BCS- case ids, UTC timestamps
LEGACY_RESOURCE = "1a0b420d-99f1-4887-9851-990b2a5a6e17"      # numeric ids, Eastern local timestamps

# Earliest open date the site covers. Weekly runs re-sync everything since this date.
DATA_START = os.getenv("DATA_START", "2026-07-01")

# Daily runs re-pull this many days so status changes (open -> closed) get picked up.
LOOKBACK_DAYS = int(os.getenv("LOOKBACK_DAYS", "60"))

# Drill-down pins cover this many days.
RECENT_DAYS = 30

# Response-time medians need at least this many closed cases to be shown.
MIN_RT_SAMPLE = 5

CATEGORIES = [
    "Animals",
    "Trash & Sanitation",
    "Housing",
    "Health & Safety",
    "Street Infrastructure",
    "Parks & Trees",
    "Permits & Signage",
    "Vehicles & Parking",
    "Other",
]

# Neighborhoods missing from the population data share a combined rate with their parent.
RATE_GROUPS = {
    "Bay Village": "South End",
    "Leather District": "Chinatown",
}

# The legacy feed puts cases with no real location at City Hall.
PLACEHOLDER_COORDS = {(42.3594, -71.0587)}


def database_url() -> str:
    url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("Set DATABASE_URL (or NEON_DATABASE_URL) in your environment or .env")
    # Newer SQLAlchemy defaults postgresql:// to psycopg 3; this project uses psycopg2.
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url
