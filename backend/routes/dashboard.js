const router = require('express').Router();
const { getAdminDashboard, getActivities, getChairpersonFacultyReview } = require('../controllers/dashboardController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/admin', authorize('Admin'), getAdminDashboard);
router.get('/activities', authorize('Admin'), getActivities);
router.get('/chairperson-faculty-review', authorize('Chairperson'), getChairpersonFacultyReview);

module.exports = router;
