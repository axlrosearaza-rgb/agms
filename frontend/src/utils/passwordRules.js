// What makes a strong password — every rule must pass. The backend applies
// the same rules (backend/utils/passwordRules.js).
export const PASSWORD_RULES = [
  { key: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { key: 'upper', label: 'An uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { key: 'lower', label: 'A lowercase letter (a–z)', test: (p) => /[a-z]/.test(p) },
  { key: 'number', label: 'A number (0–9)', test: (p) => /\d/.test(p) },
  { key: 'special', label: 'A special character (e.g. ! @ # $ %)', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

export const checkPassword = (password = '') => PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(password) }));
export const isStrongPassword = (password = '') => PASSWORD_RULES.every((r) => r.test(password));
