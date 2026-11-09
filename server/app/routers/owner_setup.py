"""Setup status and one-time owner creation; code issuance stays local."""

from collections.abc import Callable
from collections.abc import Coroutine
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
from app.schemas.owner_setup import (
    OwnerSetupCreatedRead,
    OwnerSetupRequest,
    OwnerSetupStatusRead,
)
from app.services.accounts import AccountValidationError
from app.services.owner_setup import (
    InvalidSetupCodeError,
    OwnerSetupClosedError,
    OwnerSetupStorageError,
    SetupCodeBlockedError,
    create_owner_with_setup_code,
    get_owner_setup_status,
)
from app.services.passwords import PasswordValidationError


_logger = logging.getLogger(__name__)
_MAX_SETUP_BODY_BYTES = 16 * 1024
_NO_STORE_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}
_DETAILS = {
    "validation": "Invalid setup request. Check the setup code, username, and password.",
    "https": "HTTPS is required for owner setup.",
    "origin": "The browser origin is not permitted for owner setup.",
    "json": "Owner setup requires an uncompressed application/json request.",
    "large": "The setup request body is too large.",
    "query": "Setup credentials must not be supplied in the URL.",
    "invalid": "The setup code is invalid, expired, or unavailable.",
    "closed": "Owner setup is closed. Use login or local administrator recovery.",
    "blocked": "Owner setup is temporarily blocked. Try again later.",
    "storage": "Owner setup could not be confirmed. Check server state before retrying.",
    "unexpected": "The setup request could not be completed. Check server state before retrying.",
}


