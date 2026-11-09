"""Validate browser-setup request shapes and credential-free responses."""

from dataclasses import dataclass
import json
from types import SimpleNamespace

from pydantic import SecretStr, ValidationError
import pytest

from app.schemas.owner_setup import (
    OwnerSetupCreatedRead,
    OwnerSetupRequest,
    OwnerSetupStatusRead,
)
from app.services.accounts import CreatedOwner, normalize_username
from app.services.owner_setup import OwnerSetupStatus
from app.services.passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH


DEMO_CODE = "A" * 43
DEMO_PASSWORD = "a temporary setup test passphrase"


def valid_request(**changes):
    return {"setup_code": DEMO_CODE, "username": "owner", "password": DEMO_PASSWORD, **changes}


def test_valid_request_wraps_secrets_without_changing_them():
    request = OwnerSetupRequest.model_validate(valid_request(username=" COREY "))
    assert request.username == "corey"
    assert isinstance(request.setup_code, SecretStr)
    assert isinstance(request.password, SecretStr)
    assert request.setup_code.get_secret_value() == DEMO_CODE
    assert request.password.get_secret_value() == DEMO_PASSWORD


def test_json_request_round_trips_secret_input_without_serializing_it_back():
    request = OwnerSetupRequest.model_validate_json(json.dumps(valid_request()))
    assert request.password.get_secret_value() == DEMO_PASSWORD
    assert request.model_dump() == {"username": "owner"}
    assert json.loads(request.model_dump_json()) == {"username": "owner"}
    assert request.model_dump(include={"username", "password", "setup_code"}) == {"username": "owner"}


def test_normal_representations_do_not_expose_secrets():
    request = OwnerSetupRequest.model_validate(valid_request())
    for output in (repr(request), str(request), repr(request.model_dump()), request.model_dump_json()):
        assert DEMO_CODE not in output
        assert DEMO_PASSWORD not in output


@pytest.mark.parametrize("username", [" COREY ", "Owner.Name_01", "owner-name", "a" * 64])
def test_schema_normalization_matches_account_service(username):
    request = OwnerSetupRequest.model_validate(valid_request(username=username))
    assert request.username == normalize_username(username)


@pytest.mark.parametrize("field", ["setup_code", "username", "password"])
def test_all_request_fields_are_required(field):
    payload = valid_request()
    del payload[field]
    with pytest.raises(ValidationError):
        OwnerSetupRequest.model_validate(payload)


@pytest.mark.parametrize("field", ["setup_code", "username", "password"])
@pytest.mark.parametrize("value", [None, True, 123, b"bytes", [], {}])
def test_request_fields_do_not_coerce_other_types_to_strings(field, value):
    with pytest.raises(ValidationError):
        OwnerSetupRequest.model_validate(valid_request(**{field: value}))


@pytest.mark.parametrize("field,value", [
    ("id", 1), ("is_active", True), ("password_hash", "not-allowed"),
    ("code_hash", "not-allowed"), ("rotate", True),
])
def test_extra_or_server_owned_request_fields_are_forbidden(field, value):
    with pytest.raises(ValidationError):
        OwnerSetupRequest.model_validate(valid_request(**{field: value}))


@pytest.mark.parametrize("username", ["ab", "a" * 65, ".owner", "owner name", "owner@host", "\u212aorey", "caf\u00e9"])
def test_invalid_usernames_are_rejected(username):
    with pytest.raises(ValidationError):
        OwnerSetupRequest.model_validate(valid_request(username=username))


@pytest.mark.parametrize("code", ["A" * 42, "A" * 44, "A" * 42 + "+", " " * 43, "\u00e9" * 43])
def test_setup_code_format_is_checked_without_normalizing_it(code):
    with pytest.raises(ValidationError):
        OwnerSetupRequest.model_validate(valid_request(setup_code=code))


@pytest.mark.parametrize("password", ["a" * 14, "a" * 129, " " * 15, "\ud800" * 15])
def test_unusable_new_passwords_are_rejected(password):
    with pytest.raises(ValidationError):
        OwnerSetupRequest.model_validate(valid_request(password=password))


