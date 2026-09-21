import axios from 'axios';
import { getToken, clearAuth } from './authStorage';

// ✅ Base URL — prefers an explicit REACT_APP_API_URL (a real deployment,
// where the frontend and backend live on different hosts/domains), but for
// local/LAN development — where both run on this same machine — falls back
// to whatever host the browser actually used to load this page. That makes
// the app reachable from any device on any Wi-Fi network without ever
// needing to hardcode/update an IP in .env again: load the page via
// 192.168.x.x:3000 and it talks to 192.168.x.x:5000; load it via
// localhost:3000 and it talks to localhost:5000 — it just follows whatever
// address got you here.
const API_BASE_URL =
  process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000/api`;

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
  '/users/pending',
  '/verification-assignments/mine',
  '/dashboard/',
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
api.interceptors.response.use(
  (response) => {
    const method = (response.config.method || 'get').toLowerCase();
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