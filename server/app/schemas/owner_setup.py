"""Request and safe response schemas for first-run browser account setup."""

import re
from typing import Annotated, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_validator,
)


_CODE_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}", flags=re.ASCII)

OwnerUsername = Annotated[
    str,
    Field(
        min_length=3,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9_.-]{2,63}$",
    ),
]


class _SetupSchema(BaseModel):
    model_config = ConfigDict(
        strict=True,
        extra="forbid",
        hide_input_in_errors=True,
    )


class OwnerSetupRequest(_SetupSchema):
    """Credentials for one setup attempt; the service verifies authorization.

    SecretStr masks normal representations. exclude=True also omits secrets
    from model serialization. The router must deliberately extract their raw
    values with get_secret_value() only when calling the setup service.

    IMPORTANT: hide_input_in_errors hides inputs in error text, not in raw
    ValidationError.errors() dictionaries. The HTTP validation-error handler
    must redact input/context values before returning or logging auth errors.
    """

    setup_code: SecretStr = Field(
        min_length=43,
        max_length=43,
        repr=False,
        exclude=True,
        description="The one-time code obtained locally from the server.",
    )
    username: OwnerUsername
    # Keep these creation bounds aligned with app.services.passwords.
    # Schema tests check that contract without performing expensive hashing.
    password: SecretStr = Field(
        min_length=15,
        max_length=128,
        repr=False,
        exclude=True,
        description="The new owner's password; spaces and Unicode are supported.",
    )

    @field_validator("username", mode="before")
    @classmethod
    def normalize_owner_username(cls, value: object) -> object:
        if not isinstance(value, str):
            return value  # Let strict string validation reject other types.
        normalized = value.strip()
        if not normalized.isascii():
            raise ValueError("Username must contain only supported ASCII characters.")
        return normalized.lower()

    @field_validator("setup_code")
    @classmethod
    def require_setup_code_format(cls, value: SecretStr) -> SecretStr:
        if _CODE_PATTERN.fullmatch(value.get_secret_value()) is None:
            raise ValueError("Setup code must be 43 URL-safe characters.")
        return value

    @field_validator("password")
    @classmethod
    def require_usable_new_password(cls, value: SecretStr) -> SecretStr:
        raw = value.get_secret_value()
        try:
            raw.encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("Password must be valid Unicode text.") from None
        if raw.isspace():
            raise ValueError("Password must contain more than whitespace.")
        return value


class OwnerSetupStatusRead(_SetupSchema):
    """Public setup readiness, without code state or account credentials."""

    model_config = ConfigDict(from_attributes=True)

    owner_exists: bool
    setup_ready: bool

    @model_validator(mode="after")
    def reject_contradictory_status(self) -> Self:
        if self.owner_exists and self.setup_ready:
            raise ValueError("Owner setup cannot be ready when an owner already exists.")
        return self


class OwnerSetupCreatedRead(_SetupSchema):
    """Safe confirmation of account creation; this does not create a login."""

    model_config = ConfigDict(from_attributes=True)

    id: int = Field(ge=1, le=1)
    username: OwnerUsername
