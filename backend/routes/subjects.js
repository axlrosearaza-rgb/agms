const router = require('express').Router();
const { getSubjects, createSubject, updateSubject, deleteSubject } = require('../controllers/subjectController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', getSubjects);
// Faculty/Chairperson create and maintain their own program's subjects now — Admin
// keeps visibility (read-only) plus delete, for cleanup of anything created in error.
router.post('/', authorize('Admin', 'Chairperson', 'Instructor'), createSubject);
router.put('/:id', authorize('Admin', 'Chairperson', 'Instructor'), updateSubject);
router.delete('/:id', authorize('Admin'), deleteSubject);

module.exports = router;
