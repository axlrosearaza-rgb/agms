const router = require('express').Router();
const { getUsers, getUserById, createUser, updateUser, deactivateUser, getUsersByDepartment, getPendingStudents } = require('../controllers/userController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', authorize('Admin', 'Chairperson', 'Instructor'), getUsers);
router.get('/pending', authorize('Admin', 'Instructor'), getPendingStudents);
router.get('/department/:department', authorize('Admin', 'Chairperson'), getUsersByDepartment);
router.get('/:id', authorize('Admin', 'Chairperson', 'Instructor'), getUserById);
router.post('/', authorize('Admin', 'Chairperson'), createUser);
router.put('/:id', authorize('Admin', 'Chairperson', 'Instructor'), updateUser);
router.delete('/:id', authorize('Admin', 'Chairperson'), deactivateUser);

module.exports = router;
