const router = require('express').Router();
const { getUsers, getUserById, createUser, updateUser, deleteUser, getUsersByDepartment, getPendingStudents, setRegularizationSubjects, getPresence } = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Ahead of the /:id catch-all below, or "presence" would be swallowed as an
// id param instead of reaching this handler. Any authenticated role (Admin,
// Chairperson, Faculty, Student alike) can check who's online — this is
// read-only presence, not account data.
router.get('/presence', getPresence);
router.get('/', authorize('Admin', 'Chairperson', 'Faculty'), getUsers);
router.get('/pending', authorize('Admin', 'Chairperson', 'Faculty'), getPendingStudents);
router.get('/department/:department', authorize('Admin', 'Chairperson'), getUsersByDepartment);
router.get('/:id', authorize('Admin', 'Chairperson', 'Faculty'), getUserById);
router.post('/', authorize('Admin', 'Chairperson'), createUser);
router.put('/:id', authorize('Admin', 'Chairperson', 'Faculty'), updateUser);
router.delete('/:id', authorize('Admin', 'Chairperson'), deleteUser);
router.put('/:id/regularization-subjects', authorize('Student'), setRegularizationSubjects);

module.exports = router;
