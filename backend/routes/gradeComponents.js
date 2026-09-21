const router = require('express').Router();
const {
  getComponents,
  saveComponents,
  getScores,
  saveScores,
  unlockScores,
  resetClassGrades,
} = require('../controllers/gradeComponentController');
const { authenticate, authorize } = require('../middleware/auth');
const { authorizeTeaching } = require('../utils/teachingAuth');

router.use(authenticate);

// Component definitions
router.get('/:classId/components', authorize('Faculty', 'Admin', 'Chairperson', 'Student'), getComponents);
// authorizeTeaching also admits a Chairperson flagged is_teaching (own classes
// only, enforced in the controller) — same pattern grades.js/classes.js
// already use for encode/submit/create, just missed here originally.
router.put('/:classId/components', authorizeTeaching('Faculty'), saveComponents);

// Student scores — Students may only ever see their own (enforced in the controller)
router.get('/:classId/scores', authorize('Faculty', 'Admin', 'Chairperson', 'Student'), getScores);
router.put('/:classId/scores', authorizeTeaching('Faculty'), saveScores);
router.post('/:classId/unlock-scores', authorizeTeaching('Faculty'), unlockScores);
// Wipes this class's scores/grades and resets its whole submit/verify/
// approve/release pipeline back to a blank slate — keeps the class, its
// enrolled students, and its component setup untouched.
router.post('/:classId/reset', authorizeTeaching('Faculty'), resetClassGrades);

module.exports = router;
