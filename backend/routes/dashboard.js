const router = require('express').Router();
const { getAdminDashboard, getAdminAnalytics, getActivities, getChairpersonFacultyReview } = require('../controllers/dashboardController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/admin', authorize('Admin'), getAdminDashboard);
router.get('/admin/analytics', authorize('Admin'), getAdminAnalytics);
router.get('/activities', authorize('Admin', 'Chairperson'), getActivities);
router.get('/chairperson-faculty-review', authorize('Chairperson', 'Admin'), getChairpersonFacultyReview);

module.exports = router;
