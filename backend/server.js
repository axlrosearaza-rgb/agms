// libuv's worker pool defaults to 4 threads — that's what native bcrypt (login
// password checks) and DNS lookups share. Raised before anything uses it so a
// burst of logins can't queue behind each other on 4 threads.
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || '16';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { testConnection, sequelize } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const { Server } = require('socket.io');
require('dotenv').config();

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const accountSetupRoutes = require('./routes/accountSetup');
const studentEnrollmentRoutes = require('./routes/studentEnrollment');
const subjectRoutes = require('./routes/subjects');
const classRoutes = require('./routes/classes');
const gradeRoutes = require('./routes/grades');
const gradeComponentRoutes = require('./routes/gradeComponents');
const endorsementRoutes = require('./routes/endorsements');
const dashboardRoutes = require('./routes/dashboard');
const semesterRoutes = require('./routes/semesters');
const notificationRoutes = require('./routes/notifications');
const promotionRoutes = require('./routes/promotions'); // ✅ NEW
const reportRoutes = require('./routes/reports');
const chatRoutes = require('./routes/chat');

// Models (init relations)
const { User } = require('./models');
const { getAuthUser } = require('./utils/userCache');
const { ensureIndexes } = require('./utils/ensureIndexes');
const { invalidateOnWrite } = require('./utils/responseCache');
const { markOnline, markOffline } = require('./utils/presence');
const { archiveStaleNotifications } = require('./controllers/notificationController');

const app = express();
const PORT = process.env.PORT || 5000;

// ================= CORS ORIGIN CHECKER =================
// CLIENT_URL (already in .env.example, previously unused) is the deployed
// frontend's real origin(s) — comma-separated if there's more than one
// (e.g. a Render subdomain during setup, plus a custom domain once attached).
// Everything else here stays exactly as it was for local/LAN development.
const allowedOriginsFromEnv = (process.env.CLIENT_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Local/LAN access by raw IP address. Not limited to the textbook private
// ranges (192.168.x, 10.x, 172.16–31.x) anymore: networks like the school
// portal Wi-Fi hand out addresses such as 172.50.x.x, which fell outside
// those ranges, so every request from the page was rejected by CORS and the
// login screen showed "Unable to reach the server". Any IPv4 address on any
// port is accepted instead, so the app works on whatever Wi-Fi/IP the laptop
// is on. Only outside production — a deployed backend only trusts CLIENT_URL.
const isLanOrigin = (origin) =>
  process.env.NODE_ENV !== 'production'
  && /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(origin);

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return true;
  if (isLanOrigin(origin)) return true;
  if (allowedOriginsFromEnv.includes(origin)) return true;
  return false;
};

// ================= MIDDLEWARE =================
// Sets the standard defensive response headers (X-Content-Type-Options,
// X-Frame-Options, etc.) — crossOriginResourcePolicy relaxed to
// cross-origin since the frontend is a separate origin/port fetching from
// this API (LAN dev today, a different deployed domain later), which
// helmet's default 'same-origin' policy would otherwise block.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());

app.use(cors({
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Slows down brute-force password guessing against login/register — a
// generous cap (not aimed at a legitimate user mistyping their password a
// few times), just enough to make hammering the endpoint impractical.
// Scoped to these two routes specifically rather than every request, since
// the rest of the API is already gated by authenticate()/JWT and doesn't
// need the same protection.
// 20 failed attempts per 15 minutes. Only FAILED attempts count
// (skipSuccessfulRequests) so a normal sign-in never uses one up, and the
// bucket is per IP + the account being tried (login identifier / sign-up
// student number or email): a whole campus behind one school IP isn't locked
// out together, while guessing one account's password is still cut off after
// 20 wrong tries.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const body = req.body || {};
    const account = String(body.identifier || body.student_no || body.email || '').trim().toLowerCase();
    return `${ipKeyGenerator(req.ip)}|${account}`;
  },
  message: { message: 'Too many attempts. Please wait 15 minutes and try again.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

// Backstop against a runaway client (a stuck retry loop, a script) hammering
// the API. Keyed by the signed-in USER (decoded, not verified — this only
// buckets traffic; authenticate() still does the real check), falling back to
// IP, so a whole campus behind one address is not throttled as one client.
// Generous: real usage — sidebar refreshes, chat, page loads — is a tiny
// fraction of this per user.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS' || req.path === '/health',
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      const decoded = jwt.decode(auth.slice(7));
      if (decoded && decoded.id) return `u:${decoded.id}`;
    }
    return ipKeyGenerator(req.ip);
  },
  message: { message: 'Too many requests. Please slow down and try again shortly.' },
});
app.use('/api', apiLimiter);

