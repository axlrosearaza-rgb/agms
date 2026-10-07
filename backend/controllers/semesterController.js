const { Semester, Class } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyAllUsers } = require('./notificationController');
const { invalidateTags } = require('../utils/responseCache');

// The one real "this semester is over, archive everything in it" moment —
// called from every path that can retire a semester: Admin explicitly
// marking it Completed, OR a new semester taking over as current (which
// implicitly ends whichever one WAS current).
//
// Callers own the idempotency check (comparing status BEFORE vs after their
// own mutation) — this helper itself assumes `semester.status` is already
// 'Completed' and already saved by the time it's called, and unconditionally
// does the rest: archiving + notifying. It can't safely re-check status
// itself, because by the time some callers reach here the in-memory object
// has already been mutated to 'Completed' (there's no "was it already like
// this before MY edit" left to observe on the object at that point).
//
// "Archive" here means flipping every one of this semester's still-Active
// Classes to `status: 'Completed'` — Class.semester is a plain name string,
// not a FK, so classes are matched by name (same lookup getInstructorClasses
// already does to derive `is_archived` for the same reason). Nothing about
// Grade/Enrollment/ComponentScore rows needs touching separately: every
// view that reads them always does so scoped through their own Class, and a
// Completed Class is what every "Archived" section (Faculty's My Classes,
// Chairperson's Grading Sheets, Admin's Grade Approval) already checks for
// — so archiving the Class transitively keeps everything under it out of
// the active views too, without a second "archived" flag to keep in sync.
const archiveEndedSemester = async (app, semester) => {
  // Each adviser's Semester overview (My Advisory) for this semester is kept
  // on record — saved first, while the sections still hold these students.
  await require('../utils/advisoryOverview').archiveAdvisoryOverviews(semester.name);

  await Class.update(
    { status: 'Completed' },
    { where: { semester: semester.name, status: 'Active' } }
  );

  await notifyAllUsers(app, {
    title: 'Semester Ended',
    message: `${semester.name} has ended and is now marked Completed. Its classes have been archived.`,
    type: 'semester',
  });
};

// Used for a semester object fetched fresh (not yet touched by the current
// request) whose status genuinely still needs to be flipped — the
// supersession case in createSemester/updateSemester/setCurrentSemester,
// where `semester` here is the OTHER row (the one that was current), never
// the one actively being edited.
const endSemester = async (app, semester) => {
  if (semester.status === 'Completed') return;
  semester.status = 'Completed';
  await semester.save();
  await archiveEndedSemester(app, semester);
  // The semester is over — the system checks every student graded in it and
  // promotes those who passed everything (year level / graduation after the
  // 2nd Semester). Runs in the background; never blocks this request.
  require('./promotionController').autoPromoteSemester(app, semester.name);
};

const YEAR_LABELS = ['Academic Year', 'School Year'];

// A semester whose end date has already passed can't be made Active or
// current again (utils/semesterAutoEnd.js ends those automatically) — the
// Admin has to move the end date first.
const { hasEnded, endPastSemesters } = require('../utils/semesterAutoEnd');
const endedMessage = (endDate) => `This semester already ended on ${endDate}, so it can't be Active or current. Change the end date first if it is still running.`;

// Every signed-in user shows semester labels ("A.Y."/"S.Y.", current term
// pill, document headers), so any semester change is pushed to ALL of them
// at once — their pages re-read the semester list live, no reload needed.
// Rare admin-only event, so a plain broadcast is fine here.
const emitSemestersUpdated = (app) => {
  // Dashboards, class lists and user lists all depend on the current
  // semester — drop every cached copy so the refreshed screens are fresh.
  invalidateTags(['dashboard', 'classes', 'users']);
  const io = app.get('io');
  if (io) io.emit('semestersUpdated');
};

// GET /api/semesters
const getSemesters = asyncHandler(async (req, res) => {
  const { status, academic_year } = req.query;
  const where = {};
  if (status) where.status = status;
  if (academic_year) where.academic_year = academic_year;

  const semesters = await Semester.findAll({
    where,
    order: [['academic_year', 'DESC'], ['term', 'ASC']],
  });

  res.json({ semesters });
});

// GET /api/semesters/current
const getCurrentSemester = asyncHandler(async (req, res) => {
  const current = await Semester.findOne({ where: { is_current: true } });
  res.json({ semester: current });
});

