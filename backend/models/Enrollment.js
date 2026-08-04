const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Enrollment = sequelize.define('Enrollment', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  class_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'classes', key: 'id' },
  },
  student_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'users', key: 'id' },
  },
}, {
  tableName: 'enrollments',
  indexes: [
    { unique: true, fields: ['class_id', 'student_id'] },
  ],
});

module.exports = Enrollment;
