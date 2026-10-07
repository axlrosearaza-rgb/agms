const router = require('express').Router();
const { login, updatePreferences, getMe, changeUsername, requestEmailChange, confirmEmailChange, verifyPassword, changePassword, setFirstPassword, acceptPrivacyPolicy, forgotPassword, resetPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
// No public self-registration — student accounts are created/imported by
// Admin (User Management).
router.get('/me', authenticate, getMe);
router.put('/username', authenticate, changeUsername);
router.put('/email/request', authenticate, requestEmailChange);
router.put('/email/confirm', authenticate, confirmEmailChange);
router.post('/verify-password', authenticate, verifyPassword);
router.put('/password', authenticate, changePassword);
router.post('/first-password', authenticate, setFirstPassword);
router.post('/accept-privacy', authenticate, acceptPrivacyPolicy);
// Own account preferences (e.g. the idle screen-lock time).
router.put('/preferences', authenticate, updatePreferences);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;