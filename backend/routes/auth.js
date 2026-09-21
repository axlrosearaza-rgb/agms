const router = require('express').Router();
const { login, register, verifyEmail, resendVerificationCode, getMe, changeUsername, requestEmailChange, confirmEmailChange, verifyPassword, changePassword, acceptPrivacyPolicy, forgotPassword, resetPassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
router.post('/register', register);
router.post('/verify-email', verifyEmail);
router.post('/resend-verification-code', resendVerificationCode);
router.get('/me', authenticate, getMe);
router.put('/username', authenticate, changeUsername);
router.put('/email/request', authenticate, requestEmailChange);
router.put('/email/confirm', authenticate, confirmEmailChange);
router.post('/verify-password', authenticate, verifyPassword);
router.put('/password', authenticate, changePassword);
router.post('/accept-privacy', authenticate, acceptPrivacyPolicy);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;