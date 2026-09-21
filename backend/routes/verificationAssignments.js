const router = require('express').Router();
const {
  assignVerifiers,
  unassignVerifier,
  getMyAssignments,
  getMyAssignmentCount,
  decideAssigned,
} = require('../controllers/verificationAssignmentController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.post('/', authorize('Admin', 'Chairperson'), assignVerifiers);
router.delete('/:id', authorize('Admin', 'Chairperson'), unassignVerifier);
router.get('/mine', authorize('Faculty', 'Student'), getMyAssignments);
// Ahead of /:studentId/decide below — its own literal path, not a conflict,
// but kept beside its sibling GET for visibility (same convention chat.js's
// own /unread-count uses ahead of /conversations/:id).
router.get('/mine/count', authorize('Faculty', 'Student'), getMyAssignmentCount);
router.post('/:studentId/decide', authorize('Admin', 'Chairperson', 'Faculty', 'Student'), decideAssigned);

module.exports = router;
