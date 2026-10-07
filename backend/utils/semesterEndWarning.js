const { Semester } = require('../models');
const { notifyAdmins } = require('../controllers/notificationController');

// ── "The semester ends in 14 days — create the next one" ────────────────────
// Once the current semester is within WARN_DAYS of its end_date and no next
// semester has been set up yet, every Admin is notified — once per end date
// (semesters.end_warning_for; moving the end date re-arms it). The Admin
// dashboard shows the same countdown as a banner until the next semester
// exists (components/admin/SemesterEndingBanner.js — same rules).
// Run shortly after startup and then hourly (server.js).

const WARN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Today's date in the Philippines, as YYYY-MM-DD.
const todayPH = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

// The running semester: the one marked current, else the Active one that
// started most recently.
const runningSemester = (rows) => rows.find((s) => s.is_current)
  || rows.filter((s) => s.status === 'Active').sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')) || b.id - a.id)[0]
  || null;

// A semester already created to follow it: not finished, and starting later
// (or, with no start date set, created after it).
const hasNextSemester = (rows, current) => rows.some((s) => s.id !== current.id && s.status !== 'Completed' && !s.is_current
  && (s.start_date && current.start_date ? s.start_date > current.start_date : s.id > current.id));

// { semester, days, needsWarning } for the running semester, or null.
async function semesterEndStatus(today = todayPH()) {
  const rows = await Semester.findAll({ raw: true });
  const current = runningSemester(rows);
  if (!current || !current.end_date || current.status === 'Completed') return null;
  const days = Math.round((Date.parse(current.end_date) - Date.parse(today)) / DAY_MS);
  return { semester: current, days, needsWarning: days <= WARN_DAYS && !hasNextSemester(rows, current) };
}

async function warnSemesterEnding(app) {
  try {
    const status = await semesterEndStatus();
    if (!status || !status.needsWarning) return;
    const { semester, days } = status;
    if (semester.end_warning_for === semester.end_date) return; // already warned for this date

    const when = days > 1 ? `in ${days} days` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : `${-days} day(s) ago`;
    await notifyAdmins(app, {
      title: 'Semester ending soon',
      message: `${semester.name} ends ${when} (${semester.end_date}). Create the next semester so classes and enrollment can be set up in time.`,
      type: 'system',
      link: '/admin/semesters',
    });
    await Semester.update({ end_warning_for: semester.end_date }, { where: { id: semester.id } });
    console.log(`[semester-end-warning] Admins warned: ${semester.name} ends ${when}.`);
  } catch (err) {
    console.error('[semester-end-warning] check failed:', err.message);
  }
}

// ── "30 days left to submit your grades" ─────────────────────────────────────
// Once the running semester is within GRADE_WARN_DAYS of its end_date, every
// instructor (Faculty or teaching Chairperson) who still has a class this
// semester not yet submitted to the Chairperson is notified — once per end
// date (semesters.grade_warning_for). The Faculty dashboard shows the same
// countdown (components/instructor/GradeDeadlineBanner.js).
const GRADE_WARN_DAYS = 30;

async function warnGradeSubmission(app) {
  try {
    const status = await semesterEndStatus();
    if (!status || status.days > GRADE_WARN_DAYS || status.days < 0) return;
    const { semester, days } = status;
    if (semester.grade_warning_for === semester.end_date) return; // already warned for this date

    const { Class, User } = require('../models');
    const { createNotification } = require('../controllers/notificationController');
    const pending = await Class.findAll({
      where: { semester: semester.name, status: 'Active', sent_to_chairperson: false },
      attributes: ['instructor_id'],
      raw: true,
    });
    const counts = {};
    pending.forEach((c) => { if (c.instructor_id) counts[c.instructor_id] = (counts[c.instructor_id] || 0) + 1; });
    const instructors = await User.findAll({ where: { id: Object.keys(counts), status: 'Active' }, attributes: ['id', 'role'] });

    const when = days > 1 ? `in ${days} days` : days === 1 ? 'tomorrow' : 'today';
    await Promise.all(instructors.map((u) => createNotification(app, {
      userId: u.id,
      title: 'Grade submission reminder',
      message: `${semester.name} ends ${when} (${semester.end_date}). You still have ${counts[u.id]} class${counts[u.id] !== 1 ? 'es' : ''} to submit to your Chairperson — finish encoding and submit the grades before then.`,
      type: 'grade',
      link: u.role === 'Chairperson' ? '/chairperson/classes' : '/faculty/classes',
    })));
    await Semester.update({ grade_warning_for: semester.end_date }, { where: { id: semester.id } });
    console.log(`[grade-submission-warning] ${instructors.length} instructor(s) reminded: ${semester.name} ends ${when}.`);
  } catch (err) {
    console.error('[grade-submission-warning] check failed:', err.message);
  }
}

module.exports = { warnSemesterEnding, warnGradeSubmission, semesterEndStatus, WARN_DAYS, GRADE_WARN_DAYS };
