// ── Does an imported name refer to the same person as an account? ───────────
// Same rule as the backend (backend/utils/nameMatch.js): names compared as
// sets of words — lower-cased, accents/punctuation dropped, initials and
// suffixes (Jr., III, …) ignored. They match when every word of the shorter
// name appears in the longer one, so "DELA CRUZ, Juan A." matches "Juan Dela
// Cruz" but not "Pedro Dela Cruz".

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

export const nameTokens = (name) => String(name || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z\s,]/g, ' ')
  .split(/[\s,]+/)
  .filter((t) => t.length > 1 && !SUFFIXES.has(t));

export const namesMatch = (a, b) => {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (A.size === 0 || B.size === 0) return true;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  return [...small].every((t) => large.has(t));
};

export const nameKey = (name) => [...new Set(nameTokens(name))].sort().join(' ');
