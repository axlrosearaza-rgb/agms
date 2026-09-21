const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { testConnection, sequelize } = require('./config/database');
const { errorHandler } = require('./middleware/errorHandler');
const { Server } = require('socket.io');
require('dotenv').config();

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
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
const verificationAssignmentRoutes = require('./routes/verificationAssignments');

// Models (init relations)
const { User } = require('./models');
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

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (origin.startsWith('http://localhost')) return true;
  if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ================= ROUTES =================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
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
app.use('/api/verification-assignments', verificationAssignmentRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
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

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 AGMS Server running on port ${PORT}`);
    });

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

    // Authenticate the socket handshake using the same JWT the REST API uses
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        if (!token) return next(new Error('Authentication required.'));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findByPk(decoded.id);
        if (!user || user.status !== 'Active') return next(new Error('Invalid token or account deactivated.'));

        socket.user = user.toSafeJSON();
        next();
      } catch (err) {
        next(new Error('Invalid token.'));
      }
    });

    io.on('connection', (socket) => {
      console.log('⚡ Client connected:', socket.id, '(user', socket.user.id + ')');
      socket.join(`user:${socket.user.id}`);

      // First tab/device for this user coming online — broadcast it so
      // anyone with them in a list (Messages, User Management, etc.) can
      // flip their dot live. A 2nd/3rd tab connecting is not a new event.
      if (markOnline(socket.user.id)) {
        io.emit('presence:update', { userId: socket.user.id, online: true, last_seen_at: null });
      }

      socket.on('disconnect', async () => {
        console.log('❌ Client disconnected:', socket.id);
        // Only true once their LAST open tab/device disconnects — stamps
        // last_seen_at (utils/presence.js) and broadcasts "went offline".
        if (await markOffline(socket.user.id)) {
          io.emit('presence:update', { userId: socket.user.id, online: false, last_seen_at: new Date() });
        }
      });
    });

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