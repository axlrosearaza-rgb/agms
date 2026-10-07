const router = require('express').Router();
const { getAdminDashboard, getAdminAnalytics, getActivities, getChairpersonFacultyReview } = require('../controllers/dashboardController');
const { authenticate, authorize } = require('../middleware/auth');
const { cacheJsonHandler } = require('../utils/responseCache');

router.use(authenticate);

// The heavy aggregate dashboards are identical for everyone in the same scope,
// so each is computed once and shared (see utils/responseCache.js) — a burst of
// admins/chairpersons all reloading on the same grade event costs one
// computation, not one each. Entries are dropped the instant a grade, class or
// user write could have changed them (see emitGradesUpdated / invalidateOnWrite).
const scopeKey = (req) => `${req.originalUrl}|${req.user.role}|${(req.user.programs || []).join(',')}`;

router.get('/admin', authorize('Admin'), cacheJsonHandler(getAdminDashboard, { keyFn: scopeKey, ttlMs: 15000, tags: ['dashboard'] }));
router.get('/admin/analytics', authorize('Admin'), cacheJsonHandler(getAdminAnalytics, { keyFn: scopeKey, ttlMs: 30000, tags: ['dashboard'] }));
router.get('/activities', authorize('Admin', 'Chairperson'), getActivities);
router.get('/chairperson-faculty-review', authorize('Chairperson', 'Admin'), cacheJsonHandler(getChairpersonFacultyReview, { keyFn: scopeKey, ttlMs: 10000, tags: ['dashboard'] }));

module.exports = router;
