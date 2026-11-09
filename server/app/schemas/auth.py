"""Strict login input and separate browser/native authentication responses."""

import re
from typing import Literal, Self
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_serializer,
    field_validator,
    model_validator,
)

from app.schemas.owner_setup import OwnerUsername


_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}", flags=re.ASCII)
_TOKEN_RESPONSE_SCHEMA = {
    "readOnly": True,
    "writeOnly": False,
    "format": "opaque-token",
    "minLength": 43,
    "maxLength": 43,
    "pattern": r"^[A-Za-z0-9_-]{43}$",
}


class _AuthSchema(BaseModel):
    model_config = ConfigDict(
        strict=True,
        extra="forbid",
        hide_input_in_errors=True,
    )


def _require_token(value: SecretStr) -> SecretStr:
    if _TOKEN_PATTERN.fullmatch(value.get_secret_value()) is None:
        raise ValueError("Authentication token format is invalid.")
    return value


class LoginRequest(_AuthSchema):
    """One password-login attempt; the service decides whether it is valid.

    The request cannot select client type, session tokens, account status, or
    expiration. Future routes select browser/native transport explicitly.

    Passwords are omitted from repr and model dumps. The router extracts
    the exact password only when calling the throttled login service.
    hide_input_in_errors does NOT sanitize raw ValidationError.errors();
    authentication HTTP errors must still be redacted before returning/logging.
    """

    username: OwnerUsername
    # Match verification bounds, not the minimum for creating a NEW password.
    password: SecretStr = Field(
        min_length=1, max_length=128, repr=False, exclude=True,
        description="The existing password, preserved exactly as supplied.",
    )

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        if not normalized.isascii():
            raise ValueError("Username must contain only supported ASCII characters.")
        return normalized.lower()

    @field_validator("password")
    @classmethod
    def require_unicode_password(cls, value: SecretStr) -> SecretStr:
        try:
            value.get_secret_value().encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("Password must be valid Unicode text.") from None
        return value


class SessionRead(_AuthSchema):
    """Safe identity data from a verified session, not proof of login by itself.

    Authentication remains the service's job. The UUID identifies a record;
    it is not a credential. Responses deliberately select these attributes
    rather than serializing an entire account or session ORM object.
    """

    model_config = ConfigDict(from_attributes=True)

    session_id: UUID
    account_id: int = Field(ge=1, le=1)
    username: OwnerUsername
    client_type: Literal["web", "native"]
    expires_at: AwareDatetime


class WebLoginRead(_AuthSchema):
    """Browser login JSON; the session token belongs only in an HttpOnly cookie.

    This JSON deliberately transmits the CSRF token so the frontend can send
    it back in a custom request header. Never log this response payload.
    The future route must set the session cookie and no-store headers; a
    response schema does not set cookies or enforce HTTPS by itself.
    """

    model_config = ConfigDict(from_attributes=True)

    identity: SessionRead
    csrf_token: SecretStr = Field(
        min_length=43, max_length=43, repr=False,
        json_schema_extra=_TOKEN_RESPONSE_SCHEMA.copy(),
    )

    @field_validator("csrf_token")
    @classmethod
    def require_csrf_format(cls, value: SecretStr) -> SecretStr:
        return _require_token(value)

    @field_serializer("csrf_token", when_used="json")
    def serialize_csrf_for_transport(self, value: SecretStr) -> str:
        # JSON is the explicit credential-delivery boundary. Python-mode
        # dumps keep SecretStr masked; the browser session token has no field.
        return value.get_secret_value()

    @model_validator(mode="after")
    def require_browser_identity(self) -> Self:
        if self.identity.client_type != "web":
            raise ValueError("Browser login requires a browser session.")
        return self


class NativeLoginRead(_AuthSchema):
    """Phone login JSON, containing the token for secure native device storage.

    Only the native HTTPS login route should return this response. The token
    is intentionally included in JSON for delivery; do not log this payload.
    Browser responses must use WebLoginRead instead, which has no token field.
    """

    model_config = ConfigDict(from_attributes=True)

    identity: SessionRead
    token: SecretStr = Field(
        min_length=43, max_length=43, repr=False,
        json_schema_extra=_TOKEN_RESPONSE_SCHEMA.copy(),
    )
    token_type: Literal["Bearer"] = "Bearer"

    @field_validator("token")
    @classmethod
    def require_session_token_format(cls, value: SecretStr) -> SecretStr:
        return _require_token(value)

    @field_serializer("token", when_used="json")
    def serialize_token_for_transport(self, value: SecretStr) -> str:
        return value.get_secret_value()

    @model_validator(mode="after")
    def require_native_identity(self) -> Self:
        if self.identity.client_type != "native":
            raise ValueError("Native login requires a native session.")
        return self
