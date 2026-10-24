/** Shared HTTP transport for WeekFlow's feature API clients. */

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
  /** Allows future authentication, revision, or idempotency headers. */
  headers?: Record<string, string>;
};

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
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('#')) {
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

  const controller = new AbortController();
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
        headers: {
          Accept: 'application/json',
          ...options.headers,
          ...(serializedBody !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
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
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
