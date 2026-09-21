const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  conversation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'conversations', key: 'id' },
  },
  sender_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  body: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  // Set the moment the sender edits this message's own body — null means
  // never edited. The frontend shows a small "(edited)" marker whenever
  // this is set, same as most chat apps, so the other participant can tell
  // the text isn't exactly what was originally sent.
  edited_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Reserved: previously set by a shared "Unsend" that pulled a message back
  // for BOTH participants. That action was replaced by the per-user
  // `hidden_for` delete-for-me below (see chatController.deleteMessageForMe),
  // so nothing sets this anymore — kept only so any already-unsent rows from
  // before the change keep rendering their placeholder correctly.
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // "Delete for me" — the ids of users who have removed this message from
  // THEIR OWN view only (see chatController.deleteMessageForMe). Unlike the
  // old shared unsend above, this never touches `body` and never affects the
  // other participant: getMessages simply excludes any message whose
  // hidden_for already contains the requesting user's id. Either participant
  // can hide any message (their own or the other's) for themselves.
  hidden_for: {
    type: DataTypes.ARRAY(DataTypes.INTEGER),
    allowNull: false,
    defaultValue: [],
  },
  // Marks a message created by forwardMessage — lets the frontend show a
  // small "Forwarded" label instead of implying it was typed fresh in this
  // conversation.
  is_forwarded: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
}, {
  tableName: 'messages',
});

module.exports = Message;
