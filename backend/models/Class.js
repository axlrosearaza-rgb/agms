const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Class = sequelize.define('Class', {
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
  instructor_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
  schedule: {
    type: DataTypes.STRING(255), // increased from 100 to support per-day schedules
    allowNull: true,
  },
  section: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  semester: {
    type: DataTypes.STRING(50),
    allowNull: false,
  },
  academic_year: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('Active', 'Completed', 'Cancelled'),
    defaultValue: 'Active',
  },
  encoding_open: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
}, {
  tableName: 'classes',
});

module.exports = Class;