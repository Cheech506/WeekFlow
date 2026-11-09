"""Authentication HTTP endpoints and a reusable session-check dependency.

This router must be registered separately from protected feature routers.
Registering it alone does not protect tasks, backups, or other feature APIs.
"""

from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import UTC
import logging
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import API_PREFIX
from app.database import get_db
from app.schemas.auth import LoginRequest, NativeLoginRead, SessionRead, WebLoginRead
from app.services.login_throttle import (
    InvalidLoginSourceError, LoginRateLimitedError, LoginThrottleStorageError,
    login_owner_with_limits,
)
from app.services.session_tokens import TokenValidationError, hash_token
from app.services.sessions import (
    ClientType, InvalidCredentialsError, InvalidCsrfTokenError, InvalidSessionError,
    IssuedSession, SESSION_LIFETIME, SessionStorageError,
    authenticate_session, revoke_session,
)


SESSION_COOKIE_NAME = "__Host-weekflow_session"
CSRF_HEADER_NAME = "X-CSRF-Token"
_MAX_AUTH_BODY_BYTES = 16 * 1024
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
_logger = logging.getLogger(__name__)
_NO_STORE_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
}
_DETAILS = {
    "invalid": "Invalid authentication request.",
    "https": "HTTPS is required for authentication.",
    "origin": "The browser origin is not permitted for authentication.",
    "native": "Browser credentials and browser requests cannot use native authentication.",
    "json": "Login requires an uncompressed application/json request.",
    "large": "The authentication request body is too large.",
    "query": "Authentication credentials must not be supplied in the URL.",
    "credentials": "Username or password is incorrect.",
    "session": "The login session is unavailable or no longer valid.",
    "csrf": "The browser request could not be verified.",
    "limited": "Too many login attempts. Try again later.",
    "storage": "Authentication could not be confirmed. Check server state before retrying.",
    "unexpected": "The authentication request could not be completed. Check server state before retrying.",
}


def _single_header(request: Request, name: str) -> str | None:
    values = request.headers.getlist(name)
    if len(values) > 1:
        raise HTTPException(400, detail=_DETAILS["invalid"])
    return values[0] if values else None


def _require_https(request: Request) -> None:
    # Trust the server's ASGI scheme, not an X-Forwarded-Proto header parsed
    # here. Reverse-proxy trust must be configured explicitly on the server.
    if request.url.scheme != "https":
        raise HTTPException(403, detail=_DETAILS["https"])


def _origin(value: str, *, allow_path: bool = False) -> tuple[str, str, int] | None:
    try:
        if value != value.strip() or any(char in value for char in "\r\n\t"):
            return None
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https" or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
        ):
            return None
        if not allow_path and (parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            return None
        return parsed.scheme, parsed.hostname.lower(), parsed.port if parsed.port is not None else 443
    except ValueError:
        return None


def _require_browser_origin(request: Request) -> None:
    target = _origin(str(request.base_url))
    origin = _single_header(request, "origin")
    referer = _single_header(request, "referer")
    site = (_single_header(request, "sec-fetch-site") or "").lower()
    if target is None or site in {"cross-site", "same-site"}:
        raise HTTPException(403, detail=_DETAILS["origin"])
    if origin is not None:
        permitted = _origin(origin) == target
    elif referer is not None:
        permitted = _origin(referer, allow_path=True) == target
    else:
        # Modern browsers can establish same-origin provenance with Fetch
        # Metadata when the page suppresses Referer. Otherwise fail closed.
        permitted = site == "same-origin"
    if not permitted:
        raise HTTPException(403, detail=_DETAILS["origin"])


def _require_native_transport(request: Request) -> None:
    # Native routes use explicit bearer tokens, never browser session cookies.
    # Browser provenance headers are rejected rather than providing a browser
    # alternative that exposes an HttpOnly session token in JSON.
    if SESSION_COOKIE_NAME in request.cookies or any(
        name in request.headers for name in ("origin", "referer", "sec-fetch-site", "sec-fetch-mode")
    ):
        raise HTTPException(403, detail=_DETAILS["native"])


@dataclass(frozen=True)
class _Credentials:
    client_type: ClientType
    token: str = field(repr=False)


def _credentials(request: Request) -> _Credentials:
    _require_https(request)
    authorization = _single_header(request, "authorization")
    # Detect duplicate session-cookie names across Cookie header lines.
    count = sum(
        part.strip().partition("=")[0] == SESSION_COOKIE_NAME
        for value in request.headers.getlist("cookie") for part in value.split(";")
    )
    if count > 1 or (count and authorization is not None):
        raise HTTPException(400, detail=_DETAILS["invalid"])
    if count:
        _require_browser_origin(request)
        result = _Credentials(client_type="web", token=request.cookies.get(SESSION_COOKIE_NAME, ""))
    elif authorization is not None:
        _require_native_transport(request)
        parts = authorization.split(" ")
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise HTTPException(401, detail=_DETAILS["session"], headers={"WWW-Authenticate": "Bearer"})
        result = _Credentials(client_type="native", token=parts[1])
    else:
        raise HTTPException(401, detail=_DETAILS["session"], headers={"WWW-Authenticate": "Bearer"})
    try:
        hash_token(result.token, purpose="session")
    except TokenValidationError:
        raise HTTPException(401, detail=_DETAILS["session"], headers={"WWW-Authenticate": "Bearer"}) from None
    return result


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE_NAME, path="/", secure=True, httponly=True, samesite="strict")


