"""Check setup HTTP boundaries and safe errors in isolated test apps."""

import json
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.database import get_db
from app.models import Account
from app.routers import owner_setup as setup_router
from app.services.accounts import AccountValidationError, CreatedOwner
from app.services.owner_setup import (
    InvalidSetupCodeError, OwnerSetupClosedError, OwnerSetupStatus,
    OwnerSetupStorageError, SetupCodeBlockedError, issue_setup_code,
)
from app.services.passwords import PasswordValidationError, verify_password
from test_owner_setup import setup_service_db, wrong_code
from test_owner_setup_code_model import saved_code, setup_db


STATUS_URL = "/api/v1/auth/setup/status"
SETUP_URL = "/api/v1/auth/setup"
DEMO_CODE = "A" * 43
DEMO_PASSWORD = "a temporary browser setup passphrase"


def payload(**changes):
    return {"setup_code": DEMO_CODE, "username": "owner", "password": DEMO_PASSWORD, **changes}


def make_app():
    app = FastAPI()
    app.include_router(setup_router.router)
    return app


def assert_no_store(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"


@pytest.fixture
def mocked_setup_api(monkeypatch):
    state = {"claims": [], "reads": 0}
    def db():
        yield object()
    def read(db):
        state["reads"] += 1
        return OwnerSetupStatus(owner_exists=False, setup_ready=True)
    def create(db, setup_code, username, password):
        state["claims"].append((setup_code, username, password))
        return CreatedOwner(id=1, username=username)
    monkeypatch.setattr(setup_router, "get_owner_setup_status", read)
    monkeypatch.setattr(setup_router, "create_owner_with_setup_code", create)
    app = make_app()
    app.dependency_overrides[get_db] = db
    with TestClient(app, base_url="https://weekflow.test") as client:
        yield client, state


def test_status_returns_only_safe_readiness_and_is_not_cached(mocked_setup_api):
    client, state = mocked_setup_api
    response = client.get(STATUS_URL)
    assert response.status_code == 200
    assert response.json() == {"owner_exists": False, "setup_ready": True}
    assert state["reads"] == 1
    assert_no_store(response)


def test_status_can_be_read_locally_without_sending_credentials(mocked_setup_api):
    client, _ = mocked_setup_api
    response = client.get("http://weekflow.test" + STATUS_URL)
    assert response.status_code == 200
    assert_no_store(response)


def test_success_passes_exact_secrets_and_normalized_username_to_service(mocked_setup_api):
    client, state = mocked_setup_api
    password = "  a temporary browser passphrase  "
    response = client.post(SETUP_URL, json=payload(username=" COREY ", password=password))
    assert response.status_code == 201
    assert response.json() == {"id": 1, "username": "corey"}
    assert state["claims"] == [(DEMO_CODE, "corey", password)]
    assert response.headers.get("set-cookie") is None
    assert DEMO_CODE not in response.text and password not in response.text
    assert_no_store(response)


@pytest.mark.parametrize("headers", [
    {"Origin": "https://weekflow.test"},
    {"Origin": "https://weekflow.test:443"},
    {"Referer": "https://weekflow.test/settings?view=setup"},
    {"Sec-Fetch-Site": "same-origin"},
])
def test_same_origin_browser_headers_are_accepted(mocked_setup_api, headers):
    client, state = mocked_setup_api
    assert client.post(SETUP_URL, json=payload(), headers=headers).status_code == 201
    assert len(state["claims"]) == 1


@pytest.mark.parametrize("origin", [
    "http://weekflow.test", "https://evil.test", "https://weekflow.test.evil.test",
    "https://weekflow.test@evil.test", "null", "https://weekflow.test:444",
    "https://weekflow.test/path", "https://weekflow.test?x=y", "https://weekflow.test:bad",
])
def test_other_or_invalid_browser_origins_are_rejected(mocked_setup_api, origin):
    client, state = mocked_setup_api
    response = client.post(SETUP_URL, json=payload(), headers={"Origin": origin})
    assert response.status_code == 403
    assert state["claims"] == []
    assert_no_store(response)


@pytest.mark.parametrize("headers", [
    {"Referer": "https://evil.test/page"},
    {"Sec-Fetch-Site": "cross-site"},
    {"Sec-Fetch-Site": "same-site"},
])
def test_browser_cross_origin_signals_are_rejected(mocked_setup_api, headers):
    client, state = mocked_setup_api
    assert client.post(SETUP_URL, json=payload(), headers=headers).status_code == 403
    assert state["claims"] == []


@pytest.mark.parametrize("headers", [{}, {"X-Forwarded-Proto": "https"}])
def test_plain_http_and_client_supplied_forwarded_headers_cannot_bypass_https(mocked_setup_api, headers):
    client, state = mocked_setup_api
    response = client.post("http://weekflow.test" + SETUP_URL, json=payload(), headers=headers)
    assert response.status_code == 403
    assert "HTTPS is required" in response.json()["detail"]
    assert state["claims"] == []


@pytest.mark.parametrize("content_type", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""])
def test_simple_form_and_non_json_requests_are_rejected(mocked_setup_api, content_type):
    client, state = mocked_setup_api
    response = client.post(SETUP_URL, content=json.dumps(payload()), headers={"Content-Type": content_type})
    assert response.status_code == 415
    assert state["claims"] == []
    assert_no_store(response)


