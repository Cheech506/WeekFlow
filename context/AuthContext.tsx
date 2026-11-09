/** Own the frontend login flow. A stored token alone never opens WeekFlow. */
import { ApiError, configureApiSession, subscribeToApiSessionRejection } from '@/lib/api/apiClient';
import {
    createApiOwner, fetchApiAuthSession, fetchApiSetupStatus, loginApiOwner, logoutApiOwner,
    type AuthLoginInput, type AuthLoginResult, type AuthOwnerSetupInput, type AuthSessionIdentity,
} from '@/lib/api/authApi';
import {
    AuthSessionStorageError, clearAuthSession, loadAuthSession, saveAuthSession,
} from '@/lib/authSessionStorage';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

export type AuthStatus = 'checking' | 'setup' | 'login' | 'authenticated' | 'error';
type AuthState = {
  status: AuthStatus;
  identity: Readonly<AuthSessionIdentity> | null;
  setupReady: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
  noticeMessage: string | null;
  suggestedUsername: string;
};
export type AuthContextValue = AuthState & {
  refreshAuthentication: () => Promise<void>;
  createOwner: (input: AuthOwnerSetupInput) => Promise<void>;
  signIn: (input: AuthLoginInput) => Promise<void>;
  signOut: () => Promise<void>;
};
type PendingLogout = { login: AuthLoginResult; revoked: boolean; cleared: boolean };
const AuthContext = createContext<AuthContextValue | null>(null);
const INITIAL: AuthState = { status: 'checking', identity: null, setupReady: false,
  isSubmitting: false, errorMessage: null, noticeMessage: null, suggestedUsername: '' };

function safeMessage(cause: unknown): string {
  return cause instanceof ApiError || cause instanceof AuthSessionStorageError
    ? cause.message : 'The account request could not be completed. Please try again.';
}
function unauthorized(cause: unknown): boolean {
  return cause instanceof ApiError && cause.kind === 'http' && cause.status === 401;
}
function copyLogin(login: AuthLoginResult): AuthLoginResult {
  return { identity: { ...login.identity }, credentials: login.credentials.clientType === 'web'
    ? { clientType: 'web', csrfToken: login.credentials.csrfToken }
    : { clientType: 'native', token: login.credentials.token } };
}