@pytest.mark.parametrize("password", ["a" * MIN_PASSWORD_LENGTH, "a" * MAX_PASSWORD_LENGTH, "\U0001f512" * 15, "  caf\u00e9 reading books  "])
def test_supported_passwords_are_preserved_exactly(password):
    request = OwnerSetupRequest.model_validate(valid_request(password=password))
    assert request.password.get_secret_value() == password


def test_error_text_hides_input_but_error_dictionaries_need_explicit_redaction():
    supplied = "S3cr3t!"
    with pytest.raises(ValidationError) as error:
        OwnerSetupRequest.model_validate(valid_request(password=supplied))
    assert supplied not in str(error.value)
    # A regression reminder for the future HTTP error handler: Pydantic's
    # hide_input_in_errors option does NOT redact raw errors() dictionaries.
    assert any(item.get("input") == supplied for item in error.value.errors())
    safe_errors = error.value.errors(include_input=False, include_context=False)
    assert supplied not in repr(safe_errors)


def test_invalid_code_is_not_exposed_in_error_text():
    supplied = "Z" * 42 + "+"
    with pytest.raises(ValidationError) as error:
        OwnerSetupRequest.model_validate(valid_request(setup_code=supplied))
    assert supplied not in str(error.value)


def test_openapi_request_fields_are_write_only_and_serialized_output_excludes_them():
    request_schema = OwnerSetupRequest.model_json_schema(mode="validation")
    assert set(request_schema["required"]) == {"setup_code", "username", "password"}
    for name in ("setup_code", "password"):
        assert request_schema["properties"][name]["writeOnly"] is True
    assert set(OwnerSetupRequest.model_json_schema(mode="serialization")["properties"]) == {"username"}


@pytest.mark.parametrize("exists,ready", [(False, False), (False, True), (True, False)])
def test_status_response_accepts_only_consistent_states(exists, ready):
    result = OwnerSetupStatusRead.model_validate(OwnerSetupStatus(owner_exists=exists, setup_ready=ready))
    assert result.model_dump() == {"owner_exists": exists, "setup_ready": ready}


def test_status_cannot_advertise_setup_for_an_existing_owner():
    with pytest.raises(ValidationError):
        OwnerSetupStatusRead(owner_exists=True, setup_ready=True)


@pytest.mark.parametrize("field", ["owner_exists", "setup_ready"])
@pytest.mark.parametrize("value", [0, "false", None])
def test_status_requires_actual_booleans(field, value):
    payload = {"owner_exists": False, "setup_ready": False, field: value}
    with pytest.raises(ValidationError):
        OwnerSetupStatusRead.model_validate(payload)


def test_created_response_reads_safe_service_result():
    response = OwnerSetupCreatedRead.model_validate(CreatedOwner(id=1, username="owner"))
    assert response.model_dump() == {"id": 1, "username": "owner"}


def test_response_filters_sensitive_object_attributes():
    result = SimpleNamespace(id=1, username="owner", password_hash="private-hash", setup_code=DEMO_CODE)
    response = OwnerSetupCreatedRead.model_validate(result)
    assert response.model_dump() == {"id": 1, "username": "owner"}
    assert "private-hash" not in response.model_dump_json()
    assert DEMO_CODE not in response.model_dump_json()


@pytest.mark.parametrize("id_value", [0, 2, True, "1", None])
def test_created_response_requires_the_real_singleton_account_id(id_value):
    with pytest.raises(ValidationError):
        OwnerSetupCreatedRead(id=id_value, username="owner")


@pytest.mark.parametrize("username", ["OWNER", ".owner", "owner name", "caf\u00e9", "owner\n"])
def test_created_response_requires_a_canonical_stored_username(username):
    with pytest.raises(ValidationError):
        OwnerSetupCreatedRead(id=1, username=username)


@pytest.mark.parametrize("model,payload", [
    (OwnerSetupCreatedRead, {"id": 1, "username": "owner", "password_hash": "private-hash"}),
    (OwnerSetupStatusRead, {"owner_exists": False, "setup_ready": True, "setup_code": DEMO_CODE}),
])
def test_response_dictionaries_refuse_extra_secret_fields(model, payload):
    with pytest.raises(ValidationError):
        model.model_validate(payload)
