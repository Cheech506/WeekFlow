"""Check auth HTTP boundaries and isolated PostgreSQL login/logout flows."""

from datetime import UTC, datetime, timedelta
import json
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, AuthLoginThrottle, AuthSession
from app.routers import auth as auth_router
from app.services.accounts import create_owner_account
from app.services.login_throttle import (
    InvalidLoginSourceError, LoginRateLimitedError, LoginThrottleStorageError,
)
from app.services.session_tokens import verify_token
from app.services.sessions import (
    AuthenticatedSession, InvalidCredentialsError, InvalidCsrfTokenError,
    InvalidSessionError, IssuedSession, SessionStorageError,
)
from test_auth_login_throttle_model import assert_private_table, throttle_db


WEB_URL = "/api/v1/auth/web/login"
NATIVE_URL = "/api/v1/auth/native/login"
SESSION_URL = "/api/v1/auth/session"
LOGOUT_URL = "/api/v1/auth/logout"
COOKIE = auth_router.SESSION_COOKIE_NAME
ORIGIN = {"Origin": "https://weekflow.test"}
TOKEN = "A" * 43
CSRF = "B" * 43
PASSWORD = "a temporary API login passphrase"


def payload(**changes):
    return {"username": "owner", "password": PASSWORD, **changes}


def bearer(token=TOKEN):
    return {"Authorization": "Bearer " + token}


def make_app():
    app = FastAPI()
    app.include_router(auth_router.router)
    # This test-only route checks the reusable dependency. Real feature routes
    # will be protected in a later main.py integration step.
    @app.get("/test/protected", dependencies=[Depends(auth_router.require_authenticated_session)])
    @app.post("/test/protected", dependencies=[Depends(auth_router.require_authenticated_session)])
    def protected():
        return {"ok": True}
    return app


