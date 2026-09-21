const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Conversation, ConversationParticipant, Message, User, Class, Subject, Enrollment } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');
const { canMessage } = require('../utils/chatPermissions');
const { createNotification } = require('./notificationController');

const otherUserId = (conversation, myId) =>
  conversation.user_a_id === myId ? conversation.user_b_id : conversation.user_a_id;

// "Not hidden-for-me" filter for messages.hidden_for (an ARRAY(INTEGER) —
// see models/Message.js). Nesting `{ [Op.not]: { [Op.contains]: [...] } }`
// directly in a `where` crashes Sequelize's ARRAY escaping (it tries to
// stringify the whole `{ [Op.contains]: [...] }` object as the array value
// instead of recursing into it), so this builds the `NOT (col @> ARRAY[...])`
// SQL by hand instead. userId is always an authenticated req.user.id — a
// real integer, never user-supplied text — so straight interpolation here
// is safe.
const notHiddenFor = (userId) => sequelize.literal(`NOT ("hidden_for" @> ARRAY[${parseInt(userId, 10)}]::integer[])`);

// Loads a conversation and verifies the caller is one of its two participants
const loadOwnConversation = async (conversationId, userId) => {
  const conversation = await Conversation.findByPk(conversationId);
  if (!conversation) return null;
  if (conversation.user_a_id !== userId && conversation.user_b_id !== userId) return null;
  return conversation;
};

// Shared wire shape for a Message row — every endpoint that returns one
// (getMessages, sendMessage, editMessage, forwardMessage) uses this so the
// frontend only ever has to handle one shape. `hidden_for` is deliberately
// left off — it's a private per-user list, not something either side's
// client needs to see (getMessages already filters hidden rows out before
// they're ever shaped).
const shapeMessage = (m) => ({
  id: m.id,
  conversation_id: m.conversation_id,
  sender_id: m.sender_id,
  body: m.body,
  is_read: m.is_read,
  created_at: m.createdAt,
  edited_at: m.edited_at,
  deleted_at: m.deleted_at,
  is_forwarded: m.is_forwarded,
});

// Shared by sendMessage/sendSystemMessage/forwardMessage — everything that
// happens once a new Message row actually exists: bump the conversation,
// un-hide it for both sides, push it live over Socket.IO, and notify the
// recipient (unless muted). Pulled out so the three call sites can't drift
// out of sync with each other on any of these side effects.
const deliverMessage = async (app, conversation, message, { senderId, senderName, notifyTitle }) => {
  conversation.last_message_at = message.createdAt;
  // Independent writes — run together instead of one after the other, since
  // neither depends on the other's result.
  await Promise.all([
    conversation.save(),
    ConversationParticipant.update(
      { deleted_at: null },
      { where: { conversation_id: conversation.id, deleted_at: { [Op.ne]: null } } }
    ),
  ]);

  const shapedMessage = shapeMessage(message);
  const recipientId = otherUserId(conversation, senderId);
  const io = app.get('io');
  const payload = { conversationId: conversation.id, message: shapedMessage };
  if (io) {
    io.to(`user:${recipientId}`).emit('chat:message', payload);
    io.to(`user:${senderId}`).emit('chat:conversationUpdate', { conversationId: conversation.id });
    io.to(`user:${recipientId}`).emit('chat:conversationUpdate', { conversationId: conversation.id });
  }

  // Fire-and-forget — the recipient already has the message live over the
  // socket emit above, and the sender's own response doesn't need to wait on
  // this notification-bell INSERT + emit too. Runs after we return, not
  // before.
  (async () => {
    try {
      const recipientParticipant = await ConversationParticipant.findOne({ where: { conversation_id: conversation.id, user_id: recipientId } });
      if (recipientParticipant?.is_muted) return;
      // Messages lives at a role-prefixed route for every role (App.js) —
      // there is no bare `/messages` route, so that used to be a dead link
      // every time this notification was clicked.
      const recipient = await User.findByPk(recipientId, { attributes: ['role'] });
      await createNotification(app, {
        userId: recipientId,
        title: notifyTitle || `New message from ${senderName}`,
        message: message.body.trim().slice(0, 140),
        type: 'chat',
        link: `/${(recipient?.role || 'student').toLowerCase()}/messages`,
      });
    } catch (err) {
      console.error('Failed to create chat notification:', err);
    }
  })();

  return shapedMessage;
};

