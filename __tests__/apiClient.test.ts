/** Shared transport checks. Every fetch is mocked; no server is contacted. */

import {
    ApiError,
    apiRequest,
} from '../lib/api/apiClient';

const BASE = 'http://127.0.0.1:8000';
const PATH = '/api/v1/tasks';
const previousBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
const unchanged = (value: unknown): unknown => value;

function response(status: number, payload: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: jest.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function waitForAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  if (!signal) throw new Error('Expected an AbortSignal');
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Mock request aborted')), { once: true });
  });
}

async function capturedError(operation: Promise<unknown>): Promise<ApiError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error('Expected the request to reject');
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = BASE;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  if (previousBaseUrl === undefined) {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
  } else {
    process.env.EXPO_PUBLIC_API_BASE_URL = previousBaseUrl;
  }
});


test('GET uses the configured address and returns decoded data', async () => {
  const payload = [{ id: 12, title: 'Study' }];
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(200, payload));
  const decode = jest.fn((value: unknown) => {
    if (!Array.isArray(value)) throw new Error('Expected task list');
    return value.length;
  });
  await expect(apiRequest(PATH, decode)).resolves.toBe(1);
  expect(decode).toHaveBeenCalledWith(payload);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(`${BASE}${PATH}`, {
    method: 'GET', headers: { Accept: 'application/json' }, signal: expect.any(AbortSignal),
  });
  expect(jest.getTimerCount()).toBe(0);
});


test.each(['POST', 'PATCH'] as const)('%s serializes JSON and preserves supplied headers', async (method) => {
  const payload = { title: 'Study', completed: false };
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(200, { id: 12 }));
  await apiRequest(PATH, unchanged, {
    method, body: payload,
    headers: { 'Idempotency-Key': 'synthetic-operation-1', 'If-Match': 'synthetic-revision-1' },
  });
  expect(fetchMock).toHaveBeenCalledWith(`${BASE}${PATH}`, {
    method, body: JSON.stringify(payload), signal: expect.any(AbortSignal),
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'Idempotency-Key': 'synthetic-operation-1', 'If-Match': 'synthetic-revision-1',
    },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});


test('DELETE passes null to the decoder for an empty 204 response', async () => {
  const reply = response(204, undefined);
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(reply);
  const decode = jest.fn((value: unknown) => {
    if (value !== null) throw new Error('Expected empty response');
    return undefined;
  });
  await expect(apiRequest(`${PATH}/12`, decode, { method: 'DELETE' })).resolves.toBeUndefined();
  expect(decode).toHaveBeenCalledWith(null);
  expect(reply.json).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('body');
});


test.each([
  ['  http://127.0.0.1:8000///  ', `${BASE}${PATH}`],
  ['https://weekflow.example.test', `https://weekflow.example.test${PATH}`],
  ['http://127.0.0.1:8000/weekflow/', `${BASE}/weekflow${PATH}`],
])('normalizes a supplied API address: %s', async (baseUrl, expected) => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(200, []));
  await apiRequest(PATH, unchanged, { baseUrl });
  expect(fetchMock.mock.calls[0][0]).toBe(expected);
});


test('a missing environment address fails before sending a request', async () => {
  delete process.env.EXPO_PUBLIC_API_BASE_URL;
  const fetchMock = jest.spyOn(global, 'fetch');
  const error = await capturedError(apiRequest(PATH, unchanged));
  expect(error.kind).toBe('configuration');
  expect(error.status).toBeNull();
  expect(error.mutationMayHaveSucceeded).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});


test.each([
  '', 'not a URL', 'ftp://example.test',
  'http://name:synthetic-password@example.test',
  'http://example.test/?', 'http://example.test/#',
  'http://example.test/?token=synthetic',
])('rejects an invalid API address without sending: %s', async (baseUrl) => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const error = await capturedError(apiRequest(PATH, unchanged, { method: 'POST', baseUrl }));
  expect(error.kind).toBe('configuration');
  expect(error.mutationMayHaveSucceeded).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});


test.each(['api/v1/tasks', '//other.example.test/tasks', 'https://other.example.test/tasks', '/api/v1/tasks#fragment'])(
  'rejects an invalid request path: %s', async (path) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(apiRequest(path, unchanged)).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  }
);


