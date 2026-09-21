const router = require('express').Router();
const {
  getContacts,
  getConversations,
  getUnreadCount,
  startConversation,
  getMessages,
  sendMessage,
  editMessage,
  unsendMessage,
  deleteMessageForMe,
  forwardMessage,
  markConversationRead,
  toggleMute,
  deleteConversation,
} = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/contacts', getContacts);
router.get('/conversations', getConversations);
// Ahead of any /conversations/:id route below — not actually a conflict
// here since this is its own top-level path, but kept beside its sibling
// GETs for visibility.
router.get('/unread-count', getUnreadCount);
router.post('/conversations', startConversation);
router.get('/conversations/:id/messages', getMessages);
router.post('/conversations/:id/messages', sendMessage);
// /messages/:id routes — ahead of /conversations/:id below, own top-level
// path, same as /unread-count above.
router.put('/messages/:id', editMessage);
router.delete('/messages/:id/unsend', unsendMessage);
router.delete('/messages/:id', deleteMessageForMe);
router.post('/messages/:id/forward', forwardMessage);
router.put('/conversations/:id/read', markConversationRead);
router.put('/conversations/:id/mute', toggleMute);
router.delete('/conversations/:id', deleteConversation);

module.exports = router;
