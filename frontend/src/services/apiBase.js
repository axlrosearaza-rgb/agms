// Where the backend is — one place, used by the REST client (api.js) and the
// live connection (socket.js).
//
//   1. REACT_APP_API_URL, when set: the frontend and backend live on
//      different hosts.
//   2. A production build with nothing set: the backend is served from the
//      SAME domain under /api.
//   3. Local / LAN development: both run on this machine, so the backend is
//      whatever host the browser used to load the page, on port 5000 — load
//      the page via 192.168.x.x:3000 and it talks to 192.168.x.x:5000, via
//      localhost:3000 and it talks to localhost:5000. No IP to hardcode.
const configured = (process.env.REACT_APP_API_URL || '').trim();

export const API_BASE_URL = configured
  || (process.env.NODE_ENV === 'production' ? '/api' : `http://${window.location.hostname}:5000/api`);

// Socket.io connects to the bare server origin, not ".../api". For the
// same-domain case that is simply this page's own origin.
export const SOCKET_URL = API_BASE_URL.startsWith('/')
  ? window.location.origin
  : API_BASE_URL.replace(/\/api\/?$/, '');
