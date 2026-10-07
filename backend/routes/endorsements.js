const router = require('express').Router();
const {
  getEndorsements,
  getDepartmentStudents,
  endorseStudent,
  flagStudent,
  overrideEndorsement,
} = require('../controllers/endorsementController');
const { authenticate, authorize } = require('../middleware/auth');
const { cacheJsonHandler } = require('../utils/responseCache');

router.use(authenticate);

router.get('/', authorize('Admin', 'Chairperson'), getEndorsements);
// Per-Chairperson result, shared across their reloads (the dashboard re-fetches
// this on every grade event) and dropped the moment an endorsement, a student or
// a grade could have changed it.
router.get('/department-students', authorize('Chairperson'), cacheJsonHandler(getDepartmentStudents, {
  keyFn: (req) => `${req.originalUrl}|${req.user.id}`,
  ttlMs: 10000,
  tags: ['users', 'dashboard'],
}));
router.post('/endorse', authorize('Chairperson'), endorseStudent);
router.post('/flag', authorize('Chairperson'), flagStudent);
router.put('/override', authorize('Admin'), overrideEndorsement);

module.exports = router;