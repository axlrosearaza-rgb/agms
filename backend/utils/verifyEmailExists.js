const dns = require('dns').promises;
const net = require('net');

// Best-effort "does this mailbox actually exist" check via an SMTP callout —
// connect to the domain's own mail server and ask it (RCPT TO) whether it
// would accept mail for this exact address, without ever actually sending a
// message (the connection is dropped right after the answer).
//
// Read this before relying on it:
//  - Gmail specifically is well known to accept RCPT TO for almost any
//    syntactically valid @gmail.com address and only bounce it later,
//    silently, out of band — a deliberate Google anti-enumeration measure.
//    So for gmail.com, this will very often come back "valid" even for an
//    address nobody actually owns. It's still worth running (it DOES catch
//    domains/servers that reject outright), just don't expect it to catch
//    a made-up Gmail address.
//  - Outbound port 25 is blocked by default on a lot of hosting providers
//    and home ISPs (again, anti-spam policy). Where that's the case every
//    call here times out and returns 'unknown' — see the TIMEOUT_MS below —
//    which register() below treats as "couldn't verify, let it through."
//    This is deliberate: this check must never be able to make registration
//    itself impossible just because outbound SMTP isn't reachable from
//    wherever this server happens to be running.
//
// Returns 'valid' | 'invalid' | 'unknown' — only 'invalid' (the receiving
// server explicitly said no such mailbox) should ever block a registration.
const TIMEOUT_MS = 8000;
const PROBE_HELO_DOMAIN = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/^https?:\/\//, '').split(/[/:]/)[0];
const PROBE_FROM = `verify@${PROBE_HELO_DOMAIN}`;

const getMxHosts = async (domain) => {
  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) return [];
    return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
  } catch {
    return [];
  }
};

const smtpProbe = (host, email) => new Promise((resolve) => {
  let settled = false;
  let buffer = '';
  let stage = 'connect';

  const socket = net.createConnection({ host, port: 25 });
  socket.setTimeout(TIMEOUT_MS);

  const finish = (result) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve(result);
  };

  socket.on('timeout', () => finish('unknown'));
  socket.on('error', () => finish('unknown'));

  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    // SMTP multi-line replies repeat the code with a '-' until the final
    // line, which uses a space — only act once the final line has arrived.
    const lines = buffer.split('\r\n').filter(Boolean);
    const last = lines[lines.length - 1] || '';
    if (!/^\d{3} /.test(last)) return;
    const code = parseInt(last.slice(0, 3), 10);
    buffer = '';

    if (stage === 'connect') {
      if (code !== 220) return finish('unknown');
      socket.write(`HELO ${PROBE_HELO_DOMAIN}\r\n`);
      stage = 'helo';
    } else if (stage === 'helo') {
      if (code !== 250) return finish('unknown');
      socket.write(`MAIL FROM:<${PROBE_FROM}>\r\n`);
      stage = 'mail';
    } else if (stage === 'mail') {
      if (code !== 250) return finish('unknown');
      socket.write(`RCPT TO:<${email}>\r\n`);
      stage = 'rcpt';
    } else if (stage === 'rcpt') {
      if (code === 250 || code === 251) return finish('valid');
      // Explicit "no such user" — 550/551/553 are the standard codes for
      // that. Any other 4xx/5xx (greylisting, policy, rate limiting,
      // "please try again") is NOT treated as invalid — it says nothing
      // reliable about whether the mailbox exists.
      if (code === 550 || code === 551 || code === 553) return finish('invalid');
      return finish('unknown');
    }
  });
});

const verifyMailboxExists = async (email) => {
  const domain = (email.split('@')[1] || '').toLowerCase();
  if (!domain) return 'unknown';

  const hosts = await getMxHosts(domain);
  if (hosts.length === 0) return 'unknown'; // no mail server found at all — say nothing rather than guess

  // Try each MX in priority order until one actually answers; a server
  // that's down/unreachable shouldn't fail the whole check if a backup
  // MX is available and does answer.
  for (const host of hosts.slice(0, 3)) {
    const result = await smtpProbe(host, email);
    if (result !== 'unknown') return result;
  }
  return 'unknown';
};

module.exports = { verifyMailboxExists };
