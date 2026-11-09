"""Generate and verify high-entropy session and browser CSRF tokens.

This module has no database or HTTP operations. Passwords belong in the
Argon2 password service; these tokens contain 32 cryptographically random
bytes, so their database representation can use SHA-256 instead.
"""

import hashlib
import re
import secrets
from typing import Literal


TOKEN_BYTES = 32
TOKEN_LENGTH = 43
TokenPurpose = Literal["session", "csrf"]

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}", flags=re.ASCII)
_HASH_PATTERN = re.compile(r"[0-9a-f]{64}", flags=re.ASCII)


class TokenValidationError(ValueError):
    """A token has an unsupported type or format."""


def _purpose_prefix(purpose: TokenPurpose) -> bytes:
    """Keep session-token and CSRF-token hashes in separate namespaces."""
    if purpose == "session":
        return b"weekflow:session:v1:"
    if purpose == "csrf":
        return b"weekflow:csrf:v1:"
    # A bad purpose is a programming error, not an invalid login attempt.
    raise ValueError("Token purpose must be session or csrf.")


def _valid_token(token: object) -> bool:
    # Check length first to bound work on malformed input. Do not trim,
    # lowercase, or otherwise change tokens supplied by the client.
    return (
        isinstance(token, str)
        and len(token) == TOKEN_LENGTH
        and _TOKEN_PATTERN.fullmatch(token) is not None
    )


def generate_token() -> str:
    """Return a fresh, unpredictable token for a session or CSRF check.

    Call separately for each secret: a browser's session token and CSRF token
    must be independently generated. Never log the returned value or put it
    in a URL. The caller decides how to deliver and securely store it.
    """
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str, *, purpose: TokenPurpose) -> str:
    """Return the hash to store, using an explicit session or csrf purpose.

    The purpose is included in the hash input so identical text does not
    produce an interchangeable session hash and CSRF hash. Token hashes
    are never accepted as credentials by this module.
    """
    prefix = _purpose_prefix(purpose)
    if not _valid_token(token):
        raise TokenValidationError("Token format is invalid.")
    return hashlib.sha256(prefix + token.encode("ascii")).hexdigest()


def verify_token(
    token: object,
    stored_hash: object,
    *,
    purpose: TokenPurpose,
) -> bool:
    """Check a supplied token against a stored hash without echoing secrets.

    Invalid inputs return False. Well-formed digests use compare_digest
    rather than a normal string comparison. A match proves possession of
    this token only: the session service must still check account status,
    expiration, inactivity, revocation, and the expected client type.
    """
    _purpose_prefix(purpose)
    if not _valid_token(token):
        return False
    if (
        not isinstance(stored_hash, str)
        or len(stored_hash) != 64
        or _HASH_PATTERN.fullmatch(stored_hash) is None
    ):
        return False
    candidate = hash_token(token, purpose=purpose)
    return secrets.compare_digest(candidate, stored_hash)
