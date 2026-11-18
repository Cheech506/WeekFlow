/** Remember the selected HTTPS server on this phone, separately from its login. */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type StorageErrorCode = 'invalid-address' | 'unavailable' | 'read' | 'write' | 'clear';

export class ServerAddressStorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode) {
    const messages: Record<StorageErrorCode, string> = {
      'invalid-address': 'Enter a complete HTTPS server address without a path, username, password, query, or fragment.',
      unavailable: 'Server address storage is unavailable on this device.',
      read: 'The saved server address could not be read. Please try again.',
      write: 'The server address could not be saved. Please try again.',
      clear: 'The saved server address could not be removed. Please try again.',
    };
    super(messages[code]);
    this.name = 'ServerAddressStorageError';
    this.code = code;
  }
}

const STORAGE_KEY = 'weekflow.server-address.v1';
const MAX_ADDRESS_LENGTH = 512;
const STORAGE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService: 'weekflow.server.settings.v1',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

/** Return one consistent address, such as https://10.0.0.227:9443. */
export function normalizeServerAddress(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_ADDRESS_LENGTH) {
    throw new ServerAddressStorageError('invalid-address');
  }

  const address = value.trim();
  // URL parsing can silently remove control characters. Reject those first.
  if (!/^https:\/\/[^/]/i.test(address) || /[\u0000-\u001f\u007f]/.test(address) || /[?#]/.test(address)) {
    throw new ServerAddressStorageError('invalid-address');
  }

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new ServerAddressStorageError('invalid-address');
  }

  if (
    url.protocol !== 'https:' || !url.hostname ||
    url.username || url.password || url.pathname !== '/' ||
    url.search || url.hash || url.port === '0' ||
    url.origin.length > MAX_ADDRESS_LENGTH
  ) {
    throw new ServerAddressStorageError('invalid-address');
  }

  return url.origin;
}

async function requireNativeStorage(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    throw new ServerAddressStorageError('unavailable');
  }

  try {
    if (await SecureStore.isAvailableAsync()) return;
  } catch {
    // Show a controlled message instead of native error details.
  }
  throw new ServerAddressStorageError('unavailable');
}

// Keep a later read or clear from racing an earlier save of this one setting.
let storageQueue: Promise<void> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  // A failed operation must not prevent the next explicit attempt.
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function removeSavedAddress(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEY, STORAGE_OPTIONS);
  } catch {
    throw new ServerAddressStorageError('clear');
  }
}

/** A remembered address does not mean that a server is reachable or logged in. */
export function loadServerAddress(): Promise<string | null> {
  return enqueue(async () => {
    await requireNativeStorage();
    let saved: string | null;
    try {
      saved = await SecureStore.getItemAsync(STORAGE_KEY, STORAGE_OPTIONS);
    } catch {
      throw new ServerAddressStorageError('read');
    }
    if (saved === null) return null;

    try {
      return normalizeServerAddress(saved);
    } catch {
      // Discard an invalid setting so the UI can ask for an address again.
      await removeSavedAddress();
      return null;
    }
  });
}

/** Save only the address. Passwords and login tokens belong to session storage. */
export async function saveServerAddress(value: string): Promise<void> {
  // Validate and capture the input before waiting for other storage operations.
  const address = normalizeServerAddress(value);
  return enqueue(async () => {
    await requireNativeStorage();
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, address, STORAGE_OPTIONS);
    } catch {
      throw new ServerAddressStorageError('write');
    }
  });
}

/** Clear only the server selection; this does not revoke or erase login sessions. */
export function clearServerAddress(): Promise<void> {
  return enqueue(async () => {
    await requireNativeStorage();
    await removeSavedAddress();
  });
}
