// localStorage can throw (private mode, blocked storage, sandboxed iframes).
// Every access is wrapped so the app always works without it.

export function readStorage(key, fallback = null) {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? fallback : v
  } catch {
    return fallback
  }
}

export function writeStorage(key, value) {
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, String(value))
  } catch {
    /* ignore — storage is a convenience only */
  }
}
