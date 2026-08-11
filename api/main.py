import os

from dotenv import load_dotenv
from fastapi import FastAPI
from sqlalchemy import create_engine, text
from typing import Optional

load_dotenv()

app = FastAPI()
engine = create_engine(os.getenv("DATABASE_URL"))
@app.get("/api/cases")
def get_cases(
    status: Optional[str] = None,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
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

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " LIMIT 100"

    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        rows = [dict(row._mapping) for row in result]
    return rows