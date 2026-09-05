"""Database connection helpers for WeekFlow."""

from collections.abc import Generator

from sqlalchemy import URL, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import (
    POSTGRES_DB,
    POSTGRES_HOST,
    POSTGRES_PASSWORD,
    POSTGRES_PORT,
    POSTGRES_USER,
)


if not POSTGRES_PASSWORD:
    raise RuntimeError("POSTGRES_PASSWORD must be set in server/.env")


DATABASE_URL = URL.create(
    drivername="postgresql+psycopg",
    username=POSTGRES_USER,
    password=POSTGRES_PASSWORD,
    host=POSTGRES_HOST,
    port=POSTGRES_PORT,
    database=POSTGRES_DB,
)


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
)


SessionLocal = sessionmaker(
    bind=engine,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Shared base class for WeekFlow database models."""

    pass

def check_database_connection() -> bool:
    """Return True when PostgreSQL responds to a simple query."""

    # Opening the connection is what causes SQLAlchemy to contact PostgreSQL.
    with engine.connect() as connection:
        result = connection.execute(text("SELECT 1"))

    # PostgreSQL should return exactly one value: the number 1.
    return result.scalar_one() == 1

def get_db() -> Generator[Session, None, None]:
    """Provide a database session and always close it afterward."""

    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()