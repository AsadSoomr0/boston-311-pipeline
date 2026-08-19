# Boston 311 Service Request Map

An interactive map of Boston 311 service requests, showing neighborhood-level trends and response times. Built as an end-to-end data engineering project: live data ingestion, a normalized Postgres schema, a filtering API, and an interactive frontend.

**[Live site →](https://311-map-boston.netlify.app/)**

## What it does

- **Choropleth map** of Boston neighborhoods, color-coded by 311 requests per 1,000 residents (normalized by population rather than raw counts)
- **Response Time tab** showing median response time by neighborhood and category, using the same map with a separate color scale
- **Category and status filters** (Animals, Trash & Sanitation, Street Infrastructure, Parks & Trees, Permits & Signage, Other; Open/Closed/All)
- **Zoom-in drill-down**: zooming into a neighborhood reveals individual cases reported in the last 30 days, color-coded red (open) or green (closed), with full case details on click
- **Live daily updates**: the underlying data refreshes automatically once a day from Boston's open data portal

## Architecture

```
Analyze Boston (CKAN API)
        │
        ▼
GitHub Actions (daily cron)  ──▶  Neon (Postgres)  ◀──  Render (FastAPI)
                                                              │
                                                              ▼
                                                    Netlify (static frontend)
```

- **Data source**: [Analyze Boston's 311 Service Requests dataset](https://data.boston.gov/dataset/311-service-requests), queried via the CKAN Datastore API
- **Database**: PostgreSQL, hosted on [Neon](https://neon.tech). Three tables: `cases` (the 311 requests), `topic_categories` (a lookup mapping the ~55 raw case topics into 6 broader umbrella categories), and `neighborhood_population` (BPDA population estimates, used to normalize the choropleth)
- **Backend**: FastAPI, hosted on [Render](https://render.com), serving filtered/aggregated queries over the Postgres data
- **Frontend**: Vanilla HTML/JS/CSS with [Leaflet.js](https://leafletjs.com/), hosted on [Netlify](https://netlify.com)
- **Orchestration**: An [Apache Airflow](https://airflow.apache.org/) DAG (`dags/update_311_data.py`) defines the incremental daily ingestion pipeline — fetch new/updated cases since the last run, transform, and upsert. In production, the same logic runs via a scheduled [GitHub Actions workflow](.github/workflows/daily-update.yml) rather than a hosted Airflow deployment.

## Local development

**Requirements**: Docker Desktop, Python 3.

```bash
# Start Postgres, Airflow (webserver + scheduler), and their metadata DB
docker compose up -d

# Load the initial dataset and reference tables
python scripts/load_data.py

# Run the API
uvicorn api.main:app --reload

# Serve the frontend
cd frontend && python -m http.server 5500
```

Airflow UI: `http://localhost:8080` (default login `admin` / `admin`)
API: `http://localhost:8000`
Frontend: `http://localhost:5500`

## Project structure

```
api/                FastAPI backend
dags/               Airflow DAG (reference implementation)
frontend/           Static HTML/JS/CSS map
scripts/
  load_data.py      One-time initial data load + reference table setup
  daily_update.py   Standalone incremental update script (used by GitHub Actions)
.github/workflows/  Scheduled GitHub Actions workflow
docker-compose.yml  Local Postgres + Airflow stack
```

## Known limitations

- **Boston 311 backend transition**: as of late 2025/2026, Boston's 311 system is mid-migration to a new backend, with some case types split across a legacy dataset and a differently-structured "new system" dataset. This project currently ingests only the legacy dataset. The city has also acknowledged a bug where some 2026 case types are being dropped from the legacy export during the transition.
- **Free-tier hosting**: the backend (Render) spins down after ~15 minutes of inactivity. The first request after a period of inactivity can take 30-60 seconds while it wakes up; the frontend shows a loading indicator during this window.
- **Two neighborhoods' population figures are approximated**: Bay Village and the Leather District aren't broken out separately in the population dataset used, so their per-capita rates borrow South End's and Chinatown's population figures, respectively (their neighboring, most closely associated areas).

## Tech stack

Python, FastAPI, SQLAlchemy, PostgreSQL, Apache Airflow, Pandas, Leaflet.js, Docker, GitHub Actions
