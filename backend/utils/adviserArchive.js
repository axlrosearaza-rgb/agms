// ── Past advisers ────────────────────────────────────────────────────────────
// Whenever a section is taken off an adviser (a new adviser list is uploaded,
// or the Admin changes one adviser's sections), what that adviser had is kept
// here: the section, the advisees in it at that moment, when it ended and who
// took over. Nothing is ever removed from this table (adviser_archives,
// created in utils/ensureIndexes.js) — it is the record of who advised whom.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { User, Semester } = require('../models');

const ADVISER_ROLES = ['Faculty', 'Chairperson'];

// `sections`: the sections this adviser just lost. Call AFTER the change is
// saved, so the new holder (if any) can be read back. Never throws.
async function archivePastAdvisory(adviser, sections, actingUser) {
  try {
    if (!adviser || !sections?.length) return;
    const semester = (await Semester.findOne({ where: { is_current: true }, attributes: ['name'] }))?.name || null;
    for (const sec of sections) {
      const students = await User.findAll({
        where: { role: 'Student', graduated_at: null, program: sec.program, year_level: sec.year_level, section: sec.section },
        attributes: ['id', 'student_no', 'name'],
        order: [['name', 'ASC']],
      });
      const next = await User.findOne({
        where: { role: { [Op.in]: ADVISER_ROLES }, id: { [Op.ne]: adviser.id }, advisories: { [Op.contains]: [{ program: sec.program, year_level: sec.year_level, section: sec.section }] } },
        attributes: ['name'],
      });
      await sequelize.query(
        `INSERT INTO adviser_archives (adviser_id, adviser_name, program, year_level, section, students, student_count, semester, replaced_by_name, ended_by_name, ended_at)
         VALUES (:adviser_id, :adviser_name, :program, :year_level, :section, :students::jsonb, :student_count, :semester, :replaced_by_name, :ended_by_name, NOW())`,
        { replacements: {
          adviser_id: adviser.id, adviser_name: adviser.name, program: sec.program, year_level: sec.year_level, section: sec.section,
          students: JSON.stringify(students.map((s) => ({ id: s.id, student_no: s.student_no, name: s.name }))),
          student_count: students.length, semester, replaced_by_name: next?.name || null, ended_by_name: actingUser?.name || null,
        } }
      );
    }
  } catch (err) {
    console.error('[adviser-archive] could not record a past advisory:', err.message);
  }
}

// Every past advisory, newest first.
async function listPastAdvisories() {
  const [rows] = await sequelize.query('SELECT id, adviser_id, adviser_name, program, year_level, section, students, student_count, semester, replaced_by_name, ended_by_name, ended_at FROM adviser_archives ORDER BY ended_at DESC, id DESC LIMIT 2000');
  return rows;
}

module.exports = { archivePastAdvisory, listPastAdvisories };