@pytest.mark.parametrize("encoding", ["gzip", "br"])
def test_compressed_setup_bodies_are_rejected(mocked_setup_api, encoding):
    client, state = mocked_setup_api
    response = client.post(SETUP_URL, json=payload(), headers={"Content-Encoding": encoding})
    assert response.status_code == 415
    assert state["claims"] == []


def test_json_content_type_can_include_a_charset(mocked_setup_api):
    client, _ = mocked_setup_api
    assert client.post(SETUP_URL, json=payload(), headers={"Content-Type": "application/json; charset=utf-8"}).status_code == 201


@pytest.mark.parametrize("length", ["-1", "not-a-number"])
def test_invalid_content_length_is_rejected_without_echoing_it(mocked_setup_api, length):
    client, state = mocked_setup_api
    response = client.post(SETUP_URL, json=payload(), headers={"Content-Length": length})
    assert response.status_code == 400
    assert state["claims"] == []


def test_large_declared_body_is_rejected_before_service(mocked_setup_api):
    client, state = mocked_setup_api
    response = client.post(SETUP_URL, json=payload(), headers={"Content-Length": "20000"})
    assert response.status_code == 413
    assert state["claims"] == []


@pytest.mark.parametrize("declared", [None, "1"])
def test_streamed_body_limit_cannot_be_bypassed_by_omitting_or_understating_length(mocked_setup_api, declared):
    client, state = mocked_setup_api
    headers = {"Content-Type": "application/json"}
    if declared is not None:
        headers["Content-Length"] = declared
    def chunks():
        yield b" " * 8192
        yield b" " * 8193
    response = client.post(SETUP_URL, content=chunks(), headers=headers)
    assert response.status_code == 413
    assert state["claims"] == []
    assert_no_store(response)


@pytest.mark.parametrize("body", [
    {"password": DEMO_PASSWORD},
    payload(password="S3cr3t!"),
    payload(setup_code="Z" * 42 + "+"),
    payload(**{DEMO_CODE: DEMO_PASSWORD}),
    [DEMO_CODE, DEMO_PASSWORD],
])
def test_validation_errors_never_echo_values_or_arbitrary_field_names(mocked_setup_api, body):
    client, state = mocked_setup_api
    response = client.post(SETUP_URL, json=body)
    assert response.status_code == 422
    for secret in (DEMO_CODE, DEMO_PASSWORD, "S3cr3t!", "Z" * 42 + "+"):
        assert secret not in response.text
    assert "input" not in response.json()["detail"]
    assert state["claims"] == []
    assert_no_store(response)


