/** Setup and login requests. Session persistence and screens belong elsewhere. */
import { Platform } from 'react-native';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

export type AuthClientType = 'web' | 'native';
export type AuthSessionIdentity = {
  sessionId: string;
  accountId: 1;
  username: string;
  clientType: AuthClientType;
  expiresAt: string;
};
export type AuthSetupStatus = { ownerExists: boolean; setupReady: boolean };
export type AuthOwnerCreated = { id: 1; username: string };
export type AuthLoginInput = { username: string; password: string };
export type AuthOwnerSetupInput = AuthLoginInput & { setupCode: string };

// A browser's session token stays in its HttpOnly cookie, outside JavaScript.
// The CSRF value is separate: browser writes send it in X-CSRF-Token.
export type AuthCredentials =
  | { clientType: 'web'; csrfToken: string }
  | { clientType: 'native'; token: string };
export type AuthLoginResult = { identity: AuthSessionIdentity; credentials: AuthCredentials };
export type AuthApiOptions = Pick<ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal'>;

const PATH = '/api/v1/auth';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidInput(message: string): never {
  // Error messages never include supplied passwords, setup codes, or tokens.
  throw new ApiError(message, { kind: 'configuration' });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function hasOnlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => allowed.includes(key));
}
function isToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value);
}
function isUsername(value: unknown): value is string {
  return typeof value === 'string' && USERNAME.test(value);
}
function currentClientType(): AuthClientType {
  if (Platform.OS === 'web') return 'web';
  if (Platform.OS === 'ios' || Platform.OS === 'android') return 'native';
  return invalidInput('Authentication is supported on web, iOS, and Android.');
}

/** Enforce the HTTPS and browser-origin rules that Python already requires. */
function requestOptions(options: AuthApiOptions, clientType: AuthClientType): AuthApiOptions {
  const raw = options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL;
  let address: URL;
  try {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error();
    address = new URL(raw.trim());
  } catch {
    return invalidInput('Set the WeekFlow API address to a complete HTTPS URL.');
  }
  if (address.protocol !== 'https:' || address.username || address.password ||
      address.search || address.hash || address.pathname !== '/' || /[?#]/.test(raw!)) {
    return invalidInput('Use an HTTPS API address without a path, credentials, query, or fragment.');
  }
  if (clientType === 'web') {
    // Different ports also count as different origins. CORS alone does not
    // make a separate development URL compatible with our cookie login.
    if (typeof window === 'undefined' || !window.location ||
        window.location.protocol !== 'https:' || window.location.origin !== address.origin) {
      return invalidInput('Open WeekFlow and its API through the same HTTPS address before signing in.');
    }
  }
  // Copy only supported options: callers cannot override the method, body,
  // headers, or platform by passing extra JavaScript object properties.
  return { baseUrl: address.origin, timeoutMs: options.timeoutMs, signal: options.signal };
}

function loginBody(input: unknown, creating: boolean): { username: string; password: string } {
  if (!hasOnlyKeys(input, creating ? ['username', 'password', 'setupCode'] : ['username', 'password']) ||
      typeof input.username !== 'string' || /[^\x00-\x7f]/.test(input.username)) {
    return invalidInput('Enter a username using letters, numbers, underscores, periods, or hyphens.');
  }
  const username = input.username.trim().toLowerCase();
  if (!isUsername(username)) {
    return invalidInput('Username must be 3–64 supported characters and begin with a letter or number.');
  }
  if (typeof input.password !== 'string') return invalidInput('Enter a valid password.');
  // Python measures Unicode characters, not JavaScript UTF-16 code units.
  const characters = Array.from(input.password);
  if (characters.length < (creating ? 15 : 1) || characters.length > 128 ||
      characters.some((char) => {
        const code = char.codePointAt(0)!;
        return code >= 0xd800 && code <= 0xdfff;
      }) || (creating && !input.password.trim())) {
    return invalidInput(creating
      ? 'Use a password of 15–128 characters containing more than whitespace.'
      : 'Password must contain 1–128 valid characters.');
  }
  // Passwords are preserved exactly: never trim or lowercase them.
  return { username, password: input.password };
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] &&
    Number.isFinite(Date.parse(value));
}
function decodeIdentity(value: unknown, expectedClient: AuthClientType): AuthSessionIdentity {
  if (!hasOnlyKeys(value, ['session_id', 'account_id', 'username', 'client_type', 'expires_at']) ||
      typeof value.session_id !== 'string' || !UUID.test(value.session_id) || value.account_id !== 1 ||
      !isUsername(value.username) || value.client_type !== expectedClient || !isTimestamp(value.expires_at)) {
    throw new Error('Invalid authentication identity.');
  }
  return { sessionId: value.session_id, accountId: 1, username: value.username,
    clientType: expectedClient, expiresAt: value.expires_at };
}

