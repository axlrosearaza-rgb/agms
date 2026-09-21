const router = require('express').Router();
const { getClasses, getClassById, createClass, updateClass, archiveClass, deleteClass, enrollStudents, getInstructorClasses, getEligibleStudents, getPendingApprovalCount } = require('../controllers/classController');
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
router.delete('/:id', authorizeTeaching('Admin', 'Faculty'), deleteClass);
router.post('/:id/enroll', authorizeTeaching('Admin', 'Faculty'), enrollStudents);
router.get('/:id/eligible-students', authorizeTeaching('Admin', 'Faculty'), getEligibleStudents);

module.exports = router;
