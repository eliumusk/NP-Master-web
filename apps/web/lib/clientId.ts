// Persist a per-browser UUID for anonymous job tracking. Lives in localStorage
// so user can keep accessing their jobs across page reloads without an
// account. Loss of localStorage = loss of access (acceptable for v0.2).

const KEY = "npmaster_client_id";

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Fallback: RFC4122 v4-ish via Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function writeCookie(value: string) {
  if (typeof document === "undefined") return;
  // 1 year, lax, no httpOnly (we need to read it client-side too).
  document.cookie = `${KEY}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function getOrCreateClientId(): string {
  if (typeof window === "undefined") return "";
  let v = localStorage.getItem(KEY);
  if (!v) {
    v = uuid();
    localStorage.setItem(KEY, v);
  }
  // Always re-stamp the cookie so SSR pages can read it.
  writeCookie(v);
  return v;
}

export function getClientId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}
