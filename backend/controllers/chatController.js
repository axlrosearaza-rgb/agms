const { Op } = require('sequelize');
const { Conversation, ConversationParticipant, Message, User } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { canMessage } = require('../utils/chatPermissions');
const { createNotification } = require('./notificationController');

const otherUserId = (conversation, myId) =>
  conversation.user_a_id === myId ? conversation.user_b_id : conversation.user_a_id;

// Loads a conversation and verifies the caller is one of its two participants
const loadOwnConversation = async (conversationId, userId) => {
  const conversation = await Conversation.findByPk(conversationId);
  if (!conversation) return null;
  if (conversation.user_a_id !== userId && conversation.user_b_id !== userId) return null;
  return conversation;
};

// GET /api/chat/contacts — users the caller is allowed to start a conversation with
const getContacts = asyncHandler(async (req, res) => {
  const STAFF_ROLES = ['Admin', 'Chairperson', 'Instructor'];
  let where;

  if (req.user.role === 'Student') {
    where = { role: 'Instructor', status: 'Active', programs: { [Op.contains]: [req.user.program] } };
  } else if (STAFF_ROLES.includes(req.user.role)) {
    where = { role: { [Op.in]: STAFF_ROLES }, status: 'Active', id: { [Op.ne]: req.user.id } };
  } else {
    return res.json({ contacts: [] });
  }

  const contacts = await User.findAll({ where, attributes: ['id', 'name', 'role', 'program', 'programs', 'avatar'], order: [['name', 'ASC']] });
  res.json({ contacts });
});

// GET /api/chat/conversations
const getConversations = asyncHandler(async (req, res) => {
  const myId = req.user.id;
  const conversations = await Conversation.findAll({
    where: { [Op.or]: [{ user_a_id: myId }, { user_b_id: myId }] },
    order: [['last_message_at', 'DESC']],
  });

  const result = await Promise.all(conversations.map(async (c) => {
    const otherId = otherUserId(c, myId);
    const [other, myParticipant, lastMessage, unreadCount] = await Promise.all([
      User.findByPk(otherId, { attributes: ['id', 'name', 'role', 'avatar'] }),
      ConversationParticipant.findOne({ where: { conversation_id: c.id, user_id: myId } }),
      Message.findOne({ where: { conversation_id: c.id }, order: [['created_at', 'DESC']] }),
      Message.count({ where: { conversation_id: c.id, sender_id: { [Op.ne]: myId }, is_read: false } }),
    ]);

    return {
      id: c.id,
      other_user: other,
      last_message: lastMessage ? { body: lastMessage.body, created_at: lastMessage.createdAt, sender_id: lastMessage.sender_id } : null,
      last_message_at: c.last_message_at,
      is_muted: myParticipant?.is_muted || false,
      unread_count: unreadCount,
    };
  }));

  res.json({ conversations: result });
});

// POST /api/chat/conversations  { targetUserId }
const startConversation = asyncHandler(async (req, res) => {
  const { targetUserId } = req.body;
  const myId = req.user.id;

  if (!targetUserId || parseInt(targetUserId) === myId) {
    return res.status(400).json({ message: 'A valid target user is required.' });
  }

  const target = await User.findByPk(targetUserId);
  if (!target || target.status !== 'Active') {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (!canMessage(req.user.role, target.role)) {
    return res.status(403).json({ message: 'You are not allowed to message this user.' });
  }

  const userAId = Math.min(myId, target.id);
  const userBId = Math.max(myId, target.id);

  const [conversation] = await Conversation.findOrCreate({
    where: { user_a_id: userAId, user_b_id: userBId },
    defaults: { user_a_id: userAId, user_b_id: userBId },
  });

  await Promise.all([
    ConversationParticipant.findOrCreate({ where: { conversation_id: conversation.id, user_id: myId } }),
    ConversationParticipant.findOrCreate({ where: { conversation_id: conversation.id, user_id: target.id } }),
  ]);

  res.json({
    conversation: {
      id: conversation.id,
      other_user: { id: target.id, name: target.name, role: target.role, avatar: target.avatar },
    },
  });
});

// GET /api/chat/conversations/:id/messages?before=<messageId>
const getMessages = asyncHandler(async (req, res) => {
  const conversation = await loadOwnConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  const { before } = req.query;
  const where = { conversation_id: conversation.id };
  if (before) where.id = { [Op.lt]: parseInt(before) };

  const messages = await Message.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: 50,
  });

  const shaped = messages.reverse().map((m) => ({
    id: m.id,
    conversation_id: m.conversation_id,
    sender_id: m.sender_id,
    body: m.body,
    is_read: m.is_read,
    created_at: m.createdAt,
  }));

  res.json({ messages: shaped });
});

// POST /api/chat/conversations/:id/messages  { body }
const sendMessage = asyncHandler(async (req, res) => {
  const conversation = await loadOwnConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ message: 'Message body is required.' });

  const message = await Message.create({ conversation_id: conversation.id, sender_id: req.user.id, body: body.trim() });
  conversation.last_message_at = message.createdAt;
  await conversation.save();

  const shapedMessage = {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_id: message.sender_id,
    body: message.body,
    is_read: message.is_read,
    created_at: message.createdAt,
  };

  const recipientId = otherUserId(conversation, req.user.id);
  const io = req.app.get('io');

  const payload = { conversationId: conversation.id, message: shapedMessage };
  if (io) {
    io.to(`user:${recipientId}`).emit('chat:message', payload);
    io.to(`user:${req.user.id}`).emit('chat:conversationUpdate', { conversationId: conversation.id });
    io.to(`user:${recipientId}`).emit('chat:conversationUpdate', { conversationId: conversation.id });
  }

  const recipientParticipant = await ConversationParticipant.findOne({ where: { conversation_id: conversation.id, user_id: recipientId } });
  if (!recipientParticipant?.is_muted) {
    await createNotification(req.app, {
      userId: recipientId,
      title: `New message from ${req.user.name}`,
      message: body.trim().slice(0, 140),
      type: 'chat',
      link: '/messages',
    });
  }

  res.status(201).json({ message: shapedMessage });
});

// PUT /api/chat/conversations/:id/read
const markConversationRead = asyncHandler(async (req, res) => {
  const conversation = await loadOwnConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  await Promise.all([
    Message.update({ is_read: true }, { where: { conversation_id: conversation.id, sender_id: { [Op.ne]: req.user.id }, is_read: false } }),
    ConversationParticipant.update(
      { last_read_at: new Date() },
      { where: { conversation_id: conversation.id, user_id: req.user.id } }
    ),
  ]);

  res.json({ message: 'Marked as read.' });
});

// PUT /api/chat/conversations/:id/mute  { muted }
const toggleMute = asyncHandler(async (req, res) => {
  const conversation = await loadOwnConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  await ConversationParticipant.update(
    { is_muted: !!req.body.muted },
    { where: { conversation_id: conversation.id, user_id: req.user.id } }
  );

  res.json({ message: req.body.muted ? 'Conversation muted.' : 'Conversation unmuted.' });
});

module.exports = { getContacts, getConversations, startConversation, getMessages, sendMessage, markConversationRead, toggleMute };
