/** Shared HTTP transport for WeekFlow's feature API clients. */
import type { AuthCredentials } from './authApi';

export type ApiErrorKind =
  | 'configuration'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'http'
  | 'invalid-response';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly detail: unknown;

  /**
   * A failed response does not prove that a write failed on the server.
   * The future sync queue must reconcile uncertain writes, not blindly
   * repeat a create request and risk producing a duplicate task.
   */
  readonly mutationMayHaveSucceeded: boolean;

  constructor(
    message: string,
    options: {
      kind: ApiErrorKind;
      status?: number;
      detail?: unknown;
      mutationMayHaveSucceeded?: boolean;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.detail = options.detail;
    this.mutationMayHaveSucceeded = options.mutationMayHaveSucceeded ?? false;
  }
}

export type ApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type ApiRequestOptions = {
  method?: ApiMethod;
  body?: unknown;
  /** Defaults to EXPO_PUBLIC_API_BASE_URL. */
  baseUrl?: string;
  /** Covers both receiving the response and reading its JSON body. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Revision/idempotency headers; configured session headers cannot be overridden. */
  headers?: Record<string, string>;
};

/** Supplied by AuthProvider only after verifying the session with Python. */
export type ApiAuthenticatedSession = {
  baseUrl: string;
  sessionId: string;
  expiresAt: string;
  credentials: AuthCredentials;
};
export type ApiSessionRejection = { baseUrl: string; sessionId: string };
type ActiveSession = ApiAuthenticatedSession & { generation: number };
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let sessionGeneration = 0;
let activeSession: ActiveSession | null = null;
const sessionRequests = new Set<AbortController>();
const rejectionListeners = new Set<(event: ApiSessionRejection) => void>();

/**
 * Replace the in-memory transport session. This does not log in, persist a
 * token, or prove authentication. Replacing/clearing it cancels old requests.
 */
