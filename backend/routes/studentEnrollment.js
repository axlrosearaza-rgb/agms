const router = require('express').Router();
const { getMyEnrollment } = require('../controllers/studentEnrollmentController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// The student's own classes this semester (added by their faculty's class lists).
router.get('/', authorize('Student'), getMyEnrollment);

module.exports = router;