// Drops cached list/dashboard data the moment a write could have changed it.
app.use('/api', invalidateOnWrite);

// Flags requests that take unusually long (default > 2s), with the route and
// status — the first thing to look at when the system "feels slow". Costs
// one timestamp per request; SLOW_REQUEST_MS tunes it.
const SLOW_REQUEST_MS = parseInt(process.env.SLOW_REQUEST_MS || '2000', 10);
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms > SLOW_REQUEST_MS) console.warn(`[slow] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${Math.round(ms)}ms`);
  });
  next();
});

if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ================= ROUTES =================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/account-setup', accountSetupRoutes);
app.use('/api/student-enrollment', studentEnrollmentRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/grades', gradeRoutes);
app.use('/api/grade-components', gradeComponentRoutes);
app.use('/api/endorsements', endorsementRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/semesters', semesterRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/promotions', promotionRoutes); // ✅ NEW
app.use('/api/reports', reportRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    // true while OFFLINE_MODE is on — no e-mail, no internet needed.
    offline: require('./utils/offline').isOffline(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.originalUrl} not found.` });
});

// Error handler
app.use(errorHandler);

// ================= SERVER START =================
const startServer = async () => {
  try {
    await testConnection();

    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync();
      console.log('✅ Database synced.');
    }

    await ensureIndexes();

    // A bigger accept queue than Node's default (511): when thousands of people
    // open the app in the same minute (start of class), new connections arrive
    // in bursts, and connections that overflow the queue are silently dropped
    // and only retried by the client after 1s / 3s / 7s — which looks exactly
    // like a random multi-second freeze even though the server was idle.
    const server = app.listen(PORT, '0.0.0.0', 4096, () => {
      console.log(`\n🚀 AGMS Server running on port ${PORT}`);
    });
    // Longer than typical proxy/browser idle timeouts, so a client reusing a
    // keep-alive connection never races the server closing it under it (which
    // shows up as random ECONNRESET errors under load).
    server.keepAliveTimeout = 65 * 1000;
    server.headersTimeout = 66 * 1000;

    // Auto-archive notifications past their 24h window — also runs lazily on
    // every GET /notifications (see notificationController), but that only
    // covers a user actively checking their own bell. This standing interval
    // catches everyone else too, so a notification doesn't sit "active" for
    // days on end just because nobody happened to open the app. Runs once
    // immediately (covers whatever went stale while the server was down),
    // then every 15 minutes — 24h precision doesn't need finer than that.
    archiveStaleNotifications().catch((err) => console.error('Notification auto-archive failed:', err.message));
    setInterval(() => {
      archiveStaleNotifications().catch((err) => console.error('Notification auto-archive failed:', err.message));
    }, 15 * 60 * 1000);

    // 🔥 SOCKET.IO
    const io = new Server(server, {
      cors: {
        origin: function (origin, callback) {
          if (isAllowedOrigin(origin)) {
            callback(null, true);
          } else {
            callback(new Error(`CORS blocked: ${origin}`));
          }
        },
        methods: ['GET', 'POST'],
      },
    });

    app.set('io', io);

    // INC not completed by its deadline → 5.0. Checked shortly after startup
    // and then every hour (utils/incLapse.js); also on opening a class's grades.
    const { lapseExpiredINCs } = require('./utils/incLapse');
    setTimeout(() => lapseExpiredINCs(app), 15 * 1000);
    setInterval(() => lapseExpiredINCs(app), 60 * 60 * 1000);

    // Current semester within 14 days of its end date and no next semester
    // yet → Admins are warned to create one (utils/semesterEndWarning.js).
    // Fully approved classes whose grades aren't released yet (approved
    // before release became automatic) → released now, once at startup.
    // (Off — approved classes now wait for the Admin to release them from the dashboard.)
    // setTimeout(() => require('./controllers/gradeController').releaseApprovedBacklog(app), 25 * 1000);

    // …and 30 days before the end, instructors with classes not yet submitted
    // to the Chairperson are reminded to submit their grades.
    // A semester past its end date is no longer active: marked Completed,
    // un-set as current, its classes archived (utils/semesterAutoEnd.js).
    const { endPastSemesters } = require('./utils/semesterAutoEnd');
    setTimeout(() => endPastSemesters(app), 10 * 1000);
    setInterval(() => endPastSemesters(app), 60 * 60 * 1000);
    // …and right at midnight (Philippine time), the moment an end date passes.
    const atNextMidnightPH = () => {
      const now = new Date();
      const ph = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
      const next = new Date(ph); next.setHours(24, 0, 5, 0);
      setTimeout(() => { endPastSemesters(app); atNextMidnightPH(); }, next - ph);
    };
    atNextMidnightPH();

    const { warnSemesterEnding, warnGradeSubmission } = require('./utils/semesterEndWarning');
    setTimeout(() => { warnSemesterEnding(app); warnGradeSubmission(app); }, 20 * 1000);
    setInterval(() => { warnSemesterEnding(app); warnGradeSubmission(app); }, 60 * 60 * 1000);

    // Authenticate the socket handshake using the same JWT the REST API uses
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('Authentication required.'));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Cached (utils/userCache.js) — after a server restart every open tab
        // reconnects within seconds; this keeps that from being thousands of
        // simultaneous user-table lookups.
        const user = await getAuthUser(decoded.id);
        if (!user || user.status !== 'Active') return next(new Error('Invalid token or account deactivated.'));

        socket.user = user;
        next();
      } catch (err) {
        next(new Error('Invalid token.'));
      }
    });

    // Per-connection console logging is only for development — at thousands
    // of connects/reconnects, logging each one is its own load.
    const verbose = process.env.NODE_ENV === 'development';

    // Presence is delivered ONLY to sockets that asked to watch that user
    // (rooms 'presence:<id>'), not broadcast to everyone. The old io.emit()
    // sent every user's online/offline flip to every connected socket — with N
    // people online that's N flips x N recipients (~9,000,000 packets at
    // 3,000 users just from everyone signing in), almost all of it to sockets
    // that don't have that person on screen.
    const MAX_WATCHED_PER_SOCKET = 500;

    io.on('connection', (socket) => {
      if (verbose) console.log('⚡ Client connected:', socket.id, '(user', socket.user.id + ')');
      socket.join(`user:${socket.user.id}`);
      // Role rooms — lets server-side events reach "all Admins" / "all
      // Chairpersons" (grade-pipeline changes) without touching anyone else.
      socket.join(`role:${socket.user.role}`);

      const watched = new Set();
      socket.on('presence:watch', (ids) => {
        if (!Array.isArray(ids)) return;
        for (const raw of ids) {
          const id = Number(raw);
          if (!Number.isInteger(id) || id <= 0 || watched.has(id)) continue;
          if (watched.size >= MAX_WATCHED_PER_SOCKET) break;
          watched.add(id);
          socket.join(`presence:${id}`);
        }
      });
      socket.on('presence:unwatch', (ids) => {
        if (!Array.isArray(ids)) return;
        for (const raw of ids) {
          const id = Number(raw);
          if (watched.delete(id)) socket.leave(`presence:${id}`);
        }
      });

      // First tab/device for this user coming online — tell whoever is
      // watching them so their dot flips live. A 2nd/3rd tab connecting is
      // not a new event.
      if (markOnline(socket.user.id)) {
        io.to(`presence:${socket.user.id}`).emit('presence:update', { userId: socket.user.id, online: true, last_seen_at: null });
      }

      socket.on('disconnect', async () => {
        if (verbose) console.log('❌ Client disconnected:', socket.id);
        // Only true once their LAST open tab/device disconnects — stamps
        // last_seen_at (utils/presence.js) and notifies whoever is watching.
        if (await markOffline(socket.user.id)) {
          io.to(`presence:${socket.user.id}`).emit('presence:update', { userId: socket.user.id, online: false, last_seen_at: new Date() });
        }
      });
    });

    // Graceful shutdown (deploys, restarts, Ctrl+C): stop taking new
    // connections, let in-flight requests finish, close sockets, then release
    // the database pool — instead of being killed mid-request, which drops
    // in-progress grade saves and leaves connections open on the database
    // side until Postgres times them out. A hard exit follows if it hangs.
    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\n${signal} received — shutting down gracefully...`);
      setTimeout(() => { console.error('Shutdown timed out, forcing exit.'); process.exit(1); }, 10000).unref();
      io.close(() => {
        sequelize.close().catch(() => {}).finally(() => process.exit(0));
      });
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Crash prevention: catch unhandled rejections and exceptions so the Node process stays alive
process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ [Server] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ [Server] Uncaught Exception:', err);
});

module.exports = app;