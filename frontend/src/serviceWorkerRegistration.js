// Thin registration wrapper — kept separate from index.js so the actual
// service-worker.js (public/service-worker.js) is the only place the caching
// strategy itself lives. Registers only in production: in development the
// dev server already rebuilds/serves fresh on every change, and a cached
// shell would fight that (showing stale code after a hot reload).
export function register() {
  if (process.env.NODE_ENV !== 'production') return;
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Registration failing (e.g. served over plain HTTP on a LAN IP,
      // where the Service Worker API is unavailable outside localhost)
      // just means no offline shell — the app still works online exactly
      // as before, so there's nothing more to do here.
    });
  });
}
