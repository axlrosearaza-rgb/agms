const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { User, Grade, Class, Subject } = require('../models');

// ── My Advisory → Semester overview ──────────────────────────────────────────
// For one semester: per student, how many released grades they have and which
// subjects they have to take again (Failed / INC / Dropped). Shown live for
// the current semester (userController.getMyAdvisory) and kept as a snapshot
// per section when a semester ends (archiveAdvisoryOverviews below), so the
// overview of a finished semester stays on record — students move on to other
// year levels afterwards, so it can't be rebuilt later.

// Map(studentId → { graded, passed, retakes: [{ code, name, status, grade }] })
async function semesterResults(studentIds, semesterName) {
  const results = new Map();
  if (!semesterName || !studentIds.length) return results;
  const grades = await Grade.findAll({
    where: { student_id: { [Op.in]: studentIds }, released: true, status: { [Op.in]: ['Passed', 'Failed', 'INC', 'DRP'] } },
    attributes: ['student_id', 'status', 'average'],
    include: [{ model: Class, as: 'class', where: { semester: semesterName }, attributes: ['id'], include: [{ model: Subject, as: 'subject', attributes: ['code', 'name'] }] }],
  });
  grades.forEach((g) => {
    const r = results.get(g.student_id) || { graded: 0, passed: 0, retakes: [] };
    r.graded += 1;
    if (g.status === 'Passed') r.passed += 1;
    else r.retakes.push({ code: g.class?.subject?.code, name: g.class?.subject?.name, status: g.status, grade: g.average });
    results.set(g.student_id, r);
  });
  return results;
}

// The overview's numbers for a list of students ({ id, name, student_no,
// last_promoted_semester }) in one semester.
function summarize(students, results, semesterName) {
  const rows = students.map((s) => ({ s, r: results.get(s.id) || { graded: 0, passed: 0, retakes: [] } }));
  const graded = rows.filter((x) => x.r.graded > 0);
  const withRetakes = graded.filter((x) => x.r.retakes.length > 0);
  const all = withRetakes.flatMap((x) => x.r.retakes);
  return {
    students: students.length,
    passed_all: graded.length - withRetakes.length,
    with_retakes: withRetakes.length,
    failed: all.filter((r) => r.status === 'Failed').length,
    inc: all.filter((r) => r.status === 'INC').length,
    dropped: all.filter((r) => r.status === 'DRP').length,
    promoted: students.filter((s) => s.last_promoted_semester === semesterName).length,
    no_grades: students.length - graded.length,
    retake_students: withRetakes
      .map((x) => ({ id: x.s.id, name: x.s.name, student_no: x.s.student_no, retakes: x.r.retakes }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

// Called when a semester ends (semesterController.endSemester): saves every
// advisory section's overview for that semester. Never throws; running it
// again for the same semester just refreshes the saved copy.
async function archiveAdvisoryOverviews(semesterName) {
  try {
    const advisers = await User.findAll({ where: { role: { [Op.in]: ['Faculty', 'Chairperson'] } }, attributes: ['id', 'name', 'advisories'] });
    const students = await User.findAll({
      where: { role: 'Student', graduated_at: null, archived_at: null },
      attributes: ['id', 'name', 'student_no', 'program', 'year_level', 'section', 'last_promoted_semester'],
      raw: true,
    });
    const results = await semesterResults(students.map((s) => s.id), semesterName);
    let saved = 0;
    for (const a of advisers) {
      for (const adv of (Array.isArray(a.advisories) ? a.advisories : [])) {
        const list = students.filter((s) => s.program === adv.program && Number(s.year_level) === Number(adv.year_level) && s.section === adv.section);
        if (!list.length) continue;
        const data = summarize(list, results, semesterName);
        if (data.no_grades === data.students) continue; // nothing happened in this section that semester
        await sequelize.query(
          `INSERT INTO advisory_overviews (semester, program, year_level, section, adviser_id, adviser_name, data, created_at)
           VALUES (:semester, :program, :year, :section, :aid, :aname, CAST(:data AS JSONB), NOW())
           ON CONFLICT (semester, program, year_level, section)
           DO UPDATE SET adviser_id = EXCLUDED.adviser_id, adviser_name = EXCLUDED.adviser_name, data = EXCLUDED.data, created_at = NOW()`,
          { replacements: { semester: semesterName, program: adv.program, year: adv.year_level, section: adv.section, aid: a.id, aname: a.name, data: JSON.stringify(data) } }
        );
        saved += 1;
      }
    }
    if (saved) console.log(`[advisory-overview] archived ${saved} section overview(s) for ${semesterName}.`);
    return saved;
  } catch (err) {
    console.error('[advisory-overview] archive failed:', err.message);
    return 0;
  }
}

// Saved overviews an adviser can see: their sections', plus any they were the
// adviser of when it was saved. Newest first.
async function archivedOverviewsFor(adviserId, advisories) {
  const rows = await sequelize.query(
    'SELECT id, semester, program, year_level, section, adviser_id, adviser_name, data, created_at FROM advisory_overviews ORDER BY created_at DESC, id DESC',
    { type: sequelize.QueryTypes.SELECT }
  );
  const mine = (r) => r.adviser_id === adviserId
    || (advisories || []).some((a) => a.program === r.program && Number(a.year_level) === Number(r.year_level) && a.section === r.section);
  return rows.filter(mine);
}

module.exports = { semesterResults, summarize, archiveAdvisoryOverviews, archivedOverviewsFor };
