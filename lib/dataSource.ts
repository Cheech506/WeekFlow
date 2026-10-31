/** Choose the app's storage backend during the API integration. */

export type DataSource = 'sqlite' | 'api';

/**
 * Keep SQLite as the default until all connected providers are ready.
 * This setting does not detect outages or upload offline changes.
 */
export function getDataSource(): DataSource {
  const configured = process.env.EXPO_PUBLIC_DATA_SOURCE?.trim();

  if (!configured || configured === 'sqlite') {
    return 'sqlite';
  }

  if (configured === 'api') {
    return 'api';
  }

  throw new Error(
    'EXPO_PUBLIC_DATA_SOURCE must be "sqlite" or "api".'
  );
}