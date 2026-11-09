"""Check authentication on the assembled app, not only isolated routers."""

from datetime import UTC, datetime, timedelta
import re
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import main
from app.database import Base, get_db
from app.models import Account, AuthSession, Task
from app.routers import auth as auth_router, owner_setup
from app.services.accounts import CreatedOwner, create_owner_account
from app.services.owner_setup import OwnerSetupStatus
from app.services.sessions import (
    AuthenticatedSession, InvalidCredentialsError, InvalidCsrfTokenError,
    InvalidSessionError, IssuedSession, SessionStorageError,
)
from test_auth_login_throttle_model import throttle_db


app = main.app
TOKEN = "A" * 43
CSRF = "B" * 43
PASSWORD = "a temporary main app auth passphrase"
ORIGIN = {"Origin": "https://weekflow.test"}
BEARER = {"Authorization": "Bearer " + TOKEN}
COOKIE = auth_router.SESSION_COOKIE_NAME
PUBLIC_OPERATIONS = {
    ("get", "/"), ("get", "/health"),
    ("get", "/api/v1/auth/setup/status"), ("post", "/api/v1/auth/setup"),
    ("post", "/api/v1/auth/web/login"), ("post", "/api/v1/auth/native/login"),
}
PROTECTED_OPERATIONS = [
    (method, re.sub(r"\{[^}]+\}", "1", path))
    for path, operations in app.openapi()["paths"].items()
    for method in operations
    if method in {"get", "post", "patch", "delete", "put"}
    and (method, path) not in PUBLIC_OPERATIONS
]