def assert_no_store(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["cross-origin-resource-policy"] == "same-origin"


@pytest.fixture
def mocked_auth(monkeypatch):
    state = {"logins": [], "checks": [], "revocations": []}
    session_id = uuid4()
    def identity(client_type):
        return AuthenticatedSession(session_id=session_id, account_id=1, username="owner",
            client_type=client_type, expires_at=datetime.now(UTC) + timedelta(hours=8))
    def login(db, username, password, *, client_type, client_address):
        state["logins"].append((username, password, client_type, client_address))
        return IssuedSession(identity=identity(client_type), token=TOKEN,
            csrf_token=CSRF if client_type == "web" else None)
    def check(db, token, *, client_type, csrf_token, require_csrf):
        state["checks"].append((token, client_type, csrf_token, require_csrf))
        if client_type == "web" and require_csrf and csrf_token != CSRF:
            raise InvalidCsrfTokenError("private CSRF details")
        return identity(client_type)
    def revoke(db, token, *, client_type, csrf_token):
        state["revocations"].append((token, client_type, csrf_token))
        if client_type == "web" and csrf_token != CSRF:
            raise InvalidCsrfTokenError("private CSRF details")
    def db():
        yield object()
    monkeypatch.setattr(auth_router, "login_owner_with_limits", login)
    monkeypatch.setattr(auth_router, "authenticate_session", check)
    monkeypatch.setattr(auth_router, "revoke_session", revoke)
    app = make_app()
    app.dependency_overrides[get_db] = db
    with TestClient(app, base_url="https://weekflow.test", client=("192.0.2.10", 12345)) as client:
        yield client, state


def set_cookie(client, token=TOKEN):
    client.cookies.set(COOKIE, token, domain="weekflow.test", path="/")


def test_browser_login_sets_host_cookie_and_only_delivers_csrf_in_json(mocked_auth):
    client, state = mocked_auth
    password = "  exact API password test  "
    response = client.post(WEB_URL, json=payload(username=" OWNER ", password=password), headers=ORIGIN)
    assert response.status_code == 200
    assert state["logins"] == [("owner", password, "web", "192.0.2.10")]
    data = response.json()
    assert data["csrf_token"] == CSRF and data["identity"]["client_type"] == "web"
    assert set(data) == {"identity", "csrf_token"}
    assert TOKEN not in response.text and password not in response.text
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(COOKIE + "=" + TOKEN)
    assert "Secure" in cookie and "HttpOnly" in cookie
    assert "SameSite=strict" in cookie and "Path=/" in cookie
    assert "Max-Age=28800" in cookie and "expires=" in cookie
    assert "domain=" not in cookie.lower()
    assert_no_store(response)


def test_native_login_delivers_bearer_without_cookie(mocked_auth):
    client, state = mocked_auth
    response = client.post(NATIVE_URL, json=payload())
    assert response.status_code == 200
    assert set(response.json()) == {"identity", "token", "token_type"}
    assert response.json()["token"] == TOKEN and response.json()["token_type"] == "Bearer"
    assert response.json()["identity"]["client_type"] == "native"
    assert "set-cookie" not in response.headers
    assert state["logins"][0][2:] == ("native", "192.0.2.10")
    assert_no_store(response)


@pytest.mark.parametrize("headers", [
    {"Origin": "https://weekflow.test:443"},
    {"Referer": "https://weekflow.test/login"}, {"Sec-Fetch-Site": "same-origin"},
])
def test_browser_login_accepts_same_origin_provenance(mocked_auth, headers):
    client, _ = mocked_auth
    assert client.post(WEB_URL, json=payload(), headers=headers).status_code == 200


@pytest.mark.parametrize("headers", [
    {}, {"Origin": "null"}, {"Origin": "http://weekflow.test"},
    {"Origin": "https://evil.test"}, {"Origin": "https://weekflow.test.evil.test"},
    {"Origin": "https://weekflow.test:444"}, {"Origin": "https://weekflow.test:0"},
    {"Origin": "https://@weekflow.test"}, {"Origin": "https://weekflow.test/path"},
    {"Origin": "https://weekflow.test", "Sec-Fetch-Site": "same-site"},
    {"Origin": "https://weekflow.test", "Sec-Fetch-Site": "cross-site"},
    {"Referer": "https://evil.test/login"},
])
def test_browser_login_rejects_missing_or_untrusted_origins(mocked_auth, headers):
    client, state = mocked_auth
    response = client.post(WEB_URL, json=payload(), headers=headers)
    assert response.status_code == 403 and state["logins"] == []
    assert "set-cookie" not in response.headers
    assert_no_store(response)


@pytest.mark.parametrize("headers", [ORIGIN, {"Referer": "https://weekflow.test"},
    {"Sec-Fetch-Site": "same-origin"}, {"Sec-Fetch-Mode": "cors"}])
def test_native_login_rejects_browser_requests(mocked_auth, headers):
    client, state = mocked_auth
    assert client.post(NATIVE_URL, json=payload(), headers=headers).status_code == 403
    assert state["logins"] == []


def test_native_login_rejects_browser_session_cookie(mocked_auth):
    client, state = mocked_auth
    set_cookie(client)
    assert client.post(NATIVE_URL, json=payload()).status_code == 403
    assert state["logins"] == []


@pytest.mark.parametrize("path", [WEB_URL, NATIVE_URL])
def test_http_login_is_rejected_even_with_forwarded_proto_header(mocked_auth, path):
    client, state = mocked_auth
    response = client.post("http://weekflow.test" + path, json=payload(),
        headers={"X-Forwarded-Proto": "https", **ORIGIN})
    assert response.status_code == 403 and state["logins"] == []


@pytest.mark.parametrize("path", [WEB_URL, NATIVE_URL])
def test_login_cannot_use_an_existing_authorization_header(mocked_auth, path):
    client, state = mocked_auth
    headers = {**bearer(), **(ORIGIN if path == WEB_URL else {})}
    assert client.post(path, json=payload(), headers=headers).status_code == 400
    assert state["logins"] == []


def test_source_address_is_taken_from_server_not_forwarded_header(mocked_auth):
    client, state = mocked_auth
    response = client.post(NATIVE_URL, json=payload(), headers={"X-Forwarded-For": "198.51.100.99"})
    assert response.status_code == 200
    assert state["logins"][0][3] == "192.0.2.10"


@pytest.mark.parametrize("body", [
    {}, {"username": "owner"}, payload(password=""), payload(password="x" * 129),
    payload(client_type="native"), payload(**{PASSWORD: TOKEN}), [PASSWORD, TOKEN],
])
def test_validation_errors_do_not_echo_credentials_or_arbitrary_field_names(mocked_auth, body):
    client, state = mocked_auth
    response = client.post(NATIVE_URL, json=body)
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid authentication request."}
    assert PASSWORD not in response.text and TOKEN not in response.text
    assert state["logins"] == []
    assert_no_store(response)


def test_malformed_json_errors_do_not_echo_body(mocked_auth):
    client, _ = mocked_auth
    response = client.post(NATIVE_URL, content='{"password":"' + PASSWORD,
        headers={"Content-Type": "application/json"})
    assert response.status_code == 422 and PASSWORD not in response.text


@pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded", ""])
def test_login_requires_json(mocked_auth, content_type):
    client, state = mocked_auth
    response = client.post(NATIVE_URL, content=json.dumps(payload()), headers={"Content-Type": content_type})
    assert response.status_code == 415 and state["logins"] == []


def test_json_charset_is_accepted(mocked_auth):
    client, _ = mocked_auth
    response = client.post(NATIVE_URL, content=json.dumps(payload()), headers={"Content-Type": "application/json; charset=utf-8"})
    assert response.status_code == 200


@pytest.mark.parametrize("headers,expected", [
    ({"Content-Length": "20000"}, 413), ({"Content-Length": "-1"}, 400),
    ({"Content-Length": "invalid"}, 400), ({"Content-Encoding": "gzip"}, 415),
])
def test_bad_lengths_and_compressed_bodies_are_rejected(mocked_auth, headers, expected):
    client, state = mocked_auth
    response = client.post(NATIVE_URL, content=json.dumps(payload()), headers={"Content-Type": "application/json", **headers})
    assert response.status_code == expected and state["logins"] == []


@pytest.mark.parametrize("lying_length", [False, True])
def test_streamed_body_limit_does_not_trust_content_length(mocked_auth, lying_length):
    client, state = mocked_auth
    headers = {"Content-Type": "application/json"}
    if lying_length:
        headers["Content-Length"] = "1"
    response = client.post(NATIVE_URL, content=iter([b"x" * 8192, b"x" * 8193]), headers=headers)
    assert response.status_code == 413 and state["logins"] == []


@pytest.mark.parametrize("path,method", [(NATIVE_URL, "post"), (SESSION_URL, "get"), (LOGOUT_URL, "post")])
def test_auth_query_parameters_are_rejected_without_reflection(mocked_auth, path, method):
    client, _ = mocked_auth
    kwargs = {"json": payload()} if path == NATIVE_URL else {}
    response = getattr(client, method)(path + "?token=" + TOKEN, **kwargs)
    assert response.status_code == 400 and TOKEN not in response.text


@pytest.mark.parametrize("error,expected", [
    (InvalidCredentialsError(PASSWORD), 401), (LoginRateLimitedError(30), 429),
    (InvalidLoginSourceError(PASSWORD), 503), (LoginThrottleStorageError(PASSWORD), 503),
    (SessionStorageError(PASSWORD), 503),
])
def test_login_service_errors_are_safe_and_never_set_cookie(mocked_auth, monkeypatch, error, expected):
    client, _ = mocked_auth
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(auth_router, "login_owner_with_limits", fail)
    response = client.post(WEB_URL, json=payload(), headers=ORIGIN)
    assert response.status_code == expected and PASSWORD not in response.text
    assert "set-cookie" not in response.headers
    if expected == 429:
        assert response.headers["retry-after"] == "30"
    assert_no_store(response)


def test_wrong_password_does_not_clear_an_existing_browser_session(mocked_auth, monkeypatch):
    client, _ = mocked_auth
    set_cookie(client)
    def fail(*args, **kwargs):
        raise InvalidCredentialsError(PASSWORD)
    monkeypatch.setattr(auth_router, "login_owner_with_limits", fail)
    response = client.post(WEB_URL, json=payload(), headers=ORIGIN)
    assert response.status_code == 401 and "set-cookie" not in response.headers


def test_unexpected_login_error_logs_only_exception_class(mocked_auth, monkeypatch, caplog):
    client, _ = mocked_auth
    def fail(*args, **kwargs):
        raise RuntimeError(PASSWORD + TOKEN)
    monkeypatch.setattr(auth_router, "login_owner_with_limits", fail)
    response = client.post(NATIVE_URL, json=payload())
    assert response.status_code == 500
    assert PASSWORD not in response.text and TOKEN not in response.text
    assert PASSWORD not in caplog.text and TOKEN not in caplog.text
    assert "RuntimeError" in caplog.text


def test_unknown_http_exception_cannot_inject_secret_detail_or_headers(mocked_auth, monkeypatch):
    client, _ = mocked_auth
    def fail(*args, **kwargs):
        raise HTTPException(429, detail=PASSWORD, headers={"Retry-After": TOKEN, "X-Secret": TOKEN})
    monkeypatch.setattr(auth_router, "login_owner_with_limits", fail)
    response = client.post(NATIVE_URL, json=payload())
    assert response.status_code == 429
    assert PASSWORD not in response.text and TOKEN not in response.text
    assert "retry-after" not in response.headers and "x-secret" not in response.headers


def test_native_session_read_returns_only_safe_identity(mocked_auth):
    client, state = mocked_auth
    response = client.get(SESSION_URL, headers=bearer())
    assert response.status_code == 200 and response.json()["client_type"] == "native"
    assert set(response.json()) == {"session_id", "account_id", "username", "client_type", "expires_at"}
    assert TOKEN not in response.text
    assert state["checks"] == [(TOKEN, "native", None, False)]
    assert_no_store(response)


def test_browser_session_read_uses_cookie_without_csrf_for_safe_get(mocked_auth):
    client, state = mocked_auth
    set_cookie(client)
    response = client.get(SESSION_URL, headers=ORIGIN)
    assert response.status_code == 200 and response.json()["client_type"] == "web"
    assert state["checks"] == [(TOKEN, "web", None, False)]


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Basic " + TOKEN},
    {"Authorization": "Bearer " + "a" * 64}, {"Authorization": "Bearer  " + TOKEN}])
