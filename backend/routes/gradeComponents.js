const router = require('express').Router();
const {
  getComponents,
  saveComponents,
  getScores,
  saveScores,
} = require('../controllers/gradeComponentController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Component definitions
router.get('/:classId/components', authorize('Instructor', 'Admin', 'Chairperson', 'Student'), getComponents);
router.put('/:classId/components', authorize('Instructor'), saveComponents);

// Student scores — Students may only ever see their own (enforced in the controller)
router.get('/:classId/scores', authorize('Instructor', 'Admin', 'Chairperson', 'Student'), getScores);
router.put('/:classId/scores', authorize('Instructor'), saveScores);

module.exports = router;