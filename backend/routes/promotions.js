const express = require('express');
const router = express.Router();
const {
  evaluateStudents,
  promoteStudents,
  markIrregular,
  releaseGrades,
  getPromotionHistory,
} = require('../controllers/promotionController');
const { authenticate, authorize } = require('../middleware/auth');

// All promotion routes require authentication
router.use(authenticate);

// GET /api/promotions/evaluate — evaluate students for promotion
// Admin (all programs, read-only) or Chairperson (own program)
router.get('/evaluate', authorize('Admin', 'Chairperson'), evaluateStudents);

// POST /api/promotions/promote — promote selected students
// Chairperson only (scoped to own program, requires Endorsement)
router.post('/promote', authorize('Chairperson'), promoteStudents);

// POST /api/promotions/mark-irregular — mark student as irregular
// Chairperson only (scoped to own program)
router.post('/mark-irregular', authorize('Chairperson'), markIrregular);

// POST /api/promotions/release-grades — release grades to students
// Chairperson only (scoped to own program)
router.post('/release-grades', authorize('Chairperson'), releaseGrades);

// GET /api/promotions/history — get promotion history
// Admin only
router.get('/history', authorize('Admin'), getPromotionHistory);

module.exports = router;