import { useState, useEffect, useRef } from 'react';

// usePageState (usePageState.js) survives navigating away and back, but not
// an actual page reload — its cache is just an in-memory Map, gone the
// moment the tab refreshes. This is the localStorage-backed version for
// exactly that case: input someone typed but hasn't saved yet (a whole
// grade-encoding grid, a long registration form, a draft message) should
// still be there after an accidental refresh, a dropped connection, or the
// tab getting closed and reopened — not just a client-side navigation.
//
// Usage — same shape as useState, plus a unique storage key:
//   const [scores, setScores, clearScoresDraft] = useDraftState('GradeEncoding.scores.42', {});
// Pick keys that won't collide across instances of the same page (this is
// why GradeEncoding's own key below includes the classId) — two components
// sharing a key share the same saved draft, which is a footgun outside the
// rare case that's actually wanted.
//
// Call the returned clear function once the real save actually succeeds —
// leaving a stale draft in localStorage after the server already has the
// data would silently resurrect old values on a later visit.
export function useDraftState(key, initialValue) {
  const readDraft = () => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initialValue : JSON.parse(raw);
    } catch {
      // Corrupt JSON, or localStorage unavailable (private browsing, quota) —
      // fall back to a normal, empty start rather than crashing the page.
      return initialValue;
    }
  };

  const [state, setState] = useState(readDraft);
  const keyRef = useRef(key);

  useEffect(() => {
    // Key changed under the same mounted component (e.g. classId changes on
    // the same GradeEncoding instance via client-side routing) — re-seed
    // from the NEW key's own draft instead of carrying the old one over.
    if (keyRef.current !== key) {
      keyRef.current = key;
      setState(readDraft());
    }
  }, [key]);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Quota exceeded or unavailable — the draft just won't persist this
      // time; the page itself keeps working normally either way.
    }
  }, [key, state]);

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing to do if storage itself is unavailable.
    }
  };

  return [state, setState, clearDraft];
}
