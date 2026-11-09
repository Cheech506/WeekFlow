"""Check login schemas and explicit credential-delivery boundaries."""

from datetime import datetime, timedelta, timezone
import json
from types import SimpleNamespace
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError
import pytest

from app.schemas.auth import LoginRequest, NativeLoginRead, SessionRead, WebLoginRead
from app.services.accounts import normalize_username
from app.services.passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH
from app.services.session_tokens import TOKEN_LENGTH
from app.services.sessions import AuthenticatedSession, IssuedSession


DEMO_PASSWORD = "  temporary schema test passphrase  "
DEMO_TOKEN = "A" * 43
DEMO_CSRF = "B" * 43


def identity(client_type="native", **changes):
    values = {
        "session_id": uuid4(), "account_id": 1, "username": "owner",
        "client_type": client_type,
        "expires_at": datetime(2026, 11, 8, 12, tzinfo=timezone.utc),
        **changes,
    }
    return SessionRead(**values)


def test_request_preserves_exact_password_but_omits_it_from_dumps_and_repr():
    request = LoginRequest(username=" OWNER ", password=DEMO_PASSWORD)
    assert request.username == "owner"
    assert request.password.get_secret_value() == DEMO_PASSWORD
    assert DEMO_PASSWORD not in repr(request)
    assert request.model_dump() == {"username": "owner"}
    assert json.loads(request.model_dump_json()) == {"username": "owner"}
    assert "password" not in repr(request)


@pytest.mark.parametrize("username", ["owner", " OWNER ", "Owner.Name_01", "a" * 64])
def test_request_username_matches_account_service_normalization(username):
    assert LoginRequest(username=username, password="x").username == normalize_username(username)


@pytest.mark.parametrize("username", [None, True, 123, b"owner", "ab", "a" * 65, "owner@host", "owner name", ".owner", "café", "\u212aorey"])
def test_request_rejects_unsupported_usernames(username):
    with pytest.raises(ValidationError):
        LoginRequest(username=username, password="x")


@pytest.mark.parametrize("password", ["x", "x" * (MIN_PASSWORD_LENGTH - 1), "x" * MAX_PASSWORD_LENGTH, " ", "é🙂\n"])
def test_login_allows_existing_passwords_without_new_password_minimum(password):
    request = LoginRequest(username="owner", password=password)
    assert request.password.get_secret_value() == password


@pytest.mark.parametrize("password", [None, True, 123, b"a password", [], {}, "", "x" * (MAX_PASSWORD_LENGTH + 1), "\ud800"])
def test_request_rejects_unusable_password_inputs(password):
    with pytest.raises(ValidationError):
        LoginRequest(username="owner", password=password)


@pytest.mark.parametrize("extra", [
    {"client_type": "web"}, {"account_id": 1}, {"is_active": True},
    {"token": DEMO_TOKEN}, {"expires_at": "2099-01-01T00:00:00Z"},
])
def test_client_cannot_select_server_controlled_authentication_fields(extra):
    with pytest.raises(ValidationError):
        LoginRequest(username="owner", password=DEMO_PASSWORD, **extra)


def test_schema_error_text_hides_input_but_http_handler_still_must_redact_raw_errors():
    secret = "private-password-" + "x" * MAX_PASSWORD_LENGTH
    with pytest.raises(ValidationError) as error:
        LoginRequest(username="owner", password=secret)
    assert secret not in str(error.value)
    # This is why authentication routes must not return errors() directly.
    assert any(item.get("input") == secret for item in error.value.errors())


def test_session_read_accepts_safe_service_identity_and_excludes_extra_attributes():
    value = identity()
    service_result = AuthenticatedSession(**value.model_dump())
    assert SessionRead.model_validate(service_result) == value
    extra_attributes = SimpleNamespace(**value.model_dump(), password_hash="private-hash", token=DEMO_TOKEN)
    result = SessionRead.model_validate(extra_attributes)
    assert result == value
    assert "private-hash" not in result.model_dump_json()
    assert DEMO_TOKEN not in result.model_dump_json()


@pytest.mark.parametrize("field,value", [
    ("account_id", 0), ("account_id", 2), ("account_id", True), ("account_id", "1"),
    ("session_id", "not-a-uuid"), ("session_id", str(uuid4())),
    ("client_type", "browser"), ("client_type", None),
    ("username", "OWNER"), ("username", "bad username"),
    ("expires_at", datetime(2026, 11, 8)), ("expires_at", None),
])
def test_session_read_rejects_invalid_or_coerced_python_values(field, value):
    with pytest.raises(ValidationError):
        identity(**{field: value})


@pytest.mark.parametrize("field", ["password_hash", "token_hash", "csrf_token_hash", "token"])
def test_session_read_rejects_credential_fields_in_dictionaries(field):
    data = identity().model_dump()
    with pytest.raises(ValidationError):
        SessionRead.model_validate({**data, field: DEMO_TOKEN})