const CONTACT_ATTRS = ['id', 'name', 'role', 'program', 'programs', 'avatar', 'employment_type'];

// GET /api/chat/contacts — users the caller is allowed to start a
// conversation with, mirroring chatPermissions.canMessage's own rules
// exactly (same relationships, same "actual class in common" scoping —
// see that file's own comment for the full picture) so the contact picker
// never offers someone a message would then get rejected against.
const getContacts = asyncHandler(async (req, res) => {
  let contacts = [];

  if (req.user.role === 'Admin') {
    contacts = await User.findAll({
      where: { role: 'Chairperson', status: 'Active' },
      attributes: CONTACT_ATTRS,
    });
  } else if (req.user.role === 'Chairperson') {
    const [admins, faculty, students] = await Promise.all([
      User.findAll({ where: { role: 'Admin', status: 'Active' }, attributes: CONTACT_ATTRS }),
      User.findAll({
        where: { role: 'Faculty', status: 'Active' },
        attributes: CONTACT_ATTRS,
        include: [{
          model: Class,
          as: 'taught_classes',
          required: true,
          where: { status: 'Active' },
          attributes: [],
          include: [{ model: Subject, as: 'subject', where: { program: { [Op.in]: req.user.programs || [] } }, attributes: [] }],
        }],
      }),
      // Students actually enrolled in an Active class under one of this
      // Chairperson's own programs — mirrors chatPermissions.canMessage's
      // studentEnrolledUnderChairperson exactly (scoped by the class's
      // SUBJECT program, not by matching the student's own `program` tag),
      // so nobody shows up here that a startConversation call would reject.
      (req.user.programs || []).length === 0 ? [] : User.findAll({
        where: { role: 'Student', status: 'Active' },
        attributes: CONTACT_ATTRS,
        include: [{
          model: Class,
          as: 'enrolled_classes',
          required: true,
          where: { status: 'Active' },
          attributes: [],
          include: [{ model: Subject, as: 'subject', where: { program: { [Op.in]: req.user.programs || [] } }, attributes: [] }],
        }],
      }),
    ]);
    contacts = [...admins, ...faculty, ...students];
  } else if (req.user.role === 'Faculty') {
    const myPrograms = (
      await Class.findAll({
        where: { instructor_id: req.user.id, status: 'Active' },
        include: [{ model: Subject, as: 'subject', attributes: ['program'] }],
      })
    ).map((c) => c.subject?.program).filter(Boolean);

    const [chairpersons, students] = await Promise.all([
      myPrograms.length === 0 ? [] : User.findAll({
        where: { role: 'Chairperson', status: 'Active', programs: { [Op.overlap]: myPrograms } },
        attributes: CONTACT_ATTRS,
      }),
      // Students actually enrolled in one of THIS Faculty's own Active
      // classes — via the same student <-> Class (through Enrollment)
      // association Class.students/User.enrolled_classes already use
      // elsewhere, not a fresh join.
      User.findAll({
        where: { role: 'Student', status: 'Active' },
        attributes: CONTACT_ATTRS,
        include: [{
          model: Class,
          as: 'enrolled_classes',
          required: true,
          where: { instructor_id: req.user.id, status: 'Active' },
          attributes: [],
        }],
      }),
    ]);
    contacts = [...chairpersons, ...students];
  } else if (req.user.role === 'Student') {
    const classIds = (
      await Enrollment.findAll({ where: { student_id: req.user.id }, attributes: ['class_id'] })
    ).map((e) => e.class_id);

    contacts = classIds.length === 0 ? [] : await User.findAll({
      where: { role: 'Faculty', status: 'Active' },
      attributes: CONTACT_ATTRS,
      include: [{
        model: Class,
        as: 'taught_classes',
        required: true,
        where: { id: { [Op.in]: classIds }, status: 'Active' },
        attributes: [],
      }],
    });
  }

  // De-dupe (e.g. a Faculty could otherwise appear once per matching class
  // via the join above) and drop the caller themselves if they ever
  // slipped in, then sort for a stable, readable contact list.
  const seen = new Set();
  const deduped = contacts.filter((c) => {
    if (c.id === req.user.id || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  deduped.sort((a, b) => a.name.localeCompare(b.name));

  res.json({ contacts: deduped });
});

// GET /api/chat/conversations
const getConversations = asyncHandler(async (req, res) => {
  const myId = req.user.id;
  const conversations = await Conversation.findAll({
    where: { [Op.or]: [{ user_a_id: myId }, { user_b_id: myId }] },
    order: [['last_message_at', 'DESC']],
  });

  // Deleting a conversation only hides it from the deleter's own list (their
  // own ConversationParticipant.deleted_at) — skip any conversation the
  // caller has deleted, unless sendMessage already cleared it back out for new activity.
  const myParticipants = await ConversationParticipant.findAll({ where: { conversation_id: { [Op.in]: conversations.map((c) => c.id) }, user_id: myId } });
  const deletedConversationIds = new Set(myParticipants.filter((p) => p.deleted_at).map((p) => p.conversation_id));
  const visibleConversations = conversations.filter((c) => !deletedConversationIds.has(c.id));

  const result = await Promise.all(visibleConversations.map(async (c) => {
    const otherId = otherUserId(c, myId);
    const [other, myParticipant] = await Promise.all([
      User.findByPk(otherId, { attributes: ['id', 'name', 'role', 'avatar'] }),
      ConversationParticipant.findOne({ where: { conversation_id: c.id, user_id: myId } }),
    ]);

    // "Delete for me" permanently erases everything at or before
    // cleared_before from THIS user's own view — the preview and unread
    // count shown here must never resurrect pre-deletion content, even once
    // new activity has brought the conversation back into the visible list.
    const clearedBefore = myParticipant?.cleared_before;
    // Same per-message "delete for me" exclusion getMessages applies — a
    // message the caller individually hid must not surface here as the
    // preview either, even though it's still the true last message overall.
    const messageScope = {
      conversation_id: c.id,
      [Op.and]: [notHiddenFor(myId)],
      ...(clearedBefore ? { created_at: { [Op.gt]: clearedBefore } } : {}),
    };

    const [lastMessage, unreadCount] = await Promise.all([
      Message.findOne({ where: messageScope, order: [['created_at', 'DESC']] }),
      Message.count({ where: { ...messageScope, sender_id: { [Op.ne]: myId }, is_read: false } }),
    ]);

    return {
      id: c.id,
      other_user: other,
      // `deleted_at` carried through so the list preview can tell "last
      // message was unsent" (blank body, but a real message exists) apart
      // from "no messages at all yet" (lastMessage itself is null).
      last_message: lastMessage ? { body: lastMessage.body, created_at: lastMessage.createdAt, sender_id: lastMessage.sender_id, deleted_at: lastMessage.deleted_at } : null,
      last_message_at: c.last_message_at,
      is_muted: myParticipant?.is_muted || false,
      unread_count: unreadCount,
    };
  }));

  res.json({ conversations: result });
});

// GET /api/chat/unread-count — sidebar "Messages" badge: total unread across
// every conversation, not scoped to any one thread. A single COUNT instead
// of getConversations' full per-conversation breakdown (other_user, last
// message, mute state, ...), which is far more than a badge needs.
const getUnreadCount = asyncHandler(async (req, res) => {
  const myId = req.user.id;
  const conversations = await Conversation.findAll({
    where: { [Op.or]: [{ user_a_id: myId }, { user_b_id: myId }] },
    attributes: ['id'],
  });
  const conversationIds = conversations.map((c) => c.id);
  if (conversationIds.length === 0) return res.json({ count: 0 });

  // Same "deleted only hides it from the deleter's own list" rule
  // getConversations applies — a conversation the caller deleted shouldn't
  // pad this count even if the other side sent something into it since.
  const myParticipants = await ConversationParticipant.findAll({
    where: { conversation_id: { [Op.in]: conversationIds }, user_id: myId },
  });
  const deletedIds = new Set(myParticipants.filter((p) => p.deleted_at).map((p) => p.conversation_id));
  const visibleIds = conversationIds.filter((id) => !deletedIds.has(id));
  const clearedBeforeById = new Map(myParticipants.filter((p) => p.cleared_before).map((p) => [p.conversation_id, p.cleared_before]));

  // Same "delete for me" erasure getConversations applies per-conversation —
  // messages at or before the caller's own cleared_before watermark for that
  // conversation must never count toward this badge either.
  const count = visibleIds.length === 0 ? 0 : (await Promise.all(visibleIds.map((id) => {
    const clearedBefore = clearedBeforeById.get(id);
    return Message.count({
      where: {
        conversation_id: id,
        sender_id: { [Op.ne]: myId },
        is_read: false,
        [Op.and]: [notHiddenFor(myId)],
        ...(clearedBefore ? { created_at: { [Op.gt]: clearedBefore } } : {}),
      },
    });
  }))).reduce((sum, n) => sum + n, 0);
  res.json({ count });
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

  if (!(await canMessage(req.user, target))) {
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

  // If the caller had previously deleted this conversation (soft-delete —
  // deleteConversation only ever sets THEIR OWN deleted_at, never the other
  // side's), re-opening it here has to actually un-hide it for them again
  // immediately. Previously this only got cleared inside sendMessage, which
  // meant re-starting an old conversation looked like it worked (a valid id
  // came back, messages even loaded) but getConversations kept filtering it
  // out — so the freshly "opened" conversation was invisible in the list
  // the UI looks it up from, and the chat pane rendered as if nothing were
  // selected at all.
  await ConversationParticipant.update(
    { deleted_at: null },
    { where: { conversation_id: conversation.id, user_id: myId, deleted_at: { [Op.ne]: null } } }
  );

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

  // Content the caller has "deleted for me" stays gone permanently, even
  // after new activity resurfaces the conversation in their list — only
  // messages sent strictly after their own cleared_before watermark are
  // ever visible to them again. The other participant's own request never
  // carries this filter, since it reads their own row, not this one.
  const myParticipant = await ConversationParticipant.findOne({ where: { conversation_id: conversation.id, user_id: req.user.id } });
  if (myParticipant?.cleared_before) {
    where.created_at = { ...(where.created_at || {}), [Op.gt]: myParticipant.cleared_before };
  }

  // Per-message "delete for me" — a message the caller individually hid
  // (see deleteMessageForMe) never comes back for them, even though the
  // other participant still sees it untouched.
  where[Op.and] = [notHiddenFor(req.user.id)];

  const messages = await Message.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: 50,
  });

  const shaped = messages.reverse().map(shapeMessage);

  res.json({ messages: shaped });
});

// Injects a real chat message on behalf of a system action (e.g. a
// Chairperson/Admin returning a class record or grade sheet for revision) so
// the recipient actually sees it sitting in their Messages inbox — not just
// a bell notification that's easy to miss. Reuses the exact same
// conversation the two would get from starting one normally (findOrCreate,
// not create — repeat returns land in the SAME thread instead of spawning a
// new one each time) and mirrors sendMessage's side effects (conversation
// bump, un-hiding for both sides, socket push, notification) so it behaves
// identically to the sender having typed it by hand. No canMessage check —
// the action that triggers this (returning THIS instructor's own class)
// already proves the relationship; the two users don't need to separately
// qualify under the general messaging-permission rules.
const sendSystemMessage = async (app, { fromUserId, toUserId, body }) => {
  if (!fromUserId || !toUserId || fromUserId === toUserId || !body || !body.trim()) return null;

  const userAId = Math.min(fromUserId, toUserId);
  const userBId = Math.max(fromUserId, toUserId);
  const [conversation] = await Conversation.findOrCreate({
    where: { user_a_id: userAId, user_b_id: userBId },
    defaults: { user_a_id: userAId, user_b_id: userBId },
  });

  await Promise.all([
    ConversationParticipant.findOrCreate({ where: { conversation_id: conversation.id, user_id: fromUserId } }),
    ConversationParticipant.findOrCreate({ where: { conversation_id: conversation.id, user_id: toUserId } }),
  ]);

  // Bring the thread back into view for both sides, same as a real send —
  // whichever of them had deleted it shouldn't miss this because it's
  // sitting hidden. Content erasure (cleared_before) is untouched either way.
  await ConversationParticipant.update(
    { deleted_at: null },
    { where: { conversation_id: conversation.id, deleted_at: { [Op.ne]: null } } }
  );

  const message = await Message.create({ conversation_id: conversation.id, sender_id: fromUserId, body: body.trim() });
  const senderName = (await User.findByPk(fromUserId, { attributes: ['name'] }))?.name || 'System';
  return deliverMessage(app, conversation, message, { senderId: fromUserId, senderName });
};

// POST /api/chat/conversations/:id/messages  { body }
const sendMessage = asyncHandler(async (req, res) => {
  const conversation = await loadOwnConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ message: 'Message body is required.' });

  const message = await Message.create({ conversation_id: conversation.id, sender_id: req.user.id, body: body.trim() });
  const shapedMessage = await deliverMessage(req.app, conversation, message, { senderId: req.user.id, senderName: req.user.name });

  res.status(201).json({ message: shapedMessage });
});

