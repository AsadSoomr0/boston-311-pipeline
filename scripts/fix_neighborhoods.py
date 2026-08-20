import os
import json
import pandas as pd
from sqlalchemy import create_engine, text, bindparam
from shapely.geometry import shape, Point
from dotenv import load_dotenv

load_dotenv()

DB_CONN = os.getenv("NEON_DATABASE_URL")

with open("frontend/boston_neighborhoods.json") as f:
    NEIGHBORHOODS_GEO = json.load(f)

VALID_NEIGHBORHOODS = {f["properties"]["name"] for f in NEIGHBORHOODS_GEO["features"]}


def resolve_neighborhood(lat, lng):
    try:
        point = Point(float(lng), float(lat))
    except (ValueError, TypeError):
        return None
    for feature in NEIGHBORHOODS_GEO["features"]:
        polygon = shape(feature["geometry"])
        if polygon.contains(point):
            return feature["properties"]["name"]
    return None


engine = create_engine(DB_CONN)

with engine.connect() as conn:
    result = conn.execute(text("""
        SELECT case_id, latitude, longitude, neighborhood
        FROM cases
        WHERE neighborhood NOT IN :valid OR neighborhood IS NULL
    """).bindparams(bindparam("valid", expanding=True)), {"valid": list(VALID_NEIGHBORHOODS)})
    rows = result.fetchall()

print(f"Found {len(rows)} cases with non-standard neighborhood names.")

fixed = 0
with engine.begin() as conn:
    for row in rows:
        new_neighborhood = resolve_neighborhood(row.latitude, row.longitude)
        if new_neighborhood:
            conn.execute(
                text("UPDATE cases SET neighborhood = :n WHERE case_id = :id"),
                {"n": new_neighborhood, "id": row.case_id}
            )
            fixed += 1

print(f"Fixed {fixed} of {len(rows)} cases.")