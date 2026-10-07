// ── What follows from putting students on a class list ──────────────────────
// Run after students are enrolled in a class (class-list import / Add
// Students):
//  1. Regular / Irregular is decided by the system, not by the student: a
//     student taking a subject from a PREVIOUS year level or semester, or put
//     in any class outside their own Year + Section, is marked Irregular
//     automatically.
//  2. A student put in a class that isn't their own Year + Section is asked to
//     confirm it (enrollments.needs_confirmation → the student's
//     "Is this your class?" prompt, accountSetupController).
const { Op } = require('sequelize');
const { User, Enrollment, Class, Subject } = require('../models');
const { createNotification } = require('../controllers/notificationController');
const { logActivity } = require('./activityLogger');

// 1 for a 1st-Semester name/label, 2 for 2nd, else null (Summer etc.).
const semesterOrder = (text) => {
  const s = String(text || '').toLowerCase();
  if (/\b(1st|first)\b/.test(s)) return 1;
  if (/\b(2nd|second)\b/.test(s)) return 2;
  return null;
};

// Is this class's subject behind where the student is now?
const isBackSubject = (student, cls) => {
  const subjYear = Number(cls.subject?.year_level);
  const myYear = Number(student.year_level);
  if (!subjYear || !myYear) return false;
  if (subjYear < myYear) return true;
  if (subjYear > myYear) return false;
  const subjSem = semesterOrder(cls.subject?.semester);
  const runningSem = semesterOrder(cls.semester);
  return !!subjSem && !!runningSem && subjSem < runningSem;
};

const isOtherSection = (student, cls) => (cls.year_level != null && Number(cls.year_level) !== Number(student.year_level))
  || (!!cls.section && !!student.section && String(cls.section).toUpperCase() !== String(student.section).toUpperCase());

// `cls` must include its `subject`. Returns { markedIrregular: [names], toConfirm: count }.
async function afterEnrollment(app, cls, studentIds, actorId = null) {
  const ids = [...new Set(studentIds)].filter(Boolean);
  const out = { markedIrregular: [], toConfirm: 0 };
  if (!ids.length) return out;
  // Read fresh — a major subject may just have moved their main year level.
  const students = await User.findAll({ where: { id: { [Op.in]: ids }, role: 'Student' }, attributes: ['id', 'name', 'year_level', 'section', 'student_status'] });

  // 1) Regular / Irregular, recalculated from all of their classes this semester.
  out.markedIrregular = (await syncRegularity(app, ids, actorId)).filter((c) => c.to === 'Irregular').map((c) => c.name);

  // 2) Not their own Year + Section → the student confirms.
  const other = students.filter((s) => isOtherSection(s, cls)).map((s) => s.id);
  if (other.length) {
    const [count] = await Enrollment.update(
      { needs_confirmation: true },
      { where: { class_id: cls.id, student_id: { [Op.in]: other }, needs_confirmation: false, confirmed_at: null, disputed_at: null } },
    );
    out.toConfirm = count;
    if (count) {
      const label = `${cls.subject?.code || 'a class'} (Year ${cls.year_level || '—'}${cls.section ? ` - Section ${cls.section}` : ''})`;
      await Promise.all(other.map((sid) => createNotification(app, {
        userId: sid,
        title: 'Please confirm your class',
        message: `You were added to ${label}, which is outside your own year and section. Open your dashboard to confirm it.`,
        type: 'enrollment',
        link: '/student',
      })));
    }
  }
  return out;
}

// ── Regular / Irregular, from the student's classes this semester ───────────
// REGULAR only when the student is enrolled in EVERY
// curriculum subject of their own Year + the current semester (their program)
// and in nothing outside that — no back subject (an earlier year or semester),
// no advance subject (a later year), no class of another year or section —
// with no earlier subject or prerequisite left uncompleted (Failed / INC /
// Dropped, not passed since). A student taking no subject yet is REGULAR (everyone starts Regular); anything
// else is IRREGULAR.
// Recalculated whenever their class list changes (added to a class, removed,
// "not my class"), so taking a student off a back subject makes them Regular
// again. Returns [{ id, name, to }] for every student whose status changed.
const TERM_TO_SUBJECT_SEMESTER = { 'First Semester': '1st Semester', 'Second Semester': '2nd Semester', Summer: 'Summer' };

async function runningSemester() {
  const { Semester } = require('../models');
  return (await Semester.findOne({ where: { is_current: true } }))
    || Semester.findOne({ where: { status: 'Active' }, order: [['start_date', 'DESC'], ['id', 'DESC']] });
}

