const { Semester, Class } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyAllUsers } = require('./notificationController');

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
  const { term, academic_year, start_date, end_date, is_current, status } = req.body;

  if (!term || !academic_year) {
    return res.status(400).json({ message: 'Term and academic year are required.' });
  }

  const name = `${term} ${academic_year}`;

  const existing = await Semester.findOne({ where: { name } });
  if (existing) {
    return res.status(409).json({ message: 'This semester already exists.' });
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
    start_date: start_date || null,
    end_date: end_date || null,
    is_current: is_current || false,
    status: status || 'Upcoming',
  });

  await logActivity(req.user.id, `created semester ${name}`, 'Semester', semester.id);

  if (supersededSemester) {
    await endSemester(req.app, supersededSemester);
  }

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

  res.status(201).json({ message: 'Semester created successfully.', semester });
});

// PUT /api/semesters/:id
const updateSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });

  const { term, academic_year, start_date, end_date, is_current, status } = req.body;
  // Captured before any of the fields below get overwritten — the only way
  // to tell a genuine "ends here" transition (wasn't Completed, now is)
  // apart from a semester that was already Completed getting some unrelated
  // edit (a typo fix to its dates, say), which shouldn't re-archive/re-notify.
  const wasCompleted = semester.status === 'Completed';

  if (term !== undefined) semester.term = term;
  if (academic_year !== undefined) semester.academic_year = academic_year;
  if (term || academic_year) {
    semester.name = `${semester.term} ${semester.academic_year}`;
  }
  if (start_date !== undefined) semester.start_date = start_date;
  if (end_date !== undefined) semester.end_date = end_date;
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

  res.json({ message: 'Semester updated successfully.', semester });
});

// DELETE /api/semesters/:id
const deleteSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });

  if (semester.is_current) {
    return res.status(400).json({ message: 'Cannot delete the current semester.' });
  }

  await semester.destroy();
  await logActivity(req.user.id, `deleted semester ${semester.name}`, 'Semester', semester.id);
  res.json({ message: 'Semester deleted successfully.' });
});

// PUT /api/semesters/:id/set-current
const setCurrentSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });

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

  res.json({ message: `${semester.name} is now the current semester.`, semester });
});

module.exports = { getSemesters, getCurrentSemester, createSemester, updateSemester, deleteSemester, setCurrentSemester };