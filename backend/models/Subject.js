const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Subject = sequelize.define('Subject', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  // Widened from 20 -> 60: real curriculum codes can run long, e.g.
  // "NSTP - CWTS 1/LTS 1 NSTP-NROTC 1" from the official checklist.
  code: {
    type: DataTypes.STRING(60),
    allowNull: false,
    unique: true,
  },
  name: {
    type: DataTypes.STRING(150),
    allowNull: false,
  },
  // Total units — kept as the single source of truth every other feature (grading,
  // class records, reports) already reads. Derived server-side as
  // lecture_units + lab_units whenever those are supplied, matching the "Total"
  // column of the official curriculum checklist.
  units: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 3,
    validate: { min: 1, max: 6 },
  },
  // Curriculum-checklist breakdown (Lecture / Laboratory-RLE columns). Nullable —
  // older subjects created before this existed just show '—' for the split and
  // keep using the plain `units` total. Some subjects (Practicum, Thesis, OJT)
  // legitimately have NO lecture/lab split at all — just a standalone Total, e.g.
  // "PRAC 101 — 486 Hrs / 6 Units" with both Lecture and Lab left blank. So these
  // are never derived from each other; each is exactly whatever was typed in.
  lecture_hours: { type: DataTypes.INTEGER, allowNull: true },
  lecture_units: { type: DataTypes.INTEGER, allowNull: true },
  lab_hours: { type: DataTypes.INTEGER, allowNull: true },
  lab_units: { type: DataTypes.INTEGER, allowNull: true },
  // Total Hours — stands alone (not derived), so a Practicum/Thesis-style subject
  // with no Lecture/Lab breakdown can still record its total. `units` (below) is
  // the equivalent "Total Units" value.
  total_hours: { type: DataTypes.INTEGER, allowNull: true },
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
  // Not every "Pre-Requisite" is an actual subject — the curriculum checklist
  // also lists standing-based requirements like "4th Year Standing" (e.g. for
  // Practicum, Seminars and Field Trip). Free text, shown alongside the
  // subject-based prerequisites (which stay a real relation via Prerequisite).
  prerequisite_note: {
    type: DataTypes.STRING(150),
    allowNull: true,
  },
  // Default grading breakdown for this subject — [{ name: 'Major Exam', weight: 30 }, ...].
  // Purely a template/reference (percentages don't have to sum to 100, and
  // nothing enforces it against actual grades) — an instructor's real
  // per-class GradeComponent rows are still separate and are what grading
  // itself runs on. Nullable: older subjects or ones with no settled scheme
  // yet just show "not set" until someone fills it in via the Subject form.
  grading_scheme: {
    type: DataTypes.JSONB,
    allowNull: true,
  },
}, {
  tableName: 'subjects',
});

module.exports = Subject;
