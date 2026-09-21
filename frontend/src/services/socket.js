import { io } from 'socket.io-client';
import { getToken } from './authStorage';
import api from './api';

// Same API_BASE_URL logic api.js uses, minus the trailing /api — that env
// var (or the dynamic same-host fallback — see api.js's own comment) points
// at the REST base (".../api"), but Socket.io connects to the bare server
// origin. Hardcoding localhost:5000 here (the old behavior) meant every
// deployed build silently tried to open a socket back to the visitor's own
// machine instead of the real backend, breaking realtime features (chat,
// presence) in production while the REST API worked fine.
const API_BASE_URL =
  process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000/api`;
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, '');

const socket = io(SOCKET_URL, {
  autoConnect: false,
  auth: (cb) => cb({ token: getToken() }),
  // WebSocket first — the default starts on HTTP long-polling and only then
  // "upgrades", and that polling stage is where browser shields/extensions,
  // LAN proxies and sticky-session quirks add seconds of lag (or quietly
  // deliver late) while the client still reports itself connected. Falls
  // back to polling only if a WebSocket genuinely can't be opened.
  transports: ['websocket', 'polling'],
  // Come back fast after a drop instead of backing off toward 5s+ gaps.
  reconnectionDelay: 500,
  reconnectionDelayMax: 2000,
});

// Nothing previously surfaced a failed/dropped connection anywhere — a bad
// or expired token (e.g. two roles logged in across tabs of the same
// browser, which share localStorage and can silently steal each other's
// agms_token) just left the socket permanently unconnected with zero
// visible sign why, since notifications/chat/presence all depend on it but
// none of them error when it's missing — they just never fire. These make
// that state checkable from the browser console instead of invisible.
socket.on('connect', () => {
  console.log('[socket] connected', socket.id);
});
socket.on('connect_error', (err) => {
  console.error('[socket] connection failed:', err.message);
});
socket.on('disconnect', (reason) => {
  console.warn('[socket] disconnected:', reason);
});

// Any server-side change announced over the socket makes whatever api.js has
// cached for other endpoints (class lists, approval queues, ...) stale — drop
// it BEFORE the page-level handlers below re-fetch, so those re-fetches hit
// the server instead of getting the same cached answer back. This module is
// evaluated before any component attaches its own listeners, so socket.io
// runs this one first.
['gradesUpdated', 'notification:new', 'chat:message', 'chat:conversationUpdate', 'chat:messageUpdated', 'chat:messageDeleted']
  .forEach((event) => socket.on(event, () => api.clearCache()));

export default socket;