test.each([0, -1, 1.5, 300001, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects an invalid timeout: %s', async (timeoutMs) => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(apiRequest(PATH, unchanged, { timeoutMs })).rejects.toMatchObject({ kind: 'configuration' });
    expect(fetchMock).not.toHaveBeenCalled();
  }
);


test('rejects a GET body before sending', async () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(apiRequest(PATH, unchanged, { body: { title: 'Wrong method' } })).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchMock).not.toHaveBeenCalled();
});


test('rejects a circular JSON body before sending', async () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;
  const fetchMock = jest.spyOn(global, 'fetch');
  const error = await capturedError(apiRequest(PATH, unchanged, { method: 'POST', body: circular }));
  expect(error.kind).toBe('configuration');
  expect(error.mutationMayHaveSucceeded).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});


test('rejects values that cannot produce JSON before sending', async () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  await expect(apiRequest(PATH, unchanged, { method: 'POST', body: () => undefined })).rejects.toMatchObject({ kind: 'configuration' });
  expect(fetchMock).not.toHaveBeenCalled();
});


test.each(['GET', 'POST', 'PATCH', 'DELETE'] as const)(
  '%s connection failure is classified without retrying', async (method) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Mock connection failure'));
    const error = await capturedError(apiRequest(PATH, unchanged, { method }));
    expect(error.kind).toBe('network');
    expect(error.status).toBeNull();
    expect(error.mutationMayHaveSucceeded).toBe(method !== 'GET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  }
);


test.each([400, 401, 403, 404, 409, 422, 429])(
  'HTTP %s rejection remains an HTTP error rather than an offline save', async (status) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(status, { detail: 'Rejected request' }));
    const error = await capturedError(apiRequest(PATH, unchanged, { method: 'POST' }));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(status);
    expect(error.detail).toBe('Rejected request');
    expect(error.message).toBe('Rejected request');
    expect(error.mutationMayHaveSucceeded).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  }
);


test.each(['GET', 'POST', 'PATCH', 'DELETE'] as const)(
  '%s server failure marks only a mutation as potentially saved', async (method) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(response(500, { detail: 'Server error' }));
    const error = await capturedError(apiRequest(PATH, unchanged, { method }));
    expect(error.kind).toBe('http');
    expect(error.status).toBe(500);
    expect(error.mutationMayHaveSucceeded).toBe(method !== 'GET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);


test('formats FastAPI field errors while retaining their structured detail', async () => {
  const detail = [
    { loc: ['body', 'title'], msg: 'Field required' },
    { loc: ['body', 'weekdays', 0], msg: 'Invalid weekday' },
  ];
  jest.spyOn(global, 'fetch').mockResolvedValue(response(422, { detail }));
  const error = await capturedError(apiRequest(PATH, unchanged, { method: 'POST' }));
  expect(error.message).toBe('body.title: Field required; body.weekdays.0: Invalid weekday');
  expect(error.detail).toEqual(detail);
});


test('extracts a structured conflict message', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(response(409, { detail: { message: 'Server version changed', server_revision: 'synthetic-v2' } }));
  const error = await capturedError(apiRequest(PATH, unchanged, { method: 'PATCH' }));
  expect(error.message).toBe('Server version changed');
  expect(error.detail).toEqual({ message: 'Server version changed', server_revision: 'synthetic-v2' });
});


test('retains the HTTP status when the error body is not JSON', async () => {
  const reply = response(502, null);
  jest.mocked(reply.json).mockRejectedValue(new SyntaxError('Mock HTML error page'));
  jest.spyOn(global, 'fetch').mockResolvedValue(reply);
  const error = await capturedError(apiRequest(PATH, unchanged, { method: 'PATCH' }));
  expect(error.kind).toBe('http');
  expect(error.status).toBe(502);
  expect(error.message).toBe('WeekFlow API returned HTTP 502.');
  expect(error.mutationMayHaveSucceeded).toBe(true);
});


test.each(['GET', 'POST'] as const)('%s unreadable success response is not accepted', async (method) => {
  const reply = response(200, null);
  jest.mocked(reply.json).mockRejectedValue(new SyntaxError('Mock broken JSON'));
  jest.spyOn(global, 'fetch').mockResolvedValue(reply);
  const decode = jest.fn(unchanged);
  const error = await capturedError(apiRequest(PATH, decode, { method }));
  expect(error.kind).toBe('invalid-response');
  expect(error.status).toBe(200);
  expect(error.mutationMayHaveSucceeded).toBe(method !== 'GET');
  expect(decode).not.toHaveBeenCalled();
});


test.each(['GET', 'POST'] as const)('%s invalid response shape fails decoder validation', async (method) => {
  jest.spyOn(global, 'fetch').mockResolvedValue(response(200, { wrong: 'shape' }));
  const error = await capturedError(apiRequest(PATH, () => { throw new Error('Wrong shape'); }, { method }));
  expect(error.kind).toBe('invalid-response');
  expect(error.status).toBe(200);
  expect(error.mutationMayHaveSucceeded).toBe(method !== 'GET');
  expect(jest.getTimerCount()).toBe(0);
});


test('cancellation before sending cannot have saved a mutation', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchMock = jest.spyOn(global, 'fetch');
  const error = await capturedError(apiRequest(PATH, unchanged, { method: 'POST', signal: controller.signal }));
  expect(error.kind).toBe('cancelled');
  expect(error.mutationMayHaveSucceeded).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});


