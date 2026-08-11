import os

from dotenv import load_dotenv
from fastapi import FastAPI
from sqlalchemy import create_engine, text
from typing import Optional

load_dotenv()

app = FastAPI()
engine = create_engine(os.getenv("DATABASE_URL"))
@app.get("/api/cases")
def get_cases(status: Optional[str] = None):
    query = "SELECT * FROM cases"
    params = {}

    if status == "open":
        query += " WHERE case_status != 'Closed'"
    elif status == "closed":
        query += " WHERE case_status = 'Closed'"

    query += " LIMIT 100"

    with engine.connect() as conn:
        result = conn.execute(text(query), params)
        rows = [dict(row._mapping) for row in result]
    return rows