def _origin(value: str, *, allow_path: bool = False) -> tuple[str, str, int] | None:
    """Compare HTTPS origins, not prefixes, and never trust forwarded headers here."""
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            return None
        if not allow_path and (parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            return None
        return parsed.scheme, parsed.hostname.lower(), parsed.port or 443
    except ValueError:
        return None


def _check_setup_transport(request: Request) -> None:
    # request.url.scheme must come from the server or a correctly configured
    # trusted proxy. A client-supplied X-Forwarded-Proto is not proof of TLS.
    if request.url.scheme != "https":
        raise HTTPException(403, detail=_DETAILS["https"])
    target = _origin(str(request.base_url))
    origin = request.headers.get("origin")
    referer = request.headers.get("referer")
    fetch_site = request.headers.get("sec-fetch-site", "").lower()
    if fetch_site in {"cross-site", "same-site"}:
        raise HTTPException(403, detail=_DETAILS["origin"])
    if origin is not None:
        if target is None or _origin(origin) != target:
            raise HTTPException(403, detail=_DETAILS["origin"])
    elif referer is not None:
        if target is None or _origin(referer, allow_path=True) != target:
            raise HTTPException(403, detail=_DETAILS["origin"])
    # Native/server clients may omit browser headers. The secret setup code
    # remains mandatory; origin checks are defense in depth, not authentication.

    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    content_encoding = request.headers.get("content-encoding", "identity").strip().lower()
    if content_type != "application/json" or content_encoding != "identity":
        raise HTTPException(415, detail=_DETAILS["json"])
    length = request.headers.get("content-length")
    if length is not None:
        try:
            size = int(length)
        except ValueError:
            raise HTTPException(400, detail=_DETAILS["validation"]) from None
        if size < 0:
            raise HTTPException(400, detail=_DETAILS["validation"])
        if size > _MAX_SETUP_BODY_BYTES:
            raise HTTPException(413, detail=_DETAILS["large"])


class _SafeSetupRoute(APIRoute):
    """Limit credential-bearing bodies and redact validation/server errors."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original_handler = super().get_route_handler()

        async def safe_handler(request: Request) -> Response:
            try:
                if request.url.query:
                    raise HTTPException(400, detail=_DETAILS["query"])
                if request.method == "POST":
                    _check_setup_transport(request)
                    received = 0
                    original_receive = request.receive

                    async def bounded_receive():
                        nonlocal received
                        message = await original_receive()
                        if message["type"] == "http.request":
                            received += len(message.get("body", b""))
                            if received > _MAX_SETUP_BODY_BYTES:
                                raise HTTPException(413, detail=_DETAILS["large"])
                        return message

                    request = Request(request.scope, receive=bounded_receive)
                response = await original_handler(request)
            except RequestValidationError:
                # Never return/log raw errors(), body, inputs, ctx, or arbitrary
                # field names. Those can contain passwords, codes, or JSON keys
                # deliberately chosen to reflect secrets in an error response.
                response = JSONResponse(status_code=422, content={"detail": _DETAILS["validation"]})
            except StarletteHTTPException as error:
                detail = error.detail
                if not isinstance(detail, str) or detail not in _DETAILS.values():
                    detail = _DETAILS["validation"]
                headers = {}
                if error.status_code == 429 and error.headers:
                    retry = error.headers.get("Retry-After", "")
                    if retry.isascii() and retry.isdecimal():
                        headers["Retry-After"] = retry
                response = JSONResponse(status_code=error.status_code, content={"detail": detail}, headers=headers)
            except Exception as error:
                # Record only the exception class, never credential-bearing
                # exception text, request bodies, SQL, or tracebacks.
                _logger.warning("Owner setup request failed (%s).", type(error).__name__)
                response = JSONResponse(status_code=500, content={"detail": _DETAILS["unexpected"]})
            response.headers.update(_NO_STORE_HEADERS)
            return response

        return safe_handler


router = APIRouter(
    prefix=f"{API_PREFIX}/auth/setup",
    tags=["owner setup"],
    route_class=_SafeSetupRoute,
)


@router.get(
    "/status",
    response_model=OwnerSetupStatusRead,
    responses={503: {"description": "Setup state could not be read."}},
)
def read_owner_setup_status(db: Session = Depends(get_db)) -> OwnerSetupStatusRead:
    """Read setup readiness without revealing usernames, codes, or hashes."""
    try:
        result = get_owner_setup_status(db)
    except OwnerSetupStorageError:
        raise HTTPException(503, detail=_DETAILS["storage"]) from None
    return OwnerSetupStatusRead.model_validate(result)


@router.post(
    "",
    response_model=OwnerSetupCreatedRead,
    status_code=201,
    responses={
        403: {"description": "HTTPS, browser-origin, or setup-code check failed."},
        409: {"description": "Owner setup is closed."},
        413: {"description": "Request body exceeds the setup limit."},
        415: {"description": "Request must use uncompressed application/json."},
        429: {"description": "Setup attempts are temporarily blocked; see Retry-After."},
        503: {"description": "The setup operation could not be confirmed."},
    },
)
def create_owner_from_browser(
    credentials: OwnerSetupRequest,
    db: Session = Depends(get_db),
) -> OwnerSetupCreatedRead:
    """Create an owner using an existing locally issued one-time code.

    This is setup, not login: no session token or cookie is created here.
    There is deliberately no HTTP endpoint for issuing or rotating setup codes.
    """
    try:
        result = create_owner_with_setup_code(
            db=db,
            setup_code=credentials.setup_code.get_secret_value(),
            username=credentials.username,
            password=credentials.password.get_secret_value(),
        )
    except OwnerSetupClosedError:
        raise HTTPException(409, detail=_DETAILS["closed"]) from None
    except InvalidSetupCodeError:
        raise HTTPException(403, detail=_DETAILS["invalid"]) from None
    except SetupCodeBlockedError as error:
        raise HTTPException(
            429, detail=_DETAILS["blocked"],
            headers={"Retry-After": str(error.retry_after_seconds)},
        ) from None
    except (AccountValidationError, PasswordValidationError):
        raise HTTPException(422, detail=_DETAILS["validation"]) from None
    except OwnerSetupStorageError:
        raise HTTPException(503, detail=_DETAILS["storage"]) from None
    return OwnerSetupCreatedRead.model_validate(result)
