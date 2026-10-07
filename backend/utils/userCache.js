// Short-lived cache of the authenticated user row, keyed by user id.
//
// Every authenticated API request (and every socket connect) used to run
// `SELECT * FROM users WHERE id = ?` just to confirm the token's owner still
// exists and is Active — one extra database round trip on EVERY request, from
// every browser tab, including the frequent background refreshes. With
// thousands of people online that alone is thousands of queries per second
// answering the same question. This keeps the answer for a few seconds.
//
// Staleness is bounded two ways: the entry expires after TTL_MS, and
// models/User.js drops it the moment that user is saved/deleted (so a
// deactivated account or a role change takes effect immediately for the
// process handling the write, and within TTL_MS regardless).
const TTL_MS = 20 * 1000;
const MAX_ENTRIES = 20000;

const cache = new Map(); // id -> { user, expiresAt }
const inflight = new Map(); // id -> Promise (one lookup per id at a time)

// Returns a fresh shallow copy each call — request handlers are free to
// tack things onto req.user without leaking into other requests.
async function getAuthUser(id) {
  const key = Number(id);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.user ? { ...hit.user } : null;

  if (!inflight.has(key)) {
    const p = (async () => {
      try {
        const { User } = require('../models'); // lazy: models/User.js requires this file
        const row = await User.findByPk(key);
        const user = row ? row.toSafeJSON() : null;
        if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
        cache.set(key, { user, expiresAt: Date.now() + TTL_MS });
        return user;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
  }
  const user = await inflight.get(key);
  return user ? { ...user } : null;
}

const invalidate = (id) => { cache.delete(Number(id)); };
const clear = () => { cache.clear(); };

module.exports = { getAuthUser, invalidate, clear };
