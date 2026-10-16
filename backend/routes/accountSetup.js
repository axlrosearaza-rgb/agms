const router = require('express').Router();
const { setPassword, requestEmailCode, confirmEmailCode, getStatusDeclaration, declareStatus, getClassConfirmations, answerClassConfirmation, getContacts, getRetakes, skipEmail } = require('../controllers/accountSetupController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate, authorize('Student'));

router.post('/password', setPassword);
router.post('/email/request', requestEmailCode);
router.post('/email/confirm', confirmEmailCode);
// The e-mail is optional — finish setup now, add it later in Settings.
router.post('/email/skip', skipEmail);
// Regular/Irregular + student type, declared once per semester.
router.get('/status', getStatusDeclaration);
router.post('/status', declareStatus);
router.get('/class-confirmations', getClassConfirmations);
router.get('/contacts', getContacts);
// Failed / INC / dropped subjects not yet passed or re-enrolled in.
router.get('/retakes', getRetakes);
router.post('/class-confirmations/:id', answerClassConfirmation);

module.exports = router;
