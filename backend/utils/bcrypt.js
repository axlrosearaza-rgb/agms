// Password hashing. Prefers native `bcrypt` — it runs the (deliberately slow)
// hash on libuv's worker threads, so a burst of logins can't stall the whole
// API — and falls back to pure-JS `bcryptjs` only if the native module isn't
// available on this machine (e.g. a host without a matching prebuilt binary).
// bcryptjs does the same work ON the main thread: ~105ms of blocked event
// loop per login, which at class-start login rushes freezes every other
// request. Both read and write the exact same hash format, so existing
// passwords keep working either way.
let impl;
try {
  impl = require('bcrypt');
} catch (err) {
  console.warn('[bcrypt] native module unavailable, falling back to bcryptjs:', err.message);
  impl = require('bcryptjs');
}
module.exports = impl;
