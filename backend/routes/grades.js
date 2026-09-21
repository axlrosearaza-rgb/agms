const express = require('express');
const router = express.Router();
const {
  getGradesByClass,
  encodeGrades,
  submitGrades,
  markAsINC,
  undoINC,
  markAsDRP,
  undoDRP,
  getINCList,
  getStudentGrades,
  getStudentProspectus,
  getGradeDistribution,
  getRecentSubmissions,
  getReportData,
  approveClassGrades,
  approveDocument,
  releaseClassGrades,
} = require('../controllers/gradeController');
const { authenticate, authorize } = require('../middleware/auth');
const { authorizeTeaching } = require('../utils/teachingAuth');

// ── Class grades (instructor / admin / chairperson) ──────────────────────────
router.get('/class/:classId', authenticate, authorize('Faculty', 'Admin', 'Chairperson'), getGradesByClass);

// ── Admin approval (registrar sign-off on Passed students, per class) ───────
router.post('/class/:classId/approve', authenticate, authorize('Admin'), approveClassGrades);
router.post('/class/:classId/approve-document', authenticate, authorize('Admin'), approveDocument);

// ── Release to students — gated on Chairperson verification + Admin approval,
// re-checked server-side in the controller regardless of who's calling.
router.post('/class/:classId/release', authenticate, authorizeTeaching('Faculty', 'Admin', 'Chairperson'), releaseClassGrades);

// ── Encode / submit grades ───────────────────────────────────────────────────
// authorizeTeaching also admits a Chairperson flagged is_teaching (own classes only).
router.post('/encode',  authenticate, authorizeTeaching('Faculty', 'Admin'), encodeGrades);
router.post('/submit',  authenticate, authorizeTeaching('Faculty', 'Admin'), submitGrades);

// ── INC workflow ─────────────────────────────────────────────────────────────
// Mark a student as INC
router.post('/inc',         authenticate, authorizeTeaching('Faculty', 'Admin'), markAsINC);
// Resolve an INC once the student has complied — back to blank/unsubmitted,
// so the real Midterm/Finals scores get encoded normally (no typed-GWA shortcut)
router.post('/inc/undo',    authenticate, authorizeTeaching('Faculty', 'Admin'), undoINC);
// List all INC grades (filtered by class or semester)
router.get('/inc',          authenticate, authorize('Faculty', 'Admin', 'Chairperson'), getINCList);

// ── DRP workflow ─────────────────────────────────────────────────────────────
// Mark a student as Dropped
router.post('/drp',         authenticate, authorizeTeaching('Faculty', 'Admin'), markAsDRP);
// Undo a mistaken Drop, back to a blank unsubmitted grade
router.post('/drp/undo',    authenticate, authorizeTeaching('Faculty', 'Admin'), undoDRP);

// ── Student-facing ───────────────────────────────────────────────────────────
router.get('/student/:studentId', authenticate, getStudentGrades);
router.get('/student/:studentId/prospectus', authenticate, getStudentProspectus);

// ── Admin / reports ──────────────────────────────────────────────────────────
router.get('/distribution', authenticate, authorize('Admin', 'Chairperson'), getGradeDistribution);
router.get('/recent',       authenticate, authorize('Admin', 'Chairperson', 'Faculty'), getRecentSubmissions);
router.get('/reports',      authenticate, authorize('Admin', 'Chairperson'), getReportData);

module.exports = router;