def test_safe_identity_round_trips_in_json_with_uuid_and_timezone():
    original = identity(expires_at=datetime(2026, 11, 8, 12, tzinfo=timezone(timedelta(hours=5, minutes=30))))
    encoded = original.model_dump_json()
    assert SessionRead.model_validate_json(encoded) == original
    assert isinstance(json.loads(encoded)["session_id"], str)
    assert "+05:30" in json.loads(encoded)["expires_at"]


def test_web_login_json_delivers_csrf_without_delivering_session_token():
    safe_identity = identity("web")
    issued = IssuedSession(
        identity=AuthenticatedSession(**safe_identity.model_dump()), token=DEMO_TOKEN, csrf_token=DEMO_CSRF,
    )
    response = WebLoginRead.model_validate(issued)
    encoded = response.model_dump_json()
    data = json.loads(encoded)
    assert set(data) == {"identity", "csrf_token"}
    assert data["csrf_token"] == DEMO_CSRF
    assert DEMO_TOKEN not in encoded
    assert DEMO_CSRF not in repr(response)
    assert isinstance(response.model_dump()["csrf_token"], SecretStr)
    assert DEMO_CSRF not in repr(response.model_dump())


def test_native_login_json_delivers_bearer_token_without_csrf():
    safe_identity = identity("native")
    issued = IssuedSession(
        identity=AuthenticatedSession(**safe_identity.model_dump()), token=DEMO_TOKEN, csrf_token=None,
    )
    response = NativeLoginRead.model_validate(issued)
    data = response.model_dump(mode="json")
    assert set(data) == {"identity", "token", "token_type"}
    assert data["token"] == DEMO_TOKEN and data["token_type"] == "Bearer"
    assert DEMO_TOKEN not in repr(response)
    assert isinstance(response.model_dump()["token"], SecretStr)
    assert DEMO_TOKEN not in repr(response.model_dump())


@pytest.mark.parametrize("schema,client_type,field", [
    (WebLoginRead, "web", "csrf_token"), (NativeLoginRead, "native", "token"),
])
@pytest.mark.parametrize("token", [None, True, b"A" * 43, "A" * 42, "A" * 44, "a" * 64, "A" * 42 + "=", "é" * 43, "A" * 42 + "\n"])
def test_token_responses_reject_bad_types_lengths_and_formats(schema, client_type, field, token):
    with pytest.raises(ValidationError):
        schema(identity=identity(client_type), **{field: token})


def test_web_response_cannot_describe_a_native_session():
    with pytest.raises(ValidationError, match="Browser login requires a browser session"):
        WebLoginRead(identity=identity("native"), csrf_token=DEMO_CSRF)


def test_native_response_cannot_describe_a_browser_session():
    with pytest.raises(ValidationError, match="Native login requires a native session"):
        NativeLoginRead(identity=identity("web"), token=DEMO_TOKEN)


def test_web_dictionary_cannot_add_a_session_token():
    with pytest.raises(ValidationError):
        WebLoginRead(identity=identity("web"), csrf_token=DEMO_CSRF, token=DEMO_TOKEN)


def test_native_dictionary_cannot_add_browser_csrf_or_select_token_scheme():
    with pytest.raises(ValidationError):
        NativeLoginRead(identity=identity(), token=DEMO_TOKEN, csrf_token=DEMO_CSRF)
    with pytest.raises(ValidationError):
        NativeLoginRead(identity=identity(), token=DEMO_TOKEN, token_type="Basic")


def test_openapi_describes_write_only_password_and_read_only_response_tokens():
    request = LoginRequest.model_json_schema(mode="validation")
    password = request["properties"]["password"]
    assert password["writeOnly"] is True
    assert password["minLength"] == 1 and password["maxLength"] == MAX_PASSWORD_LENGTH
    for schema, field in ((WebLoginRead, "csrf_token"), (NativeLoginRead, "token")):
        response = schema.model_json_schema(mode="serialization")
        token = response["properties"][field]
        assert token["readOnly"] is True and token["writeOnly"] is False
        assert token["minLength"] == token["maxLength"] == TOKEN_LENGTH
        assert response["additionalProperties"] is False
    assert "token" not in WebLoginRead.model_json_schema(mode="serialization")["properties"]


def test_fastapi_response_serialization_uses_the_intended_transport_fields():
    app = FastAPI()
    @app.get("/test/web", response_model=WebLoginRead)
    def web():
        return WebLoginRead(identity=identity("web"), csrf_token=DEMO_CSRF)
    @app.get("/test/native", response_model=NativeLoginRead)
    def native():
        return NativeLoginRead(identity=identity(), token=DEMO_TOKEN)
    with TestClient(app) as client:
        web_result = client.get("/test/web")
        native_result = client.get("/test/native")
    assert web_result.status_code == native_result.status_code == 200
    assert web_result.json()["csrf_token"] == DEMO_CSRF
    assert "token" not in web_result.json()
    assert native_result.json()["token"] == DEMO_TOKEN
