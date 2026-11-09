/** Persist login material, scoped to one HTTPS WeekFlow server. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { AuthCredentials, AuthLoginResult } from './api/authApi';

export type AuthSessionStorageOptions = { baseUrl?: string };
export type StoredAuthSession = {
  sessionId: string;
  expiresAt: string;
  credentials: AuthCredentials;
};
type FailureCode = 'configuration' | 'unavailable' | 'read' | 'write' | 'clear' | 'invalid-session';

export class AuthSessionStorageError extends Error {
  readonly code: FailureCode;
  constructor(code: FailureCode) {
    const messages: Record<FailureCode, string> = {
      configuration: 'Use the correct HTTPS WeekFlow address before accessing the saved login.',
      unavailable: 'Login storage is unavailable on this device or browser.',
      read: 'The saved login could not be read. Please try again.',
      write: 'The login could not be saved securely. Please try again.',
      clear: 'The saved login could not be removed. Please try again.',
      'invalid-session': 'Only a valid, unexpired login for this device can be saved.',
    };
    super(messages[code]);
    this.name = 'AuthSessionStorageError';
    this.code = code;
    // Do not attach native exception text, saved JSON, tokens, or passwords.
  }
}

type Scope = { origin: string; key: string; clientType: 'web' | 'native'; storage?: Storage };
type Envelope = StoredAuthSession & { version: 1; origin: string };
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME = /^[a-z0-9][a-z0-9_.-]{2,63}$/;
const MAX_RECORD_LENGTH = 2048;
const NATIVE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'weekflow.auth.sessions.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  // Expo Go can use secure storage without enabling biometric prompts.
  requireAuthentication: false,
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function onlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).every(key => allowed.includes(key));
}
function token(value: unknown): value is string { return typeof value === 'string' && TOKEN.test(value); }

function scopeFor(options: AuthSessionStorageOptions): Scope {
  const raw = options.baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL;
  let url: URL;
  try {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error();
    url = new URL(raw.trim());
  } catch { throw new AuthSessionStorageError('configuration'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || /[?#]/.test(raw!) || url.origin.length > 512) {
    throw new AuthSessionStorageError('configuration');
  }
  const clientType = Platform.OS === 'web' ? 'web'
    : Platform.OS === 'ios' || Platform.OS === 'android' ? 'native' : null;
  if (clientType === null) throw new AuthSessionStorageError('unavailable');
  // Hex encoding avoids illegal SecureStore key characters and collisions
  // between origins such as different hosts or different HTTPS ports.
  const encodedOrigin = Array.from(url.origin, char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  const scope: Scope = { origin: url.origin, key: `weekflow.auth.v1.${encodedOrigin}`, clientType };
  if (clientType === 'web') {
    if (typeof window === 'undefined' || !window.location ||
        window.location.protocol !== 'https:' || window.location.origin !== scope.origin) {
      throw new AuthSessionStorageError('configuration');
    }
    try { scope.storage = window.localStorage; }
    catch { throw new AuthSessionStorageError('unavailable'); }
    if (!scope.storage) throw new AuthSessionStorageError('unavailable');
  }
  return scope;
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] &&
    Number.isFinite(Date.parse(value));
}
function copyCredentials(value: unknown, scope: Scope): AuthCredentials | null {
  if (!record(value) || value.clientType !== scope.clientType) return null;
  if (value.clientType === 'web' && onlyKeys(value, ['clientType', 'csrfToken']) && token(value.csrfToken)) {
    return { clientType: 'web', csrfToken: value.csrfToken };
  }
  if (value.clientType === 'native' && onlyKeys(value, ['clientType', 'token']) && token(value.token)) {
    return { clientType: 'native', token: value.token };
  }
  return null;
}
function decodeStored(value: unknown, scope: Scope): StoredAuthSession | null {
  if (!onlyKeys(value, ['version', 'origin', 'sessionId', 'expiresAt', 'credentials']) ||
      value.version !== 1 || value.origin !== scope.origin || typeof value.sessionId !== 'string' ||
      !UUID.test(value.sessionId) || !validTimestamp(value.expiresAt) || Date.parse(value.expiresAt) <= Date.now()) {
    return null;
  }
  const credentials = copyCredentials(value.credentials, scope);
  return credentials ? { sessionId: value.sessionId, expiresAt: value.expiresAt, credentials } : null;
}

// Serialize storage operations within this app instance. In particular, a
// pending save must finish before a later logout clears the same entry.
const queues = new Map<string, Promise<void>>();
function enqueue<T>(scope: Scope, operation: () => Promise<T>): Promise<T> {
  const queueKey = `${scope.clientType}:${scope.key}`;
  const result = (queues.get(queueKey) ?? Promise.resolve()).then(operation);
  const tail = result.then(() => undefined, () => undefined);
  queues.set(queueKey, tail);
  void tail.then(() => { if (queues.get(queueKey) === tail) queues.delete(queueKey); });
  return result;
}
async function requireNativeStorage() {
  try { if (await SecureStore.isAvailableAsync()) return; }
  catch { /* Replace uncontrolled native exception messages. */ }
  throw new AuthSessionStorageError('unavailable');
}
async function readRaw(scope: Scope): Promise<string | null> {
  if (scope.clientType === 'native') await requireNativeStorage();
  try {
    return scope.clientType === 'web' ? scope.storage!.getItem(scope.key)
      : await SecureStore.getItemAsync(scope.key, NATIVE_OPTIONS);
  } catch { throw new AuthSessionStorageError('read'); }
}
async function removeRaw(scope: Scope): Promise<void> {
  if (scope.clientType === 'native') await requireNativeStorage();
  try {
    if (scope.clientType === 'web') scope.storage!.removeItem(scope.key);
    else await SecureStore.deleteItemAsync(scope.key, NATIVE_OPTIONS);
  } catch { throw new AuthSessionStorageError('clear'); }
}

