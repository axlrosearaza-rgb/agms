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
  // Which Year Level of students this specific class offering is for — set
  // explicitly by the Faculty member at creation (defaults to the Subject's own
  // curriculum year if left blank). Kept separate from Subject.year_level since
  // a class can legitimately be offered to a different year (e.g. a retake
  // section, or a GE subject open to multiple years). Combined with `section`,
  // this is what the Enroll Students picker filters by.
  year_level: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 1, max: 6 },
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
  // Which score→Rate transmutation this class's own Class Record uses —
  // '50_45' is Rate = (score/max)*45 + 50 (the SSU default, Rate range
  // 50-95), '60_35' is Rate = (score/max)*35 + 60 (Rate range 60-95). Both
  // top out at 95 for a perfect score; only the floor for a 0 score differs.
  // Chosen once per class in Grade Component Setup — every Rate/Ave/
  // Weighted/Composite/GWA figure for this class (gradeComponentController's
  // own itemRate, classRecordExcel.js's shared formula engine, and the
  // Excel export's own live Rate formula) reads this same field so none of
  // them can ever disagree on which scale this particular class is using.
  rate_formula: {
    type: DataTypes.ENUM('50_45', '60_35'),
    allowNull: false,
    defaultValue: '50_45',
  },
  // Locks the Class Record's per-item score grid (raw scores, not the
  // midterm/finals GWA those scores compute into) once Faculty clicks "Save
  // All Scores" — prevents accidental further edits. Faculty can still
  // deliberately click "Edit Scores" to unlock and correct something before
  // actually submitting to the Chairperson (see gradeComponentController.
  // saveScores/unlockScores). Independent of `submitted` on Grade, which
  // locks a further step downstream once the whole class is sent on.
  class_record_locked: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // The combined "verified and finalized" gate that unlocks releasing grades
  // to students (see gradeController.getReleaseStatus) and counts toward
  // promotion eligibility (promotionController) — true only once BOTH
  // class_record_verified and grade_sheet_verified below are true. Set
  // together with both of those in one shot when the Chairperson forwards
  // the whole thing at once (reportController.forwardGradingSheetToAdmin),
  // or derived incrementally when Admin verifies each document separately
  // from the Grade Approval preview (reportController.adminVerifyClass) —
  // either path ends up in the same place. The other half of the full
  // release gate (Admin's per-student sign-off) isn't a column here either —
  // it's derived from Grade.admin_approved across the class's own submitted/
  // Passed grades.
  chairperson_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  chairperson_verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Split out from the single chairperson_verified flag so Admin can verify
  // (or send back) the Class Record and the Grade Sheet independently from
  // their own separate preview in Grade Approval — reviewing one doesn't
  // silently also sign off on the other anymore. chairperson_verified above
  // is derived as class_record_verified && grade_sheet_verified.
  class_record_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  class_record_verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  grade_sheet_verified: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  grade_sheet_verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Admin's side of the same per-document pattern the Chairperson pair above
  // uses — each has its own Approve button; once BOTH are true here, the
  // class is fully approved and Faculty is notified they can export &
  // release (see gradeController.approveDocument). Only reachable once
  // chairperson_verified is already true — Admin never sees a class the
  // Chairperson hasn't forwarded.
  admin_class_record_approved: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  admin_class_record_approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  admin_grade_sheet_approved: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  admin_grade_sheet_approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Set only when Admin sends the class back to the Chairperson (never on
  // the normal "not yet touched" path) — lets the Chairperson's own Grade
  // Approval page put these in their own "Returned by Admin" container
  // instead of blending back into the generic "not yet verified" pile, and
  // shows the actual reason right there. Cleared the moment the Chairperson
  // acts on it (re-verifies a document, or bounces it on to Faculty).
  admin_return_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  admin_returned_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // Set when the Chairperson bounces the class to Faculty (returnToFaculty)
  // — while true, this class is Faculty's problem, not the Chairperson's, so
  // it's filtered off the Chairperson's own Grade Approval page entirely
  // instead of sitting in "Not Yet Submitted" looking like a class nobody's
  // touched yet. Cleared the moment Faculty resubmits (gradeController.
  // submitGrades), which is what brings it back into view.
  awaiting_faculty_revision: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  // The Chairperson's own reason text, set alongside awaiting_faculty_revision
  // by the same returnToFaculty call — lets Faculty's own Dashboard/My Classes
  // put these in a dedicated "Returned by Chairperson" container with the
  // actual reason shown, the same way admin_return_reason does for the
  // Chairperson's page. Cleared the moment Faculty resubmits, same trigger
  // that clears awaiting_faculty_revision itself.
  chairperson_return_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  chairperson_returned_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  // True once Faculty has sent the Class Record/Grade Sheet to the
  // Chairperson (reportController.sendGradingSheet) — the "Send to
  // Chairperson" button on Faculty's own page stays disabled the whole time
  // this is true, so it can't be clicked again while it's already somewhere
  // in the Chairperson/Admin pipeline. Only reset back to false by
  // returnToFaculty, which is the one thing that actually hands the class
  // back to Faculty to resend.
  sent_to_chairperson: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
}, {
  tableName: 'classes',
});

module.exports = Class;