const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Prerequisite = sequelize.define('Prerequisite', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  subject_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'subjects', key: 'id' },
  },
  prerequisite_subject_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'subjects', key: 'id' },
  },
}, {
  tableName: 'prerequisites',
});

module.exports = Prerequisite;
