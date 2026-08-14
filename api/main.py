import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

engine = create_engine(os.getenv("DATABASE_URL"))
@app.get("/api/cases")
def get_cases(
    status: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    neighborhood: Optional[str] = None,
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lng: Optional[float] = None,
    max_lng: Optional[float] = None,
):
    query = """
        SELECT cases.*, topic_categories.umbrella_category
        FROM cases
        JOIN topic_categories ON cases.case_topic = topic_categories.case_topic
    """
    conditions = []
    params = {}

    if status == "open":
        conditions.append("cases.case_status != 'Closed'")
    elif status == "closed":
        conditions.append("cases.case_status = 'Closed'")

    if category:
        conditions.append("topic_categories.umbrella_category = :category")
        params["category"] = category

    if start_date:
        conditions.append("cases.open_date >= :start_date")
        params["start_date"] = start_date

    if end_date:
        conditions.append("cases.open_date <= :end_date")
        params["end_date"] = end_date

    if neighborhood:
        conditions.append("cases.neighborhood = :neighborhood")
        params["neighborhood"] = neighborhood

    if min_lat is not None and max_lat is not None:
        conditions.append("cases.latitude BETWEEN :min_lat AND :max_lat")
        params["min_lat"] = min_lat
        params["max_lat"] = max_lat

    if min_lng is not None and max_lng is not None:
        conditions.append("cases.longitude BETWEEN :min_lng AND :max_lng")
        params["min_lng"] = min_lng
        params["max_lng"] = max_lng

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " LIMIT 200"

    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        rows = [dict(row._mapping) for row in result]
    return rows

@app.get("/api/cases/by-neighborhood")
def get_cases_by_neighborhood(
    status: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    query = """
        SELECT cases.neighborhood, COUNT(*) as case_count
        FROM cases
        JOIN topic_categories ON cases.case_topic = topic_categories.case_topic
    """
    conditions = []
    params = {}

    if status == "open":
        conditions.append("cases.case_status != 'Closed'")
    elif status == "closed":
        conditions.append("cases.case_status = 'Closed'")

    if category:
        conditions.append("topic_categories.umbrella_category = :category")
        params["category"] = category

    if start_date:
        conditions.append("cases.open_date >= :start_date")
        params["start_date"] = start_date

    if end_date:
        conditions.append("cases.open_date <= :end_date")
        params["end_date"] = end_date

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " GROUP BY cases.neighborhood"

    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        rows = [dict(row._mapping) for row in result]
    return rows