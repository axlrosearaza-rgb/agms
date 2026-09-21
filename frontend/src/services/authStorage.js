// Small shared helper so the session can live in either localStorage
// ("Remember me" checked — survives closing the browser) or sessionStorage
// ("Remember me" unchecked — cleared when the tab/browser closes), while
// api.js, socket.js, and AuthContext.js all agree on where to look for it
// without duplicating the same fallback logic three times.

const TOKEN_KEY = 'agms_token';
const USER_KEY = 'agms_user';
const LAST_ACTIVITY_KEY = 'agms_last_activity';
const LOCKED_KEY = 'agms_locked';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Writes the session to the chosen storage and makes sure the other one is
// clear, so a later getToken()/getUser() can't accidentally pick up a stale
// value left behind from a previous login with the opposite choice.
export function setAuth(remember, token, user) {
  const target = remember ? localStorage : sessionStorage;
  const other = remember ? sessionStorage : localStorage;

  target.setItem(TOKEN_KEY, token);
  target.setItem(USER_KEY, JSON.stringify(user));
  other.removeItem(TOKEN_KEY);
  other.removeItem(USER_KEY);
}

export function setUser(user) {
  // Patches whichever storage currently holds the session.
  const target = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  target.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(LAST_ACTIVITY_KEY);
  localStorage.removeItem(LOCKED_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(LAST_ACTIVITY_KEY);
  sessionStorage.removeItem(LOCKED_KEY);
}

let lastRecordedActivity = 0;
export function markActivity() {
  const now = Date.now();
  if (now - lastRecordedActivity < 10000) return;
  lastRecordedActivity = now;
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  } catch {}
}

export function isLockedState() {
  return localStorage.getItem(LOCKED_KEY) === '1' || sessionStorage.getItem(LOCKED_KEY) === '1';
}

export function setLockedState(locked) {
  const target = localStorage.getItem(TOKEN_KEY) ? localStorage : sessionStorage;
  target.setItem(LOCKED_KEY, locked ? '1' : '0');
}

export function getLastActivity() {
  return Number(localStorage.getItem(LAST_ACTIVITY_KEY) || sessionStorage.getItem(LAST_ACTIVITY_KEY) || Date.now());
}
