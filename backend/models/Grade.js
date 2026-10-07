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

  // INC is per period: a student can be incomplete in the Midterm, the
  // Finals, or both, independently — marking one never marks the other.
  // `status` stays 'INC' as the overall summary while either flag is set (no
  // average can exist yet). Rows marked INC before these existed have neither
  // flag set; they're read as "INC in whichever period is still missing scores".
  inc_midterm: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  inc_finals: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // Set when an INC wasn't completed by its compliance deadline: the grade
  // became 5.0 (Failed) automatically (utils/incLapse.js), and the Remarks
  // show the faculty's own INC reason (inc_remarks) instead of "FAILED".
  inc_lapsed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Which period the lapsed INC was in ('Midterm' / 'Finals' / 'Both') —
  // the Class Record shows the reason only under that period.
  inc_lapsed_period: {
    type: DataTypes.STRING(10),
    allowNull: true,
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
    beforeSave: (grade, options) => {
      // ✅ FIX: Never auto-overwrite status if instructor explicitly set INC or DRP.
      // INC/DRP are manual decisions — the hook must not touch them.
      if (grade.status === 'INC' || grade.status === 'DRP') {
        // Clear average for INC so it doesn't pollute GWA computation
        if (grade.status === 'INC') {
          grade.average = null;
        }
        return;
      }

      // A component-driven class (gradeComponentController.js's saveScores /
      // resolveCompletedINCs) already worked out the correct average/status
      // itself before calling save() — combining BOTH periods' raw composites
      // first and clamping once (see its own combinedGWA), not averaging the
      // two already-clamped period GWAs the fallback below does. That naive
      // (midterm+finals)/2 can read a tenth or more off whenever either raw
      // composite converts to a GWA past the 1.0/5.0 clamp before ever being
      // averaged. `skipAutoAverage` says the caller already set the right
      // figures — leave them alone instead of overwriting them here. Only a
      // manual-entry class (no components, an instructor types Midterm/Finals
      // GWA straight in via gradeController.js) still needs this fallback —
      // there's no raw composite behind those numbers to combine.
      if (options && options.skipAutoAverage) return;

      // Auto-compute average and status only when both midterm and finals are
      // present. `!= null` (loose) on purpose — catches `undefined` too, not
      // just explicit `null`: a bare Grade.create()/findOrCreate() call whose
      // `defaults` omits the midterm/finals keys entirely leaves them
      // `undefined`, which `!== null` (strict) would wrongly treat as
      // "present" and compute NaN average / a false "Failed" status from.
      if (grade.midterm != null && grade.finals != null) {
        const mid = parseFloat(grade.midterm);
        const fin = parseFloat(grade.finals);
        // GWA is 1 decimal (matches classRecordExcel.js's formatGrade
        // convention, verified against the real official spreadsheet).
        // Epsilon-corrected — same reason gradeComponentController.js's own
        // combinedGWA/toGWA need it: a true x.5 can be stored as
        // x.49999999999994 in binary float, silently rounding down.
        const avg = Math.round(((mid + fin) / 2) * 10 + 1e-9) / 10;

        grade.average = avg;
        // <=3.01, not 3.0 — matches the real official spreadsheet's own
        // Remarks formula exactly.
        grade.status = avg >= 1.0 && avg <= 3.01 ? 'Passed' : 'Failed';
      }
    },
  },
});

module.exports = Grade;