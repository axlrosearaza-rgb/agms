const router = require('express').Router();
const { getAdviserSummary, getUsers, getUserById, createUser, checkStudentNos, updateUser, archiveUser, restoreUser, getUsersByDepartment, setAdvisory, importAdvisories, getMyAdvisory, importAdvisoryList, updateAdvisee, setRegularizationSubjects, getPresence } = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Ahead of the /:id catch-all below, or "presence" would be swallowed as an
// id param instead of reaching this handler. Any authenticated role (Admin,
// Chairperson, Faculty, Student alike) can check who's online — this is
// read-only presence, not account data.
router.get('/presence', getPresence);
router.get('/', authorize('Admin', 'Chairperson', 'Faculty'), getUsers);
// Faculty's own advisory section + its students (ahead of /:id, same reason
// as /presence).
router.get('/my-advisory', authorize('Faculty', 'Chairperson'), getMyAdvisory);
// The adviser imports their own section's class list.
router.post('/my-advisory/import', authorize('Faculty', 'Chairperson'), importAdvisoryList);
router.put('/my-advisory/students/:id', authorize('Faculty', 'Chairperson'), updateAdvisee);
router.get('/department/:department', authorize('Admin', 'Chairperson'), getUsersByDepartment);
// Every adviser's section at a glance (Admin dashboard). Before '/:id'.
router.get('/advisers/summary', authorize('Admin'), getAdviserSummary);
router.get('/:id', authorize('Admin', 'Chairperson', 'Faculty'), getUserById);
// Which Student ID Numbers already have an account — used while a class
// list is being reviewed (Faculty / teaching Chairperson) before import.
router.post('/check-student-nos', authorize('Admin', 'Faculty', 'Chairperson'), checkStudentNos);
// Whole adviser list from a Room Assignment-style document (Admin).
router.post('/advisories/import', authorize('Admin'), importAdvisories);
router.post('/', authorize('Admin', 'Chairperson'), createUser);
router.put('/:id', authorize('Admin', 'Chairperson', 'Faculty'), updateUser);
// Nothing is deleted — accounts are archived (and can be restored).
router.put('/:id/archive', authorize('Admin', 'Chairperson'), archiveUser);
router.put('/:id/restore', authorize('Admin', 'Chairperson'), restoreUser);
router.put('/:id/advisory', authorize('Admin'), setAdvisory);
router.put('/:id/regularization-subjects', authorize('Student'), setRegularizationSubjects);

module.exports = router;