test.each(['GET', 'POST', 'PATCH', 'DELETE'] as const)(
  '%s timeout aborts the request without automatically retrying', async (method) => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((_url, init) => waitForAbort(init?.signal));
    const pending = capturedError(apiRequest(PATH, unchanged, { method, timeoutMs: 50 }));
    await jest.advanceTimersByTimeAsync(50);
    const error = await pending;
    expect(error.kind).toBe('timeout');
    expect(error.mutationMayHaveSucceeded).toBe(method !== 'GET');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  }
);


test('the default timeout is fifteen seconds', async () => {
  jest.spyOn(global, 'fetch').mockImplementation((_url, init) => waitForAbort(init?.signal));
  let settled = false;
  const pending = capturedError(apiRequest(PATH, unchanged)).then((error) => {
    settled = true;
    return error;
  });
  await jest.advanceTimersByTimeAsync(14_999);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect((await pending).kind).toBe('timeout');
});


test('the timeout also covers reading the response body', async () => {
  jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
    const reply = response(200, undefined);
    jest.mocked(reply.json).mockImplementation(() => waitForAbort(init?.signal));
    return reply;
  });
  const pending = capturedError(apiRequest(PATH, unchanged, { method: 'PATCH', timeoutMs: 50 }));
  await jest.advanceTimersByTimeAsync(50);
  const error = await pending;
  expect(error.kind).toBe('timeout');
  expect(error.mutationMayHaveSucceeded).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});


test.each(['GET', 'POST'] as const)('%s can be cancelled after it has been sent', async (method) => {
  const controller = new AbortController();
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation((_url, init) => waitForAbort(init?.signal));
  const pending = capturedError(apiRequest(PATH, unchanged, { method, signal: controller.signal }));
  controller.abort();
  const error = await pending;
  expect(error.kind).toBe('cancelled');
  expect(error.mutationMayHaveSucceeded).toBe(method !== 'GET');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});


test('an aborted request does not accept a response even if fetch still resolves', async () => {
  const controller = new AbortController();
  jest.spyOn(global, 'fetch').mockImplementation(async () => {
    controller.abort();
    return response(200, { id: 12 });
  });
  const decode = jest.fn(unchanged);
  const error = await capturedError(apiRequest(PATH, decode, { method: 'POST', signal: controller.signal }));
  expect(error.kind).toBe('cancelled');
  expect(error.mutationMayHaveSucceeded).toBe(true);
  expect(decode).not.toHaveBeenCalled();
});


test('success removes the caller cancellation listener and clears its timer', async () => {
  const controller = new AbortController();
  const add = jest.spyOn(controller.signal, 'addEventListener');
  const remove = jest.spyOn(controller.signal, 'removeEventListener');
  jest.spyOn(global, 'fetch').mockResolvedValue(response(200, []));
  await apiRequest(PATH, unchanged, { signal: controller.signal });
  expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
  expect(jest.getTimerCount()).toBe(0);
});
