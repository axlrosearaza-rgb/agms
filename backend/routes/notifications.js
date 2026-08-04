const router = require('express').Router();
const { getNotifications, markAsRead, markAllAsRead, deleteNotification } = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', getNotifications);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

module.exports = router;