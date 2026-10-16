const router = require('express').Router();
const { getSubjects, updateSubject, archiveSubject, importSubjects, archiveCurriculum } = require('../controllers/subjectController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', getSubjects);
// Only the Admin changes subjects, and only in two ways: importing a
// curriculum and editing a subject. Subjects are not added one by one and are
// not archived by hand (an earlier curriculum stays on record for reference).
// Chairperson and Faculty are read-only here.
const notOffered = (what) => (req, res) => res.status(403).json({ message: what });
router.post('/', authorize('Admin'), notOffered('Subjects are added by importing a curriculum (Import Subjects), not one by one.'));
// A whole curriculum at once (the Subjects page's Import Subjects).
router.post('/import', authorize('Admin'), importSubjects);
// Archive / restore every subject of one program's curriculum — ahead of /:id.
// Restoring is still allowed, for anything archived earlier.
const restoreOnly = (req, res, next) => (req.body.archived === false ? next() : res.status(403).json({ message: 'Subjects and curricula are not archived — an earlier curriculum stays on record for reference.' }));
router.put('/curriculum/archive', authorize('Admin'), restoreOnly, archiveCurriculum);
router.put('/:id', authorize('Admin'), updateSubject);
// Nothing is deleted — subjects are archived (and can be restored).
router.put('/:id/archive', authorize('Admin'), restoreOnly, archiveSubject);

module.exports = router;
