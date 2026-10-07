// A student's MAIN year level follows the MAJOR subjects they're taking this
// semester (Subject.subject_type = 'Major') — the highest curriculum year among
// them. Minor subjects (GE, PE, outside electives) never change it, so a 4th-year
// irregular student taking a 1st-year minor stays in 4th year, and one whose
// majors are all 3rd-year subjects is in 3rd year. Their section letter stays.
const { Op } = require('sequelize');
const { User, Enrollment, Class, Subject, Semester } = require('../models');
const { logActivity } = require('./activityLogger');

// Re-checks the given students against their current-semester majors.
// Returns [{ id, name, from, to }] for every student whose year changed.
async function syncMainYear(studentIds, actorId = null) {
  const ids = [...new Set(studentIds)].filter(Boolean);
  if (!ids.length) return [];
  const current = await Semester.findOne({ where: { is_current: true }, attributes: ['name'] });
  if (!current) return [];

  const rows = await Enrollment.findAll({
    where: { student_id: { [Op.in]: ids } },
    attributes: ['student_id'],
    include: [{
      model: Class,
      as: 'class',
      where: { semester: current.name },
      attributes: ['id'],
      include: [{ model: Subject, as: 'subject', where: { subject_type: 'Major' }, attributes: ['year_level'] }],
    }],
  });
  const majorYear = new Map();
  rows.forEach((r) => {
    const y = Number(r.class?.subject?.year_level);
    if (y >= 1 && y <= 4) majorYear.set(r.student_id, Math.max(majorYear.get(r.student_id) || 0, y));
  });
  if (!majorYear.size) return [];

  const students = await User.findAll({
    where: { id: { [Op.in]: [...majorYear.keys()] }, role: 'Student', graduated_at: null },
    attributes: ['id', 'name', 'year_level', 'section', 'program'],
  });
  const changed = [];
  for (const s of students) {
    const to = majorYear.get(s.id);
    if (to && Number(s.year_level) !== to) {
      changed.push({ id: s.id, name: s.name, from: s.year_level, to });
      await User.update({ year_level: to }, { where: { id: s.id }, validate: false });
    }
  }
  if (changed.length && actorId) {
    await logActivity(actorId, `main year updated from major subjects for ${changed.length} student(s): ${changed.map((c) => `${c.name} Y${c.from}→Y${c.to}`).join(', ')}`, 'User', null);
  }
  return changed;
}

module.exports = { syncMainYear };
