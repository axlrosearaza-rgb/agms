const router = require('express').Router();
const {
  getSemesters,
  getCurrentSemester,
  createSemester,
  updateSemester,
  deleteSemester,
  setCurrentSemester,
} = require('../controllers/semesterController');
const { authenticate, authorize } = require('../middleware/auth');

// Admin can always manage semesters; a Chairperson may only if specifically flagged
// `can_manage_semester` (Admin sets this on one chairperson — e.g. the IT chair — via
// User Management, since day-to-day updates are more practically handled by them).
const requireSemesterManager = (req, res, next) => {
  if (req.user.role === 'Admin') return next();
  if (req.user.role === 'Chairperson' && req.user.can_manage_semester) return next();
  return res.status(403).json({ message: 'You are not authorized to manage semesters.' });
};

// Public, unauthenticated — used by the pre-login landing page
router.get('/public/current', getCurrentSemester);

router.use(authenticate);

router.get('/', getSemesters);
router.get('/current', getCurrentSemester);
router.post('/', authorize('Admin', 'Chairperson'), requireSemesterManager, createSemester);
router.put('/:id', authorize('Admin', 'Chairperson'), requireSemesterManager, updateSemester);
router.delete('/:id', authorize('Admin', 'Chairperson'), requireSemesterManager, deleteSemester);
router.put('/:id/set-current', authorize('Admin', 'Chairperson'), requireSemesterManager, setCurrentSemester);

module.exports = router;