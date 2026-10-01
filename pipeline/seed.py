"""One-time: load BPDA neighborhood population estimates into Postgres.

    python -m pipeline.seed data/neighborhood_population.csv

Only needed for a fresh database (Neon already has this table).
"""
from __future__ import annotations

import sys

import pandas as pd

from .config import RATE_GROUPS
from .load import get_engine


def seed_population(csv_path: str) -> int:
    df = pd.read_csv(csv_path)[["name", "population_b01001_001e"]]
    df.columns = ["neighborhood", "population"]
    # Neighborhoods without their own estimate borrow their parent's (the site combines their rates).
    for child, parent in RATE_GROUPS.items():
        if child not in set(df["neighborhood"]):
            parent_pop = df.loc[df["neighborhood"] == parent, "population"].iloc[0]
            df = pd.concat([df, pd.DataFrame([{"neighborhood": child, "population": parent_pop}])])
    df.to_sql("neighborhood_population", get_engine(), if_exists="replace", index=False)
    return len(df)


if __name__ == "__main__":
    print(f"Loaded {seed_population(sys.argv[1])} neighborhood populations")
