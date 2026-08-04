const router = require('express').Router();
const { getInstructorGradeReport, sendGradeReport, sendGradingSheet, forwardGradingSheetToAdmin, getChairpersonReport } = require('../controllers/reportController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/grades', authorize('Instructor'), getInstructorGradeReport);
router.post('/send', authorize('Instructor'), sendGradeReport);
router.post('/send-grading-sheet/:classId', authorize('Instructor', 'Admin'), sendGradingSheet);
router.post('/forward-grading-sheet/:classId', authorize('Chairperson'), forwardGradingSheetToAdmin);
router.get('/chairperson', authorize('Chairperson'), getChairpersonReport);

module.exports = router;
