const router = require('express').Router();
const { getClasses, getClassById, createClass, updateClass, archiveClass, enrollStudents, unenrollStudent, getSectionStudents, importClassList, getInstructorClasses, getEligibleStudents, getPendingApprovalCount } = require('../controllers/classController');
const { authenticate, authorize } = require('../middleware/auth');
const { authorizeTeaching } = require('../utils/teachingAuth');

router.use(authenticate);

router.get('/', authorize('Admin', 'Chairperson'), getClasses);
// authorizeTeaching also admits a Chairperson flagged is_teaching, so a
// department chair who teaches can reach their own classes/grades here too.
router.get('/instructor/:instructorId', authorizeTeaching('Admin', 'Faculty'), getInstructorClasses);
// Ahead of the /:id catch-all below — "pending-approval-count" would
// otherwise be swallowed as an :id param and 404/500 against the DB.
router.get('/pending-approval-count', authorize('Admin', 'Chairperson'), getPendingApprovalCount);
// Students who said "No, not mine" about one of this instructor's classes —
// the dashboard warning, until dismissed (utils/classDisputes.js).
router.get('/disputes/mine', authorizeTeaching('Faculty'), async (req, res) => {
  res.json({ disputes: await require('../utils/classDisputes').openDisputesFor(req.user.id) });
});
router.post('/disputes/:disputeId/dismiss', authorizeTeaching('Faculty'), async (req, res) => {
  await require('../utils/classDisputes').dismissDispute(parseInt(req.params.disputeId, 10), req.user.id);
  res.json({ message: 'Dismissed.' });
});
router.get('/:id', getClassById);
router.post('/', authorizeTeaching('Admin', 'Faculty'), createClass);
router.put('/:id', authorizeTeaching('Admin', 'Faculty'), updateClass);
// Narrow enough (just the Active <-> Completed archive toggle) to open up to
// a plain Chairperson too — scoped to their own program(s) in the controller —
// unlike the general updateClass above, which stays Admin/Faculty(-teaching) only.
router.put('/:id/archive', authorizeTeaching('Admin', 'Chairperson', 'Faculty'), archiveClass);
// authorizeTeaching also admits a Chairperson flagged is_teaching — both are
// restricted to their OWN classes only (enforced in the controller), same as
// update/enroll above. Admin can still delete any class.
router.post('/:id/enroll', authorizeTeaching('Admin', 'Faculty'), enrollStudents);
router.delete('/:id/students/:studentId', authorizeTeaching('Admin', 'Faculty'), unenrollStudent);
router.get('/:id/section-students', authorizeTeaching('Admin', 'Faculty'), getSectionStudents);
// Faculty (or a teaching Chairperson) importing the class list of their own class.
router.post('/:id/import-class-list', authorizeTeaching('Faculty'), importClassList);
router.get('/:id/eligible-students', authorizeTeaching('Admin', 'Faculty'), getEligibleStudents);

module.exports = router;
