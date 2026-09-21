// In-memory online presence — who's actually connected right now, tracked
// against real Socket.IO connections (server.js wires this in on every
// connect/disconnect), never persisted. A user can have more than one tab/
// device open at once, so this is a connection COUNT per user, not a boolean
// — only when the count drops to zero are they actually offline.
const { User } = require('../models');

const connectionCounts = new Map(); // userId -> number of live sockets

const isOnline = (userId) => (connectionCounts.get(Number(userId)) || 0) > 0;

// Called from server.js on every new socket connection. Returns true the
// FIRST time this user comes online (so the caller knows to broadcast it —
// their 2nd, 3rd, etc. tab connecting is not a new "came online" event).
const markOnline = (userId) => {
  const id = Number(userId);
  const next = (connectionCounts.get(id) || 0) + 1;
  connectionCounts.set(id, next);
  return next === 1;
};

// Called from server.js on every socket disconnect. Returns true once their
// LAST connection drops (so the caller knows to broadcast "went offline" and
// stamp last_seen_at) — closing one of several open tabs is not that event.
const markOffline = async (userId) => {
  const id = Number(userId);
  const next = Math.max(0, (connectionCounts.get(id) || 0) - 1);
  if (next === 0) {
    connectionCounts.delete(id);
    await User.update({ last_seen_at: new Date() }, { where: { id } }).catch(() => {});
    return true;
  }
  connectionCounts.set(id, next);
  return false;
};

// GET /api/users/presence's own shape for a batch of user IDs — online ones
// need no last_seen_at (they're right here now); offline ones read whatever
// was stamped on their most recent disconnect (or null if they've never
// connected at all yet).
const presenceFor = async (userIds) => {
  const ids = [...new Set(userIds.map(Number))];
  const onlineIds = ids.filter(isOnline);
  const offlineIds = ids.filter((id) => !isOnline(id));

  const result = {};
  onlineIds.forEach((id) => { result[id] = { online: true, last_seen_at: null }; });

  if (offlineIds.length > 0) {
    const rows = await User.findAll({ where: { id: offlineIds }, attributes: ['id', 'last_seen_at'] });
    rows.forEach((r) => { result[r.id] = { online: false, last_seen_at: r.last_seen_at }; });
  }

  return result;
};

module.exports = { isOnline, markOnline, markOffline, presenceFor };
