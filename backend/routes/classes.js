const router = require('express').Router();
const { getClasses, getClassById, createClass, updateClass, deleteClass, enrollStudents, getInstructorClasses } = require('../controllers/classController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', authorize('Admin', 'Chairperson'), getClasses);
router.get('/instructor/:instructorId', authorize('Admin', 'Instructor'), getInstructorClasses);
router.get('/:id', getClassById);
router.post('/', authorize('Admin', 'Instructor'), createClass);
router.put('/:id', authorize('Admin', 'Instructor'), updateClass);
router.delete('/:id', authorize('Admin'), deleteClass);
router.post('/:id/enroll', authorize('Admin', 'Instructor'), enrollStudents);

module.exports = router;
