const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ConversationParticipant = sequelize.define('ConversationParticipant', {
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
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  is_muted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  last_read_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // "Delete conversation" is per-user, not shared — hides it from just this
  // participant's own CONVERSATION LIST (the other participant's view is
  // untouched). Cleared automatically the moment either side sends a new
  // message, or this participant reopens it via "New Message" — so it
  // resurfaces once there's new activity instead of staying hidden forever.
  // This alone does NOT erase any message content — see cleared_before below
  // for that half.
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // The actual "delete for me" content erasure — a one-way watermark, never
  // reset. Any message sent AT OR BEFORE this timestamp is permanently
  // excluded from what THIS participant can ever see again in this
  // conversation (getMessages filters on it), even after deleted_at clears
  // and the thread resurfaces from new activity. The other participant's own
  // row is untouched, so their own history stays intact — only the deleter's
  // own view loses the old content, permanently.
  cleared_before: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'conversation_participants',
  indexes: [
    { unique: true, fields: ['conversation_id', 'user_id'] },
  ],
});

module.exports = ConversationParticipant;
