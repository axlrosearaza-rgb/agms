const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// A single sub-item within a GradeComponent (e.g. "Test 1" inside "Summative Test").
// Item scores are averaged (via their transmuted Rate) to produce the component's score.
const ComponentItem = sequelize.define('ComponentItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  component_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'grade_components', key: 'id' },
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'e.g. Test 1, Quiz 2, Lab 3',
  },
  max_score: {
    type: DataTypes.DECIMAL(7, 2),
    allowNull: false,
    defaultValue: 100,
  },
  order_index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
}, {
  tableName: 'component_items',
  indexes: [
    { fields: ['component_id'] },
  ],
});

module.exports = ComponentItem;
