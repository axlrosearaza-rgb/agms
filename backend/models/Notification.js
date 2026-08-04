const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Who receives this notification',
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'registration, grade, endorsement, enrollment, system',
  },
  is_read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  link: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Optional URL to navigate to when clicked',
  },
}, {
  tableName: 'notifications',
});

module.exports = Notification;