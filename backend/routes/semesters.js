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

// Public, unauthenticated — used by the pre-login landing page
router.get('/public/current', getCurrentSemester);

router.use(authenticate);

// Only Admin sets the semester now — Chairpersons have read-only visibility at
// most (wherever the current semester is shown elsewhere), no management UI.
router.get('/', getSemesters);
router.get('/current', getCurrentSemester);
router.post('/', authorize('Admin'), createSemester);
router.put('/:id', authorize('Admin'), updateSemester);
router.delete('/:id', authorize('Admin'), deleteSemester);
router.put('/:id/set-current', authorize('Admin'), setCurrentSemester);

module.exports = router;