// Loads a message and verifies the caller actually SENT it (not just a
// participant in its conversation) — edit is a sender-only action, unlike
// delete-for-me/delete-conversation/forward which either participant can do
// regardless of who sent the message.
const loadOwnMessage = async (messageId, userId) => {
  const message = await Message.findByPk(messageId);
  if (!message || message.sender_id !== userId) return null;
  if (message.deleted_at) return null; // already unsent (legacy) — nothing left to edit
  return message;
};

// Loads a message and verifies the caller is a participant of ITS
// conversation — used by deleteMessageForMe, which either side can invoke
// on any message (their own or the other's) since it only ever touches the
// caller's own view.
const loadMessageForParticipant = async (messageId, userId) => {
  const message = await Message.findByPk(messageId);
  if (!message) return null;
  const conversation = await loadOwnConversation(message.conversation_id, userId);
  if (!conversation) return null;
  return { message, conversation };
};

// PUT /api/chat/messages/:id  { body }
const editMessage = asyncHandler(async (req, res) => {
  const message = await loadOwnMessage(req.params.id, req.user.id);
  if (!message) return res.status(404).json({ message: 'Message not found.' });

  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ message: 'Message body is required.' });

  message.body = body.trim();
  message.edited_at = new Date();
  await message.save();

  const conversation = await Conversation.findByPk(message.conversation_id);
  const shapedMessage = shapeMessage(message);
  const recipientId = otherUserId(conversation, req.user.id);
  const io = req.app.get('io');
  if (io) {
    const payload = { conversationId: conversation.id, message: shapedMessage };
    io.to(`user:${req.user.id}`).emit('chat:messageUpdated', payload);
    io.to(`user:${recipientId}`).emit('chat:messageUpdated', payload);
  }

  res.json({ message: shapedMessage });
});