def assert_private_headers(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"


@pytest.fixture
def guarded_client(monkeypatch):
    assert auth_router.require_authenticated_session not in app.dependency_overrides
    old_overrides = app.dependency_overrides.copy()
    state = {"checks": [], "queries": 0, "database_health": 0}
    class ReadOnlyTestDatabase:
        def scalars(self, statement):
            state["queries"] += 1
            class EmptyResult:
                def all(self):
                    return []
            return EmptyResult()
    def db():
        yield ReadOnlyTestDatabase()
    def check(db, token, *, client_type, csrf_token, require_csrf):
        state["checks"].append((token, client_type, csrf_token, require_csrf))
        if token != TOKEN:
            raise InvalidSessionError("private token details")
        if client_type == "web" and require_csrf and csrf_token != CSRF:
            raise InvalidCsrfTokenError("private CSRF details")
        return AuthenticatedSession(session_id=uuid4(), account_id=1, username="owner",
            client_type=client_type, expires_at=datetime.now(UTC) + timedelta(hours=8))
    def login(db, username, password, *, client_type, client_address):
        if password != PASSWORD:
            raise InvalidCredentialsError("private password details")
        identity = AuthenticatedSession(session_id=uuid4(), account_id=1, username="owner",
            client_type=client_type, expires_at=datetime.now(UTC) + timedelta(hours=8))
        return IssuedSession(identity=identity, token=TOKEN,
            csrf_token=CSRF if client_type == "web" else None)
    def health():
        state["database_health"] += 1
        return True
    app.dependency_overrides[get_db] = db
    monkeypatch.setattr(auth_router, "authenticate_session", check)
    monkeypatch.setattr(auth_router, "login_owner_with_limits", login)
    monkeypatch.setattr(main, "check_database_connection", health)
    monkeypatch.setattr(owner_setup, "get_owner_setup_status", lambda db: OwnerSetupStatus(False, True))
    monkeypatch.setattr(owner_setup, "create_owner_with_setup_code",
        lambda **kwargs: CreatedOwner(id=1, username=kwargs["username"]))
    try:
        with TestClient(app, base_url="https://weekflow.test", client=("192.0.2.10", 12345)) as client:
            yield client, state
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


@pytest.mark.parametrize("method,path", PROTECTED_OPERATIONS)
def test_every_non_public_api_operation_requires_a_session(guarded_client, method, path):
    client, state = guarded_client
    kwargs = {"json": {}} if method in {"post", "patch", "put"} and path != "/api/v1/auth/logout" else {}
    response = client.request(method.upper(), path, **kwargs)
    assert response.status_code == 401, (method, path, response.status_code)
    assert state["checks"] == [] and state["queries"] == 0
    assert state["database_health"] == 0
    assert_private_headers(response)


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_documentation_is_not_public(guarded_client, path):
    client, state = guarded_client
    response = client.get(path)
    assert response.status_code == 401 and state["checks"] == []
    assert_private_headers(response)


@pytest.mark.parametrize("path", ["/", "/health"])
def test_basic_health_remains_public_even_over_local_http(guarded_client, path):
    client, state = guarded_client
    response = client.get("http://weekflow.test" + path)
    assert response.status_code == 200 and state["checks"] == []
    assert_private_headers(response)


def test_setup_and_login_remain_reachable_without_an_existing_session(guarded_client):
    client, state = guarded_client
    assert client.get("/api/v1/auth/setup/status").status_code == 200
    setup = client.post("/api/v1/auth/setup", json={
        "setup_code": "C" * 43, "username": "owner", "password": PASSWORD,
    }, headers=ORIGIN)
    assert setup.status_code == 201
    native = client.post("/api/v1/auth/native/login", json={"username": "owner", "password": PASSWORD})
    assert native.status_code == 200 and native.json()["token"] == TOKEN
    web = client.post("/api/v1/auth/web/login", json={"username": "owner", "password": PASSWORD}, headers=ORIGIN)
    assert web.status_code == 200 and web.json()["csrf_token"] == CSRF
    assert state["checks"] == []


def test_native_session_can_reach_feature_api_and_diagnostics(guarded_client):
    client, state = guarded_client
    assert client.get("/api/v1/tasks", headers=BEARER).json() == []
    assert state["queries"] == 1
    assert client.get("/api/v1/info", headers=BEARER).status_code == 200
    assert client.get("/api/v1/database/health", headers=BEARER).status_code == 200
    assert state["database_health"] == 1
    assert all(call[1] == "native" for call in state["checks"])


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_valid_session_can_reach_protected_documentation(guarded_client, path):
    client, state = guarded_client
    response = client.get(path, headers=BEARER)
    assert response.status_code == 200 and len(state["checks"]) == 1
    assert_private_headers(response)


def test_authenticated_database_outage_is_a_safe_503(guarded_client, monkeypatch):
    client, _ = guarded_client
    def fail():
        raise SQLAlchemyError("private database details")
    monkeypatch.setattr(main, "check_database_connection", fail)
    response = client.get("/api/v1/database/health", headers=BEARER)
    assert response.status_code == 503 and response.json() == {"detail": "Database is unavailable"}
    assert_private_headers(response)


def test_browser_feature_write_is_rejected_before_business_queries_without_csrf(guarded_client):
    client, state = guarded_client
    client.cookies.set(COOKIE, TOKEN, domain="weekflow.test", path="/")
    response = client.post("/api/v1/tasks", json={"title": "Private test task"}, headers=ORIGIN)
    assert response.status_code == 403 and state["queries"] == 0
    assert state["checks"][-1] == (TOKEN, "web", None, True)
    assert "set-cookie" not in response.headers


def test_invalid_browser_session_is_cleared_on_feature_401(guarded_client):
    client, _ = guarded_client
    client.cookies.set(COOKIE, "D" * 43, domain="weekflow.test", path="/")
    response = client.get("/api/v1/tasks", headers=ORIGIN)
    assert response.status_code == 401
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert len(response.headers.get_list("set-cookie")) == 1


def test_invalid_browser_session_is_not_cleared_twice_on_auth_session_endpoint(guarded_client):
    client, _ = guarded_client
    client.cookies.set(COOKIE, "D" * 43, domain="weekflow.test", path="/")
    response = client.get("/api/v1/auth/session", headers=ORIGIN)
    assert response.status_code == 401 and len(response.headers.get_list("set-cookie")) == 1


def test_wrong_login_password_preserves_existing_browser_cookie(guarded_client):
    client, _ = guarded_client
    client.cookies.set(COOKIE, TOKEN, domain="weekflow.test", path="/")
    response = client.post("/api/v1/auth/web/login", json={"username": "owner", "password": "wrong"}, headers=ORIGIN)
    assert response.status_code == 401 and "set-cookie" not in response.headers


def test_storage_outage_does_not_erase_browser_session(guarded_client, monkeypatch):
    client, _ = guarded_client
    client.cookies.set(COOKIE, TOKEN, domain="weekflow.test", path="/")
    def fail(*args, **kwargs):
        raise SessionStorageError("private state")
    monkeypatch.setattr(auth_router, "authenticate_session", fail)
    response = client.get("/api/v1/tasks", headers=ORIGIN)
    assert response.status_code == 503 and "set-cookie" not in response.headers
    assert_private_headers(response)


def test_streamed_login_body_limit_still_works_through_main_middleware(guarded_client):
    client, _ = guarded_client
    response = client.post("/api/v1/auth/native/login", content=iter([b"x" * 8192, b"x" * 8193]),
        headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert_private_headers(response)


def test_cors_preflight_can_run_without_a_login_but_does_not_expose_data(guarded_client):
    client, state = guarded_client
    response = client.options("/api/v1/tasks", headers={
        "Origin": "http://localhost:8081", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Authorization, X-CSRF-Token, Content-Type",
    })
    assert response.status_code == 200 and state["checks"] == []
    assert state["queries"] == 0
    assert response.headers["access-control-allow-origin"] == "http://localhost:8081"


def test_cors_allowlist_does_not_bypass_browser_origin_protection(guarded_client):
    client, state = guarded_client
    client.cookies.set(COOKIE, TOKEN, domain="weekflow.test", path="/")
    response = client.get("/api/v1/tasks", headers={"Origin": "http://localhost:8081"})
    assert response.status_code == 403 and state["checks"] == []


@pytest.fixture
def postgres_main(throttle_db):
    connection = throttle_db
    schema = connection.info["login_throttle_test_schema"]
    # Every table is explicitly translated into the generated private schema.
    # This lets real task and backup workflows run without touching live data.
    assert connection.get_execution_options()["schema_translate_map"][None] == schema
    Base.metadata.create_all(connection)
    for name in Base.metadata.tables:
        assert connection.scalar(text("""
            SELECT n.nspname = :schema FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = to_regclass(:name)
        """), {"schema": schema, "name": name}) is True
    old_overrides = app.dependency_overrides.copy()
    def db():
        with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
            yield session
    with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
        create_owner_account(session, "owner", PASSWORD)
    app.dependency_overrides[get_db] = db
    try:
        with TestClient(app, base_url="https://weekflow.test", client=("192.0.2.10", 12345)) as client:
            yield client, connection
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)


def test_real_native_login_allows_task_write_then_logout_blocks_later_reads(postgres_main):
    client, connection = postgres_main
    assert client.post("/api/v1/tasks", json={"title": "Private test task"}).status_code == 401
    token = client.post("/api/v1/auth/native/login", json={"username": "owner", "password": PASSWORD}).json()["token"]
    headers = {"Authorization": "Bearer " + token}
    response = client.post("/api/v1/tasks", json={"title": "Private test task"}, headers=headers)
    assert response.status_code == 201
    assert connection.scalar(select(func.count()).select_from(Task)) == 1
    assert client.get("/api/v1/tasks", headers=headers).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/v1/tasks", headers=headers).status_code == 401
    assert connection.scalar(select(func.count()).select_from(Task)) == 1


def test_real_browser_write_requires_session_and_csrf(postgres_main):
    client, connection = postgres_main
    login = client.post("/api/v1/auth/web/login", json={"username": "owner", "password": PASSWORD}, headers=ORIGIN)
    assert login.status_code == 200
    csrf = login.json()["csrf_token"]
    rejected = client.post("/api/v1/tasks", json={"title": "Private browser task"}, headers=ORIGIN)
    assert rejected.status_code == 403
    assert connection.scalar(select(func.count()).select_from(Task)) == 0
    accepted = client.post("/api/v1/tasks", json={"title": "Private browser task"}, headers={**ORIGIN, "X-CSRF-Token": csrf})
    assert accepted.status_code == 201
    assert connection.scalar(select(func.count()).select_from(Task)) == 1


def test_real_backup_export_is_protected_and_does_not_export_authentication_records(postgres_main):
    client, _ = postgres_main
    assert client.post("/api/v1/backups/export").status_code == 401
    token = client.post("/api/v1/auth/native/login", json={"username": "owner", "password": PASSWORD}).json()["token"]
    response = client.post("/api/v1/backups/export", headers={"Authorization": "Bearer " + token})
    assert response.status_code == 200
    assert token not in response.text and PASSWORD not in response.text
    for name in ("accounts", "auth_sessions", "owner_setup_codes", "auth_login_throttles"):
        assert name not in response.json()
    assert_private_headers(response)