export function AuthProvider({ children, baseUrl }: { children: ReactNode; baseUrl?: string }) {
  // Capture the address explicitly for each operation. Changing the configured
  // instance must not save or verify credentials against a different server.
  const address = baseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  const options = { baseUrl: address };
  const [state, setState] = useState<AuthState>(INITIAL);
  const stateRef = useRef<AuthState>(INITIAL);
  const serverRef = useRef(address);
  const renderedServerRef = useRef(address);
  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const verifiedRef = useRef<AuthLoginResult | null>(null);
  const pendingLogoutRef = useRef<PendingLogout | null>(null);
  const refreshQueuedRef = useRef(false);
  const actionsRef = useRef<{ refresh: () => Promise<void>; expire: (id: string) => Promise<void> } | null>(null);
  serverRef.current = address;

  function publish(patch: Partial<AuthState>) {
    if (!mountedRef.current || serverRef.current !== address) return;
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }
  function forgetTransport() {
    verifiedRef.current = null;
    configureApiSession(null);
  }
  function begin(): { id: number; signal: AbortSignal } | null {
    if (!mountedRef.current || serverRef.current !== address || busyRef.current) return null;
    busyRef.current = true;
    const id = ++operationRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    publish({ isSubmitting: true, errorMessage: null });
    return { id, signal: controller.signal };
  }
  function current(id: number): boolean {
    return mountedRef.current && serverRef.current === address && operationRef.current === id;
  }
  function finish(id: number) {
    if (!current(id)) return;
    busyRef.current = false;
    controllerRef.current = null;
    publish({ isSubmitting: false });
    if (refreshQueuedRef.current && !pendingLogoutRef.current) {
      refreshQueuedRef.current = false;
      // A different browser tab may have changed the cookie/storage pair
      // while this operation was pending. Verify again after it finishes.
      void Promise.resolve().then(() => { if (mountedRef.current) void actionsRef.current?.refresh(); });
    }
  }
  function show(status: AuthStatus, patch: Partial<AuthState> = {}) {
    publish({ status, identity: null, setupReady: false, errorMessage: null, noticeMessage: null, ...patch });
  }
  function install(login: AuthLoginResult) {
    const saved = copyLogin(login);
    configureApiSession({ baseUrl: address, sessionId: saved.identity.sessionId,
      expiresAt: saved.identity.expiresAt, credentials: saved.credentials });
    verifiedRef.current = saved;
    publish({ status: 'authenticated', identity: Object.freeze({ ...saved.identity }),
      setupReady: false, errorMessage: null, noticeMessage: null });
  }
  async function clearMatching(id: string): Promise<boolean> {
    const stored = await loadAuthSession(options);
    if (stored && stored.sessionId !== id) return false;
    if (stored) await clearAuthSession(options);
    return true;
  }

  /** Keep incomplete logout visible and retryable instead of claiming success. */
  async function completeLogout(id: number, pending: PendingLogout) {
    let failure: unknown = null;
    if (!pending.revoked && pending.login.credentials.clientType === 'web') {
      try {
        // All tabs share the browser cookie. If another tab replaced the
        // login, verify that cookie's new storage pair before logging out.
        const latest = await loadAuthSession(options);
        if (!current(id)) return;
        if (latest && latest.sessionId !== pending.login.identity.sessionId && latest.credentials.clientType === 'web') {
          const identity = await fetchApiAuthSession(latest.credentials, options);
          if (!current(id)) return;
          if (identity.sessionId === latest.sessionId && identity.clientType === 'web') {
            pending.login = { identity, credentials: latest.credentials };
            pending.cleared = false;
          }
        }
      } catch (cause) { failure = cause; }
    }
    if (!pending.revoked) {
      try { await logoutApiOwner(pending.login.credentials, options); pending.revoked = true; }
      catch (cause) { if (unauthorized(cause)) pending.revoked = true; else failure = cause; }
    }
    if (!current(id)) return;
    if (!pending.cleared) {
      try { await clearMatching(pending.login.identity.sessionId); pending.cleared = true; }
      catch (cause) { failure = cause; }
    }
    if (!current(id)) return;
    if (pending.revoked && pending.cleared) {
      pendingLogoutRef.current = null;
      refreshQueuedRef.current = false;
      show('login', { noticeMessage: 'You have signed out.' });
    } else {
      show('error', { errorMessage: 'Logout could not be fully confirmed. ' + safeMessage(failure) });
    }
  }

  async function refreshAuthentication(): Promise<void> {
    const operation = begin();
    if (!operation) { if (mountedRef.current) refreshQueuedRef.current = true; return; }
    const { id, signal } = operation;
    forgetTransport();
    show('checking');
    try {
      if (pendingLogoutRef.current) {
        await completeLogout(id, pendingLogoutRef.current);
        return;
      }
      const status = await fetchApiSetupStatus({ ...options, signal });
      if (!current(id)) return;
      if (!status.ownerExists) {
        await clearAuthSession(options);
        if (current(id)) show('setup', { setupReady: status.setupReady });
        return;
      }
      const stored = await loadAuthSession(options);
      if (!current(id)) return;
      if (!stored) { show('login'); return; }
      let identity: AuthSessionIdentity;
      try { identity = await fetchApiAuthSession(stored.credentials, { ...options, signal }); }
      catch (cause) {
        if (!current(id)) return;
        if (!unauthorized(cause)) throw cause;
        if (!await clearMatching(stored.sessionId)) refreshQueuedRef.current = true;
        if (current(id)) show('login', { noticeMessage: 'Your session has ended. Sign in again.' });
        return;
      }
      if (!current(id)) return;
      if (identity.sessionId !== stored.sessionId || identity.clientType !== stored.credentials.clientType) {
        if (!await clearMatching(stored.sessionId)) refreshQueuedRef.current = true;
        if (current(id)) show('login', { noticeMessage: 'Sign in again to verify this device’s session.' });
        return;
      }
      // Use the server's identity and deadline, not identity data from storage.
      const login = { identity, credentials: stored.credentials };
      await saveAuthSession(login, options);
      if (current(id)) install(login);
    } catch (cause) {
      if (current(id)) show('error', { errorMessage: safeMessage(cause) });
    } finally { finish(id); }
  }

  async function createOwner(input: AuthOwnerSetupInput): Promise<void> {
    if (stateRef.current.status !== 'setup' || !stateRef.current.setupReady) return;
    const operation = begin();
    if (!operation) return;
    const { id, signal } = operation;
    const submitted = { ...input };
    try {
      const owner = await createApiOwner(submitted, { ...options, signal });
      if (current(id)) show('login', { suggestedUsername: owner.username,
        noticeMessage: 'Account created. Sign in to continue.' });
    } catch (cause) {
      if (!current(id)) return;
      const uncertain = cause instanceof ApiError && (cause.mutationMayHaveSucceeded || cause.status === 409);
      if (uncertain) {
        // A timeout can happen after account creation commits. Recheck with
        // GET; never automatically repeat the password/setup-code request.
        try {
          const status = await fetchApiSetupStatus({ ...options, signal });
          if (!current(id)) return;
          if (status.ownerExists) {
            show('login', { suggestedUsername: submitted.username.trim().toLowerCase(),
              noticeMessage: 'An account now exists. Sign in to continue.' });
          } else {
            show('setup', { setupReady: status.setupReady, errorMessage: safeMessage(cause) });
          }
        } catch (checkFailure) {
          if (current(id)) show('error', { errorMessage: 'Account creation could not be confirmed. ' + safeMessage(checkFailure) });
        }
      } else { publish({ errorMessage: safeMessage(cause) }); }
    } finally { finish(id); }
  }

  async function signIn(input: AuthLoginInput): Promise<void> {
    if (stateRef.current.status !== 'login' || pendingLogoutRef.current) return;
    const operation = begin();
    if (!operation) return;
    const { id, signal } = operation;
    const submitted = { ...input };
    let issued: AuthLoginResult | null = null;
    forgetTransport();
    publish({ noticeMessage: null });
    try {
      // Remove an older entry before issuing a replacement login. An uncertain
      // response must not cause a reload to reuse mismatched old credentials.
      await clearAuthSession(options);
      if (!current(id)) return;
      issued = await loginApiOwner(submitted, { ...options, signal });
      if (!current(id)) return;
      const identity = await fetchApiAuthSession(issued.credentials, { ...options, signal });
      if (!current(id)) return;
      if (identity.sessionId !== issued.identity.sessionId || identity.clientType !== issued.identity.clientType ||
          identity.username !== issued.identity.username) {
        throw new ApiError('The new login session could not be verified.', { kind: 'invalid-response' });
      }
      issued = { identity, credentials: issued.credentials };
      await saveAuthSession(issued, options);
      if (current(id)) install(issued);
    } catch (cause) {
      if (!current(id)) return;
      forgetTransport();
      if (issued) {
        // If verification/persistence fails, keep the app locked and clean up
        // the session we just created. Failed cleanup remains retryable.
        const pending: PendingLogout = { login: copyLogin(issued), revoked: false, cleared: false };
        pendingLogoutRef.current = pending;
        await completeLogout(id, pending);
        if (current(id) && !pendingLogoutRef.current) {
          show('login', { errorMessage: safeMessage(cause) });
        }
      } else { publish({ errorMessage: safeMessage(cause) }); }
    } finally { finish(id); }
  }

  async function signOut(): Promise<void> {
    const login = verifiedRef.current;
    if (!login && !pendingLogoutRef.current) return;
    const operation = begin();
    if (!operation) return;
    const pending = pendingLogoutRef.current ?? { login: copyLogin(login!), revoked: false, cleared: false };
    pendingLogoutRef.current = pending;
    forgetTransport();
    show('checking');
    try { await completeLogout(operation.id, pending); }
    catch (cause) { if (current(operation.id)) show('error', { errorMessage: safeMessage(cause) }); }
    finally { finish(operation.id); }
  }

  async function expireSession(sessionId: string): Promise<void> {
    if (verifiedRef.current?.identity.sessionId !== sessionId) return;
    const operation = begin();
    if (!operation) return;
    forgetTransport();
    show('checking');
    try {
      if (!await clearMatching(sessionId)) refreshQueuedRef.current = true;
      if (current(operation.id)) show('login', { noticeMessage: 'Your session has ended. Sign in again.' });
    } catch (cause) {
      if (current(operation.id)) show('error', { errorMessage: safeMessage(cause) });
    } finally { finish(operation.id); }
  }

  actionsRef.current = { refresh: refreshAuthentication, expire: expireSession };
  useEffect(() => {
    mountedRef.current = true;
    renderedServerRef.current = address;
    stateRef.current = { ...INITIAL };
    setState(stateRef.current);
    busyRef.current = false;
    refreshQueuedRef.current = false;
    pendingLogoutRef.current = null;
    void actionsRef.current!.refresh();
    const unsubscribe = subscribeToApiSessionRejection(event => {
      if (!verifiedRef.current || verifiedRef.current.identity.sessionId !== event.sessionId) return;
      let origin: string;
      try { origin = new URL(address).origin; } catch { return; }
      if (event.baseUrl === origin) void actionsRef.current?.expire(event.sessionId);
    });
    const storageChanged = (event: StorageEvent) => {
      try {
        if (event.storageArea !== window.localStorage || (event.key !== null && !event.key.startsWith('weekflow.auth.v1.'))) return;
      } catch { return; }
      if (busyRef.current) refreshQueuedRef.current = true;
      else void actionsRef.current?.refresh();
    };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('storage', storageChanged);
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
      unsubscribe();
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('storage', storageChanged);
      forgetTransport();
    };
  }, [address]);

  useEffect(() => {
    if (state.status !== 'authenticated' || !state.identity) return;
    const identity = state.identity;
    const timer = setTimeout(() => { void actionsRef.current?.expire(identity.sessionId); },
      Math.max(0, Math.min(Date.parse(identity.expiresAt) - Date.now(), 2_147_483_647)));
    return () => { clearTimeout(timer); };
  }, [state.status, state.identity]);

  // A changed server prop cannot expose the previous instance for a render
  // while the effect above resets and checks the new server.
  const visible = renderedServerRef.current === address ? state : INITIAL;
  return <AuthContext.Provider value={{ ...visible, refreshAuthentication, createOwner, signIn, signOut }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