// DELETE /api/chat/messages/:id/unsend — sender-only. Unlike
// deleteMessageForMe below (which only hides a message from the CALLER's
// own view), this actually pulls the message back for BOTH participants —
// the historical "Unsend" behavior Message.js's own `deleted_at` column was
// originally built for (see that model's comment) and that getMessages/
// getConversations/shapeMessage already know how to render as a "This
// message was unsent" placeholder; nothing else needs to change to
// support it coming back. loadOwnMessage already refuses an already-
// unsent message (nothing left to unsend twice).
const unsendMessage = asyncHandler(async (req, res) => {
  const message = await loadOwnMessage(req.params.id, req.user.id);
  if (!message) return res.status(404).json({ message: 'Message not found.' });

  message.deleted_at = new Date();
  await message.save();

  const conversation = await Conversation.findByPk(message.conversation_id);
  const shapedMessage = shapeMessage(message);
  const recipientId = otherUserId(conversation, req.user.id);
  const io = req.app.get('io');
  if (io) {
    // Both sides get it — reuses 'chat:messageUpdated' (same event editMessage
    // already emits to both), which the frontend already handles by
    // replacing that bubble in place; the message's own deleted_at is what
    // then flips it to the "unsent" placeholder for either participant.
    const payload = { conversationId: conversation.id, message: shapedMessage };
    io.to(`user:${req.user.id}`).emit('chat:messageUpdated', payload);
    io.to(`user:${recipientId}`).emit('chat:messageUpdated', payload);
  }

  res.json({ message: shapedMessage });
});

