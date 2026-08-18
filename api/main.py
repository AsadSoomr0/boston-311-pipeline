import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text, bindparam

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
    category: Optional[list[str]] = Query(None),
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
        conditions.append("topic_categories.umbrella_category IN :category")
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

    stmt = text(query)
    if "category" in params:
        stmt = stmt.bindparams(bindparam("category", expanding=True))

    with engine.connect() as conn:
        result = conn.execute(stmt, params)
        rows = [dict(row._mapping) for row in result]
    return rows

@app.get("/api/cases/by-neighborhood")
def get_cases_by_neighborhood(
    status: Optional[str] = None,
    category: Optional[list[str]] = Query(None),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    query = """
        SELECT 
            cases.neighborhood,
            COUNT(*) as case_count,
            neighborhood_population.population,
            ROUND((COUNT(*)::numeric / neighborhood_population.population::numeric) * 1000, 2) as cases_per_1000,
            ROUND(
                (PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (cases.close_date - cases.open_date)) / 3600
                ) FILTER (WHERE cases.close_date IS NOT NULL))::numeric, 1
            ) as median_response_hours
        FROM cases
        JOIN topic_categories ON cases.case_topic = topic_categories.case_topic
        JOIN neighborhood_population ON cases.neighborhood = neighborhood_population.neighborhood
    """
    
    conditions = []
    params = {}

    if status == "open":
        conditions.append("cases.case_status != 'Closed'")
    elif status == "closed":
        conditions.append("cases.case_status = 'Closed'")

    if category:
        conditions.append("topic_categories.umbrella_category IN :category")
        params["category"] = category

    if start_date:
        conditions.append("cases.open_date >= :start_date")
        params["start_date"] = start_date

    if end_date:
        conditions.append("cases.open_date <= :end_date")
        params["end_date"] = end_date

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " GROUP BY cases.neighborhood, neighborhood_population.population"

    stmt = text(query)
    if "category" in params:
        stmt = stmt.bindparams(bindparam("category", expanding=True))

    with engine.connect() as conn:
        result = conn.execute(stmt, params)
        rows = [dict(row._mapping) for row in result]
    return rows