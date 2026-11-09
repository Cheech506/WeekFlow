"""Password hashing and verification, without database or HTTP operations."""

import secrets

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError


# This instance currently has no second authentication factor, so require a
# long password. Permit passphrases, Unicode, and spaces without case rules.
MIN_PASSWORD_LENGTH = 15
MAX_PASSWORD_LENGTH = 128
MAX_PASSWORD_HASH_LENGTH = 1024

_password_hash = PasswordHash.recommended()

# A missing account/hash should still perform password-verification work.
# This is a random, process-local dummy value, never a usable owner account.
# Its raw input is discarded; even a match must never authorize a request.
_dummy_hash = _password_hash.hash(secrets.token_urlsafe(32))


class PasswordValidationError(ValueError):
    """A proposed new password does not meet the supported password rules."""


def _usable_password_input(password: object) -> bool:
    """Reject unusable input before invoking the expensive hashing library."""

    if not isinstance(password, str) or not 1 <= len(password) <= MAX_PASSWORD_LENGTH:
        return False
    try:
        password.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def hash_password(password: str) -> str:
    """Validate a new password and return a salted Argon2 hash.

    The caller saves only the returned hash to Account.password_hash.
    Do not trim, lowercase, log, or silently truncate the supplied password.
    Library hashing failures propagate; they are not successful account setup.
    """

    if not _usable_password_input(password):
        raise PasswordValidationError(
            f"Password must be valid Unicode text with 1-{MAX_PASSWORD_LENGTH} characters."
        )
    if len(password) < MIN_PASSWORD_LENGTH:
        raise PasswordValidationError(
            f"Choose a password with at least {MIN_PASSWORD_LENGTH} characters."
        )
    if password.isspace():
        raise PasswordValidationError(
            "Choose a password containing more than whitespace."
        )

    # The library generates a fresh salt. Never supply a fixed salt here.
    return _password_hash.hash(password)


def verify_and_update_password(
    password: str,
    stored_hash: str | None,
) -> tuple[bool, str | None]:
    """Check a login password and optionally return an upgraded hash.

    The second result is a replacement hash when library settings need an
    upgrade. The caller decides how to save it; this function never writes
    to the database. Rehashing is not a password change.

    Apply the minimum length only when setting a new password. A future
    increase to that minimum must not lock out existing valid passwords.
    """

    if not _usable_password_input(password):
        return False, None

    if (
        not isinstance(stored_hash, str)
        or not stored_hash
        or len(stored_hash) > MAX_PASSWORD_HASH_LENGTH
    ):
        _password_hash.verify(password, _dummy_hash)
        return False, None

    try:
        return _password_hash.verify_and_update(password, stored_hash)
    except UnknownHashError:
        # Unknown formats must fail closed, not crash login or accept input.
        # Dummy work reduces the obvious missing-account timing difference;
        # it does not replace endpoint rate limits or guarantee equal timing.
        _password_hash.verify(password, _dummy_hash)
        return False, None


def verify_password(password: str, stored_hash: str | None) -> bool:
    """Return whether the supplied password matches a stored password hash."""

    valid, _ = verify_and_update_password(password, stored_hash)
    return valid
