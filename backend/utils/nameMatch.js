// ── Does an imported name refer to the same person as an account? ───────────
// Class lists write names many ways — "DELA CRUZ, Juan A.", "Juan Dela Cruz",
// "Juan Antonio dela Cruz Jr." — so names are compared as sets of words:
// lower-cased, accents and punctuation dropped, initials (one letter) and
// suffixes (Jr., III, …) ignored. Two names match when every word of the
// shorter one appears in the longer one. A different first name or surname —
// a mistyped Student ID pointing at someone else — doesn't.
// Mirrored on the frontend in src/utils/nameMatch.js.

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const nameTokens = (name) => String(name || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '') // ñ → n, é → e
  .replace(/[^a-z\s,]/g, ' ')
  .split(/[\s,]+/)
  .filter((t) => t.length > 1 && !SUFFIXES.has(t));

const namesMatch = (a, b) => {
  const A = new Set(nameTokens(a));
  const B = new Set(nameTokens(b));
  if (A.size === 0 || B.size === 0) return true; // nothing to compare
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  return [...small].every((t) => large.has(t));
};

// Same words regardless of order/format — for finding a same-name account.
const nameKey = (name) => [...new Set(nameTokens(name))].sort().join(' ');

module.exports = { nameTokens, namesMatch, nameKey };
