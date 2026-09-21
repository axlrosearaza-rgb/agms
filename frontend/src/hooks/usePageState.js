import { useState, useEffect, useRef } from 'react';

// React Router unmounts a page's whole component tree the moment you
// navigate away from it — every plain useState (filters, search text, which
// tab you had open, loaded results) is gone, so coming back always starts
// from a blank slate. This is the fix: a drop-in replacement for useState
// that keeps its value in a small in-memory cache keyed by a string you
// choose, outside the component's own lifecycle. Navigate away and back
// (or open a different page and return) and the state is still there,
// because it was never actually destroyed — only the component was.
//
// Usage: same shape as useState, just with a unique key as the first arg —
//   const [search, setSearch] = usePageState('PromotionManagement.search', '');
// Pick keys that won't collide between pages/instances (prefix with the page
// name); two components using the same key SHARE state, which is occasionally
// useful (e.g. syncing a filter across two views of the same page) but is a
// footgun if accidental.
//
// Deliberately session-only (a plain module-level Map, not localStorage) —
// state that shouldn't survive a real page reload (loading flags, modal
// open/closed, in-flight action spinners) should just stay as regular
// useState; only pass through here what a user would actually expect to
// still be there after clicking away and back, like Evaluate's results,
// active filters/tabs, and expanded/collapsed groups.
const cache = new Map();

export function usePageState(key, initialValue) {
  const [state, setState] = useState(() => (cache.has(key) ? cache.get(key) : initialValue));
  const keyRef = useRef(key);

  useEffect(() => {
    // If the key itself changes between renders (rare — e.g. a param-based
    // page reusing the hook for a different id), re-seed from that key's own
    // cached value instead of carrying the old key's state over.
    if (keyRef.current !== key) {
      keyRef.current = key;
      setState(cache.has(key) ? cache.get(key) : initialValue);
    }
  }, [key]);

  useEffect(() => {
    cache.set(key, state);
  }, [key, state]);

  return [state, setState];
}

// Escape hatch for the rare case a page wants to explicitly clear its own
// cached state (e.g. a "Reset filters" button, or after a destructive action
// where stale cached state would be actively misleading).
export function clearPageState(key) {
  cache.delete(key);
}
