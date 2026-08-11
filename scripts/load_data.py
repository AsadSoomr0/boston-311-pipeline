import pandas as pd
from sqlalchemy import create_engine
import os
from dotenv import load_dotenv

load_dotenv()

engine = create_engine(os.getenv("DATABASE_URL"))

df = pd.read_csv("data/311_raw.csv")

# clean up: drop empty columns, parse dates
df = df.drop(columns=["submitted_photo", "closed_photo"])
df["open_date"] = pd.to_datetime(df["open_date"], format="ISO8601")
df["close_date"] = pd.to_datetime(df["close_date"], format="ISO8601")
df["target_close_date"] = pd.to_datetime(df["target_close_date"], format="ISO8601")

df.to_sql("cases", engine, if_exists="replace", index=False)

print(f"Loaded {len(df)} rows into 'cases' table")