def test_malformed_json_never_echoes_its_contents(mocked_setup_api):
    client, state = mocked_setup_api
    response = client.post(SETUP_URL, content='{"password":"' + DEMO_PASSWORD, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert DEMO_PASSWORD not in response.text
    assert state["claims"] == []


@pytest.mark.parametrize("method,url", [("GET", STATUS_URL), ("POST", SETUP_URL)])
def test_query_credentials_are_rejected_without_reflection(mocked_setup_api, method, url):
    client, state = mocked_setup_api
    response = client.request(method, url + "?setup_code=" + DEMO_CODE, json=payload() if method == "POST" else None)
    assert response.status_code == 400
    assert DEMO_CODE not in response.text
    assert state["claims"] == [] and state["reads"] == 0


@pytest.mark.parametrize("error,status", [
    (OwnerSetupClosedError(DEMO_PASSWORD), 409),
    (InvalidSetupCodeError(DEMO_CODE), 403),
    (SetupCodeBlockedError(300), 429),
    (AccountValidationError(DEMO_PASSWORD), 422),
    (PasswordValidationError(DEMO_PASSWORD), 422),
    (OwnerSetupStorageError(DEMO_PASSWORD), 503),
])
def test_service_failures_map_to_safe_http_responses(mocked_setup_api, monkeypatch, error, status):
    client, _ = mocked_setup_api
    def failed(**kwargs):
        raise error
    monkeypatch.setattr(setup_router, "create_owner_with_setup_code", failed)
    response = client.post(SETUP_URL, json=payload())
    assert response.status_code == status
    assert DEMO_CODE not in response.text and DEMO_PASSWORD not in response.text
    if status == 429:
        assert response.headers["retry-after"] == "300"
    assert_no_store(response)


def test_status_storage_failure_does_not_expose_exception_details(mocked_setup_api, monkeypatch):
    client, _ = mocked_setup_api
    def failed(db):
        raise OwnerSetupStorageError(DEMO_PASSWORD)
    monkeypatch.setattr(setup_router, "get_owner_setup_status", failed)
    response = client.get(STATUS_URL)
    assert response.status_code == 503
    assert DEMO_PASSWORD not in response.text
    assert_no_store(response)


def test_unexpected_error_is_sanitized_in_response_and_logs(mocked_setup_api, monkeypatch, caplog):
    client, _ = mocked_setup_api
    def failed(**kwargs):
        raise RuntimeError(f"private SQL password: {DEMO_PASSWORD}; code: {DEMO_CODE}")
    monkeypatch.setattr(setup_router, "create_owner_with_setup_code", failed)
    response = client.post(SETUP_URL, json=payload())
    assert response.status_code == 500
    assert DEMO_PASSWORD not in response.text + caplog.text
    assert DEMO_CODE not in response.text + caplog.text
    assert "RuntimeError" in caplog.text
    assert_no_store(response)


def test_unknown_http_exception_details_and_headers_are_not_reflected(mocked_setup_api, monkeypatch):
    client, _ = mocked_setup_api
    def failed(**kwargs):
        raise HTTPException(403, detail={"password": DEMO_PASSWORD}, headers={"X-Secret": DEMO_CODE})
    monkeypatch.setattr(setup_router, "create_owner_with_setup_code", failed)
    response = client.post(SETUP_URL, json=payload())
    assert response.status_code == 403
    assert DEMO_PASSWORD not in response.text
    assert "x-secret" not in response.headers


def test_invalid_service_response_does_not_expose_its_object(mocked_setup_api, monkeypatch, caplog):
    client, _ = mocked_setup_api
    monkeypatch.setattr(setup_router, "create_owner_with_setup_code", lambda **kwargs: SimpleNamespace(
        id=2, username="owner", password_hash=DEMO_PASSWORD,
    ))
    response = client.post(SETUP_URL, json=payload())
    assert response.status_code == 500
    assert DEMO_PASSWORD not in response.text + caplog.text


def test_router_documents_only_status_and_owner_creation(mocked_setup_api):
    client, _ = mocked_setup_api
    paths = client.app.openapi()["paths"]
    assert set(paths) == {STATUS_URL, SETUP_URL}
    assert set(paths[STATUS_URL]) == {"get"}
    assert set(paths[SETUP_URL]) == {"post"}
    assert paths[SETUP_URL]["post"]["responses"].get("201")


@pytest.fixture
def postgres_setup_api(setup_service_db):
    connection, issuer_db = setup_service_db
    issued = issue_setup_code(issuer_db)
    def db():
        with Session(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False) as session:
            yield session
    app = make_app()
    app.dependency_overrides[get_db] = db
    with TestClient(app, base_url="https://weekflow.test") as client:
        yield client, connection, issued


def test_postgres_setup_creates_owner_consumes_code_and_closes_registration(postgres_setup_api):
    client, connection, issued = postgres_setup_api
    assert client.get(STATUS_URL).json() == {"owner_exists": False, "setup_ready": True}
    response = client.post(SETUP_URL, json=payload(setup_code=issued.code))
    assert response.status_code == 201
    assert response.json() == {"id": 1, "username": "owner"}
    owner = connection.execute(select(Account.__table__)).mappings().one()
    assert verify_password(DEMO_PASSWORD, owner["password_hash"]) is True
    assert saved_code(connection)["consumed_at"] is not None
    assert client.get(STATUS_URL).json() == {"owner_exists": True, "setup_ready": False}
    assert client.post(SETUP_URL, json=payload(setup_code=issued.code)).status_code == 409
    assert connection.scalar(select(func.count()).select_from(Account)) == 1


def test_postgres_wrong_code_attempts_persist_and_trigger_retry_after(postgres_setup_api):
    client, connection, issued = postgres_setup_api
    body = payload(setup_code=wrong_code(issued.code))
    for attempt in range(1, 5):
        assert client.post(SETUP_URL, json=body).status_code == 403
        assert saved_code(connection)["failed_attempts"] == attempt
    blocked = client.post(SETUP_URL, json=body)
    assert blocked.status_code == 429 and blocked.headers["retry-after"] == "300"
    assert client.post(SETUP_URL, json=payload(setup_code=issued.code)).status_code == 429
    assert saved_code(connection)["consumed_at"] is None
    assert connection.scalar(select(func.count()).select_from(Account)) == 0


def test_postgres_invalid_password_does_not_consume_a_valid_code(postgres_setup_api):
    client, connection, issued = postgres_setup_api
    before = saved_code(connection)
    response = client.post(SETUP_URL, json=payload(setup_code=issued.code, password="S3cr3t!"))
    assert response.status_code == 422
    assert issued.code not in response.text and "S3cr3t!" not in response.text
    assert saved_code(connection) == before
    assert connection.scalar(select(func.count()).select_from(Account)) == 0