def test_missing_or_malformed_bearer_is_rejected_before_database_work(mocked_auth, headers):
    client, state = mocked_auth
    response = client.get(SESSION_URL, headers=headers)
    assert response.status_code == 401 and state["checks"] == []
    assert response.headers["www-authenticate"] == "Bearer"


def test_cookie_and_bearer_cannot_be_mixed(mocked_auth):
    client, state = mocked_auth
    set_cookie(client)
    response = client.get(SESSION_URL, headers={**ORIGIN, **bearer()})
    assert response.status_code == 400 and state["checks"] == []


def test_duplicate_session_cookies_are_rejected(mocked_auth):
    client, state = mocked_auth
    response = client.get(SESSION_URL, headers={**ORIGIN, "Cookie": f"{COOKIE}={TOKEN}; {COOKIE}={TOKEN}"})
    assert response.status_code == 400 and state["checks"] == []


def test_duplicate_authorization_headers_are_rejected(mocked_auth):
    client, state = mocked_auth
    response = client.get(SESSION_URL, headers=[("Authorization", "Bearer " + TOKEN), ("Authorization", "Bearer " + TOKEN)])
    assert response.status_code == 400 and state["checks"] == []


def test_browser_cannot_use_bearer_transport(mocked_auth):
    client, state = mocked_auth
    response = client.get(SESSION_URL, headers={**bearer(), **ORIGIN})
    assert response.status_code == 403 and state["checks"] == []


