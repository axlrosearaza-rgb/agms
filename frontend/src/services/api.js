import axios from 'axios';
import { getToken, clearAuth } from './authStorage';
// Where the backend is (env var, same-domain /api, or this host:5000).
import { API_BASE_URL } from './apiBase';

// ✅ Create axios instance
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// In-memory response cache to make module switching and tab changes instantaneous
const responseCache = new Map();
const DEFAULT_CACHE_TTL_MS = 20 * 1000; // 20 seconds

export const clearApiCache = (pattern) => {
  if (!pattern) {
    responseCache.clear();
  } else {
    for (const key of responseCache.keys()) {
      if (key.includes(pattern)) {
        responseCache.delete(key);
      }
    }
  }
};

api.clearCache = clearApiCache;

// ── No internet: nothing disappears, nothing is half-saved ───────────────────
// The system only saves while the internet is on. While it is off:
//  - every screen keeps showing the last data it loaded — a list that tries
//    to reload gets that last copy back instead of coming up empty;
//  - anything that would change data (save, submit, approve, release, send)
//    is stopped before it leaves the browser, with a clear message, so
//    nothing is lost or saved halfway. Work typed in meanwhile stays on the
//    page (Grade Encoding also keeps it as a draft in this browser).
// When the connection comes back, every open page reloads by itself
// (components/layout/AppLayout.js).
export const OFFLINE_MESSAGE = 'No internet connection — nothing was saved. Your work is still on this page; try again when the connection is back.';
const LAST_KNOWN_PREFIX = 'agms.lastKnown.';
const LAST_KNOWN_MAX_CHARS = 400000; // a very large list is kept in memory only
const lastKnown = new Map();
const rememberLastKnown = (key, data) => {
  lastKnown.set(key, data);
  if (lastKnown.size > 300) lastKnown.delete(lastKnown.keys().next().value);
  try {
    const text = JSON.stringify(data);
    if (text.length <= LAST_KNOWN_MAX_CHARS) window.localStorage.setItem(LAST_KNOWN_PREFIX + key, text);
  } catch (e) { /* storage full or blocked — the in-memory copy still works */ }
};
const recallLastKnown = (key) => {
  if (lastKnown.has(key)) return lastKnown.get(key);
  try {
    const text = window.localStorage.getItem(LAST_KNOWN_PREFIX + key);
    return text ? JSON.parse(text) : undefined;
  } catch (e) { return undefined; }
};
// Signed out: another person may sign in on this browser next.
export const clearLastKnown = () => {
  lastKnown.clear();
  try {
    Object.keys(window.localStorage).filter((k) => k.startsWith(LAST_KNOWN_PREFIX)).forEach((k) => window.localStorage.removeItem(k));
  } catch (e) { /* nothing stored */ }
};
const keyOf = (config) => `${config.url}?${JSON.stringify(config.params || {})}`;
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const offlineError = (config) => {
  const err = new Error(OFFLINE_MESSAGE);
  err.config = config;
  err.isOffline = true;
  // Shaped like a server reply, so every page's usual
  // `err.response?.data?.message` shows this message as it is.
  err.response = { status: 0, data: { message: OFFLINE_MESSAGE }, config };
  return err;
};

// Endpoints whose whole point is being CURRENT — chat, notifications, and
// the sidebar/dashboard live counts. These must never be served from the
// 20s cache above: every socket event and every fast poll re-fetches them
// to pick up something that just changed on the server, and a cache hit
// hands back the answer from up to 20s ago, which is exactly what made new
// messages show up "literally late" (only a full page refresh, which wipes
// this in-memory cache, ever showed them on time).
const LIVE_URL_PATTERNS = [
  '/chat/',
  '/notifications',
  'pending-approval-count',
  '/dashboard/',
  '/student-enrollment',
  // The once-per-semester status pop-up must never come back from a cached
  // "not declared yet" answer after the student has saved it.
  '/account-setup',
];
const isLiveUrl = (url = '') => LIVE_URL_PATTERNS.some((p) => url.includes(p));

// ✅ Attach token and check client cache
api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const method = (config.method || 'get').toLowerCase();

    // No internet: a change is not sent at all (see the note at the top).
    if (['post', 'put', 'patch', 'delete'].includes(method) && isOffline()) {
      return Promise.reject(offlineError(config));
    }

    // Invalidate cache on mutations to prevent stale data
    if (['post', 'put', 'patch', 'delete'].includes(method)) {
      responseCache.clear();
      return config;
    }

    // Cache hit check for GET requests
    if (method === 'get' && !config.skipCache && !isLiveUrl(config.url)) {
      const cacheKey = `${config.url}?${JSON.stringify(config.params || {})}`;
      const cached = responseCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        config.adapter = () =>
          Promise.resolve({
            data: JSON.parse(JSON.stringify(cached.data)),
            status: cached.status || 200,
            statusText: 'OK (cached)',
            headers: cached.headers || {},
            config,
            request: {},
          });
      }
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// ✅ Global response handler and caching
// Requests that change nothing a list would show (sign-in checks, read
// receipts, chat, presence, look-ups) — they don't trigger a page refresh.
const QUIET_CHANGE = /\/auth\/|\/notifications|\/chat|\/presence|check-student-nos|\/account-setup\/(password|email)/;

api.interceptors.response.use(
  (response) => {
    const method = (response.config.method || 'get').toLowerCase();
    // Something was saved → pages reload their lists (hooks/useAutoRefresh.js).
    if (['post', 'put', 'patch', 'delete'].includes(method) && !QUIET_CHANGE.test(response.config.url || '') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event('agms:data-changed'));
    }
    if (method === 'get' && response.status === 200 && !response.config.offlineCopy) rememberLastKnown(keyOf(response.config), response.data);
    if (method === 'get' && !response.config.skipCache && !isLiveUrl(response.config.url) && response.status === 200) {
      const cacheKey = `${response.config.url}?${JSON.stringify(response.config.params || {})}`;
      const ttl = response.config.cacheTTL || DEFAULT_CACHE_TTL_MS;
      responseCache.set(cacheKey, {
        data: response.data,
        status: response.status,
        headers: response.headers,
        expiresAt: Date.now() + ttl,
      });
      // Bound cache size to prevent memory bloat
      if (responseCache.size > 120) {
        const oldestKey = responseCache.keys().next().value;
        responseCache.delete(oldestKey);
      }
    }
    return response;
  },
  (error) => {
    const cfg = error.config || {};
    const method = (cfg.method || 'get').toLowerCase();
    const unreachable = !error.response || error.isOffline;
    if (unreachable && method === 'get') {
      const data = recallLastKnown(keyOf(cfg));
      if (data !== undefined) {
        return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), status: 200, statusText: 'OK (last copy, offline)', headers: {}, config: { ...cfg, offlineCopy: true }, request: {} });
      }
    }
    if (unreachable && method !== 'get' && !error.isOffline) {
      // The connection dropped while the change was on its way: say so plainly.
      const err = offlineError(cfg);
      return Promise.reject(err);
    }
    // Unauthorized → logout
    if (error.response?.status === 401) {
      clearAuth();
      window.location.href = '/login';
    }

    // Optional: log other errors
    console.error('API Error:', error.response?.data || error.message);

    return Promise.reject(error);
  }
);

export default api;