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
}, {
  tableName: 'messages',
});

module.exports = Message;
