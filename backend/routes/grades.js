const express = require('express');
const router = express.Router();
const {
  getGradesByClass,
  encodeGrades,
  submitGrades,
  markAsINC,
  resolveINC,
  getINCList,
  getStudentGrades,
  getGradeDistribution,
  getRecentSubmissions,
  getReportData,
  approveClassGrades,
} = require('../controllers/gradeController');
const { authenticate, authorize } = require('../middleware/auth');

// ── Class grades (instructor / admin / chairperson) ──────────────────────────
router.get('/class/:classId', authenticate, authorize('Instructor', 'Admin', 'Chairperson'), getGradesByClass);

// ── Admin approval (registrar sign-off on Passed students, per class) ───────
router.post('/class/:classId/approve', authenticate, authorize('Admin'), approveClassGrades);

// ── Encode / submit grades ───────────────────────────────────────────────────
router.post('/encode',  authenticate, authorize('Instructor', 'Admin'), encodeGrades);
router.post('/submit',  authenticate, authorize('Instructor', 'Admin'), submitGrades);

// ── INC workflow ─────────────────────────────────────────────────────────────
// Mark a student as INC
router.post('/inc',         authenticate, authorize('Instructor', 'Admin'), markAsINC);
// Resolve an INC once the student has complied
router.post('/inc/resolve', authenticate, authorize('Instructor', 'Admin'), resolveINC);
// List all INC grades (filtered by class or semester)
router.get('/inc',          authenticate, authorize('Instructor', 'Admin', 'Chairperson'), getINCList);

// ── Student-facing ───────────────────────────────────────────────────────────
router.get('/student/:studentId', authenticate, getStudentGrades);

// ── Admin / reports ──────────────────────────────────────────────────────────
router.get('/distribution', authenticate, authorize('Admin', 'Chairperson'), getGradeDistribution);
router.get('/recent',       authenticate, authorize('Admin', 'Chairperson', 'Instructor'), getRecentSubmissions);
router.get('/reports',      authenticate, authorize('Admin', 'Chairperson'), getReportData);

module.exports = router;