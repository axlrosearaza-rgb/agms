// What makes a strong password — every rule must pass. Mirrors the frontend
// checklist (frontend/src/utils/passwordRules.js).
const PASSWORD_RULES = [
  { label: 'at least 8 characters', test: (p) => p.length >= 8 },
  { label: 'an uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'a lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'a number', test: (p) => /\d/.test(p) },
  { label: 'a special character', test: (p) => /[^A-Za-z0-9\s]/.test(p) },
];

// null when strong, else a message naming what's missing.
const weakPasswordMessage = (password = '') => {
  const missing = PASSWORD_RULES.filter((r) => !r.test(String(password))).map((r) => r.label);
  return missing.length ? `Your password needs ${missing.join(', ')}.` : null;
};

module.exports = { weakPasswordMessage };