// DELETE /api/chat/messages/:id — "Delete for me": removes the message from
// ONLY the caller's own view (like delete-conversation's per-user
// cleared_before erasure, just scoped to one message instead of a whole
// thread). Either participant can do this to any message, own or received.
// The row, its body, and the other participant's copy are all completely
// untouched — they never see it disappear, unlike the old shared "Unsend".
const deleteMessageForMe = asyncHandler(async (req, res) => {
  const loaded = await loadMessageForParticipant(req.params.id, req.user.id);
  if (!loaded) return res.status(404).json({ message: 'Message not found.' });
  const { message } = loaded;

  if (!message.hidden_for.includes(req.user.id)) {
    message.hidden_for = [...message.hidden_for, req.user.id];
    await message.save();
  }

  // Only the caller needs to know — nothing changed for the other side, so
  // no socket event goes to them. This just lets the caller's other open
  // tabs/devices drop it from their view too.
  const io = req.app.get('io');
  if (io) {
    io.to(`user:${req.user.id}`).emit('chat:messageDeleted', { conversationId: message.conversation_id, messageId: message.id });
  }

  res.json({ message: 'Message deleted.' });
});

// POST /api/chat/messages/:id/forward  { targetUserId }
// Re-sends an existing message's content into a (possibly brand new)
// conversation with someone else. Either participant of the ORIGINAL
// conversation can forward from it (not sender-only, unlike edit/unsend —
// forwarding something someone sent you is the normal case), but the
// canMessage check on the TARGET still applies same as starting a fresh
// conversation — forwarding is not a backdoor around the messaging
// permission rules.
const forwardMessage = asyncHandler(async (req, res) => {
  const original = await Message.findByPk(req.params.id);
  if (!original || original.deleted_at) return res.status(404).json({ message: 'Message not found.' });

  const sourceConversation = await loadOwnConversation(original.conversation_id, req.user.id);
  if (!sourceConversation) return res.status(404).json({ message: 'Message not found.' });

  const { targetUserId } = req.body;
  if (!targetUserId || parseInt(targetUserId) === req.user.id) {
    return res.status(400).json({ message: 'A valid target user is required.' });
  }

  const target = await User.findByPk(targetUserId);
  if (!target || target.status !== 'Active') {
    return res.status(404).json({ message: 'User not found.' });
  }
  if (!(await canMessage(req.user, target))) {
    return res.status(403).json({ message: 'You are not allowed to message this user.' });
  }

  const userAId = Math.min(req.user.id, target.id);
  const userBId = Math.max(req.user.id, target.id);
  const [targetConversation] = await Conversation.findOrCreate({
    where: { user_a_id: userAId, user_b_id: userBId },
    defaults: { user_a_id: userAId, user_b_id: userBId },
  });
  await Promise.all([
    ConversationParticipant.findOrCreate({ where: { conversation_id: targetConversation.id, user_id: req.user.id } }),
    ConversationParticipant.findOrCreate({ where: { conversation_id: targetConversation.id, user_id: target.id } }),
  ]);

  const forwarded = await Message.create({
    conversation_id: targetConversation.id,
    sender_id: req.user.id,
    body: original.body,
    is_forwarded: true,
  });
  const shapedMessage = await deliverMessage(req.app, targetConversation, forwarded, { senderId: req.user.id, senderName: req.user.name });

  res.status(201).json({ message: shapedMessage, conversation: { id: targetConversation.id, other_user: { id: target.id, name: target.name, role: target.role, avatar: target.avatar } } });
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

// DELETE /api/chat/conversations/:id — hides it from the caller's own list
// (deleted_at, on just their ConversationParticipant row) AND permanently
// erases the existing message content from their own view (cleared_before,
// a one-way watermark — see the model's comment). The other participant's
// copy, and the actual Message rows, are completely untouched — this is a
// per-user "delete for me", not a shared/destructive delete. A new message
// from either side clears deleted_at and brings the conversation back to the
// list, but cleared_before never resets, so only messages sent AFTER this
// point ever become visible to the deleter again.
const deleteConversation = asyncHandler(async (req, res) => {
  const conversation = await loadOwnConversation(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

  const now = new Date();
  await ConversationParticipant.update(
    { deleted_at: now, cleared_before: now },
    { where: { conversation_id: conversation.id, user_id: req.user.id } }
  );

  res.json({ message: 'Conversation deleted.' });
});

module.exports = { getContacts, getConversations, getUnreadCount, startConversation, getMessages, sendMessage, sendSystemMessage, editMessage, unsendMessage, deleteMessageForMe, forwardMessage, markConversationRead, toggleMute, deleteConversation };
