const router = require('express').Router();
const { getInstructorGradeReport, sendGradeReport, sendGradingSheet, forwardGradingSheetToAdmin, verifyDocument, returnToChairperson, returnToFaculty, sendApprovedGradeSheet, getAdminGradesReport, getChairpersonReport } = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');
const { authorizeTeaching } = require('../utils/teachingAuth');

router.use(authenticate);

router.get('/grades', authorize('Faculty'), getInstructorGradeReport);
router.post('/send', authorize('Faculty'), sendGradeReport);
// authorizeTeaching also admits a Chairperson flagged is_teaching (own
// classes only, enforced in the controller) — same pattern as the grade-
// components/grades/classes routes.
router.post('/send-grading-sheet/:classId', authorizeTeaching('Faculty', 'Admin'), sendGradingSheet);
router.post('/forward-grading-sheet/:classId', authorize('Chairperson'), forwardGradingSheetToAdmin);
router.post('/verify-document/:classId', authorize('Chairperson'), verifyDocument);
router.post('/return-to-chairperson/:classId', authorize('Admin'), returnToChairperson);
router.post('/return-to-faculty/:classId', authorize('Chairperson'), returnToFaculty);
router.post('/send-approved-grade-sheet/:classId', authorize('Admin'), sendApprovedGradeSheet);
router.get('/admin', authorize('Admin'), getAdminGradesReport);
router.get('/chairperson', authorize('Chairperson'), getChairpersonReport);

module.exports = router;
