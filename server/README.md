# WeekFlow API

WeekFlow’s backend uses Python and FastAPI.

The current backend provides service information and health-check endpoints.
The mobile application still stores its data locally in SQLite and is not
connected to this backend yet.

## First-time setup

The backend has been tested with Python 3.12.

From the WeekFlow repository root, run these commands using Python 3.12:

```bash
cd server
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

If the virtual environment is already set up, use the startup instructions below.

## Start the development server

From the WeekFlow repository root:

```bash
cd server
source .venv/bin/activate
python -m uvicorn app.main:app --reload
```

Keep this terminal open while using the API.
Press Control+C to stop the server.

The `--reload` option restarts the development server when its source files change.

## Available endpoints

| Address | Purpose |
|---|---|
| http://127.0.0.1:8000/ | Basic service information |
| http://127.0.0.1:8000/health | Check that the API is running |
| http://127.0.0.1:8000/api/v1/info | Application and API versions |
| http://127.0.0.1:8000/docs | Interactive API documentation |

These addresses access the server from the computer running it.

## Run backend tests

In a separate terminal, start from the WeekFlow repository root:

```bash
cd server
source .venv/bin/activate
python -m pytest
```

The current suite contains two endpoint tests.
The development server does not need to be running.

Using `python -m pytest` runs pytest through the selected Python interpreter.

## Configuration

Application metadata is defined in `app/config.py`:

- `APP_NAME`: the service name.
- `APP_VERSION`: the backend application version.
- `API_VERSION`: the API contract version.
- `API_PREFIX`: the base path for versioned endpoints, derived from `API_VERSION`.

## Current scope

PostgreSQL, authentication, and mobile-to-server communication are planned
for later capstone work.