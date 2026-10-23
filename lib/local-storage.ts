// localStorage is best-effort. Safari private mode, a full quota, a disabled
// storage API, or a server render all make the accessor throw or vanish, and a
// remembered preference is never worth an error, so every read and write is
// guarded and a failure simply means the preference does not persist.

export function readLocalStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // The preference does not persist; the in-memory state still applies.
  }
}
