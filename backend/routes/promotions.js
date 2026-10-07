const express = require('express');
const router = express.Router();
const { evaluateStudents, promoteStudents } = require('../controllers/promotionController');
const { authenticate, authorize } = require('../middleware/auth');

// All promotion routes require authentication
router.use(authenticate);

// Promotion is done by each section's ADVISER (a Faculty member or a
// Chairperson the Admin assigned to that Program / Year / Section), from their
// My Advisory page — only for students in their own advisory section(s),
// re-checked in the controller. Admin no longer has a Promotions page.

// GET /api/promotions/evaluate?semester=&program=&year_level=&section=
router.get('/evaluate', authorize('Faculty', 'Chairperson'), evaluateStudents);

// POST /api/promotions/promote — { student_ids, semester }
router.post('/promote', authorize('Faculty', 'Chairperson'), promoteStudents);

module.exports = router;