// POST /api/semesters
const createSemester = asyncHandler(async (req, res) => {
  const { term, academic_year, start_date, end_date, is_current, status, year_label, add_drop_start, add_drop_end } = req.body;

  if (!term || !academic_year) {
    return res.status(400).json({ message: 'Term and academic year are required.' });
  }
  if (year_label !== undefined && !YEAR_LABELS.includes(year_label)) {
    return res.status(400).json({ message: 'Year label must be "Academic Year" or "School Year".' });
  }

  const name = `${term} ${academic_year}`;

  const existing = await Semester.findOne({ where: { name } });
  if (existing) {
    return res.status(409).json({ message: 'This semester already exists.' });
  }
  if (hasEnded(end_date) && (is_current || status === 'Active')) {
    return res.status(400).json({ message: endedMessage(end_date) });
  }

  // If marking as current, unset all others — and whichever one WAS
  // current just got superseded, which is as real an "ends here" moment as
  // Admin marking it Completed by hand (see endSemester's own comment).
  let supersededSemester = null;
  if (is_current) {
    supersededSemester = await Semester.findOne({ where: { is_current: true } });
    await Semester.update({ is_current: false }, { where: { is_current: true } });
  }

  const semester = await Semester.create({
    name,
    term,
    academic_year,
    year_label: year_label || 'Academic Year',
    start_date: start_date || null,
    end_date: end_date || null,
    add_drop_start: add_drop_start || null,
    add_drop_end: add_drop_end || null,
    is_current: is_current || false,
    status: status || 'Upcoming',
  });

  await logActivity(req.user.id, `created semester ${name}`, 'Semester', semester.id);

  if (supersededSemester) {
    await endSemester(req.app, supersededSemester);
  }
  await endPastSemesters(req.app);
  await semester.reload();

  // Every user — not just Admin/Chairperson — cares that a new term now
  // exists (Faculty and Students both plan around it), so this is one of the
  // few notifications that goes out system-wide instead of scoped to a role
  // or program.
  // No link — /admin/semesters is Admin-only, and there's no equivalent
  // Chairperson/Faculty/Student page to send everyone else to instead.
  await notifyAllUsers(req.app, {
    title: 'New Semester Created',
    message: `${name} has been created${is_current ? ' and set as the current semester' : ''}.`,
    type: 'semester',
  });

  emitSemestersUpdated(req.app);
  res.status(201).json({ message: 'Semester created successfully.', semester });
});

// PUT /api/semesters/:id
const updateSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });

  const { term, academic_year, start_date, end_date, is_current, status, year_label, add_drop_start, add_drop_end } = req.body;
  if (year_label !== undefined && !YEAR_LABELS.includes(year_label)) {
    return res.status(400).json({ message: 'Year label must be "Academic Year" or "School Year".' });
  }
  // Captured before any of the fields below get overwritten — the only way
  // to tell a genuine "ends here" transition (wasn't Completed, now is)
  // apart from a semester that was already Completed getting some unrelated
  // edit (a typo fix to its dates, say), which shouldn't re-archive/re-notify.
  const wasCompleted = semester.status === 'Completed';

  const nextEnd = end_date !== undefined ? end_date : semester.end_date;
  const nextStatus = status !== undefined ? status : semester.status;
  const nextCurrent = is_current !== undefined ? !!is_current : semester.is_current;
  if (hasEnded(nextEnd) && (nextStatus === 'Active' || nextCurrent)) {
    return res.status(400).json({ message: endedMessage(nextEnd) });
  }

  if (term !== undefined) semester.term = term;
  if (academic_year !== undefined) semester.academic_year = academic_year;
  if (term || academic_year) {
    semester.name = `${semester.term} ${semester.academic_year}`;
  }
  if (year_label !== undefined) semester.year_label = year_label;
  if (start_date !== undefined) semester.start_date = start_date;
  if (end_date !== undefined) semester.end_date = end_date;
  if (add_drop_start !== undefined) semester.add_drop_start = add_drop_start || null;
  if (add_drop_end !== undefined) semester.add_drop_end = add_drop_end || null;
  if (status !== undefined) semester.status = status;

  // Whichever semester WAS current just got superseded — same "ends here"
  // moment as createSemester's own supersession case.
  let supersededSemester = null;
  if (is_current) {
    supersededSemester = await Semester.findOne({ where: { is_current: true, id: { [Op.ne]: semester.id } } });
    await Semester.update({ is_current: false }, { where: { is_current: true } });
    semester.is_current = true;
  } else if (is_current === false) {
    semester.is_current = false;
  }

  await semester.save();
  await logActivity(req.user.id, `updated semester ${semester.name}`, 'Semester', semester.id);

  // Covers both ways this one request can end a semester: Admin explicitly
  // set status to Completed above (checked against the BEFORE snapshot, so
  // an already-Completed semester getting an unrelated edit doesn't
  // re-fire), or setting THIS semester current superseded a different one
  // (endSemester there re-checks that row's own status itself, since it was
  // never mutated by this request).
  if (!wasCompleted && semester.status === 'Completed') await archiveEndedSemester(req.app, semester);
  if (supersededSemester) await endSemester(req.app, supersededSemester);
  await endPastSemesters(req.app);
  await semester.reload();

  emitSemestersUpdated(req.app);
  res.json({ message: 'Semester updated successfully.', semester });
});

// Semesters are never deleted — one is archived by marking it Completed
// (updateSemester), which archives its classes too.

// PUT /api/semesters/:id/set-current
const setCurrentSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });
  if (hasEnded(semester.end_date)) return res.status(400).json({ message: endedMessage(semester.end_date) });

  // Whichever semester WAS current just got superseded by this one — same
  // "ends here" moment createSemester/updateSemester's own is_current
  // supersession handles.
  const supersededSemester = await Semester.findOne({ where: { is_current: true, id: { [Op.ne]: semester.id } } });
  await Semester.update({ is_current: false }, { where: { is_current: true } });

  semester.is_current = true;
  semester.status = 'Active';
  await semester.save();

  await logActivity(req.user.id, `set ${semester.name} as current semester`, 'Semester', semester.id);

  if (supersededSemester) await endSemester(req.app, supersededSemester);

  emitSemestersUpdated(req.app);
  res.json({ message: `${semester.name} is now the current semester.`, semester });
});

module.exports = { getSemesters, getCurrentSemester, createSemester, updateSemester, setCurrentSemester, endSemester, emitSemestersUpdated };