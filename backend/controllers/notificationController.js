const { Op } = require('sequelize');
const { Notification } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');

// Any notification past its 24-hour window gets flagged `archived` — a
// single indexed UPDATE, not a per-row loop, so it stays cheap even with a
// large backlog. The row itself is never deleted (see deleteNotification
// below for that), so nothing here is destructive — an archived
// notification just stops showing in the bell dropdown / unread count.
// Called both lazily (every getNotifications request, so a user's own view
// is always correct the moment they check) and on a standing interval in
// server.js (so it also runs for users who aren't actively polling).
const ARCHIVE_AFTER_MS = 24 * 60 * 60 * 1000;
const archiveStaleNotifications = async () => {
  await Notification.update(
    { archived: true, archived_at: new Date() },
    { where: { archived: false, created_at: { [Op.lt]: new Date(Date.now() - ARCHIVE_AFTER_MS) } } }
  );
};

// GET /api/notifications
// GET /api/notifications?archived=true returns the archived list instead —
// same shape, same 50-row cap — for the "Archived" view in the bell
// dropdown. unreadCount always reflects the ACTIVE (non-archived) list
// regardless of which one was requested, since that's what the bell badge
// itself is counting.
const getNotifications = asyncHandler(async (req, res) => {
  await archiveStaleNotifications();

  const wantArchived = req.query.archived === 'true';
  const notifications = await Notification.findAll({
    where: { user_id: req.user.id, archived: wantArchived },
    order: [['created_at', 'DESC']],
    limit: 50,
  });

  const unreadCount = await Notification.count({
    where: { user_id: req.user.id, is_read: false, archived: false },
  });

  res.json({ notifications, unreadCount });
});

// PUT /api/notifications/:id/read
const markAsRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });

  notification.is_read = true;
  await notification.save();
  res.json({ message: 'Marked as read.' });
});

// PUT /api/notifications/read-all
const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.update(
    { is_read: true },
    { where: { user_id: req.user.id, is_read: false } }
  );
  res.json({ message: 'All notifications marked as read.' });
});

// DELETE /api/notifications/:id
const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOne({
    where: { id: req.params.id, user_id: req.user.id },
  });
  if (!notification) return res.status(404).json({ message: 'Notification not found.' });

  await notification.destroy();
  res.json({ message: 'Notification deleted.' });
});

// Helper: Create a notification and emit via Socket.IO
const createNotification = async (app, { userId, title, message, type, link }) => {
  try {
    const notification = await Notification.create({
      user_id: userId,
      title,
      message,
      type,
      link: link || null,
    });

    // Emit real-time notification via Socket.IO — scoped to this user's own
    // room (joined on connect in server.js) instead of io.emit()'ing to
    // every connected socket system-wide under a userId-specific event name.
    // The old per-user event name still worked (each browser only has a
    // listener bound for its own id, so it never reacted to anyone else's),
    // but every notification for every user was still being serialized and
    // sent down every open connection regardless — wasted egress that grows
    // with concurrent users, on the exact path this needs to stay fast.
    const io = app.get('io');
    if (io) {
      io.to(`user:${userId}`).emit('notification:new', {
        id: notification.id,
        title,
        message,
        type,
        link,
        is_read: false,
        created_at: notification.created_at,
        createdAt: notification.createdAt,
      });
    }

    return notification;
  } catch (err) {
    console.error('Failed to create notification:', err);
  }
};

// Helper: Notify all admins
// Fanned out with Promise.all instead of a sequential for-loop — each
// createNotification is its own INSERT + socket emit, so awaiting them one
// at a time serialized N round trips into the caller's own response time
// for no reason (nothing here depends on the previous notification landing
// first). Same reasoning for the three helpers below.
const notifyAdmins = async (app, { title, message, type, link }) => {
  const { User } = require('../models');
  const admins = await User.findAll({ where: { role: 'Admin', status: 'Active' } });
  await Promise.all(admins.map((admin) => createNotification(app, { userId: admin.id, title, message, type, link })));
};

// Helper: Notify all active Faculty in a given program. Faculty accounts carry
// their program(s) in the `programs` array (not the singular `program` field,
// which is Student-only) — matched via containment, not equality.
const notifyInstructorsByProgram = async (app, program, { title, message, type, link }) => {
  const { User } = require('../models');
  const { Op } = require('sequelize');
  const instructors = await User.findAll({ where: { role: 'Faculty', status: 'Active', programs: { [Op.contains]: [program] } } });
  await Promise.all(instructors.map((instructor) => createNotification(app, { userId: instructor.id, title, message, type, link })));
};

// Helper: Notify all active Chairpersons in a given program — the first stop
// for a new student registration (they see it grouped by Year/Section before
// Faculty ever act on it, per the registration-flow redesign).
const notifyChairpersonsByProgram = async (app, program, { title, message, type, link }) => {
  const { User } = require('../models');
  const { Op } = require('sequelize');
  const chairs = await User.findAll({ where: { role: 'Chairperson', status: 'Active', programs: { [Op.contains]: [program] } } });
  await Promise.all(chairs.map((chair) => createNotification(app, { userId: chair.id, title, message, type, link })));
};

// Helper: Notify every active user regardless of role — for events that
// affect the whole system rather than one program or role (a semester being
// created or ending applies to every Admin/Chairperson/Faculty/Student
// alike, unlike notifyInstructorsByProgram/notifyChairpersonsByProgram's
// program-scoped notices). `link` is optional here specifically because a
// single URL can't be right for all four roles at once (there's no one
// "Semesters" page every role can see) — when the caller doesn't supply one,
// each recipient gets sent to their OWN role's dashboard instead of getting
// a dead click.
const notifyAllUsers = async (app, { title, message, type, link }) => {
  const { User } = require('../models');
  const users = await User.findAll({ where: { status: 'Active' }, attributes: ['id', 'role'] });
  await Promise.all(users.map((u) => createNotification(app, { userId: u.id, title, message, type, link: link || `/${u.role.toLowerCase()}` })));
};

module.exports = { getNotifications, markAsRead, markAllAsRead, deleteNotification, createNotification, notifyAdmins, notifyInstructorsByProgram, notifyChairpersonsByProgram, notifyAllUsers, archiveStaleNotifications };