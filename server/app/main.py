from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, status
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from app.routers.tasks import router as tasks_router
from fastapi.middleware.cors import CORSMiddleware
from app.routers.backups import router as backups_router
from app.routers.planning_cycles import (
    router as planning_cycles_router,
)
from app.routers.goals import router as goals_router
from app.routers.goal_milestones import (
    router as goal_milestones_router,
)

from app.routers.recurring_rules import router as recurring_rules_router
from app.routers.recurring_exceptions import router as recurring_exceptions_router
from app.routers.weekly_commitments import router as weekly_commitments_router
from app.routers.weekly_reviews import router as weekly_reviews_router
from app.routers.weekly_task_decisions import router as weekly_task_decisions_router
from app.routers.cycle_reviews import router as cycle_reviews_router
from app.routers.brain_dumps import router as brain_dumps_router
from app.routers.task_templates import router as task_templates_router
from app.routers.recurring_task_workflows import (
    router as recurring_task_workflows_router,
)
from app.routers.owner_setup import router as owner_setup_router
from app.routers.auth import (
    SESSION_COOKIE_NAME,
    require_authenticated_session,
    router as auth_router,
)

from app.config import (
    API_PREFIX,
    API_VERSION,
    APP_NAME,
    APP_VERSION,
    POSTGRES_DB,
)
from app.database import check_database_connection

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description="Self-hosted API backend for WeekFlow.",
    # Register documentation explicitly below, behind the session guard.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://10.0.0.247:8081"
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
)

# Login and setup must be reachable before the caller has a session.
app.include_router(owner_setup_router)
app.include_router(auth_router)

# Add feature endpoints through this router so they share one session guard.
# The guard runs before their endpoint functions. Browser writes require CSRF.
protected_api = APIRouter(dependencies=[Depends(require_authenticated_session)])
protected_api.include_router(backups_router)
protected_api.include_router(tasks_router)
protected_api.include_router(planning_cycles_router)
protected_api.include_router(goals_router)
protected_api.include_router(goal_milestones_router)
protected_api.include_router(recurring_rules_router)
protected_api.include_router(recurring_exceptions_router)
protected_api.include_router(weekly_commitments_router)
protected_api.include_router(weekly_reviews_router)
protected_api.include_router(weekly_task_decisions_router)
protected_api.include_router(cycle_reviews_router)
protected_api.include_router(brain_dumps_router)
protected_api.include_router(task_templates_router)
protected_api.include_router(recurring_task_workflows_router)


@app.middleware("http")
async def private_response_headers(request: Request, call_next):
    """Keep API responses out of caches, including ordinary error responses."""
    response = await call_next(request)
    response.headers.update({
        "Cache-Control": "no-store",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Resource-Policy": "same-origin",
    })
    # Clear an unusable browser session on a protected request, but preserve
    # an existing session if a separate password-login attempt was incorrect.
    login_paths = {f"{API_PREFIX}/auth/web/login", f"{API_PREFIX}/auth/native/login"}
    if (
        response.status_code == 401
        and request.url.path not in login_paths
        and SESSION_COOKIE_NAME in request.cookies
        and not any(
            value.startswith(SESSION_COOKIE_NAME + "=")
            for value in response.headers.getlist("set-cookie")
        )
    ):
        response.delete_cookie(
            SESSION_COOKIE_NAME, path="/", secure=True, httponly=True, samesite="strict",
        )
    return response


@app.get("/")
def root():
    """Return basic information confirming the WeekFlow API is running."""
    return {
        "service": APP_NAME,
        "version": APP_VERSION,
        "apiVersion": API_VERSION,
        "message": "WeekFlow API is running",
    }

@app.get("/health")
def health_check():
    """Confirm that the WeekFlow API process is running."""

    return {
        "status": "ok",
        "service": APP_NAME,
    }

@protected_api.get(f"{API_PREFIX}/database/health")
def database_health():
    """Confirm that the API can communicate with PostgreSQL."""

    try:
        check_database_connection()
    except SQLAlchemyError:
        # 503 means the API is running but a required service is unavailable.
        # We return a safe message instead of exposing database error details.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from None

    return {
        "status": "ok",
        "database": POSTGRES_DB,
    }

@protected_api.get(f"{API_PREFIX}/info")
def api_info():
    return {
        "name": APP_NAME,
        "version": APP_VERSION,
        "apiVersion": API_VERSION,
    }


@protected_api.get("/openapi.json", include_in_schema=False)
def authenticated_openapi():
    """Return API documentation only after checking the login session."""
    return JSONResponse(app.openapi())


@protected_api.get("/docs", include_in_schema=False)
def authenticated_swagger(request: Request):
    """Serve Swagger UI using the same session guard as feature APIs."""
    root_path = request.scope.get("root_path", "").rstrip("/")
    return get_swagger_ui_html(
        openapi_url=f"{root_path}/openapi.json",
        title=f"{APP_NAME} - Swagger UI",
    )


@protected_api.get("/redoc", include_in_schema=False)
def authenticated_redoc(request: Request):
    """Serve ReDoc without exposing an unprotected schema endpoint."""
    root_path = request.scope.get("root_path", "").rstrip("/")
    return get_redoc_html(
        openapi_url=f"{root_path}/openapi.json",
        title=f"{APP_NAME} - ReDoc",
    )


# Include after all protected routes have been declared.
app.include_router(protected_api)