/** No account creation or login happens when reading these two flags. */
export async function fetchApiSetupStatus(options: AuthApiOptions = {}): Promise<AuthSetupStatus> {
  const checked = requestOptions(options, currentClientType());
  return apiRequest(`${PATH}/setup/status`, (value) => {
    if (!hasOnlyKeys(value, ['owner_exists', 'setup_ready']) ||
        typeof value.owner_exists !== 'boolean' || typeof value.setup_ready !== 'boolean' ||
        (value.owner_exists && value.setup_ready)) {
      throw new Error('Invalid owner setup status.');
    }
    return { ownerExists: value.owner_exists, setupReady: value.setup_ready };
  }, { ...checked, method: 'GET' });
}

/** Create the singleton owner using a code issued locally on the server. */
export async function createApiOwner(
  input: AuthOwnerSetupInput, options: AuthApiOptions = {}
): Promise<AuthOwnerCreated> {
  const checked = requestOptions(options, currentClientType());
  const body = loginBody(input, true);
  if (!isToken(input.setupCode)) return invalidInput('Enter the 43-character setup code from the server.');
  return apiRequest(`${PATH}/setup`, (value) => {
    if (!hasOnlyKeys(value, ['id', 'username']) || value.id !== 1 ||
        !isUsername(value.username) || value.username !== body.username) {
      throw new Error('Invalid owner creation response.');
    }
    return { id: 1, username: value.username };
  }, { ...checked, method: 'POST', body: { ...body, setup_code: input.setupCode } });
}

/** Login once; do not automatically retry a failed credential-bearing request. */
export async function loginApiOwner(
  input: AuthLoginInput, options: AuthApiOptions = {}
): Promise<AuthLoginResult> {
  const clientType = currentClientType();
  const checked = requestOptions(options, clientType);
  const body = loginBody(input, false);
  return apiRequest(`${PATH}/${clientType}/login`, (value): AuthLoginResult => {
    const allowed = clientType === 'web' ? ['identity', 'csrf_token'] : ['identity', 'token', 'token_type'];
    if (!hasOnlyKeys(value, allowed)) throw new Error('Invalid login response.');
    const identity = decodeIdentity(value.identity, clientType);
    if (identity.username !== body.username) throw new Error('Login identity does not match.');
    if (clientType === 'web') {
      if (!isToken(value.csrf_token)) throw new Error('Invalid browser login response.');
      return { identity, credentials: { clientType: 'web', csrfToken: value.csrf_token } };
    }
    if (!isToken(value.token) || value.token_type !== 'Bearer') throw new Error('Invalid native login response.');
    return { identity, credentials: { clientType: 'native', token: value.token } };
  }, { ...checked, method: 'POST', body });
}

function credentialHeaders(credentials: AuthCredentials | null, clientType: AuthClientType, writing: boolean): Record<string, string> {
  if (credentials === null) {
    if (clientType === 'web' && !writing) return {}; // Cookie-based session check.
    return invalidInput('A login session is required for this request.');
  }
  if (!isRecord(credentials) || credentials.clientType !== clientType) {
    return invalidInput('The login session does not match this device type.');
  }
  if (credentials.clientType === 'web') {
    if (!hasOnlyKeys(credentials, ['clientType', 'csrfToken']) || !isToken(credentials.csrfToken)) {
      return invalidInput('The browser session needs a valid CSRF token.');
    }
    return writing ? { 'X-CSRF-Token': credentials.csrfToken } : {};
  }
  if (!hasOnlyKeys(credentials, ['clientType', 'token']) || !isToken(credentials.token)) {
    return invalidInput('The phone session needs a valid bearer token.');
  }
  return { Authorization: `Bearer ${credentials.token}` };
}

/** Verify the server session; locally saved identity is not proof of login. */
export async function fetchApiAuthSession(
  credentials: AuthCredentials | null = null, options: AuthApiOptions = {}
): Promise<AuthSessionIdentity> {
  const clientType = currentClientType();
  const checked = requestOptions(options, clientType);
  const headers = credentialHeaders(credentials, clientType, false);
  return apiRequest(`${PATH}/session`, (value) => decodeIdentity(value, clientType),
    { ...checked, method: 'GET', headers });
}

/** Revoke this server session. The session manager also clears local state. */
export async function logoutApiOwner(
  credentials: AuthCredentials, options: AuthApiOptions = {}
): Promise<void> {
  const clientType = currentClientType();
  const checked = requestOptions(options, clientType);
  const headers = credentialHeaders(credentials, clientType, true);
  return apiRequest(`${PATH}/logout`, (value) => {
    if (value !== null) throw new Error('Expected an empty logout response.');
  }, { ...checked, method: 'POST', headers });
}
