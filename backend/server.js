const express = require('express');
const cors = require('cors');
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

// Models (init relations)
const { User } = require('./models');

const app = express();
const PORT = process.env.PORT || 5000;

// ================= CORS ORIGIN CHECKER =================
const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (origin.startsWith('http://localhost')) return true;
  if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  if (/^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d+\.\d+(:\d+)?$/.test(origin)) return true;
  return false;
};

// ================= MIDDLEWARE =================
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
      socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
      });
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;