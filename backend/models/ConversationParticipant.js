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
}, {
  tableName: 'conversation_participants',
  indexes: [
    { unique: true, fields: ['conversation_id', 'user_id'] },
  ],
});

module.exports = ConversationParticipant;
