const router = require('express').Router();
const { getSubjects, createSubject, updateSubject, deleteSubject } = require('../controllers/subjectController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', getSubjects);
// Only the Chairperson creates subjects for their own program(s) now — Faculty is
// read-only here (they just see the catalog once it exists). Admin keeps edit and
// delete, for cleanup of anything created in error, but not create.
router.post('/', authorize('Chairperson'), createSubject);
router.put('/:id', authorize('Admin', 'Chairperson'), updateSubject);
router.delete('/:id', authorize('Admin', 'Chairperson'), deleteSubject);

module.exports = router;
