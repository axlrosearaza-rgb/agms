// Small in-process cache for expensive, read-mostly endpoints (user lists,
// class lists, dashboards) — built for the "thousands of people hit the same
// heavy query at once" case that otherwise takes the database down:
//
//  - TTL: an answer is reused for a few seconds instead of recomputed per request.
//  - Single-flight: if a hundred requests arrive while the answer is being
//    computed, they all wait on that ONE computation instead of starting a
//    hundred identical queries (the classic cache stampede).
//  - Tags: entries declare which kinds of data they depend on, and a write
//    to that kind of data drops them immediately (see invalidateFor), so a
//    cached list never lags behind an edit someone just made.
//
// Single-process by design (this server is one Node process). If it's ever
// scaled out to several, swap this for Redis behind the same three functions.

const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const gzip = promisify(zlib.gzip);

const entries = new Map(); // key -> { value, expiresAt, tags }
const inflight = new Map(); // key -> Promise
const MAX_ENTRIES = 500;
// Cached values are often big pre-serialized JSON strings (a 3,000-student
// list is ~2 MB) — bound total memory, not just entry count, evicting the
// oldest entries first.
const MAX_BYTES = 128 * 1024 * 1024;
let totalBytes = 0;
// Bumped on every invalidation. A computation that STARTED before an
// invalidation must not store its (possibly stale) result after it.
let generation = 0;
const sizeOf = (value) => {
  if (typeof value === 'string') return value.length;
  if (value && typeof value.json === 'string') return value.json.length + (value.gz ? value.gz.length : 0);
  return 2048;
};
const evict = (key) => {
  const e = entries.get(key);
  if (e) { totalBytes -= e.bytes; entries.delete(key); }
};

const now = () => Date.now();

// cached(key, { ttlMs, tags }, producer) -> producer's value, cached.
async function cached(key, { ttlMs = 10000, tags = [] } = {}, producer) {
  const hit = entries.get(key);
  if (hit && hit.expiresAt > now()) return hit.value;

  if (inflight.has(key)) return inflight.get(key);

  const startedAt = generation;
  const p = (async () => {
    try {
      const value = await producer();
      // A write landed while this was computing — hand back the result to the
      // callers already waiting on it, but don't keep it for later ones.
      if (startedAt !== generation) return value;
      evict(key);
      const bytes = sizeOf(value);
      while ((entries.size >= MAX_ENTRIES || totalBytes + bytes > MAX_BYTES) && entries.size > 0) evict(entries.keys().next().value);
      entries.set(key, { value, expiresAt: now() + ttlMs, tags, bytes });
      totalBytes += bytes;
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

function invalidateTags(tags) {
  if (!tags || tags.length === 0) return;
  generation += 1;
  const wanted = new Set(tags);
  for (const [key, entry] of entries) {
    if (entry.tags.some((t) => wanted.has(t))) evict(key);
  }
}

function clearAll() {
  generation += 1;
  entries.clear();
  totalBytes = 0;
}

// Which cached data a write to a given API path can affect. Unknown paths
// clear everything — never serving something stale beats being clever.
const TAGS_BY_PREFIX = [
  ['/api/users', ['users', 'classes', 'dashboard']],
  ['/api/auth', ['users']],
  ['/api/classes', ['classes', 'dashboard']],
  ['/api/grades', ['classes', 'dashboard']],
  ['/api/grade-components', ['classes', 'dashboard']],
  ['/api/reports', ['classes', 'dashboard']],
  ['/api/semesters', ['classes', 'dashboard']],
  ['/api/promotions', ['users', 'classes', 'dashboard']],
  ['/api/endorsements', ['users', 'dashboard']],
  ['/api/account-setup', ['users']],
  ['/api/student-enrollment', ['users', 'classes', 'dashboard']],
  ['/api/subjects', ['classes', 'dashboard']],
  // Chat and notifications never feed a cached list.
  ['/api/chat', []],
  ['/api/notifications', []],
];

function invalidateFor(path) {
  const match = TAGS_BY_PREFIX.find(([prefix]) => path.startsWith(prefix));
  if (!match) return clearAll();
  invalidateTags(match[1]);
}

// Express middleware: after any successful write, drop the cache entries
// that write could have made stale.
function invalidateOnWrite(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode < 400) invalidateFor(req.originalUrl.split('?')[0]);
  });
  next();
}

// ---- JSON responses built once and shared --------------------------------
//
// For big list/dashboard payloads the per-request cost isn't the query, it's
// re-serializing and re-gzipping the same multi-hundred-KB body for every
// caller. A JSON entry holds the serialized body, its gzip (computed ONCE, at
// fill time, off the main thread), and an ETag — so serving it is just
// writing bytes, and a browser that already has it gets a bodyless 304.
async function buildJsonEntry(payload, status = 200) {
  const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const gz = json.length > 4096 ? await gzip(json, { level: 5 }) : null;
  const etag = `"${crypto.createHash('sha1').update(json).digest('base64url').slice(0, 24)}"`;
  return { json, gz, etag, status };
}

function sendJsonEntry(req, res, entry) {
  res.status(entry.status || 200);
  res.type('application/json');
  // Revalidate every time (cheap: it's the 304 path) — freshness is governed
  // by the server-side TTL/invalidation, never by a browser holding on.
  res.set('Cache-Control', 'private, no-cache');
  res.set('ETag', entry.etag);
  res.set('Vary', 'Accept-Encoding');
  if (entry.gz && /gzip/.test(req.headers['accept-encoding'] || '')) {
    res.set('Content-Encoding', 'gzip');
    return res.send(entry.gz);
  }
  return res.send(entry.json);
}

// Wraps an existing Express handler that ends in res.json(payload) so its
// result is computed once per key and shared (see cached()). The wrapped
// handler is untouched — it just runs against a stand-in response.
function cacheJsonHandler(handler, { keyFn, ttlMs = 10000, tags = [] }) {
  return async (req, res, next) => {
    try {
      const entry = await cached(keyFn(req), { ttlMs, tags }, async () => {
        const captured = await new Promise((resolve, reject) => {
          const stand = {
            statusCode: 200,
            status(code) { this.statusCode = code; return this; },
            json(payload) { resolve({ status: this.statusCode, payload }); return this; },
          };
          Promise.resolve(handler(req, stand, reject)).catch(reject);
        });
        return buildJsonEntry(captured.payload, captured.status);
      });
      return sendJsonEntry(req, res, entry);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { cached, invalidateTags, clearAll, invalidateFor, invalidateOnWrite, buildJsonEntry, sendJsonEntry, cacheJsonHandler };
