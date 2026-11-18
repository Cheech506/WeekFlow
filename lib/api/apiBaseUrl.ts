/** Choose an API address. Callers still validate its URL and HTTPS rules. */
import { Platform } from 'react-native';

// An in-memory selection for the current app run. SecureStore handles
// remembering the address between launches in serverAddressStorage.ts.
let nativeApiBaseUrl: string | undefined;

/**
 * Startup supplies the validated mobile server before mounting authentication.
 * Passing undefined removes this selection and restores the existing fallback.
 * This does not save an address, sign in, or change the active login session.
 */
export function configureNativeApiBaseUrl(baseUrl: string | undefined): void {
  nativeApiBaseUrl = baseUrl;
}

export function resolveApiBaseUrl(explicitBaseUrl?: string): string | undefined {
  // Explicit overrides remain useful for isolated requests and tests.
  if (explicitBaseUrl !== undefined) return explicitBaseUrl;

  // A mobile selection takes priority over the address compiled from .env.local.
  // A browser always keeps its existing configuration/origin behavior.
  if ((Platform.OS === 'ios' || Platform.OS === 'android') && nativeApiBaseUrl !== undefined) {
    return nativeApiBaseUrl;
  }

  const configured = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (configured !== undefined) {
    // Preserve even blank or invalid configuration so callers report it.
    return configured;
  }

  // A packaged website shares its HTTPS origin with the API through Caddy.
  // Native apps cannot infer their API address from a browser window.
  if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

  // origin contains the scheme, host, and port, without a page path or query.
  return window.location?.origin;
}