async function syncRegularity(app, studentIds, actorId = null) {
  const ids = [...new Set(studentIds)].filter(Boolean);
  const changed = [];
  if (!ids.length) return changed;
  const sem = await runningSemester();
  if (!sem) return changed;
  const subjectSemester = TERM_TO_SUBJECT_SEMESTER[sem.term] || null;

  const students = await User.findAll({ where: { id: { [Op.in]: ids }, role: 'Student', graduated_at: null }, attributes: ['id', 'name', 'program', 'year_level', 'section', 'student_status', 'declared_status', 'status_declared_semester'] });
  const enrollments = await Enrollment.findAll({
    where: { student_id: { [Op.in]: ids } },
    attributes: ['student_id'],
    include: [{
      model: Class,
      as: 'class',
      where: { semester: sem.name, status: 'Active' },
      attributes: ['id', 'year_level', 'section', 'semester', 'subject_id'],
      include: [{ model: Subject, as: 'subject', attributes: ['id', 'year_level', 'semester'] }],
    }],
  });
  const byStudent = {};
  enrollments.forEach((e) => { (byStudent[e.student_id] = byStudent[e.student_id] || []).push(e.class); });

  // The curriculum each (program, year) is supposed to take this semester.
  const pairs = [...new Set(students.map((s) => `${s.program}|${s.year_level}`))];
  const required = {};
  for (const key of pairs) {
    const [program, year] = key.split('|');
    required[key] = subjectSemester
      ? (await Subject.findAll({ where: { program, year_level: Number(year), semester: subjectSemester }, attributes: ['id'] })).map((s) => s.id)
      : [];
  }

  // Subjects each student took here before and hasn't completed yet — a
  // Failed / INC / Dropped grade with no later Passed grade for the same
  // subject (that includes a prerequisite they still have to pass).
  const { Grade } = require('../models');
  const pastGrades = await Grade.findAll({
    where: { student_id: { [Op.in]: ids }, submitted: true },
    attributes: ['student_id', 'status'],
    include: [{ model: Class, as: 'class', where: { semester: { [Op.ne]: sem.name } }, attributes: ['subject_id'] }],
  });
  const unfinished = {};
  const passedSubj = {};
  pastGrades.forEach((g) => {
    const sid = g.student_id;
    const subj = g.class?.subject_id;
    if (!subj) return;
    if (g.status === 'Passed') (passedSubj[sid] = passedSubj[sid] || new Set()).add(subj);
    else if (['Failed', 'INC', 'DRP', 'Dropped'].includes(g.status)) (unfinished[sid] = unfinished[sid] || new Set()).add(subj);
  });
  const hasUnfinished = (sid) => [...(unfinished[sid] || [])].some((subj) => !(passedSubj[sid] || new Set()).has(subj));

  for (const s of students) {
    const classes = byStudent[s.id] || [];
    let to;
    if (classes.length === 0) {
      // Not taking any subject yet → Regular (everyone starts Regular)…
      // unless their grades say otherwise: a subject failed / INC / dropped
      // before (promoted "with retake" by the adviser) keeps them Irregular.
      to = hasUnfinished(s.id) ? 'Irregular' : 'Regular';
    } else {
      const taking = new Set(classes.map((c) => c.subject_id));
      // Every subject of their own Year + this semester…
      const complete = (required[`${s.program}|${s.year_level}`] || []).every((id) => taking.has(id));
      // …and nothing outside it: no back subject, no class of another
      // section / year, no advance (later-year) subject.
      const outside = classes.some((c) => isBackSubject(s, c) || isOtherSection(s, c) || Number(c.subject?.year_level) > Number(s.year_level));
      // …and no earlier subject (or prerequisite) still not completed.
      to = complete && !outside && !hasUnfinished(s.id) ? 'Regular' : 'Irregular';
    }
    // The student's own "Irregular" answer this semester stands even when
    // their classes alone would make them Regular.
    if (to === 'Regular' && s.declared_status === 'Irregular' && s.status_declared_semester === sem.name) to = 'Irregular';
    if (s.student_status === to) continue;
    await User.update({ student_status: to }, { where: { id: s.id }, validate: false });
    changed.push({ id: s.id, name: s.name, to });
    await createNotification(app, {
      userId: s.id,
      title: 'Academic Status Update',
      message: to === 'Regular'
        ? 'You are now Regular — you are taking exactly the subjects of your year and section this semester.'
        : 'You are now Irregular — your subjects this semester are not exactly those of your year and section (a missing, back or advance subject, a class of another section, or an earlier subject or prerequisite not yet completed).',
      type: 'system',
      link: '/student',
    });
  }
  if (changed.length && actorId) {
    await logActivity(actorId, `Regular/Irregular updated automatically for ${changed.length} student(s): ${changed.map((c) => `${c.name} → ${c.to}`).join(', ')}`, 'User', null);
  }
  return changed;
}

module.exports = { afterEnrollment, syncRegularity, isBackSubject, isOtherSection };
