/* eslint-disable no-restricted-globals */
// AGMS service worker — makes the app SHELL (the HTML/JS/CSS that renders the
// UI) available offline and survive a refresh with no connection. It never
// touches API calls (those go to a different origin/port — see the same-origin
// check below — and always need live, accurate data for a grading system, so
// they're deliberately left to fail/succeed on their own, same as before).
//
// Strategy:
//  - Navigations (loading the page itself) — network-first, falling back to
//    the last cached shell when offline. This is what makes a refresh with no
//    internet still show AGMS instead of the browser's own offline page.
//  - Static assets (JS/CSS/images under the app's own origin) — cache-first,
//    refreshed in the background on every successful fetch (stale-while-
//    revalidate), so the very next load already has whatever changed.
//
// Bump CACHE_NAME whenever this file's own strategy changes — activate()
// below deletes every other cache, so old entries never linger.
const CACHE_NAME = 'agms-shell-v1';
const SHELL_URL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(SHELL_URL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only ever handle GETs against this app's own origin — the API lives on a
  // different port (see services/api.js) and is intentionally never cached
  // here, so grade/approval data is never served stale.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(SHELL_URL, copy));
          return response;
        })
        .catch(() => caches.match(SHELL_URL).then((cached) => cached || caches.match(request)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
