const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Subject = sequelize.define('Subject', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  code: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  units: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 3,
    validate: { min: 1, max: 6 },
  },
  department: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  program: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  year_level: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  semester: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'subjects',
});

module.exports = Subject;
