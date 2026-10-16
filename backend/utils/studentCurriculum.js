// ── Which curriculum a student follows ───────────────────────────────────────
// Each student follows ONE curriculum of their program (users.curriculum_year),
// decided once and kept as they move up the years:
//   - A new account gets the curriculum that was in force the year the student
//     entered: a 1st-year student → the latest curriculum; a student who comes
//     in at 2nd year or higher → the curriculum of their own batch (the latest
//     one not newer than the year they started).
//   - When the Admin imports a NEW curriculum, only students who are in 1st
//     year, 1st semester and have no grades yet move to it. Everyone already
//     further along keeps the curriculum they started with.
// The prospectus, the Regular / Irregular check and promotion all use the
// student's own curriculum, so an old curriculum (even an archived one) still
// works for the students on it.
const { Op } = require('sequelize');
const { User, Subject, Semester, Grade, Class } = require('../models');

const yearOf = (cy) => parseInt(String(cy || '').slice(0, 4), 10) || 0;

// Does this subject belong to the curriculum this student follows? A subject
// with no curriculum year, or a student with none recorded, matches anything.
const followsCurriculum = (subject, student) => !subject?.curriculum_year || !student?.curriculum_year
  || String(subject.curriculum_year) === String(student.curriculum_year);

// Every curriculum year of a program (archived ones included), oldest first.
async function curriculaOf(program) {
  const rows = await Subject.findAll({ where: { program, curriculum_year: { [Op.ne]: null } }, attributes: ['curriculum_year'], group: ['curriculum_year'] });
  return rows.map((r) => r.curriculum_year).sort((a, b) => yearOf(a) - yearOf(b));
}

async function runningSemester() {
  return (await Semester.findOne({ where: { is_current: true } }))
    || Semester.findOne({ where: { status: 'Active' }, order: [['start_date', 'DESC'], ['id', 'DESC']] });
}

// The curriculum for a student account being created now, at this year level.
// `cache` (optional Map) avoids repeating the lookups across a class list.
async function curriculumForNewStudent(program, yearLevel, cache = new Map()) {
  if (!program) return null;
  const key = `${program}|${yearLevel}`;
  if (cache.has(key)) return cache.get(key);
  const curricula = await curriculaOf(program);
  let pick = null;
  if (curricula.length) {
    const sem = await runningSemester();
    const startYear = yearOf(sem?.academic_year) || new Date().getFullYear();
    const entryYear = startYear - (Math.max(1, Number(yearLevel) || 1) - 1);
    const inForce = curricula.filter((c) => yearOf(c) <= entryYear);
    // Nothing that old on record → the oldest curriculum there is.
    pick = inForce.length ? inForce[inForce.length - 1] : curricula[0];
  }
  cache.set(key, pick);
  return pick;
}

// A new curriculum was just added for these programs. Moves the 1st-year,
// 1st-semester students with no grades yet onto it. Returns how many moved.
async function applyNewCurriculum(programs, curriculumYear) {
  const sem = await runningSemester();
  if (!sem || sem.term !== 'First Semester') return 0;
  const candidates = await User.findAll({
    where: {
      role: 'Student', graduated_at: null, year_level: 1, program: { [Op.in]: programs },
      [Op.or]: [{ curriculum_year: null }, { curriculum_year: { [Op.ne]: curriculumYear } }],
    },
    attributes: ['id', 'curriculum_year'],
  });
  if (!candidates.length) return 0;
  // Never move a student back to an older curriculum.
  const eligible = candidates.filter((s) => yearOf(s.curriculum_year) <= yearOf(curriculumYear));
  // Already graded in an earlier semester → not a new first-year student.
  const graded = await Grade.findAll({
    where: { student_id: { [Op.in]: eligible.map((s) => s.id) }, submitted: true },
    attributes: ['student_id'],
    include: [{ model: Class, as: 'class', where: { semester: { [Op.ne]: sem.name } }, attributes: [], required: true }],
  });
  const hasHistory = new Set(graded.map((g) => g.student_id));
  const ids = eligible.filter((s) => !hasHistory.has(s.id)).map((s) => s.id);
  if (ids.length) await User.update({ curriculum_year: curriculumYear }, { where: { id: { [Op.in]: ids } }, validate: false });
  return ids.length;
}

module.exports = { followsCurriculum, curriculumForNewStudent, applyNewCurriculum, curriculaOf };
