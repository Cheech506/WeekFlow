# Capstone WK1 — FastAPI and PostgreSQL Foundation

**Date:** September 4, 2026  
**Status:** Complete

## Summary

WeekFlow’s first capstone week established the foundation for moving the
application from local SQLite storage to a self-hosted client/server system.

The existing React Native application remains functional and continues using
SQLite. A separate FastAPI backend now runs alongside it and can communicate
with PostgreSQL through Docker Compose.

## Architecture

The current mobile architecture is:

```text
React Native
    ↓
React Context
    ↓
Storage modules
    ↓
SQLite
```

The target capstone architecture is:

```text
Mobile and web clients
          ↓
      FastAPI API
          ↓
      PostgreSQL
```

## FastAPI Foundation

Created a Python backend under `server/` with:

- An isolated Python virtual environment
- FastAPI and Uvicorn
- Central application configuration
- API name and version information
- Interactive Swagger documentation
- Backend setup and run instructions

The current API endpoints are:

- `GET /`
- `GET /health`
- `GET /api/v1/info`
- `GET /api/v1/database/health`

## PostgreSQL Foundation

Added a PostgreSQL 17 development database using Docker Compose.

The database setup includes:

- A PostgreSQL container
- A persistent Docker volume
- A database health check
- Localhost-only port forwarding
- Environment-based configuration
- An ignored private `.env` file
- A committed `.env.example` file

Verified the database directly with `psql` and confirmed that the `weekflow`
database and `weekflow` user were created successfully.

## Python Database Layer

Added SQLAlchemy and Psycopg to connect Python to PostgreSQL.

The database layer provides:

- A safely constructed PostgreSQL connection URL
- A shared SQLAlchemy engine
- A database session factory
- A declarative base for future models
- A reusable FastAPI database-session dependency
- A PostgreSQL connection check

The API returns `200 OK` when PostgreSQL is available and a safe
`503 Service Unavailable` response when the database cannot be reached.

## Testing

Backend validation:

- Five pytest tests passed
- API process health tested
- API version information tested
- Direct PostgreSQL communication tested
- Successful database-health response tested
- Unavailable-database response tested

Existing application regression validation:

- TypeScript check passed
- 28 Jest suites passed
- 197 Jest tests passed
- All five primary mobile tabs opened correctly
- Settings opened correctly
- Task creation, editing, scheduling, completion, and History were checked
- Brain Dump editing and cancellation were checked
- Local SQLite persistence was checked

One existing FastAPI TestClient deprecation warning remains and does not cause
a test failure.

## Result

WeekFlow now has a working FastAPI backend and an initial PostgreSQL connection
while preserving the existing React Native and SQLite application.

The database does not contain WeekFlow application tables yet.

## Next Steps

The next backend work will introduce:

- Alembic database migrations
- The first server-side models
- PostgreSQL tables and constraints
- Task API endpoints
- Automated model and API tests
