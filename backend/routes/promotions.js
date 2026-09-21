const express = require('express');
const router = express.Router();
const {
  evaluateStudents,
  promoteStudents,
  markIrregular,
  getPromotionHistory,
  getPromotionOverview,
} = require('../controllers/promotionController');
const { authenticate, authorize } = require('../middleware/auth');

// All promotion routes require authentication
router.use(authenticate);

// Promotion (evaluate/promote/mark-irregular) is handled entirely by Admin —
// Chairperson's own verification step (Grade Sheet and Class Records) still
// gates it, but the actual promote action is Admin's call. A brief self-
// service version (students promoting themselves, with Admin/Chairperson
// just notified afterward) was tried and then deliberately reverted — Admin
// decides promotion. Releasing grades to students is still Faculty's own
// action once their class is finalized (see gradeController.releaseClassGrades)
// — Promotion Management doesn't have its own separate release step.

// GET /api/promotions/evaluate — evaluate students for promotion (admin-wide)
router.get('/evaluate', authorize('Admin'), evaluateStudents);

// POST /api/promotions/promote — promote selected students (admin-wide, once verified/approved)
router.post('/promote', authorize('Admin'), promoteStudents);

// POST /api/promotions/mark-irregular — mark student as irregular
router.post('/mark-irregular', authorize('Admin'), markIrregular);

// GET /api/promotions/history — get promotion history
// Admin only
router.get('/history', authorize('Admin'), getPromotionHistory);

// GET /api/promotions/overview — current semester's summary counts, for the
// Admin Dashboard's "Promotions Going" card
router.get('/overview', authorize('Admin'), getPromotionOverview);

module.exports = router;