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
  // What this semester's year is called everywhere it's shown — "A.Y." or
  // "S.Y." on dashboards, the Class Record, Grade Sheet, exports.
  year_label: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'School Year',
    validate: { isIn: [['Academic Year', 'School Year']] },
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
  // Student self-service Add/Drop window (studentEnrollmentController).
  // Either left null = no limit on that side.
  add_drop_start: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  add_drop_end: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  // The end_date Admins were already warned about ("ends in 14 days — create
  // the next semester", utils/semesterEndWarning.js). Moving end_date re-arms it.
  end_warning_for: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  // The end_date instructors were already reminded about ("30 days left to
  // submit your grades", utils/semesterEndWarning.js).
  grade_warning_for: {
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