def test_invalid_browser_session_clears_cookie(mocked_auth, monkeypatch):
    client, _ = mocked_auth
    set_cookie(client)
    def fail(*args, **kwargs):
        raise InvalidSessionError(TOKEN)
    monkeypatch.setattr(auth_router, "authenticate_session", fail)
    response = client.get(SESSION_URL, headers=ORIGIN)
    assert response.status_code == 401 and TOKEN not in response.text
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_session_storage_failure_does_not_clear_cookie(mocked_auth, monkeypatch):
    client, _ = mocked_auth
    set_cookie(client)
    def fail(*args, **kwargs):
        raise SessionStorageError(TOKEN)
    monkeypatch.setattr(auth_router, "authenticate_session", fail)
    response = client.get(SESSION_URL, headers=ORIGIN)
    assert response.status_code == 503 and TOKEN not in response.text
    assert "set-cookie" not in response.headers


def test_native_logout_returns_empty_response_and_uses_bearer(mocked_auth):
    client, state = mocked_auth
    response = client.post(LOGOUT_URL, headers=bearer())
    assert response.status_code == 204 and response.content == b""
    assert "set-cookie" not in response.headers
    assert state["revocations"] == [(TOKEN, "native", None)]
    assert_no_store(response)


def test_browser_logout_needs_csrf_and_clears_cookie_only_on_success(mocked_auth):
    client, state = mocked_auth
    set_cookie(client)
    rejected = client.post(LOGOUT_URL, headers=ORIGIN)
    assert rejected.status_code == 403 and "set-cookie" not in rejected.headers
    response = client.post(LOGOUT_URL, headers={**ORIGIN, "X-CSRF-Token": CSRF})
    assert response.status_code == 204 and response.content == b""
    assert "Max-Age=0" in response.headers["set-cookie"]
    assert state["revocations"][-1] == (TOKEN, "web", CSRF)


def test_logout_rejects_credentials_in_body(mocked_auth):
    client, state = mocked_auth
    response = client.post(LOGOUT_URL, json={"token": TOKEN}, headers=bearer())
    assert response.status_code == 400 and state["revocations"] == []


