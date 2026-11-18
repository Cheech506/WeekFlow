/** Choose the mobile server before authentication or private data can mount. */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { ServerAddressScreen } from '@/components/ServerAddressScreen';
import { configureNativeApiBaseUrl } from '@/lib/api/apiBaseUrl';
import { configureApiSession } from '@/lib/api/apiClient';
import {
    clearServerAddress, loadServerAddress, normalizeServerAddress,
    saveServerAddress, ServerAddressStorageError,
} from '@/lib/serverAddressStorage';

type SelectionState = {
  stage: 'loading' | 'entry' | 'ready';
  address: string | null;
  errorMessage: string | null;
  isSubmitting: boolean;
};
type ServerAddressContextValue = {
  address: string;
  /** Leave this server locally. This does not revoke its saved login session. */
  changeServer: () => Promise<void>;
};
const ServerAddressContext = createContext<ServerAddressContextValue | null>(null);

/** Returns null on web or outside the mobile server-selection boundary. */
export function useServerAddress(): ServerAddressContextValue | null {
  return useContext(ServerAddressContext);
}

function suggestedAddress(): string {
  // Development configuration is only a prefilled suggestion on first use.
  // It cannot skip selection or override a remembered mobile server.
  try { return normalizeServerAddress(process.env.EXPO_PUBLIC_API_BASE_URL); }
  catch { return ''; }
}

function safeMessage(cause: unknown): string {
  return cause instanceof ServerAddressStorageError ? cause.message
    : 'The server address could not be loaded or saved. Please try again.';
}

/** Mount one instance above AuthProvider in the root layout. */
export function ServerAddressBoundary({ children }: { children: ReactNode }) {
  const native = Platform.OS === 'ios' || Platform.OS === 'android';
  const [state, setState] = useState<SelectionState>({
    stage: 'loading', address: null, errorMessage: null, isSubmitting: false,
  });
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const operationRef = useRef(0);
  const stageRef = useRef<SelectionState['stage']>('loading');
  const selectedRef = useRef<string | null>(null);
  const [suggestion] = useState(suggestedAddress);

  function current(operation: number): boolean {
    return mountedRef.current && operationRef.current === operation;
  }

  function install(address: string) {
    // Set the shared address FIRST. Children mount on the following render,
    // so AuthProvider and every feature client read the same server address.
    configureNativeApiBaseUrl(address);
    selectedRef.current = address;
    stageRef.current = 'ready';
    setState({ stage: 'ready', address, errorMessage: null, isSubmitting: false });
  }

  async function restore(): Promise<void> {
    if (!native || !mountedRef.current || busyRef.current || stageRef.current === 'ready') return;
    busyRef.current = true;
    const operation = ++operationRef.current;
    stageRef.current = 'loading';
    setState({ stage: 'loading', address: null, errorMessage: null, isSubmitting: false });
    try {
      const saved = await loadServerAddress();
      if (!current(operation)) return;
      if (saved === null) {
        stageRef.current = 'entry';
        setState({ stage: 'entry', address: null, errorMessage: null, isSubmitting: false });
      } else {
        install(normalizeServerAddress(saved));
      }
    } catch (cause) {
      if (current(operation)) {
        stageRef.current = 'entry';
        setState({ stage: 'entry', address: null, errorMessage: safeMessage(cause), isSubmitting: false });
      }
    } finally {
      if (current(operation)) busyRef.current = false;
    }
  }

  async function select(address: string): Promise<void> {
    if (!native || !mountedRef.current || busyRef.current || stageRef.current !== 'entry') return;
    busyRef.current = true;
    const operation = ++operationRef.current;
    setState(previous => ({ ...previous, errorMessage: null, isSubmitting: true }));
    try {
      const normalized = normalizeServerAddress(address);
      // Do not open login until the selected address is safely remembered.
      await saveServerAddress(normalized);
      if (current(operation)) install(normalized);
    } catch (cause) {
      if (current(operation)) {
        stageRef.current = 'entry';
        setState({ stage: 'entry', address: null, errorMessage: safeMessage(cause), isSubmitting: false });
      }
    } finally {
      if (current(operation)) busyRef.current = false;
    }
  }

  async function changeServer(): Promise<void> {
    if (!native || !mountedRef.current || busyRef.current || stageRef.current !== 'ready' ||
      state.address !== selectedRef.current) return;
    busyRef.current = true;
    const operation = ++operationRef.current;
    // Remove the old authentication/data tree and cancel protected requests.
    // Choosing another server is separate from logging out on the old server.
    configureApiSession(null);
    configureNativeApiBaseUrl(undefined);
    stageRef.current = 'entry';
    selectedRef.current = null;
    setState({ stage: 'entry', address: null, errorMessage: null, isSubmitting: true });
    try {
      await clearServerAddress();
    } catch (cause) {
      if (current(operation)) setState(previous => ({ ...previous, errorMessage: safeMessage(cause) }));
    } finally {
      if (current(operation)) {
        busyRef.current = false;
        setState(previous => ({ ...previous, isSubmitting: false }));
      }
    }
  }

  useEffect(() => {
    if (!native) return;
    mountedRef.current = true;
    busyRef.current = false;
    stageRef.current = 'loading';
    selectedRef.current = null;
    configureApiSession(null);
    configureNativeApiBaseUrl(undefined);
    void restore();
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      configureApiSession(null);
      configureNativeApiBaseUrl(undefined);
    };
  }, [native]);

  // Browsers already know their server from the website/configuration.
  // They must not read a phone setting or display the native address form.
  if (!native) return <>{children}</>;

  if (state.stage === 'ready' && state.address !== null) {
    return (
      <ServerAddressContext.Provider key={state.address} value={{ address: state.address, changeServer }}>
        {children}
      </ServerAddressContext.Provider>
    );
  }

  return (
    <ServerAddressScreen
      initialAddress={suggestion}
      isLoading={state.stage === 'loading'}
      isSubmitting={state.isSubmitting}
      errorMessage={state.errorMessage}
      onContinue={select}
      onRetry={state.errorMessage ? restore : undefined}
    />
  );
}
