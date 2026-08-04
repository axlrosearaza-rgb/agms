const router = require('express').Router();
const {
  getContacts,
  getConversations,
  startConversation,
  getMessages,
  sendMessage,
  markConversationRead,
  toggleMute,
} = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/contacts', getContacts);
router.get('/conversations', getConversations);
router.post('/conversations', startConversation);
router.get('/conversations/:id/messages', getMessages);
router.post('/conversations/:id/messages', sendMessage);
router.put('/conversations/:id/read', markConversationRead);
router.put('/conversations/:id/mute', toggleMute);

module.exports = router;
