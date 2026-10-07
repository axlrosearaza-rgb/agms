import { useEffect, useRef } from 'react';

// Pages call useAutoRefresh(reload) to reload their lists whenever something
// is saved anywhere in the app — creating / editing a class, adding or
// removing students, editing an advisee, saving scores… services/api.js fires
// 'agms:data-changed' after every successful change; several changes close
// together trigger one reload.
export const DATA_CHANGED_EVENT = 'agms:data-changed';

export function useAutoRefresh(reload, delayMs = 350) {
  const fn = useRef(reload);
  fn.current = reload;
  useEffect(() => {
    let timer = null;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { try { fn.current(); } catch (e) { /* page gone */ } }, delayMs);
    };
    window.addEventListener(DATA_CHANGED_EVENT, onChange);
    return () => { window.removeEventListener(DATA_CHANGED_EVENT, onChange); clearTimeout(timer); };
  }, [delayMs]);
}