/**
 * Restore only login material, never an authenticated state. The session
 * provider must call fetchApiAuthSession and match its sessionId before
 * mounting data providers. PostgreSQL remains the authority on validity.
 */
export async function loadAuthSession(options: AuthSessionStorageOptions = {}): Promise<StoredAuthSession | null> {
  const scope = scopeFor(options);
  return enqueue(scope, async () => {
    const raw = await readRaw(scope);
    if (raw === null) return null;
    let saved: StoredAuthSession | null = null;
    if (raw.length <= MAX_RECORD_LENGTH) {
      try { saved = decodeStored(JSON.parse(raw), scope); }
      catch { /* Malformed stored data is not a valid login. */ }
    }
    if (saved) return saved;
    await removeRaw(scope);
    return null;
  });
}

/**
 * Save only an explicitly validated subset of a successful login result.
 * Native: bearer token in SecureStore. Web: CSRF value in localStorage;
 * the actual browser session token stays exclusively in its HttpOnly cookie.
 * No password, setup code, username, or full response object is persisted.
 */
export async function saveAuthSession(login: AuthLoginResult, options: AuthSessionStorageOptions = {}): Promise<void> {
  const scope = scopeFor(options);
  if (!onlyKeys(login, ['identity', 'credentials']) || !record(login.identity)) {
    throw new AuthSessionStorageError('invalid-session');
  }
  const identity = login.identity;
  if (identity.accountId !== 1 || identity.clientType !== scope.clientType ||
      typeof identity.username !== 'string' || !USERNAME.test(identity.username)) {
    throw new AuthSessionStorageError('invalid-session');
  }
  const envelope: Envelope = { version: 1, origin: scope.origin,
    sessionId: identity.sessionId as string, expiresAt: identity.expiresAt as string,
    credentials: login.credentials as AuthCredentials };
  const saved = decodeStored(envelope, scope);
  if (!saved) throw new AuthSessionStorageError('invalid-session');
  // Snapshot before awaiting storage so a later form/state mutation cannot
  // change which session is persisted. Only allowlisted fields are encoded.
  const encoded = JSON.stringify({ version: 1, origin: scope.origin, ...saved });
  if (encoded.length > MAX_RECORD_LENGTH) throw new AuthSessionStorageError('invalid-session');
  return enqueue(scope, async () => {
    if (Date.parse(saved.expiresAt) <= Date.now()) throw new AuthSessionStorageError('invalid-session');
    if (scope.clientType === 'native') await requireNativeStorage();
    try {
      if (scope.clientType === 'web') scope.storage!.setItem(scope.key, encoded);
      else await SecureStore.setItemAsync(scope.key, encoded, NATIVE_OPTIONS);
    } catch { throw new AuthSessionStorageError('write'); }
  });
}

/** Remove the local entry. The session provider must also revoke it in Python. */
export async function clearAuthSession(options: AuthSessionStorageOptions = {}): Promise<void> {
  const scope = scopeFor(options);
  return enqueue(scope, () => removeRaw(scope));
}
