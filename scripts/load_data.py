import os
from datetime import datetime

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine

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

topic_categories = {
    "Domestic Animal Issue": "Animals",
    "Wild Animal Issue": "Animals",
    "Dead Animal General": "Animals",
    "Lost Pet": "Animals",
    "Park Dead Animal": "Animals",

    "Litter & Debris": "Trash & Sanitation",
    "Missed Waste Pick-up": "Trash & Sanitation",
    "Improper Trash Storage": "Trash & Sanitation",
    "Illegal Dumping or Disposal": "Trash & Sanitation",
    "Trash Placed Out Early": "Trash & Sanitation",
    "Overflowing Trash": "Trash & Sanitation",
    "Illegal Graffiti": "Trash & Sanitation",
    "Construction Debris": "Trash & Sanitation",
    "Sticker Request": "Trash & Sanitation",
    "Broken Public Waste Receptacle": "Trash & Sanitation",
    "Request New Public Waste Receptacle": "Trash & Sanitation",
    "Code Enforcement Collection": "Trash & Sanitation",

    "Street Light Outage": "Street Infrastructure",
    "Street Light Other": "Street Infrastructure",
    "Street Light Knockdown": "Street Infrastructure",
    "Pothole": "Street Infrastructure",
    "Sidewalk Repair": "Street Infrastructure",
    "Illegally Blocked Sidewalk": "Street Infrastructure",
    "Unshoveled Sidewalk": "Street Infrastructure",
    "Utility Contractor Complaints": "Street Infrastructure",
    "Utility Casting Repair": "Street Infrastructure",
    "Missing Manhole Cover": "Street Infrastructure",
    "Lane Divider": "Street Infrastructure",
    "Fences/Guardrails/Bollards": "Street Infrastructure",
    "Bridge Maintenance": "Street Infrastructure",
    "News Boxes": "Street Infrastructure",
    "Snow Plowing": "Street Infrastructure",
    "Emergency Responder Snow Plowing": "Street Infrastructure",

    "Fallen Tree or Branches": "Parks & Trees",
    "Pruning Request": "Parks & Trees",
    "Park Groundskeeping": "Parks & Trees",
    "Tree or Stump Removal": "Parks & Trees",
    "Broken Park Equipment": "Parks & Trees",
    "Overgrown Weeds": "Parks & Trees",
    "Planting Request": "Parks & Trees",
    "Park Litter & Debris": "Parks & Trees",
    "Park Overflowing Trash Can": "Parks & Trees",
    "Parks General Request": "Parks & Trees",
    "Ballfield Issue": "Parks & Trees",
    "Park Light Outage": "Parks & Trees",
    "Park Graffiti": "Parks & Trees",
    "Park Suggestions": "Parks & Trees",
    "Locked Gates": "Parks & Trees",
    "Cemetery Maintenance": "Parks & Trees",

    "Unauthorized Signage": "Permits & Signage",
    "Unauthorized Vending": "Permits & Signage",
    "Illegal Yard Parking": "Permits & Signage",
    "Municipal Lots": "Permits & Signage",

    "Other": "Other",
    "Dropped Personal Item": "Other",
    "PWD General": "Other",
    "External referral": "Other",
}
topics_df = pd.DataFrame(
    list(topic_categories.items()),
    columns=["case_topic", "umbrella_category"]
)
topics_df.to_sql("topic_categories", engine, if_exists="replace", index=False)
print(f"Loaded {len(topics_df)} topic mappings")

