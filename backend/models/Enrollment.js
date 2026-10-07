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
  // The class isn't the student's own Year + Section — the student is asked
  // "Is this your class?" (utils/enrollmentChecks.js). Answered → one of the
  // two dates below is set and needs_confirmation goes back to false.
  needs_confirmation: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  confirmed_at: { type: DataTypes.DATE, allowNull: true },
  disputed_at: { type: DataTypes.DATE, allowNull: true },
}, {
  tableName: 'enrollments',
  indexes: [
    { unique: true, fields: ['class_id', 'student_id'] },
  ],
});

module.exports = Enrollment;
