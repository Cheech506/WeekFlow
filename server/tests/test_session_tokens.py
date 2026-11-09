"""Check session-token generation, hashing, and malformed-input handling."""

import hashlib
import re

import pytest

from app.services import session_tokens as tokens


DEMO_TOKEN = "A" * 43


def test_generated_token_has_supported_format():
    token = tokens.generate_token()
    assert len(token) == tokens.TOKEN_LENGTH == 43
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)


def test_generator_requests_32_random_bytes(monkeypatch):
    requested = []
    def generate(size):
        requested.append(size)
        return DEMO_TOKEN
    monkeypatch.setattr(tokens.secrets, "token_urlsafe", generate)
    assert tokens.generate_token() == DEMO_TOKEN
    assert requested == [32]


def test_separate_calls_generate_different_secrets():
    assert tokens.generate_token() != tokens.generate_token()


@pytest.mark.parametrize("purpose", ["session", "csrf"])
def test_hash_has_the_expected_sha256_representation(purpose):
    expected = hashlib.sha256(
        f"weekflow:{purpose}:v1:".encode("ascii") + DEMO_TOKEN.encode("ascii")
    ).hexdigest()
    digest = tokens.hash_token(DEMO_TOKEN, purpose=purpose)
    assert digest == expected
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert DEMO_TOKEN not in digest
    assert tokens.verify_token(DEMO_TOKEN, digest, purpose=purpose)


def test_same_token_has_distinct_session_and_csrf_hashes():
    session_hash = tokens.hash_token(DEMO_TOKEN, purpose="session")
    csrf_hash = tokens.hash_token(DEMO_TOKEN, purpose="csrf")
    assert session_hash != csrf_hash
    assert not tokens.verify_token(DEMO_TOKEN, session_hash, purpose="csrf")
    assert not tokens.verify_token(DEMO_TOKEN, csrf_hash, purpose="session")


@pytest.mark.parametrize("changed", ["B" + "A" * 42, "a" * 43, "A" * 42 + "B"])
def test_modified_tokens_do_not_match(changed):
    digest = tokens.hash_token(DEMO_TOKEN, purpose="session")
    assert not tokens.verify_token(changed, digest, purpose="session")


@pytest.mark.parametrize("invalid", [
    None, True, 123, b"A" * 43, [], {}, "", "A" * 42, "A" * 44,
    " " + "A" * 42, "A" * 42 + " ", "A" * 42 + "\n",
    "A" * 42 + "=", "A" * 42 + "/", "A" * 42 + "+", "é" * 43,
    "A" * 42 + "\ud800", "A" * 100_000,
])
def test_malformed_tokens_are_rejected_without_echoing_input(invalid):
    with pytest.raises(tokens.TokenValidationError) as error:
        tokens.hash_token(invalid, purpose="session")
    assert str(error.value) == "Token format is invalid."
    digest = tokens.hash_token(DEMO_TOKEN, purpose="session")
    assert not tokens.verify_token(invalid, digest, purpose="session")


@pytest.mark.parametrize("invalid_hash", [
    None, False, 123, b"a" * 64, [], {}, "", "a" * 63, "a" * 65,
    "A" * 64, "g" * 64, "a" * 63 + "\n", "é" * 64,
    "\ud800" * 64, "a" * 100_000,
])
def test_malformed_stored_hashes_fail_closed(invalid_hash):
    assert not tokens.verify_token(DEMO_TOKEN, invalid_hash, purpose="session")


def test_database_hash_is_not_a_usable_token():
    digest = tokens.hash_token(DEMO_TOKEN, purpose="session")
    assert not tokens.verify_token(digest, digest, purpose="session")


def test_digest_comparison_uses_compare_digest(monkeypatch):
    digest = tokens.hash_token(DEMO_TOKEN, purpose="session")
    comparisons = []
    def compare(left, right):
        comparisons.append((left, right))
        return True
    monkeypatch.setattr(tokens.secrets, "compare_digest", compare)
    assert tokens.verify_token(DEMO_TOKEN, digest, purpose="session")
    assert comparisons == [(digest, digest)]


@pytest.mark.parametrize("purpose", [None, "", "SESSION", "password", "private-secret"])
def test_unsupported_purpose_is_a_safe_programming_error(purpose):
    with pytest.raises(ValueError, match="Token purpose must be session or csrf"):
        tokens.hash_token(DEMO_TOKEN, purpose=purpose)
    with pytest.raises(ValueError, match="Token purpose must be session or csrf"):
        tokens.verify_token(DEMO_TOKEN, "a" * 64, purpose=purpose)


def test_entropy_failure_propagates_without_fallback(monkeypatch):
    def unavailable(size):
        raise RuntimeError("Random generator unavailable")
    monkeypatch.setattr(tokens.secrets, "token_urlsafe", unavailable)
    with pytest.raises(RuntimeError, match="Random generator unavailable"):
        tokens.generate_token()
