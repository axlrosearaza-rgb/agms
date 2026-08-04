const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Grade = sequelize.define('Grade', {
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
  midterm: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: true,
    validate: {
      isValidGWA(value) {
        if (value === null) return;
        const v = parseFloat(value);
        if (v < 1.0 || v > 5.0) {
          throw new Error('Midterm must be a GWA between 1.0 and 5.0.');
        }
      },
    },
  },
  finals: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: true,
    validate: {
      isValidGWA(value) {
        if (value === null) return;
        const v = parseFloat(value);
        if (v < 1.0 || v > 5.0) {
          throw new Error('Finals must be a GWA between 1.0 and 5.0.');
        }
      },
    },
  },
  average: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM('Passed', 'Failed', 'INC', 'DRP', 'Pending'),
    defaultValue: 'Pending',
  },

  // ✅ NEW: Tracks the reason why a student is marked INC
  inc_remarks: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: null,
  },

  // ✅ NEW: Deadline given to the student to complete INC requirements
  inc_deadline: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
  },

  // ✅ NEW: Date when the INC was resolved and a final grade was given
  inc_resolved_date: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null,
  },

  submitted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  submitted_date: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  is_draft: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  released: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  released_date: {
    type: DataTypes.DATE,
    allowNull: true,
  },

  // Registrar-office sign-off: Admin verifies a class's Passed students (separate
  // from `released`, which is the Chairperson-controlled student-visibility flag).
  admin_approved: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  admin_approved_date: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  tableName: 'grades',
  indexes: [
    { unique: true, fields: ['class_id', 'student_id'] },
  ],
  hooks: {
    beforeSave: (grade) => {
      // ✅ FIX: Never auto-overwrite status if instructor explicitly set INC or DRP.
      // INC/DRP are manual decisions — the hook must not touch them.
      if (grade.status === 'INC' || grade.status === 'DRP') {
        // Clear average for INC so it doesn't pollute GWA computation
        if (grade.status === 'INC') {
          grade.average = null;
        }
        return;
      }

      // Auto-compute average and status only when both midterm and finals are present
      if (grade.midterm !== null && grade.finals !== null) {
        const mid = parseFloat(grade.midterm);
        const fin = parseFloat(grade.finals);
        const avg = Math.round(((mid + fin) / 2) * 100) / 100;

        grade.average = avg;
        grade.status = avg >= 1.0 && avg <= 3.0 ? 'Passed' : 'Failed';
      }
    },
  },
});

module.exports = Grade;