export function configureApiSession(session: ApiAuthenticatedSession | null): void {
  let next: Omit<ActiveSession, 'generation'> | null = null;
  if (session !== null) {
    let address: URL;
    try { address = new URL(session.baseUrl); }
    catch { throw configurationError('The login session needs a valid HTTPS API address.'); }
    const credentials = session.credentials;
    if (address.protocol !== 'https:' || address.pathname !== '/' || address.username || address.password ||
        address.search || address.hash || /[?#]/.test(session.baseUrl) ||
        typeof session.sessionId !== 'string' || !UUID_PATTERN.test(session.sessionId) ||
        typeof session.expiresAt !== 'string' || !Number.isFinite(Date.parse(session.expiresAt)) ||
        Date.parse(session.expiresAt) <= Date.now() || !isRecord(credentials)) {
      throw configurationError('The login session is not valid for authenticated requests.');
    }
    let copied: AuthCredentials;
    if (credentials.clientType === 'native' && typeof credentials.token === 'string' &&
        TOKEN_PATTERN.test(credentials.token) && Object.keys(credentials).every(key => ['clientType', 'token'].includes(key))) {
      copied = { clientType: 'native', token: credentials.token };
    } else if (credentials.clientType === 'web' && typeof credentials.csrfToken === 'string' &&
        TOKEN_PATTERN.test(credentials.csrfToken) && Object.keys(credentials).every(key => ['clientType', 'csrfToken'].includes(key))) {
      if (typeof window === 'undefined' || !window.location || window.location.protocol !== 'https:' ||
          window.location.origin !== address.origin) {
        throw configurationError('Open WeekFlow and its API through the same HTTPS address before signing in.');
      }
      copied = { clientType: 'web', csrfToken: credentials.csrfToken };
    } else { throw configurationError('The login session contains invalid or mixed credentials.'); }
    next = { baseUrl: address.origin, sessionId: session.sessionId, expiresAt: session.expiresAt, credentials: copied };
  }
  sessionGeneration += 1;
  activeSession = next ? { ...next, generation: sessionGeneration } : null;
  for (const controller of sessionRequests) controller.abort();
  sessionRequests.clear();
}

/** Notify the provider when the current protected session receives HTTP 401. */
export function subscribeToApiSessionRejection(listener: (event: ApiSessionRejection) => void): () => void {
  rejectionListeners.add(listener);
  return () => { rejectionListeners.delete(listener); };
}

function rejectCurrentSession(session: ActiveSession) {
  if (activeSession?.generation !== session.generation) return;
  configureApiSession(null);
  for (const listener of rejectionListeners) {
    try { listener({ baseUrl: session.baseUrl, sessionId: session.sessionId }); }
    catch { /* UI listener errors must not replace the original HTTP failure. */ }
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 300_000;

function configurationError(message: string): ApiError {
  return new ApiError(message, { kind: 'configuration' });
}

function normalizedBaseUrl(baseUrl: string | undefined): string {
  const value = baseUrl?.trim().replace(/\/+$/, '');
  if (!value) {
    throw configurationError('Set EXPO_PUBLIC_API_BASE_URL to your WeekFlow API address.');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError('The WeekFlow API address must be a complete HTTP or HTTPS URL.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    value.includes('?') || value.includes('#') || parsed.username || parsed.password
  ) {
    throw configurationError('Use an HTTP or HTTPS API address without credentials, a query, or a fragment.');
  }
  return parsed.href.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorDetail(payload: unknown): unknown {
  return isRecord(payload) && 'detail' in payload ? payload.detail : payload;
}

function httpErrorMessage(status: number, detail: unknown): string {
  const fallback = `WeekFlow API returned HTTP ${status}.`;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  if (isRecord(detail) && typeof detail.message === 'string' && detail.message.trim()) {
    return detail.message;
  }
  if (Array.isArray(detail)) {
    // FastAPI's request-validation errors contain a field location and msg.
    const messages = detail.slice(0, 5).flatMap((item: unknown) => {
      if (!isRecord(item) || typeof item.msg !== 'string') return [];
      const location = Array.isArray(item.loc)
        ? item.loc.filter((part) => typeof part === 'string' || typeof part === 'number').join('.')
        : '';
      return [location ? `${location}: ${item.msg}` : item.msg];
    });
    if (messages.length) return messages.join('; ');
  }
  return fallback;
}

/**
 * Make ONE request and decode its response with a feature-specific validator.
 *
 * This helper does not retry, write to SQLite, queue changes, or switch app
 * storage. In particular, HTTP 409/422 errors must not be treated as offline
 * saves. A network failure can also mean a CORS or connection configuration
 * problem; it does not establish that the server itself is down.
 *
 * A 204 response passes null to decode. A delete client can validate null
 * and return undefined. Other successful responses must contain valid JSON.
 */
export async function apiRequest<T>(
  path: string,
  decode: (value: unknown) => T,
  options: ApiRequestOptions = {}
): Promise<T> {
  const baseUrl = normalizedBaseUrl(
    options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL
  );
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#') || /[\\\r\n\t]/.test(path)) {
    throw configurationError('API paths must start with one slash and must not contain a fragment.');
  }

  const method = options.method ?? 'GET';
  const isMutation = method !== 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw configurationError(`API timeout must be an integer from 1 to ${MAX_TIMEOUT_MS} milliseconds.`);
  }
  if (method === 'GET' && options.body !== undefined) {
    throw configurationError('A GET request cannot include a JSON body.');
  }

  let serializedBody: string | undefined;
  if (options.body !== undefined) {
    try {
      serializedBody = JSON.stringify(options.body);
      if (serializedBody === undefined) throw new Error('Not JSON data');
    } catch {
      throw configurationError('The API request body must be JSON-serializable.');
    }
  }

  if (options.signal?.aborted) {
    throw new ApiError('The request was cancelled before it was sent.', { kind: 'cancelled' });
  }

  const target = new URL(`${baseUrl}${path}`);
  const authRoute = target.pathname === '/api/v1/auth' || target.pathname.startsWith('/api/v1/auth/');
  const protectedRoute = target.pathname.startsWith('/api/v1/') && !authRoute;
  const session = protectedRoute ? activeSession : null;
  const headers: Record<string, string> = {
    Accept: 'application/json', ...options.headers,
    ...(serializedBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
  if (session) {
    if (target.origin !== session.baseUrl || baseUrl !== session.baseUrl || target.protocol !== 'https:') {
      throw configurationError('This request does not match the signed-in WeekFlow server.');
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      rejectCurrentSession(session);
      throw new ApiError('Your login session has expired. Sign in again.', { kind: 'http', status: 401 });
    }
    const reserved = ['authorization', 'cookie', 'x-csrf-token'];
    if (Object.keys(options.headers ?? {}).some(key => reserved.includes(key.toLowerCase()))) {
      throw configurationError('Session credentials must come from the authentication provider.');
    }
    if (session.credentials.clientType === 'native') {
      headers.Authorization = `Bearer ${session.credentials.token}`;
    } else {
      if (typeof window === 'undefined' || !window.location || window.location.protocol !== 'https:' ||
          window.location.origin !== session.baseUrl) {
        throw configurationError('Browser requests must use the same HTTPS address as WeekFlow.');
      }
      if (isMutation) headers['X-CSRF-Token'] = session.credentials.csrfToken;
    }
  }
  const explicitCredentials = Object.keys(headers).some(key => ['authorization', 'x-csrf-token', 'cookie'].includes(key.toLowerCase()));
  const credentialRequest = !!session || authRoute || explicitCredentials;
  if (credentialRequest && target.protocol !== 'https:') {
    throw configurationError('Login credentials and authentication requests require HTTPS.');
  }
  const bearerRequest = session?.credentials.clientType === 'native' ||
    target.pathname === '/api/v1/auth/native/login' ||
    Object.keys(headers).some(key => key.toLowerCase() === 'authorization');

  const controller = new AbortController();
  if (session) sessionRequests.add(controller);
  let timedOut = false;
  let sent = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  function interruptedError(): ApiError | null {
    if (!controller.signal.aborted) return null;
    return new ApiError(
      timedOut ? 'The WeekFlow API request timed out.' : 'The WeekFlow API request was cancelled.',
      {
        kind: timedOut ? 'timeout' : 'cancelled',
        mutationMayHaveSucceeded: sent && isMutation,
      }
    );
  }

  try {
    let response: Response;
    try {
      sent = true;
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        // Native bearer requests do not use a browser cookie. Browsers keep
        // their session cookie limited to the same HTTPS origin.
        ...(credentialRequest ? { credentials: bearerRequest ? 'omit' as const : 'same-origin' as const,
          redirect: 'error' as const } : {}),
        ...(serializedBody !== undefined ? { body: serializedBody } : {}),
        signal: controller.signal,
      });
    } catch {
      throw interruptedError() ?? new ApiError('Could not reach the WeekFlow API.', {
        kind: 'network',
        mutationMayHaveSucceeded: isMutation,
      });
    }
    const interrupted = interruptedError();
    if (interrupted) throw interrupted;
    let unexpectedAddress = response.redirected === true;
    if (credentialRequest && response.url) {
      try { unexpectedAddress ||= new URL(response.url).origin !== target.origin; }
      catch { unexpectedAddress = true; }
    }
    if (credentialRequest && unexpectedAddress) {
      throw new ApiError('The authentication request returned an unexpected address.', {
        kind: 'invalid-response', status: response.status, mutationMayHaveSucceeded: isMutation,
      });
    }

    let payload: unknown = null;
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch {
        const stopped = interruptedError();
        if (stopped) throw stopped;
        if (response.ok) {
          throw new ApiError('The WeekFlow API returned unreadable JSON.', {
            kind: 'invalid-response',
            status: response.status,
            mutationMayHaveSucceeded: isMutation,
          });
        }
        // Preserve the HTTP status even when an error page is HTML/text.
      }
    }
    const stopped = interruptedError();
    if (stopped) throw stopped;

    if (!response.ok) {
      const detail = errorDetail(payload);
      if (session && response.status === 401) {
        // Keep this request's HTTP 401, while cancelling other old-session
        // requests. A late response cannot clear a newer configured session.
        sessionRequests.delete(controller);
        rejectCurrentSession(session);
      }
      throw new ApiError(httpErrorMessage(response.status, detail), {
        kind: 'http',
        status: response.status,
        detail,
        mutationMayHaveSucceeded: isMutation && response.status >= 500,
      });
    }

    try {
      return decode(payload);
    } catch {
      throw new ApiError('The WeekFlow API response did not match the expected data.', {
        kind: 'invalid-response',
        status: response.status,
        mutationMayHaveSucceeded: isMutation,
      });
    }
  } finally {
    sessionRequests.delete(controller);
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
