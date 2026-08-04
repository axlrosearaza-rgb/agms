const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// user_a_id is always the numerically-smaller of the two participant ids —
// keeps each 1:1 pair canonical so the unique index prevents duplicate conversations.
const Conversation = sequelize.define('Conversation', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_a_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  user_b_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  last_message_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'conversations',
  indexes: [
    { unique: true, fields: ['user_a_id', 'user_b_id'] },
  ],
});

module.exports = Conversation;
