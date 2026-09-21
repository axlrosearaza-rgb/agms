const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const GradeComponent = sequelize.define('GradeComponent', {
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
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'e.g. Quiz, Assignment, Project, Exam',
  },
  period: {
    type: DataTypes.ENUM('Midterm', 'Finals'),
    allowNull: false,
    comment: 'Which grading period this component belongs to',
  },
  weight: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    comment: 'Weight percentage (e.g. 30 for 30%)',
    validate: { min: 0, max: 100 },
  },
  order_index: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Display order within the period',
  },
  // Whether this component's own Ave column is shown in the read-only
  // Class Record (ClassRecordView.js) and its Excel export — Weighted is
  // still shown either way, still computed from Ave internally. Has no
  // effect on the Faculty's own editable grading grid. A component made up
  // of a single Rate-only item hides its Ave regardless of this flag (see
  // isRateOnlyComp in classRecordExcel.js) — this is for manually hiding
  // Ave on any OTHER component too.
  show_ave: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
}, {
  tableName: 'grade_components',
  indexes: [
    { fields: ['class_id', 'period'] },
  ],
});

module.exports = GradeComponent;