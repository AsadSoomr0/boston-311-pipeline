"""Local Airflow version of the daily pipeline.

Production runs the same `pipeline` package from GitHub Actions (.github/workflows/daily-update.yml).
This DAG exists so the pipeline can also be run and inspected in Airflow locally.
"""
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.python import PythonOperator


def ingest_task():
    from pipeline.load import ensure_schema, get_engine, sync_topic_categories
    from pipeline.run import ingest, pick_since

    class Args:  # mirror the CLI defaults: daily lookback, full re-sync on Sundays
        since = None
        full = False
        rebuild = False

    engine = get_engine()
    ensure_schema(engine)
    sync_topic_categories(engine)
    ingest(engine, pick_since(Args))


def build_task():
    from pipeline.build import build
    from pipeline.load import get_engine

    build(get_engine())


with DAG(
    dag_id="update_311_data",
    start_date=datetime(2026, 7, 1),
    schedule="0 8 * * *",
    catchup=False,
    default_args={"retries": 1, "retry_delay": timedelta(minutes=10)},
    tags=["boston311"],
) as dag:
    ingest_cases = PythonOperator(task_id="ingest_cases", python_callable=ingest_task)
    build_site_data = PythonOperator(task_id="build_site_data", python_callable=build_task)

    ingest_cases >> build_site_data
