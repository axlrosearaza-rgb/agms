const router = require('express').Router();
const { login, register, getMe, changePassword } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', login);
router.post('/register', register);
router.get('/me', authenticate, getMe);
router.put('/password', authenticate, changePassword);

module.exports = router;