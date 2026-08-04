const { Notification } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/notifications
const getNotifications = asyncHandler(async (req, res) => {
  const notifications = await Notification.findAll({
    where: { user_id: req.user.id },
    order: [['created_at', 'DESC']],
    limit: 50,
  });

  const unreadCount = await Notification.count({
    where: { user_id: req.user.id, is_read: false },
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

    // Emit real-time notification via Socket.IO
    const io = app.get('io');
    if (io) {
      io.emit(`notification:${userId}`, {
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
const notifyAdmins = async (app, { title, message, type, link }) => {
  const { User } = require('../models');
  const admins = await User.findAll({ where: { role: 'Admin', status: 'Active' } });
  for (const admin of admins) {
    await createNotification(app, { userId: admin.id, title, message, type, link });
  }
};

// Helper: Notify all active Instructors in a given program
const notifyInstructorsByProgram = async (app, program, { title, message, type, link }) => {
  const { User } = require('../models');
  const instructors = await User.findAll({ where: { role: 'Instructor', status: 'Active', program } });
  for (const instructor of instructors) {
    await createNotification(app, { userId: instructor.id, title, message, type, link });
  }
};

module.exports = { getNotifications, markAsRead, markAllAsRead, deleteNotification, createNotification, notifyAdmins, notifyInstructorsByProgram };