const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ComponentScore = sequelize.define('ComponentScore', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  item_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'component_items', key: 'id' },
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  score: {
    type: DataTypes.DECIMAL(7, 2),
    allowNull: true,
    comment: 'Raw score for this item',
  },
}, {
  tableName: 'component_scores',
  indexes: [
    { unique: true, fields: ['item_id', 'student_id'] },
  ],
});

module.exports = ComponentScore;