def test_dependency_requires_csrf_for_browser_feature_writes(mocked_auth):
    client, state = mocked_auth
    set_cookie(client)
    assert client.get("/test/protected", headers=ORIGIN).status_code == 200
    assert client.post("/test/protected", headers=ORIGIN).status_code == 403
    assert client.post("/test/protected", headers={**ORIGIN, "X-CSRF-Token": CSRF}).status_code == 200
    assert state["checks"][-1] == (TOKEN, "web", CSRF, True)


def test_dependency_unexpected_failure_is_safe_on_a_normal_feature_route(mocked_auth, monkeypatch, caplog):
    client, _ = mocked_auth
    def fail(*args, **kwargs):
        raise RuntimeError(TOKEN)
    monkeypatch.setattr(auth_router, "authenticate_session", fail)
    response = client.get("/test/protected", headers=bearer())
    assert response.status_code == 503 and TOKEN not in response.text and TOKEN not in caplog.text


def test_openapi_contains_four_auth_paths_with_separate_login_responses(mocked_auth):
    client, _ = mocked_auth
    paths = client.app.openapi()["paths"]
    assert {path for path in paths if path.startswith("/api/v1/auth/")} == {WEB_URL, NATIVE_URL, SESSION_URL, LOGOUT_URL}
    assert paths[WEB_URL]["post"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("WebLoginRead")
    assert paths[NATIVE_URL]["post"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"].endswith("NativeLoginRead")


@pytest.fixture
def postgres_auth(throttle_db):
    connection = throttle_db
    Account.__table__.create(connection)
    AuthSession.__table__.create(connection)
    schema = connection.info["login_throttle_test_schema"]
    for name in ("accounts", "auth_sessions"):
        assert connection.scalar(text("""
            SELECT n.nspname = :schema FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.oid = to_regclass(:name)
        """), {"schema": schema, "name": name}) is True
    def db():
        with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
            yield session
    with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
        create_owner_account(session, "owner", PASSWORD)
    app = make_app()
    app.dependency_overrides[get_db] = db
    with TestClient(app, base_url="https://weekflow.test", client=("192.0.2.10", 12345)) as client:
        yield client, connection


def test_postgres_native_login_session_and_logout(postgres_auth):
    client, connection = postgres_auth
    first = client.post(NATIVE_URL, json=payload())
    assert first.status_code == 200
    token = first.json()["token"]
    row = connection.execute(select(AuthSession.__table__)).mappings().one()
    assert verify_token(token, row["token_hash"], purpose="session")
    assert token not in row.values()
    assert client.get(SESSION_URL, headers=bearer(token)).status_code == 200
    second = client.post(NATIVE_URL, json=payload()).json()["token"]
    assert token != second
    assert client.post(LOGOUT_URL, headers=bearer(token)).status_code == 204
    assert client.get(SESSION_URL, headers=bearer(token)).status_code == 401
    assert client.get(SESSION_URL, headers=bearer(second)).status_code == 200


def test_postgres_browser_login_csrf_logout_and_cookie_clearing(postgres_auth):
    client, connection = postgres_auth
    login = client.post(WEB_URL, json=payload(), headers=ORIGIN)
    assert login.status_code == 200
    csrf = login.json()["csrf_token"]
    assert client.get(SESSION_URL, headers=ORIGIN).status_code == 200
    assert client.post(LOGOUT_URL, headers=ORIGIN).status_code == 403
    assert connection.scalar(select(AuthSession.revoked_at)) is None
    logout = client.post(LOGOUT_URL, headers={**ORIGIN, "X-CSRF-Token": csrf})
    assert logout.status_code == 204 and "Max-Age=0" in logout.headers["set-cookie"]
    assert connection.scalar(select(AuthSession.revoked_at)) is not None
    assert client.get(SESSION_URL, headers=ORIGIN).status_code == 401


def test_postgres_web_token_cannot_be_used_as_native_bearer(postgres_auth):
    client, _ = postgres_auth
    assert client.post(WEB_URL, json=payload(), headers=ORIGIN).status_code == 200
    token = client.cookies.get(COOKIE)
    client.cookies.clear()
    response = client.get(SESSION_URL, headers=bearer(token))
    assert response.status_code == 401


def test_postgres_repeated_wrong_passwords_block_even_a_correct_next_password(postgres_auth):
    client, connection = postgres_auth
    for _ in range(5):
        assert client.post(NATIVE_URL, json=payload(password="incorrect password")).status_code == 401
    response = client.post(NATIVE_URL, json=payload())
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) >= 1
    assert connection.scalar(select(func.count()).select_from(AuthSession)) == 0
    assert_private_table(connection)
    rows = connection.execute(select(AuthLoginThrottle.__table__)).mappings().all()
    assert len(rows) == 2 and all(row["attempt_count"] == 5 for row in rows)
