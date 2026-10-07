import { lazy } from 'react';

// React.lazy for a page, made safe against "Loading chunk … failed"
// (ChunkLoadError): the page's own file couldn't be fetched just then — the
// Wi-Fi dropped for a moment, the server was restarting / rebuilding, or the
// app was updated while this tab stayed open. Instead of a crash screen:
//   1. try the file again a few times, a little apart;
//   2. still failing → reload the page once (that fetches a fresh copy of
//      the app), but never in a loop;
//   3. reloaded already and it still fails → show a plain message with a
//      Retry button.
const RELOAD_KEY = 'agms:chunk-reload-at';
const RETRIES = 3;
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const recentlyReloaded = () => {
  try { return Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 30000; } catch (e) { return false; }
};
const markReloaded = () => { try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (e) { /* private mode */ } };

function CouldNotLoad() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: '#1e3a5f', marginBottom: 8 }}>This page couldn't be loaded</p>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 18 }}>
          The connection to the system was interrupted. Check that this device is still connected to the same network as the server, then try again.
        </p>
        <button
          type="button"
          onClick={() => { try { sessionStorage.removeItem(RELOAD_KEY); } catch (e) { /* ignore */ } window.location.reload(); }}
          style={{ background: '#1e3a5f', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export function lazyPage(load) {
  return lazy(async () => {
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await load();
      } catch (err) {
        if (attempt === RETRIES) break;
        // eslint-disable-next-line no-await-in-loop
        await wait(600 * (attempt + 1));
      }
    }
    if (!recentlyReloaded()) {
      markReloaded();
      window.location.reload();
      return new Promise(() => {}); // the reload takes over
    }
    return { default: CouldNotLoad };
  });
}
