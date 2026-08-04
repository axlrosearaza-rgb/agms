const router = require('express').Router();
const {
  getEndorsements,
  getDepartmentStudents,
  endorseStudent,
  flagStudent,
  overrideEndorsement,
} = require('../controllers/endorsementController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', authorize('Admin', 'Chairperson'), getEndorsements);
router.get('/department-students', authorize('Chairperson'), getDepartmentStudents);
router.post('/endorse', authorize('Chairperson'), endorseStudent);
router.post('/flag', authorize('Chairperson'), flagStudent);
router.put('/override', authorize('Admin'), overrideEndorsement);

module.exports = router;