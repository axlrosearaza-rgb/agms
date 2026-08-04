const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Semester = sequelize.define('Semester', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  academic_year: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  term: {
    type: DataTypes.ENUM('First Semester', 'Second Semester', 'Summer'),
    allowNull: false,
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  is_current: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  status: {
    type: DataTypes.ENUM('Active', 'Completed', 'Upcoming'),
    defaultValue: 'Upcoming',
  },
}, {
  tableName: 'semesters',
});

module.exports = Semester;