// ── Offline mode ─────────────────────────────────────────────────────────────
// OFFLINE_MODE=true in backend/.env runs the whole system with no Wi-Fi /
// internet: the database, the app and live updates are all on this machine
// already, so the only thing that ever needed the internet is e-mail (Gmail).
// While it is on:
//   - no e-mail is sent at all (utils/emailService.js);
//   - steps that wait for an e-mailed code are skipped — a student's account
//     setup and an e-mail change in Settings save the address straight away,
//     marked NOT verified (it can be verified once the system is online);
//   - "Forgot password" by e-mail is unavailable (the Admin / adviser resets).
// To go back online: set OFFLINE_MODE=false (or remove the line) and restart
// the backend. Nothing else needs changing.
const isOffline = () => /^(true|1|yes|on)$/i.test(String(process.env.OFFLINE_MODE || '').trim());

module.exports = { isOffline };
