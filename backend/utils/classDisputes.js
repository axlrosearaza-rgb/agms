// ── "No, not mine" — students who said they aren't taking a class ───────────
// Kept in their own table (the enrollment itself is deleted when the student
// is removed), so the instructor's dashboard can keep warning about them
// until the instructor dismisses each one.
const { sequelize } = require('../config/database');

// Never throws — failing to record this must not fail the student's answer.
async function recordDispute({ cls, student, removed }) {
  try {
    await sequelize.query(
      `INSERT INTO class_disputes (class_id, instructor_id, student_id, student_name, student_no, class_label, removed)
       VALUES (:class_id, :instructor_id, :student_id, :student_name, :student_no, :class_label, :removed)`,
      {
        replacements: {
          class_id: cls.id,
          instructor_id: cls.instructor_id || cls.instructor?.id || null,
          student_id: student.id,
          student_name: student.name,
          student_no: student.student_no || null,
          class_label: `${cls.subject?.code || 'Class'}${cls.section ? ` ${cls.year_level || ''}-${cls.section}` : ''}`,
          removed: !!removed,
        },
      },
    );
  } catch (err) {
    console.warn('[class dispute] not saved:', err.message);
  }
}

// The instructor's not-yet-dismissed warnings, newest first.
async function openDisputesFor(instructorId) {
  return sequelize.query(
    `SELECT id, class_id, student_id, student_name, student_no, class_label, removed, created_at
       FROM class_disputes WHERE instructor_id = :id AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 100`,
    { replacements: { id: instructorId }, type: 'SELECT' },
  );
}

async function dismissDispute(id, instructorId) {
  await sequelize.query(
    'UPDATE class_disputes SET dismissed_at = NOW() WHERE id = :id AND instructor_id = :instructorId',
    { replacements: { id, instructorId } },
  );
}

module.exports = { recordDispute, openDisputesFor, dismissDispute };
