"""Check password hashing and verification without a database connection."""

from argon2 import Type, extract_parameters
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
import pytest

from app.services import passwords


DEMO_PASSWORD = "a temporary test passphrase"


@pytest.fixture(scope="module")
def stored_hash():
    return passwords.hash_password(DEMO_PASSWORD)


def test_new_hash_uses_argon2id_and_does_not_contain_the_password(stored_hash):
    assert extract_parameters(stored_hash).type is Type.ID
    assert DEMO_PASSWORD not in stored_hash
    assert stored_hash != DEMO_PASSWORD


def test_correct_password_matches_and_wrong_password_does_not(stored_hash):
    assert passwords.verify_password(DEMO_PASSWORD, stored_hash) is True
    assert passwords.verify_password("a different test passphrase", stored_hash) is False


def test_same_password_gets_a_fresh_random_salt(stored_hash):
    second = passwords.hash_password(DEMO_PASSWORD)
    assert second != stored_hash
    assert passwords.verify_password(DEMO_PASSWORD, second) is True


@pytest.mark.parametrize("password", [
    "a" * 15,
    "a" * 128,
    "a passphrase with spaces",
    "\U0001f512" * 15,
])
def test_supported_passwords_round_trip_without_truncation(password):
    stored = passwords.hash_password(password)
    assert passwords.verify_password(password, stored) is True
    assert passwords.verify_password(password[:-1], stored) is False


def test_leading_and_trailing_spaces_are_part_of_the_password():
    password = "  a temporary test passphrase  "
    stored = passwords.hash_password(password)
    assert passwords.verify_password(password, stored) is True
    assert passwords.verify_password(password.strip(), stored) is False


def test_passwords_remain_case_sensitive(stored_hash):
    assert passwords.verify_password(DEMO_PASSWORD.upper(), stored_hash) is False


def test_unicode_is_not_silently_normalized():
    password = "caf\u00e9 reading books"
    stored = passwords.hash_password(password)
    assert passwords.verify_password(password, stored) is True
    assert passwords.verify_password("cafe\u0301 reading books", stored) is False


@pytest.mark.parametrize("password", [
    None, False, 123, b"a temporary test passphrase",
    "", "a" * 14, "a" * 129, " " * 15, "\ud800" * 15,
])
def test_invalid_new_password_is_rejected(password):
    with pytest.raises(passwords.PasswordValidationError):
        passwords.hash_password(password)


def test_validation_error_does_not_echo_the_password():
    supplied = "Secret!"
    with pytest.raises(passwords.PasswordValidationError) as error:
        passwords.hash_password(supplied)
    assert supplied not in str(error.value)


@pytest.mark.parametrize("password", [None, False, 123, b"bytes", "", "a" * 129, "\ud800"])
def test_unusable_login_password_is_rejected(stored_hash, password):
    assert passwords.verify_and_update_password(password, stored_hash) == (False, None)


@pytest.mark.parametrize("stored", [
    None, "", "plain-text-is-not-a-hash", "$argon2id$broken",
    "$argon2id$v=19$m=65536,t=3,p=4$bad$bad", "a" * 1025, "\ud800",
])
def test_missing_or_invalid_stored_hash_fails_closed(stored):
    assert passwords.verify_and_update_password(DEMO_PASSWORD, stored) == (False, None)


def test_missing_hash_performs_dummy_verification_without_accepting_a_match(monkeypatch):
    calls = []
    def pretend_match(password, stored):
        calls.append((password, stored))
        return True
    monkeypatch.setattr(passwords._password_hash, "verify", pretend_match)
    assert passwords.verify_and_update_password(DEMO_PASSWORD, None) == (False, None)
    assert calls == [(DEMO_PASSWORD, passwords._dummy_hash)]


def test_unknown_hash_performs_dummy_verification(monkeypatch):
    calls = []
    original_verify = passwords._password_hash.verify
    def record_verify(password, stored):
        calls.append(stored)
        return original_verify(password, stored)
    monkeypatch.setattr(passwords._password_hash, "verify", record_verify)
    assert passwords.verify_and_update_password(DEMO_PASSWORD, "unknown-format") == (False, None)
    assert calls == [passwords._dummy_hash]


def test_current_hash_needs_no_replacement(stored_hash):
    assert passwords.verify_and_update_password(DEMO_PASSWORD, stored_hash) == (True, None)


@pytest.fixture
def older_hash():
    # A real low-cost Argon2 hash simulates an older deployment's settings.
    # This configuration is only for testing automatic upgrades.
    older = PasswordHash((Argon2Hasher(memory_cost=8192, time_cost=1, parallelism=1),))
    return older.hash(DEMO_PASSWORD)


def test_valid_older_hash_returns_an_upgraded_hash(older_hash):
    valid, replacement = passwords.verify_and_update_password(DEMO_PASSWORD, older_hash)
    assert valid is True
    assert replacement is not None
    assert replacement != older_hash
    assert PasswordHash.recommended().verify(DEMO_PASSWORD, replacement) is True
    assert passwords.verify_and_update_password(DEMO_PASSWORD, replacement) == (True, None)


def test_wrong_password_does_not_upgrade_a_hash(older_hash):
    assert passwords.verify_and_update_password("wrong passphrase", older_hash) == (False, None)


def test_new_minimum_does_not_block_verifying_an_existing_short_password():
    stored = PasswordHash.recommended().hash("old")
    assert passwords.verify_password("old", stored) is True
    with pytest.raises(passwords.PasswordValidationError):
        passwords.hash_password("old")


def test_unexpected_hashing_failure_is_not_reported_as_success(monkeypatch):
    def failed_hash(password):
        raise RuntimeError("Hashing unavailable")
    monkeypatch.setattr(passwords._password_hash, "hash", failed_hash)
    with pytest.raises(RuntimeError, match="Hashing unavailable"):
        passwords.hash_password(DEMO_PASSWORD)


def test_unexpected_verification_failure_is_not_swallowed(monkeypatch, stored_hash):
    def failed_verification(password, stored):
        raise RuntimeError("Verification unavailable")
    monkeypatch.setattr(passwords._password_hash, "verify_and_update", failed_verification)
    with pytest.raises(RuntimeError, match="Verification unavailable"):
        passwords.verify_password(DEMO_PASSWORD, stored_hash)
