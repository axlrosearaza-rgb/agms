import { useState, useEffect, useRef } from 'react';
import { userService } from '../services';
import socket from '../services/socket';

// Online/offline + "how long ago" for a list of user IDs — one shared hook so
// every list of Faculty/Chairperson/Student accounts (Messages, User
// Management, Faculty Pending Review, ...) reads presence the same way:
// fetch the current state once for whichever IDs are visible, then patch it
// live off the same `presence:update` broadcast the backend fires on every
// connect/disconnect (server.js + utils/presence.js) — no polling.
//
// Returns { [userId]: { online: boolean, last_seen_at: string|null } }.
// An ID with no entry yet (still loading) should be treated as unknown, not
// offline — callers checking `presence[id]?.online` naturally get that.
// The server only pushes a person's online/offline flip to sockets that asked
// to watch them (it used to broadcast every flip to everyone — see server.js).
// Several lists can be mounted at once and may watch the same person, so
// subscriptions are reference-counted here: the server hears "watch" when the
// first list wants someone and "unwatch" only when the last one stops.
const watchCounts = new Map(); // userId -> number of mounted hooks watching
const watch = (ids) => {
  const fresh = [];
  ids.forEach((id) => {
    const n = watchCounts.get(id) || 0;
    watchCounts.set(id, n + 1);
    if (n === 0) fresh.push(id);
  });
  if (fresh.length > 0 && socket.connected) socket.emit('presence:watch', fresh);
};
const unwatch = (ids) => {
  const gone = [];
  ids.forEach((id) => {
    const n = watchCounts.get(id) || 0;
    if (n <= 1) { watchCounts.delete(id); gone.push(id); } else watchCounts.set(id, n - 1);
  });
  if (gone.length > 0 && socket.connected) socket.emit('presence:unwatch', gone);
};
// Rooms live on the server-side socket, which is brand new after every
// reconnect — put everyone still on screen back.
socket.on('connect', () => {
  if (watchCounts.size > 0) socket.emit('presence:watch', [...watchCounts.keys()]);
});

export function usePresence(userIds) {
  const [presence, setPresence] = useState({});
  // Stable dependency key — an inline array literal from the caller would
  // otherwise re-trigger this effect every render even when the actual ids
  // haven't changed.
  const idsKey = [...new Set((userIds || []).filter(Boolean))].sort((a, b) => a - b).join(',');
  const idsRef = useRef([]);
  idsRef.current = idsKey ? idsKey.split(',').map(Number) : [];

  useEffect(() => {
    const ids = idsRef.current;
    if (ids.length === 0) return undefined;
    watch(ids);
    userService.getPresence(ids)
      .then(({ data }) => setPresence((prev) => ({ ...prev, ...data.presence })))
      .catch(() => {});
    return () => unwatch(ids);
  }, [idsKey]);

  useEffect(() => {
    const handler = ({ userId, online, last_seen_at }) => {
      // Only patch IDs this hook actually cares about — every mounted list's
      // hook receives every broadcast, so this keeps each one's state scoped
      // to what it's actually displaying.
      if (!idsRef.current.includes(userId)) return;
      setPresence((prev) => ({ ...prev, [userId]: { online, last_seen_at } }));
    };
    socket.on('presence:update', handler);
    return () => socket.off('presence:update', handler);
  }, []);

  return presence;
}

// "3m ago" / "5h ago" / "2d ago" — same rounding buckets the notification
// bell's own timeSince already uses (AppLayout.js), kept as its own copy
// here since presence's "ago" always measures from last_seen_at specifically,
// not a notification's created_at.
export function agoLabel(date) {
  if (!date) return '';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