class _SafeAuthRoute(APIRoute):
    """Bound auth bodies and keep secrets out of validation/server responses."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original_handler = super().get_route_handler()
        is_login = self.name in {"login_web", "login_native"}

        async def safe_handler(request: Request) -> Response:
            try:
                _require_https(request)
                if request.url.query:
                    raise HTTPException(400, detail=_DETAILS["query"])
                length = _single_header(request, "content-length")
                if length is not None:
                    try:
                        size = int(length)
                    except ValueError:
                        raise HTTPException(400, detail=_DETAILS["invalid"]) from None
                    if size < 0:
                        raise HTTPException(400, detail=_DETAILS["invalid"])
                    if size > _MAX_AUTH_BODY_BYTES:
                        raise HTTPException(413, detail=_DETAILS["large"])
                encoding = request.headers.get("content-encoding", "identity").strip().lower()
                media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if encoding != "identity" or (is_login and media_type != "application/json"):
                    raise HTTPException(415, detail=_DETAILS["json"])
                if is_login:
                    if self.name == "login_web":
                        _require_browser_origin(request)
                    else:
                        _require_native_transport(request)
                    if _single_header(request, "authorization") is not None:
                        raise HTTPException(400, detail=_DETAILS["invalid"])

                received = 0
                original_receive = request.receive
                async def bounded_receive():
                    nonlocal received
                    message = await original_receive()
                    if message["type"] == "http.request":
                        received += len(message.get("body", b""))
                        if received > _MAX_AUTH_BODY_BYTES:
                            raise HTTPException(413, detail=_DETAILS["large"])
                    return message
                request = Request(request.scope, receive=bounded_receive)
                if not is_login and await request.body():
                    raise HTTPException(400, detail=_DETAILS["invalid"])
                response = await original_handler(request)
            except RequestValidationError:
                # Raw errors/body/field names can contain passwords or tokens.
                response = JSONResponse(status_code=422, content={"detail": _DETAILS["invalid"]})
            except StarletteHTTPException as error:
                detail = error.detail
                if not isinstance(detail, str) or detail not in _DETAILS.values():
                    detail = _DETAILS["invalid"]
                headers = {}
                if error.status_code == 429 and error.headers:
                    retry = error.headers.get("Retry-After", "")
                    if retry.isascii() and retry.isdecimal():
                        headers["Retry-After"] = retry
                if error.status_code == 401:
                    headers["WWW-Authenticate"] = "Bearer"
                response = JSONResponse(status_code=error.status_code, content={"detail": detail}, headers=headers)
                if error.status_code == 401 and self.name in {"read_login_session", "logout"}:
                    if SESSION_COOKIE_NAME in request.cookies:
                        _clear_session_cookie(response)
            except Exception as error:
                _logger.warning("Authentication request failed (%s).", type(error).__name__)
                response = JSONResponse(status_code=500, content={"detail": _DETAILS["unexpected"]})
            response.headers.update(_NO_STORE_HEADERS)
            return response

        return safe_handler


def _login(request: Request, credentials: LoginRequest, db: Session, client_type: ClientType) -> IssuedSession:
    try:
        return login_owner_with_limits(
            db, credentials.username, credentials.password.get_secret_value(),
            client_type=client_type,
            # The server/proxy establishes request.client. Do not parse
            # X-Forwarded-For or accept a client-selected address here.
            client_address=request.client.host if request.client else None,
        )
    except InvalidCredentialsError:
        raise HTTPException(401, detail=_DETAILS["credentials"]) from None
    except LoginRateLimitedError as error:
        raise HTTPException(429, detail=_DETAILS["limited"], headers={"Retry-After": str(error.retry_after_seconds)}) from None
    except (InvalidLoginSourceError, LoginThrottleStorageError, SessionStorageError):
        raise HTTPException(503, detail=_DETAILS["storage"]) from None


def require_authenticated_session(request: Request, db: Session = Depends(get_db)) -> SessionRead:
    """Dependency to attach to feature routers in the next integration step.

    Cookie transport selects web; bearer transport selects native. Unsafe web
    requests require CSRF. This commits authentication activity before feature
    work starts, returning only a safe identity rather than an ORM object.
    """
    credentials = _credentials(request)
    csrf = _single_header(request, CSRF_HEADER_NAME)
    try:
        result = authenticate_session(
            db, credentials.token, client_type=credentials.client_type,
            csrf_token=csrf, require_csrf=request.method.upper() not in _SAFE_METHODS,
        )
        return SessionRead.model_validate(result)
    except InvalidSessionError:
        raise HTTPException(401, detail=_DETAILS["session"], headers={"WWW-Authenticate": "Bearer"}) from None
    except InvalidCsrfTokenError:
        raise HTTPException(403, detail=_DETAILS["csrf"]) from None
    except SessionStorageError:
        raise HTTPException(503, detail=_DETAILS["storage"]) from None
    except Exception as error:
        # Also keep unexpected failures safe when this dependency runs on a
        # feature route that does not use _SafeAuthRoute.
        _logger.warning("Authentication check failed (%s).", type(error).__name__)
        raise HTTPException(503, detail=_DETAILS["storage"]) from None


router = APIRouter(prefix=f"{API_PREFIX}/auth", tags=["authentication"], route_class=_SafeAuthRoute)
_LOGIN_ERRORS = {
    401: {"description": "Username or password is incorrect."},
    403: {"description": "HTTPS or request-origin check failed."},
    429: {"description": "Login attempts are limited; see Retry-After."},
    503: {"description": "Authentication could not be confirmed."},
}


@router.post("/web/login", response_model=WebLoginRead, responses=_LOGIN_ERRORS)
def login_web(request: Request, response: Response, credentials: LoginRequest, db: Session = Depends(get_db)) -> WebLoginRead:
    """Log in the browser using an HttpOnly cookie and separate CSRF token."""
    issued = _login(request, credentials, db, "web")
    result = WebLoginRead.model_validate(issued)
    hash_token(issued.token, purpose="session")  # Check before setting a cookie.
    response.set_cookie(
        SESSION_COOKIE_NAME, issued.token,
        max_age=int(SESSION_LIFETIME.total_seconds()),
        expires=issued.identity.expires_at.astimezone(UTC),
        path="/", secure=True, httponly=True, samesite="strict",
    )
    return result


@router.post("/native/login", response_model=NativeLoginRead, responses=_LOGIN_ERRORS)
def login_native(request: Request, credentials: LoginRequest, db: Session = Depends(get_db)) -> NativeLoginRead:
    """Log in a native client and deliver its bearer token over HTTPS."""
    return NativeLoginRead.model_validate(_login(request, credentials, db, "native"))


@router.get("/session", response_model=SessionRead)
def read_login_session(identity: SessionRead = Depends(require_authenticated_session)) -> SessionRead:
    """Read the current verified identity without returning credentials."""
    return identity


@router.post("/logout", status_code=204, response_model=None)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    """Revoke this login; the native client must also erase its saved token."""
    credentials = _credentials(request)
    csrf = _single_header(request, CSRF_HEADER_NAME)
    try:
        revoke_session(db, credentials.token, client_type=credentials.client_type, csrf_token=csrf)
    except InvalidSessionError:
        raise HTTPException(401, detail=_DETAILS["session"], headers={"WWW-Authenticate": "Bearer"}) from None
    except InvalidCsrfTokenError:
        raise HTTPException(403, detail=_DETAILS["csrf"]) from None
    except SessionStorageError:
        raise HTTPException(503, detail=_DETAILS["storage"]) from None
    response = Response(status_code=204)
    if credentials.client_type == "web":
        _clear_session_cookie(response)
    return response
