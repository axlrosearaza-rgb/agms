const { emitGradesUpdated } = require('../utils/realtime');
const { cached } = require('../utils/responseCache');
const { USER_SECRET_FIELDS } = require('../utils/userFields');
const { Grade, Class, Subject, User, Enrollment, GradeComponent, ComponentItem, ComponentScore, Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { actsAsInstructor } = require('../utils/teachingAuth');
// Every Notification.create in this file goes through this instead — it also
// emits the real-time `notification:${userId}` Socket.IO event the frontend
// bell (and its notification sound) listens for. Creating a Notification row
// directly would leave it silently sitting there until the recipient's next
// page load/manual refresh, with no live badge update or sound at all.
const { createNotification } = require('./notificationController');
const { resolveCompletedINCs, classRecordFinalGrades } = require('./gradeComponentController');

// Grades only go out to students after BOTH sign-offs: the Chairperson's
// verification (chairperson_verified) AND Admin's approval of both documents
// (the Class Record and the Grade Sheet). Admin's side is checked from those
// two document flags, not just from "no Passed grade is still pending" —
// that alone reads as approved for a class with no Passed grades at all
// (everyone INC/Dropped/Failed), which Admin never actually looked at.
const adminSignedOff = (cls) => !!(cls.admin_class_record_approved && cls.admin_grade_sheet_approved);

// Valid GWA values
const VALID_GWA = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 5.0];

// ================= GET CLASS GRADES =================
const getGradesByClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.classId, {
    include: [
      { model: Subject, as: 'subject' },
      // `programs` (plural array) — not `program` (singular), which is
      // Student-only. Faculty/Chairperson use `programs` specifically to
      // support teaching more than one program.
      { model: User, as: 'instructor', attributes: ['id', 'name', 'programs', 'employment_type'] },
    ],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Faculty' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only view grades for your own classes.' });
  }

  // An INC past its deadline becomes 5.0 — settled before the grades are read.
  await require('../utils/incLapse').lapseExpiredINCs(req.app, { classId: cls.id });

  const enrollments = await Enrollment.findAll({
    where: { class_id: cls.id },
    include: [{
      model: User,
      as: 'student',
      attributes: ['id', 'name', 'student_no', 'avatar', 'program', 'year_level', 'section'],
    }],
  });

  // The Class Record is the source of truth — an INC student whose scores are
  // now all in isn't incomplete anymore, so settle that before reading the
  // grades, and the Grade Sheet (and everything built from it) matches.
  await resolveCompletedINCs(cls.id);

  const grades = await Grade.findAll({ where: { class_id: cls.id } });

  const gradeMap = {};
  grades.forEach(g => { gradeMap[g.student_id] = g; });

  const studentGrades = enrollments.map(e => ({
    student: e.student,
    grade: gradeMap[e.student_id] || null,
  }));

  // Whether this class's grades can be released to students: Chairperson
  // must have reviewed it (reportController.forwardGradingSheetToAdmin sets
  // chairperson_verified) AND Admin must have approved every submitted,
  // Passed grade (the same admin_approved flag the Grade Approval page
  // already uses) — "finalized by Admin" is derived from that, not a
  // separate stored flag.
  const submitted = grades.filter(g => g.submitted);
  const passed = submitted.filter(g => g.status === 'Passed');
  const pendingAdminApproval = passed.filter(g => !g.admin_approved).length;
  const alreadyReleased = submitted.length > 0 && submitted.every(g => g.released);
  const releaseStatus = {
    chairperson_verified: cls.chairperson_verified,
    chairperson_verified_at: cls.chairperson_verified_at,
    // Admin's sign-off only counts while the Chairperson's verification still
    // stands — a class sent back (by either one) resets chairperson_verified,
    // so it reads as awaiting again instead of staying "finalized" off grades
    // that happened to be approved before it was returned.
    admin_finalized: !!cls.chairperson_verified && adminSignedOff(cls) && pendingAdminApproval === 0,
    pending_admin_approval: pendingAdminApproval,
    submitted_count: submitted.length,
    already_released: alreadyReleased,
    can_release: submitted.length > 0 && !!cls.chairperson_verified && adminSignedOff(cls) && pendingAdminApproval === 0 && !alreadyReleased,
  };

  res.json({ class: cls, student_grades: studentGrades, release_status: releaseStatus });
});

// ================= ENCODE GRADES =================
const encodeGrades = asyncHandler(async (req, res) => {
  const { class_id, grades } = req.body;

  const cls = await Class.findByPk(class_id, {
    include: [{ model: Subject, as: 'subject' }],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only encode grades for your own classes.' });
  }

  if (!cls.encoding_open) {
    return res.status(400).json({ message: 'Grade encoding is closed for this class.' });
  }

  const results = [];
  // A class with a Class Record: the Final Grade and Passed/Failed come from
  // the record's scores, not from averaging the two period grades sent here.
  const fromRecord = await classRecordFinalGrades(cls);

  for (const g of grades) {
    const { student_id, midterm, finals } = g;

    // Validate GWA values (allow null for INC/incomplete entries)
    if (midterm !== null && midterm !== undefined && (parseFloat(midterm) < 1.0 || parseFloat(midterm) > 5.0)) {
      continue;
    }
    if (finals !== null && finals !== undefined && (parseFloat(finals) < 1.0 || parseFloat(finals) > 5.0)) {
      continue;
    }

    const enrolled = await Enrollment.findOne({ where: { class_id, student_id } });
    if (!enrolled) continue;

    const [grade, created] = await Grade.findOrCreate({
      where: { class_id, student_id },
      defaults: { midterm, finals, is_draft: true },
    });

    if (!created) {
      // ✅ Never overwrite an INC grade through normal encode — resolve it first (undoINC), which drops the status back to Pending
      if (grade.submitted && grade.status !== 'INC') continue;

      // Allow updating INC grades only if both midterm and finals are now provided
      // (meaning the student has completed their requirements)
      if (grade.status === 'INC' && (midterm === null || finals === null)) {
        continue; // Still incomplete, skip
      }

      grade.midterm = midterm;
      grade.finals = finals;
      grade.is_draft = true;
    }

    const recordGrade = fromRecord[student_id];
    if (recordGrade && grade.status !== 'INC' && grade.status !== 'DRP') {
      // Keep the Class Record's own Final Grade (the hook's plain average can
      // differ from it by a tenth, enough to flip Passed/Failed at 3.0).
      grade.average = recordGrade.average;
      grade.status = recordGrade.status;
      await grade.save({ skipAutoAverage: true });
    } else if (!created) {
      await grade.save(); // no Class Record: the hook computes average & status
    }

    results.push(grade);
  }

  await logActivity(
    req.user.id,
    `saved draft grades for ${cls.subject.code}`,
    'Class',
    class_id
  );

  const io = req.app.get('io');
  if (io) {
    emitGradesUpdated(io, { class_id, message: 'Grades updated (draft)' }, 'draft');
  }

  res.json({ message: 'Grades saved as draft.', grades: results });
});

// ================= MARK AS INC =================
// POST /api/grades/inc
const markAsINC = asyncHandler(async (req, res) => {
  const { class_id, student_id, inc_remarks, inc_deadline, period } = req.body;

  // INC is per period — Midterm and Finals are marked (and resolved)
  // independently, so which one this is for has to be stated.
  if (period !== 'Midterm' && period !== 'Finals') {
    return res.status(400).json({ message: 'Choose which period this INC is for: "Midterm" or "Finals".' });
  }

  // Required, not optional — an INC has to state what the student is
  // actually missing (the frontend already blocks submitting without it;
  // this is the real gate, same reasoning as every other frontend-validated
  // field in this app).
  // A compliance deadline is required too — the follow-up list and its time
  // limit are built on it, and a request can always skip the form's own check.
  if (!inc_deadline || Number.isNaN(new Date(inc_deadline).getTime())) {
    return res.status(400).json({ message: 'A compliance deadline is required to mark a student as INC.' });
  }

  if (!inc_remarks || !inc_remarks.trim()) {
    return res.status(400).json({ message: 'Reason / remarks are required to mark a student as INC.' });
  }

  const cls = await Class.findByPk(class_id, {
    include: [{ model: Subject, as: 'subject' }],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only mark INC for your own classes.' });
  }

  const enrolled = await Enrollment.findOne({ where: { class_id, student_id } });
  if (!enrolled) return res.status(404).json({ message: 'Student not enrolled in this class.' });

  // No "already fully scored" gate here anymore: Faculty can mark a period INC
  // (or edit an existing INC) at any time — whether the student's scores are
  // in or not is their call. (It used to reject a period with every score
  // entered, which is what kept "Mark INC" from being usable.)

  const [grade] = await Grade.findOrCreate({
    where: { class_id, student_id },
    defaults: {
      midterm: null,
      finals: null,
      average: null,
      status: 'INC',
      is_draft: false,
      submitted: true,
      submitted_date: new Date(),
      inc_remarks: inc_remarks || null,
      inc_deadline: inc_deadline || null,
    },
  });

  if (grade.submitted && grade.status !== 'INC') {
    return res.status(400).json({
      message: 'Grade already submitted. Cannot mark as INC.',
    });
  }

  // ✅ Use update() instead of save() to bypass the beforeSave hook.
  // midterm/finals are deliberately left as stored, not nulled: a period only
  // has a stored GWA once ALL of its scores were entered, so whatever is here
  // is a genuinely completed period — the Grade Sheet keeps showing it (INC
  // only for the period that's actually missing), same as the Class Record.
  // The overall average is what can't exist yet, so that alone is cleared.
  // Only THIS period gets flagged — the other one is never touched (an older
  // INC row with neither flag is settled to a real period when the class
  // loads, see resolveCompletedINCs).
  await Grade.update(
    {
      status: 'INC',
      average: null,
      is_draft: false,
      submitted: true,
      submitted_date: new Date(),
      inc_remarks: inc_remarks || null,
      inc_deadline: inc_deadline || null,
      inc_resolved_date: null,
      inc_lapsed_at: null,
      inc_lapsed_period: null,
      inc_midterm: period === 'Midterm' ? true : grade.inc_midterm,
      inc_finals: period === 'Finals' ? true : grade.inc_finals,
    },
    { where: { id: grade.id } }
  );

  await logActivity(
    req.user.id,
    `marked ${(await User.findByPk(student_id))?.name} as INC (${period}) in ${cls.subject.code}`,
    'Grade',
    grade.id
  );

  const io = req.app.get('io');
  if (io) {
    emitGradesUpdated(io, { class_id, message: 'INC grade recorded' }, 'pipeline');
  }

  const updated = await Grade.findByPk(grade.id);
  res.json({ message: 'Student marked as INC successfully.', grade: updated });
});

// ================= RESOLVE/UNDO INC =================
// POST /api/grades/inc/undo — the ONLY way out of INC (the old inc/resolve
// endpoint, which took a typed Midterm/Finals GWA directly with no per-item
// scores behind it, has been removed). Puts the grade back to blank/
// unsubmitted so the instructor completes it the normal way instead —
// editing item scores on the Class Record grid, same as any other student,
// with the real per-item scores (never cleared by markAsINC) still sitting
// there ready to finish entering. The frontend's "Resolve INC" button calls
// this directly now.
const undoINC = asyncHandler(async (req, res) => {
  const { grade_id, period } = req.body;

  const grade = await Grade.findByPk(grade_id, {
    include: [{ model: Class, as: 'class', include: [{ model: Subject, as: 'subject' }] }],
  });
  if (!grade) return res.status(404).json({ message: 'Grade record not found.' });
  if (grade.status !== 'INC') return res.status(400).json({ message: 'This grade is not marked as INC.' });

  if (actsAsInstructor(req.user) && grade.class.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only undo an INC for your own classes.' });
  }

  // Per period: resolving the Midterm INC leaves a Finals INC alone (and vice
  // versa) — the student only stops being INC once NO period is flagged.
  if (period === 'Midterm' || period === 'Finals') {
    const stillMidterm = period === 'Midterm' ? false : grade.inc_midterm;
    const stillFinals = period === 'Finals' ? false : grade.inc_finals;
    if (stillMidterm || stillFinals) {
      await Grade.update({ inc_midterm: stillMidterm, inc_finals: stillFinals }, { where: { id: grade_id } });
      const io = req.app.get('io');
      if (io) emitGradesUpdated(io, { class_id: grade.class_id, message: 'INC partly resolved' }, 'pipeline');
      const partial = await Grade.findByPk(grade_id);
      return res.json({ message: `${period} INC resolved — the student is still INC in the ${stillMidterm ? 'Midterm' : 'Finals'}.`, grade: partial, still_inc: true });
    }
  }

  await Grade.update(
    {
      status: 'Pending',
      average: null,
      midterm: null,
      finals: null,
      inc_midterm: false,
      inc_finals: false,
      submitted: false,
      is_draft: true,
      submitted_date: null,
      // The completed grade is a brand-new one — it hasn't been released or
      // approved yet, whatever the INC placeholder that came before it had
      // (INC grades get released along with the rest of the class). Left
      // as-is, `released` stayed true, so the class kept counting as "already
      // released" and Release to Students never became available again for
      // this student's new grade.
      released: false,
      released_date: null,
      admin_approved: false,
      admin_approved_date: null,
      inc_remarks: null,
      inc_deadline: null,
      inc_resolved_date: null,
      inc_lapsed_at: null,
      inc_lapsed_period: null,
    },
    { where: { id: grade_id } }
  );

  await logActivity(
    req.user.id,
    `undid INC status for student in ${grade.class.subject.code}`,
    'Grade',
    grade_id
  );

  const io = req.app.get('io');
  if (io) emitGradesUpdated(io, { class_id: grade.class_id, message: 'INC undone' }, 'pipeline');

  const updated = await Grade.findByPk(grade_id);
  res.json({ message: 'INC undone — grade is back to unsubmitted and ready to edit.', grade: updated });
});

// ================= MARK DRP =================
// POST /api/grades/drp — same shape as markAsINC (findOrCreate + a manual
// update() that bypasses the beforeSave average-computing hook), for the
// other final-status-without-a-number case: a student who officially
// dropped the class. Unlike INC, there's no "deadline"/"remarks" pair to
// collect — dropped is dropped.
const markAsDRP = asyncHandler(async (req, res) => {
  const { class_id, student_id } = req.body;

  const cls = await Class.findByPk(class_id, {
    include: [{ model: Subject, as: 'subject' }],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only mark a student Dropped for your own classes.' });
  }

  const enrolled = await Enrollment.findOne({ where: { class_id, student_id } });
  if (!enrolled) return res.status(404).json({ message: 'Student not enrolled in this class.' });

  const [grade] = await Grade.findOrCreate({
    where: { class_id, student_id },
    defaults: {
      midterm: null,
      finals: null,
      average: null,
      status: 'DRP',
      is_draft: false,
      submitted: true,
      submitted_date: new Date(),
    },
  });

  if (grade.submitted && grade.status !== 'DRP') {
    return res.status(400).json({ message: 'Grade already submitted. Cannot mark as Dropped.' });
  }

  await Grade.update(
    {
      status: 'DRP',
      average: null,
      midterm: null,
      finals: null,
      is_draft: false,
      submitted: true,
      submitted_date: new Date(),
    },
    { where: { id: grade.id } }
  );

  await logActivity(
    req.user.id,
    `marked ${(await User.findByPk(student_id))?.name} as Dropped in ${cls.subject.code}`,
    'Grade',
    grade.id
  );

  const io = req.app.get('io');
  if (io) emitGradesUpdated(io, { class_id, message: 'Student marked Dropped' }, 'pipeline');

  const updated = await Grade.findByPk(grade.id);
  res.json({ message: 'Student marked as Dropped successfully.', grade: updated });
});

// ================= UNDO DRP =================
// POST /api/grades/drp/undo — reverses a mistaken Drop back to a blank,
// unsubmitted grade the instructor can encode normally, same as before it
// was ever marked. No score to restore (there never was one — DRP replaces
// a grade, it doesn't sit alongside one), so this is just a clean reset
// rather than a "resolve" that computes a final average.
const undoDRP = asyncHandler(async (req, res) => {
  const { grade_id } = req.body;

  const grade = await Grade.findByPk(grade_id, {
    include: [{ model: Class, as: 'class', include: [{ model: Subject, as: 'subject' }] }],
  });
  if (!grade) return res.status(404).json({ message: 'Grade record not found.' });
  if (grade.status !== 'DRP') return res.status(400).json({ message: 'This grade is not marked as Dropped.' });

  if (actsAsInstructor(req.user) && grade.class.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only undo a Drop for your own classes.' });
  }

  await Grade.update(
    { status: 'Pending', average: null, midterm: null, finals: null, submitted: false, is_draft: true, submitted_date: null },
    { where: { id: grade_id } }
  );

  await logActivity(
    req.user.id,
    `undid Dropped status for student in ${grade.class.subject.code}`,
    'Grade',
    grade_id
  );

  const io = req.app.get('io');
  if (io) emitGradesUpdated(io, { class_id: grade.class_id, message: 'Drop undone' }, 'pipeline');

  const updated = await Grade.findByPk(grade_id);
  res.json({ message: 'Drop undone — grade is back to unsubmitted.', grade: updated });
});

// ================= GET INC LIST =================
// GET /api/grades/inc — returns all pending INC grades (for admin/chairperson view)
const getINCList = asyncHandler(async (req, res) => {
  const { class_id, semester } = req.query;

  const whereClause = { status: 'INC' };
  if (class_id) whereClause.class_id = class_id;

  const classWhere = {};
  if (semester) classWhere.semester = semester;

  // Instructors only see their own classes
  if (req.user.role === 'Faculty') {
    classWhere.instructor_id = req.user.id;
  }

  const incGrades = await Grade.findAll({
    where: whereClause,
    include: [
      {
        model: User,
        as: 'student',
        attributes: ['id', 'name', 'student_no', 'program', 'year_level'],
      },
      {
        model: Class,
        as: 'class',
        where: Object.keys(classWhere).length ? classWhere : undefined,
        include: [
          { model: Subject, as: 'subject', attributes: ['id', 'code', 'name', 'units'] },
          { model: User, as: 'instructor', attributes: ['id', 'name'] },
        ],
      },
    ],
    order: [['inc_deadline', 'ASC']],
  });

  const now = new Date();
  const result = incGrades.map(g => ({
    ...g.toJSON(),
    is_overdue: g.inc_deadline ? new Date(g.inc_deadline) < now : false,
  }));

  res.json({ inc_grades: result, total: result.length });
});

// ================= GET MY RELEASED INC LIST =================
// GET /api/grades/inc/mine — the Faculty's own follow-up list: students still
// marked INC in classes whose grades were already released to students, so
// there's one place to see who still needs to be completed. A student stays
// on it only for a set time — until the INC deadline set when they were
// marked (through the end of that day), or, when none was set, for
// INC_DEFAULT_WINDOW_DAYS after the grades were released. Past that they drop
// off; resolving the INC (undoINC) takes them off immediately since the
// status is no longer INC.
const INC_DEFAULT_WINDOW_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

const getMyReleasedINCList = asyncHandler(async (req, res) => {
  const incGrades = await Grade.findAll({
    where: { status: 'INC', released: true },
    include: [
      { model: User, as: 'student', attributes: ['id', 'name', 'student_no'] },
      {
        model: Class,
        as: 'class',
        required: true,
        where: { instructor_id: req.user.id },
        include: [{ model: Subject, as: 'subject', attributes: ['id', 'code', 'name'] }],
      },
    ],
  });

  const now = Date.now();
  const list = [];
  incGrades.forEach((g) => {
    const hasDeadline = !!g.inc_deadline;
    const startedAt = new Date(g.released_date || g.submitted_date || g.updatedAt).getTime();
    // A deadline is a calendar date — still valid for that whole day.
    const deadlineAt = hasDeadline ? new Date(g.inc_deadline).getTime() : startedAt + INC_DEFAULT_WINDOW_DAYS * DAY_MS;
    const expiresAt = hasDeadline ? deadlineAt + DAY_MS : deadlineAt;
    if (expiresAt <= now) return;
    list.push({
      id: g.id,
      student: g.student,
      class: {
        id: g.class.id,
        section: g.class.section,
        year_level: g.class.year_level,
        semester: g.class.semester,
        subject: g.class.subject,
      },
      inc_remarks: g.inc_remarks,
      // Which period(s) are INC (marked and resolved independently).
      incomplete_periods: [g.inc_midterm && 'Midterm', g.inc_finals && 'Finals'].filter(Boolean),
      inc_deadline: new Date(deadlineAt).toISOString(),
      deadline_is_default: !hasDeadline,
      days_left: Math.max(0, Math.ceil((expiresAt - now) / DAY_MS) - (hasDeadline ? 1 : 0)),
      expires_at: expiresAt,
    });
  });

  list.sort((a, b) => a.expires_at - b.expires_at);
  res.json({ inc_students: list, total: list.length });
});

// ================= SUBMIT GRADES =================
const submitGrades = asyncHandler(async (req, res) => {
  const { class_id } = req.body;

  const cls = await Class.findByPk(class_id, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: USER_SECRET_FIELDS } },
    ],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only submit grades for your own classes.' });
  }

  // ✅ FIX: Grades are ready to submit if they have a valid average (normal grades)
  // OR if they are explicitly marked INC/DRP (these are valid submitted states too)
  const gradesToSubmit = await Grade.findAll({
    where: {
      class_id,
      [Op.or]: [
        { average: { [Op.ne]: null } },     // Normal grades with computed average
        { status: { [Op.in]: ['INC', 'DRP'] } }, // INC/DRP are valid final states
      ],
    },
  });

  if (gradesToSubmit.length === 0) {
    return res.status(400).json({
      message: 'No complete grades to submit. Please encode grades or mark students as INC first.',
    });
  }

  const enrollCount = await Enrollment.count({ where: { class_id } });

  // ✅ Only submit grades that are not already submitted
  const notYetSubmitted = gradesToSubmit.filter(g => !g.submitted);
  const alreadyINC = gradesToSubmit.filter(g => g.status === 'INC' && g.submitted);

  if (notYetSubmitted.length > 0) {
    const idsToSubmit = notYetSubmitted.map(g => g.id);
    // released is cleared too: a grade being (re)submitted here hasn't been
    // released in its current form — this also heals a completed INC that was
    // resolved before undoINC started clearing it, whose stale released flag
    // kept the whole class reading "already released".
    await Grade.update(
      { submitted: true, is_draft: false, submitted_date: new Date(), released: false, released_date: null },
      { where: { id: { [Op.in]: idsToSubmit } } }
    );
  }

  // A grade submitted AFTER the Chairperson already verified the class can
  // only be a completed INC (a Chairperson return un-verifies everything, and
  // before verification there's nothing to redo) — the Class Record and Grade
  // Sheet both changed, so both have to go through the whole pipeline again:
  // Chairperson verifies each document, forwards to Admin, Admin approves.
  // Everything both of them signed off on is reset and the class is marked as
  // not-yet-sent, so notifyGradingSheetSent below (once every student has a
  // submitted grade) sends it to the Chairperson again. Admin hears about it
  // only later, when the Chairperson forwards it (verifyDocument) — same as
  // any first submission.
  if (notYetSubmitted.length > 0 && cls.chairperson_verified) {
    cls.chairperson_verified = false;
    cls.chairperson_verified_at = null;
    cls.class_record_verified = false;
    cls.class_record_verified_at = null;
    cls.grade_sheet_verified = false;
    cls.grade_sheet_verified_at = null;
    cls.admin_class_record_approved = false;
    cls.admin_class_record_approved_at = null;
    cls.admin_grade_sheet_approved = false;
    cls.admin_grade_sheet_approved_at = null;
    cls.admin_return_reason = null;
    cls.admin_returned_at = null;
    cls.sent_to_chairperson = false;
    await cls.save();
  }

  // Faculty resubmitting is what brings a class back into the Chairperson's
  // Grade Approval page after a returnToFaculty bounced it off entirely.
  if (cls.awaiting_faculty_revision) {
    cls.awaiting_faculty_revision = false;
    cls.chairperson_return_reason = null;
    cls.chairperson_returned_at = null;
    await cls.save();
  }

  const totalSubmitted = gradesToSubmit.length;
  const pendingCount = enrollCount - totalSubmitted;
  const incCount = gradesToSubmit.filter(g => g.status === 'INC').length;

  await logActivity(
    req.user.id,
    `submitted grades for ${cls.subject.code}`,
    'Class',
    class_id
  );

  const io = req.app.get('io');
  if (io) {
    emitGradesUpdated(io, { class_id, message: 'Grades submitted' }, 'pipeline');
  }

  // Every enrolled student now has a submitted grade — this class is
  // complete, so send it on to the Chairperson (and Admin) automatically
  // instead of making Faculty come back and click a separate "Send to
  // Chairperson" button. notifyGradingSheetSent re-checks the same
  // enrolled/submitted counts itself and no-ops if the class isn't actually
  // fully submitted yet (pendingCount > 0) or was already sent, so it's
  // safe to call on every submitGrades regardless of whether this call was
  // the one that finished the roster.
  if (pendingCount === 0) {
    const { notifyGradingSheetSent } = require('./reportController');
    await notifyGradingSheetSent(req.app, cls, req.user);
  }

  let message = 'Grades submitted successfully.';
  if (incCount > 0) message += ` ${incCount} student(s) marked as INC.`;
  if (pendingCount > 0) message += ` ${pendingCount} student(s) still pending.`;
  else message += ' Sent to your Chairperson for review.';

  res.json({
    message,
    submitted: totalSubmitted,
    inc: incCount,
    pending: pendingCount,
  });
});

// ================= UNDO SUBMISSION =================
// POST /api/grades/class/:classId/undo-submit — the instructor (Faculty, or a
// teaching Chairperson) takes back a Class Record + Grade Sheet they sent by
// mistake, so they can correct it and submit again. Only while it's still
// untouched on the Chairperson's side: once the Chairperson has verified
// either document (or anything further happened), the only way back is the
// Chairperson returning it for revision.
const undoSubmission = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: USER_SECRET_FIELDS } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only undo submissions for your own classes.' });
  }

  if (!cls.sent_to_chairperson) {
    return res.status(400).json({ message: 'This class has not been submitted yet.' });
  }

  const reviewStarted = cls.class_record_verified || cls.grade_sheet_verified || cls.chairperson_verified
    || cls.admin_class_record_approved || cls.admin_grade_sheet_approved;
  const releasedOrApproved = await Grade.count({
    where: { class_id: cls.id, [Op.or]: [{ released: true }, { admin_approved: true }] },
  });
  if (reviewStarted || releasedOrApproved > 0) {
    return res.status(400).json({
      message: 'Your Chairperson has already started reviewing this class, so the submission can no longer be undone. Ask your Chairperson to return it for revision instead.',
    });
  }

  await Grade.update(
    { submitted: false, submitted_date: null, is_draft: true },
    { where: { class_id: cls.id } }
  );
  cls.sent_to_chairperson = false;
  await cls.save();

  // Let the Chairperson(s) who were told about it know it's been taken back.
  const recipients = await User.findAll({
    where: { status: 'Active', role: 'Chairperson', programs: { [Op.contains]: [cls.subject?.program] } },
  });
  const label = `${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`;
  await Promise.all(
    recipients
      .filter((r) => r.id !== req.user.id)
      .map((r) => createNotification(req.app, {
        userId: r.id,
        title: 'Grading Sheet Submission Undone',
        message: `${cls.instructor?.name || req.user.name} took back the Class Record and Grade Sheet for ${label} to make corrections. It will come back once resubmitted.`,
        type: 'report',
        link: '/chairperson/grading-sheets',
      }))
  );

  await logActivity(req.user.id, `undid the grade submission for ${cls.subject?.code}`, 'Class', cls.id);

  const io = req.app.get('io');
  if (io) emitGradesUpdated(io, { class_id: cls.id, message: 'Submission undone' }, 'pipeline');

  res.json({ message: `Submission undone — ${label}'s Class Record and Grade Sheet are editable again. Submit again once corrected.` });
});

// A student's full grade record (grades / prospectus) is private: only the
// student themselves, the adviser of their Program / Year / Section (a
// Faculty or Chairperson with that section in their advisories), and the
// Chairperson of the student's own program.
const canViewStudentRecord = async (user, studentId) => {
  if (user.id === parseInt(studentId, 10)) return true;
  if (user.role !== 'Faculty' && user.role !== 'Chairperson') return false;
  const [me, student] = await Promise.all([
    User.findByPk(user.id, { attributes: ['advisories', 'programs'] }),
    User.findByPk(studentId, { attributes: ['role', 'program', 'year_level', 'section'] }),
  ]);
  if (!student || student.role !== 'Student') return false;
  if (user.role === 'Chairperson' && (me?.programs || []).includes(student.program)) return true;
  return (Array.isArray(me?.advisories) ? me.advisories : []).some((a) =>
    a.program === student.program && Number(a.year_level) === Number(student.year_level) && a.section === student.section);
};

// ================= STUDENT GRADES =================
const getStudentGrades = asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;
  const { semester } = req.query;

  if (!(await canViewStudentRecord(req.user, studentId))) {
    return res.status(403).json({ message: req.user.role === 'Student' ? 'You can only view your own grades.' : 'Only this student\'s adviser or their program\'s Chairperson can view their grades.' });
  }

  const student = await User.findByPk(studentId, {
    attributes: { exclude: USER_SECRET_FIELDS },
  });

  if (!student) return res.status(404).json({ message: 'Student not found.' });

  const enrollments = await Enrollment.findAll({
    where: { student_id: studentId },
    include: [{
      model: Class,
      as: 'class',
      ...(semester ? { where: { semester } } : {}),
      include: [
        { model: Subject, as: 'subject' },
        { model: User, as: 'instructor', attributes: ['id', 'name'] },
      ],
    }],
  });

  const allGrades = await Grade.findAll({ where: { student_id: studentId } });

  // If the student has not yet completed their account setup (password changed + email verified),
  // their grades cannot be received/viewed by the student, chairperson, or adviser on the grade record.
  // The grades remain safely stored in the database and will be revealed once setup is completed.
  const isSetup = !!student.account_setup_at;
  const isOwnRecord = req.user.role === 'Student';
  const grades = isSetup ? (isOwnRecord ? allGrades.filter((g) => g.released) : allGrades) : [];

  const gradeMap = {};
  grades.forEach(g => { gradeMap[g.class_id] = g; });

  const studentGrades = enrollments
    .filter(e => e.class)
    .map(e => ({
      class: e.class,
      grade: gradeMap[e.class_id] || null,
    }));

  // ✅ INC grades are submitted but excluded from GWA computation
  // Only Passed/Failed submitted grades count toward GWA
  const submittedGrades = grades.filter(g => g.submitted && g.average !== null && g.status !== 'INC');
  const incGrades = grades.filter(g => g.status === 'INC');

  const gwa = submittedGrades.length > 0
    ? (submittedGrades.reduce((sum, g) => sum + parseFloat(g.average), 0) / submittedGrades.length).toFixed(1)
    : null;

  const passed = submittedGrades.filter(g => g.status === 'Passed').length;
  const failed = submittedGrades.filter(g => g.status === 'Failed').length;

  res.json({
    student,
    grades: studentGrades,
    account_setup_pending: !isSetup,
    summary: {
      gwa,
      total_subjects: submittedGrades.length,
      passed,
      failed,
      // ✅ INC count surfaced separately so the student dashboard can show it
      inc: incGrades.length,
    },
  });
});

// ================= STUDENT PROSPECTUS =================
// The full curriculum checklist for the student's program (every subject, 1st
// through 4th year) with each subject's actual outcome overlaid — Passed /
// Failed / INC / DRP where a released grade exists, "In Progress" where
// they're currently enrolled but not yet graded, "Not Taken" otherwise. This
// is enrollment/grade-independent in scope (unlike getStudentGrades, which
// only lists classes actually enrolled in) — it always shows the complete
// curriculum so a student can see at a glance what's left.
const getStudentProspectus = asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;

  if (!(await canViewStudentRecord(req.user, studentId))) {
    return res.status(403).json({ message: req.user.role === 'Student' ? 'You can only view your own prospectus.' : 'Only this student\'s adviser or their program\'s Chairperson can view their grades.' });
  }

  const student = await User.findByPk(studentId, { attributes: { exclude: USER_SECRET_FIELDS } });
  if (!student) return res.status(404).json({ message: 'Student not found.' });

  if (!student.program) {
    return res.json({
      student,
      years: {},
      chairperson: null,
      summary: { total_subjects: 0, passed: 0, failed: 0, in_progress: 0, not_taken: 0, units_earned: 0, total_curriculum_units: 0, gwa: null },
    });
  }

  // The whole program curriculum (with prerequisites/co-requisites joined in) is
  // identical for every student in the same program, and it's the heaviest
  // query on this page — so it's fetched once and shared, not once per student
  // (every student opening My Grades ran their own copy). Dropped the moment a
  // subject is edited (see utils/responseCache.js TAGS_BY_PREFIX).
  const programSubjects = await cached(`curriculum:${student.program}`, { ttlMs: 60000, tags: ['classes'] }, () => Subject.findAll({
    where: { program: student.program },
    include: [
      { model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id', 'code'] },
      { model: Subject, as: 'co_requisites', through: { attributes: [] }, attributes: ['id', 'code'] },
    ],
    order: [['year_level', 'ASC'], ['semester', 'ASC'], ['code', 'ASC']],
  }));

  const enrollments = await Enrollment.findAll({
    where: { student_id: studentId },
    include: [{ model: Class, as: 'class' }],
  });
  const enrolledSubjectIds = new Set(enrollments.filter((e) => e.class).map((e) => e.class.subject_id));
  // The student's own curriculum (utils/studentCurriculum.js) — plus any
  // subject of another curriculum they were actually enrolled in, so a grade
  // is never left off the prospectus.
  const { followsCurriculum } = require('../utils/studentCurriculum');
  const subjects = programSubjects.filter((s) => followsCurriculum(s, student) || enrolledSubjectIds.has(s.id));

  const isSetup = !!student.account_setup_at;

  const grades = isSetup
    ? await Grade.findAll({
        where: { student_id: studentId },
        include: [{ model: Class, as: 'class' }],
        order: [['created_at', 'DESC']],
      })
    : [];

  // A subject can have more than one Grade row over time (a retake creates a
  // new class/grade pair) — pick the most representative one: a Passed final
  // record wins outright; otherwise the most recent final record; otherwise
  // just the most recent record (grades are already newest-first).
  const bestGradeBySubject = {};
  for (const g of grades) {
    const subjId = g.class?.subject_id;
    if (!subjId) continue;
    const isFinal = g.submitted && g.released;
    const existing = bestGradeBySubject[subjId];
    if (!existing) { bestGradeBySubject[subjId] = g; continue; }
    const existingFinal = existing.submitted && existing.released;
    if (isFinal && g.status === 'Passed' && !(existingFinal && existing.status === 'Passed')) {
      bestGradeBySubject[subjId] = g;
    } else if (isFinal && !existingFinal) {
      bestGradeBySubject[subjId] = g;
    }
  }

  const rows = subjects.map((s) => {
    const g = bestGradeBySubject[s.id];
    const isFinal = g && g.submitted && g.released;
    let status = 'Not Taken';
    if (isFinal) status = g.status;
    else if (g || enrolledSubjectIds.has(s.id)) status = 'In Progress';
    return {
      subject: s,
      grade: isFinal ? { class_id: g.class_id, midterm: g.midterm, finals: g.finals, average: g.average, status: g.status } : null,
      status,
    };
  });

  const finalRows = rows.filter((r) => r.grade);
  const passed = finalRows.filter((r) => r.status === 'Passed');
  const failed = finalRows.filter((r) => r.status === 'Failed');
  const gwaEligible = finalRows.filter((r) => r.status !== 'INC' && r.status !== 'DRP' && r.grade?.average != null);
  const gwa = gwaEligible.length > 0
    ? (gwaEligible.reduce((sum, r) => sum + parseFloat(r.grade.average), 0) / gwaEligible.length).toFixed(3)
    : null;
  const unitsEarned = passed.reduce((sum, r) => sum + (r.subject.units || 0), 0);

  // For the "Verified By" line on the Evaluation of Grades export — the
  // actual Chairperson of the student's own program, not a hardcoded name,
  // so this stays correct as chairperson assignments change and for
  // students in any of the college's programs, not just one.
  const chairperson = await cached(`chairperson-of:${student.program}`, { ttlMs: 60000, tags: ['users'] }, () => User.findOne({
    where: { role: 'Chairperson', programs: { [Op.contains]: [student.program] } },
    attributes: ['id', 'name'],
  }));

  // "Evaluated By" — the student's adviser: the Faculty member the
  // Chairperson assigned as adviser of this student's own Program / Year /
  // Section (userController.setAdvisory). null until one is assigned.
  const adviser = student.year_level && student.section ? await User.findOne({
    where: {
      role: { [Op.in]: ['Faculty', 'Chairperson'] },
      advisories: { [Op.contains]: [{ program: student.program, year_level: student.year_level, section: student.section }] },
    },
    attributes: ['id', 'name'],
  }) : null;

  const years = {};
  rows.forEach((r) => {
    const yr = r.subject.year_level || 0;
    const sem = r.subject.semester || 'Unspecified';
    if (!years[yr]) years[yr] = {};
    if (!years[yr][sem]) years[yr][sem] = [];
    years[yr][sem].push(r);
  });

  res.json({
    student,
    years,
    account_setup_pending: !isSetup,
    chairperson: chairperson ? { id: chairperson.id, name: chairperson.name } : null,
    adviser: adviser ? { id: adviser.id, name: adviser.name } : null,
    summary: {
      total_subjects: subjects.length,
      passed: passed.length,
      failed: failed.length,
      in_progress: rows.filter((r) => r.status === 'In Progress').length,
      not_taken: rows.filter((r) => r.status === 'Not Taken').length,
      units_earned: unitsEarned,
      total_curriculum_units: subjects.reduce((sum, s) => sum + (s.units || 0), 0),
      gwa,
    },
  });
});

// ================= GWA DISTRIBUTION =================
const getGradeDistribution = asyncHandler(async (req, res) => {
  // `semester` alone used to collide across years — Class.semester is just
  // the term label ("1st Semester"), so without academic_year too, 2024's
  // and 2025's 1st Semester were indistinguishable and got merged into one
  // filter option. Both are now accepted (and returned together below) so
  // the dropdown can offer real Academic Year + Semester combinations.
  const { semester, academic_year } = req.query;
  let filterSemester = semester;
  let filterAcademicYear = academic_year;
  if (!filterSemester && !filterAcademicYear) {
    const currentSem = await Semester.findOne({ where: { is_current: true } });
    if (currentSem) {
      filterSemester = currentSem.name;
    }
  }

  // Admin sees the system-wide distribution; a Chairperson only sees their
  // own program(s) — otherwise this endpoint would leak other programs'
  // grades into what's meant to read as "my program's" chart.
  const classWhere = {};
  if (filterSemester) classWhere.semester = filterSemester;
  if (filterAcademicYear) classWhere.academic_year = filterAcademicYear;
  const classInclude = [{ model: Class, as: 'class', where: classWhere, attributes: ['semester', 'academic_year'] }];
  if (req.user.role === 'Chairperson') {
    classInclude[0].include = [{ model: Subject, as: 'subject', where: { program: { [Op.in]: req.user.programs || [] } }, attributes: [] }];
  }

  // Only grades the Admin has RELEASED to the students count: the chart
  // fills in by itself as each class is released, never earlier.
  const grades = await Grade.findAll({
    where: { released: true },
    include: classInclude,
  });

  // One bar-slot per STUDENT, not per grade row — a student takes several
  // subjects at once, so bucketing every grade separately let the same
  // student pad multiple bars (or the same bar several times) and made the
  // bars sum to way more than the actual number of students. Each student's
  // own overall GWA (mean of their per-subject averages, same computation
  // the student's own dashboard/prospectus uses — INC/DRP excluded, they
  // don't have a resolved average yet) gets bucketed exactly once instead.
  const byStudent = {};
  grades.forEach((g) => {
    if (g.average === null || g.status === 'INC' || g.status === 'DRP') return;
    if (!byStudent[g.student_id]) byStudent[g.student_id] = [];
    byStudent[g.student_id].push(parseFloat(g.average));
  });

  // Grades are now continuous (e.g. 2.86), so bucket into the familiar quarter-point
  // display buckets for charting purposes only — this doesn't touch the stored value.
  const distribution = {};
  VALID_GWA.forEach(g => { distribution[g.toFixed(2)] = 0; });

  Object.values(byStudent).forEach((averages) => {
    const studentGwa = averages.reduce((sum, a) => sum + a, 0) / averages.length;
    const bucket = studentGwa > 3.0 ? 5.0 : Math.min(3.0, Math.max(1.0, Math.round(studentGwa * 4) / 4));
    const key = bucket.toFixed(2);
    if (distribution[key] !== undefined) {
      distribution[key]++;
    }
  });

  const allClasses = await Class.findAll({
    attributes: ['semester', 'academic_year'],
    group: ['semester', 'academic_year'],
    raw: true,
  });
  // Newest academic year first, then semester as-is (whatever order Faculty
  // actually created classes in — there's no fixed "1st before 2nd" sort key
  // stored, and it's a short list either way).
  const semesters = allClasses
    .filter((c) => c.semester)
    .sort((a, b) => (b.academic_year || '').localeCompare(a.academic_year || ''))
    .map((c) => ({ semester: c.semester, academic_year: c.academic_year || null }));

  res.json({
    distribution,
    semesters,
    total: grades.length,
    passed: grades.filter(g => g.status === 'Passed').length,
    failed: grades.filter(g => g.status === 'Failed').length,
    // ✅ Include INC count in distribution stats
    inc: grades.filter(g => g.status === 'INC').length,
  });
});

// ================= RECENT =================
const getRecentSubmissions = asyncHandler(async (req, res) => {
  const grades = await Grade.findAll({
    where: { submitted: true },
    include: [
      { model: User, as: 'student', attributes: ['id', 'name', 'student_no'] },
      {
        model: Class, as: 'class',
        include: [{ model: Subject, as: 'subject', attributes: ['code', 'name'] }],
      },
    ],
    order: [['submitted_date', 'DESC']],
    limit: 10,
  });

  res.json({ grades });
});

// ================= REPORTS DATA =================
const getReportData = asyncHandler(async (req, res) => {
  const { type, semester, department, year_level } = req.query;

  let data = {};

  switch (type) {
    case 'grade-summary': {
      const includeClass = [{
        model: Class,
        as: 'class',
        ...(semester ? { where: { semester } } : {}),
        include: [
          { model: Subject, as: 'subject', ...(department ? { where: { department } } : {}) },
          { model: User, as: 'instructor', attributes: ['id', 'name'] },
        ],
      }];

      const grades = await Grade.findAll({
        where: { submitted: true },
        include: includeClass,
      });

      const bySubject = {};
      grades.forEach(g => {
        if (!g.class || !g.class.subject) return;
        const key = g.class.subject.code;
        if (!bySubject[key]) {
          bySubject[key] = {
            code: g.class.subject.code,
            name: g.class.subject.name,
            instructor: g.class.instructor?.name,
            semester: g.class.semester,
            grades: [],
          };
        }
        bySubject[key].grades.push({
          midterm: g.midterm !== null ? parseFloat(g.midterm) : null,
          finals: g.finals !== null ? parseFloat(g.finals) : null,
          average: g.average !== null ? parseFloat(g.average) : null,
          status: g.status,
        });
      });

      data.subjects = Object.values(bySubject).map(sub => {
        // ✅ Exclude INC from average computation
        const gradedGrades = sub.grades.filter(g => g.average !== null && g.status !== 'INC');
        const avgs = gradedGrades.map(g => g.average);
        return {
          ...sub,
          total_students: sub.grades.length,
          avg_gwa: avgs.length > 0 ? (avgs.reduce((s, v) => s + v, 0) / avgs.length).toFixed(1) : null,
          passed: sub.grades.filter(g => g.status === 'Passed').length,
          failed: sub.grades.filter(g => g.status === 'Failed').length,
          inc: sub.grades.filter(g => g.status === 'INC').length,
          pass_rate: gradedGrades.length > 0
            ? Math.round((sub.grades.filter(g => g.status === 'Passed').length / gradedGrades.length) * 100)
            : 0,
        };
      });
      break;
    }

    case 'student-perf': {
      const studentWhere = { role: 'Student', status: 'Active' };
      if (department) studentWhere.department = department;
      if (year_level) studentWhere.year_level = parseInt(year_level);

      const students = await User.findAll({
        where: studentWhere,
        attributes: { exclude: USER_SECRET_FIELDS },
      });

      data.students = await Promise.all(students.map(async (s) => {
        const grades = await Grade.findAll({
          where: { student_id: s.id, submitted: true },
          include: [{
            model: Class, as: 'class',
            ...(semester ? { where: { semester } } : {}),
            include: [{ model: Subject, as: 'subject' }],
          }],
        });

        // ✅ INC excluded from GWA
        const validGrades = grades.filter(g => g.class && g.average !== null && g.status !== 'INC');
        const gwa = validGrades.length > 0
          ? (validGrades.reduce((sum, g) => sum + parseFloat(g.average), 0) / validGrades.length).toFixed(1)
          : null;

        return {
          id: s.id,
          name: s.name,
          student_no: s.student_no,
          program: s.program,
          department: s.department,
          year_level: s.year_level,
          gwa,
          total_subjects: validGrades.length,
          passed: validGrades.filter(g => g.status === 'Passed').length,
          failed: validGrades.filter(g => g.status === 'Failed').length,
          inc: grades.filter(g => g.status === 'INC').length,
        };
      }));
      break;
    }

    case 'faculty-workload': {
      const instrWhere = { role: 'Faculty', status: 'Active' };
      if (department) instrWhere.department = department;

      const instructors = await User.findAll({
        where: instrWhere,
        attributes: { exclude: USER_SECRET_FIELDS },
      });

      data.instructors = await Promise.all(instructors.map(async (instr) => {
        const classWhere = { instructor_id: instr.id };
        if (semester) classWhere.semester = semester;

        const classes = await Class.findAll({
          where: classWhere,
          include: [{ model: Subject, as: 'subject' }],
        });

        let totalStudents = 0;
        let totalUnits = 0;
        for (const cls of classes) {
          const count = await Enrollment.count({ where: { class_id: cls.id } });
          totalStudents += count;
          totalUnits += cls.subject?.units || 0;
        }

        return {
          id: instr.id,
          name: instr.name,
          department: instr.department,
          total_classes: classes.length,
          total_students: totalStudents,
          total_units: totalUnits,
          classes: classes.map(c => ({
            subject_code: c.subject?.code,
            subject_name: c.subject?.name,
            schedule: c.schedule,
            semester: c.semester,
          })),
        };
      }));
      break;
    }

    case 'pass-fail': {
      const includeOpts = [{
        model: Class,
        as: 'class',
        ...(semester ? { where: { semester } } : {}),
        include: [{ model: Subject, as: 'subject', ...(department ? { where: { department } } : {}) }],
      }];

      const grades = await Grade.findAll({
        where: { submitted: true },
        include: includeOpts,
      });

      const bySubject = {};
      grades.forEach(g => {
        if (!g.class?.subject) return;
        const key = g.class.subject.code;
        if (!bySubject[key]) {
          bySubject[key] = {
            code: key,
            name: g.class.subject.name,
            department: g.class.subject.department,
            passed: 0, failed: 0, inc: 0, total: 0,
          };
        }
        bySubject[key].total++;
        if (g.status === 'Passed') bySubject[key].passed++;
        if (g.status === 'Failed') bySubject[key].failed++;
        if (g.status === 'INC') bySubject[key].inc++;
      });

      data.subjects = Object.values(bySubject).map(s => {
        const graded = s.passed + s.failed;
        return {
          ...s,
          pass_rate: graded > 0 ? Math.round((s.passed / graded) * 100) : 0,
          fail_rate: graded > 0 ? Math.round((s.failed / graded) * 100) : 0,
        };
      });
      break;
    }

    case 'enrollment': {
      const studentWhere = { role: 'Student', status: 'Active' };
      if (department) studentWhere.department = department;
      if (year_level) studentWhere.year_level = parseInt(year_level);

      const byDept = await User.findAll({
        where: studentWhere,
        attributes: ['department', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']],
        group: ['department'],
        raw: true,
      });

      const byYear = await User.findAll({
        where: studentWhere,
        attributes: ['year_level', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']],
        group: ['year_level'],
        raw: true,
      });

      const byProgram = await User.findAll({
        where: studentWhere,
        attributes: ['program', [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'count']],
        group: ['program'],
        raw: true,
      });

      data.by_department = byDept;
      data.by_year_level = byYear;
      data.by_program = byProgram;
      data.total = await User.count({ where: studentWhere });
      break;
    }

    default:
      return res.status(400).json({ message: 'Invalid report type.' });
  }

  res.json({ type, data });
});

// Used by the manual "Release Grades" endpoint — the actual actor who makes
// grades visible to students is the class's own Faculty (export the Class
// Record/Grade Sheet, then release), once both the Chairperson and Admin
// have verified. Not called automatically by approveClassGrades below —
// see the comment there for why. Returns null if the class isn't actually
// eligible yet (or already fully released), so callers can distinguish "not
// ready" from "released 0 because there was nothing left to release".
// An Irregular student self-selects, once, specific Subject IDs on their own
// record (User.regularization_subjects — set via
// userController.setRegularizationSubjects, one-shot and locked in via
// regularization_locked_at) as "clear these and you're Regular again."
// Called for every student whose grade just went `released` — the one point
// in the whole pipeline where a grade is truly final and official, not just
// Faculty's own encoded number. Once every subject in that list has a
// released Passed grade, flips student_status back to 'Regular' and clears
// regularization_subjects, regularization_locked_at, and irregular_sections
// on its own — nobody has to remember to do it by hand, and a future
// Irregular spell starts with a fresh, unlocked pick.
const checkAndRegularizeStudent = async (studentId, actorId, app) => {
  const student = await User.findByPk(studentId);
  if (!student || student.student_status !== 'Irregular' || !student.regularization_subjects?.length) return;

  const passedGrades = await Grade.findAll({
    where: { student_id: studentId, status: 'Passed', released: true },
    include: [{ model: Class, as: 'class', attributes: ['subject_id'] }],
  });
  const passedSubjectIds = new Set(passedGrades.map((g) => g.class?.subject_id).filter(Boolean));
  const allCleared = student.regularization_subjects.every((sid) => passedSubjectIds.has(sid));
  if (!allCleared) return;

  student.student_status = 'Regular';
  student.regularization_subjects = null;
  student.regularization_locked_at = null;
  student.irregular_sections = null;
  await student.save();

  await createNotification(app, {
    userId: studentId,
    title: 'Regular Status Restored',
    message: 'You’ve passed all your required subjects and are back to Regular status.',
    type: 'grade',
    link: '/student',
  });

  await logActivity(actorId, `${student.name} automatically regularized — all required subjects cleared`, 'User', studentId);
};

const releaseGradesForClass = async (cls, actorId, app) => {
  const grades = await Grade.findAll({ where: { class_id: cls.id, submitted: true } });
  if (grades.length === 0) return null;
  if (!cls.chairperson_verified) return null;
  if (!adminSignedOff(cls)) return null;
  const pendingAdminApproval = grades.filter((g) => g.status === 'Passed' && !g.admin_approved).length;
  if (pendingAdminApproval > 0) return null;

  const toRelease = grades.filter((g) => !g.released);
  if (toRelease.length === 0) return null;

  await Promise.all(toRelease.map((g) => g.update({ released: true, released_date: new Date() })));

  await Promise.all(toRelease.map((g) => createNotification(app, {
    userId: g.student_id,
    title: 'Grades Released',
    message: `Your grades for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} (${cls.semester}) have been released and are now visible.`,
    type: 'grade',
    link: '/student/grades',
  })));

  // Passed + released is exactly the trigger checkAndRegularizeStudent looks
  // for — only worth checking students who actually just cleared a Passed
  // grade, not every release.
  const uniqueStudentIds = [...new Set(toRelease.filter((g) => g.status === 'Passed').map((g) => g.student_id))];
  await Promise.all(uniqueStudentIds.map((sid) => checkAndRegularizeStudent(sid, actorId, app)));

  await logActivity(actorId, `released grades to ${toRelease.length} student(s) for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`, 'Class', cls.id);

  // Admin releases the grades — the class's instructor hears about it.
  if (cls.instructor_id && cls.instructor_id !== actorId) {
    await createNotification(app, {
      userId: cls.instructor_id,
      title: 'Grades Released to Students',
      message: `${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} was approved by Admin and its grades were released to ${toRelease.length} student(s).`,
      type: 'grade',
      link: `/faculty/encode/${cls.id}`,
    });
  }

  return toRelease.length;
};

// Off: the Admin releases approved classes by hand (Admin dashboard → Release
// Grades to Students, or Grade Approval). Set to true to release them
// automatically the moment both documents are approved.
const AUTO_RELEASE_ON_APPROVAL = false;

// Admin's approval of both documents is the last step — the grades go out to
// the students right then, with no separate "Release" click. Live-refreshes
// open pages and starts the automatic promotion check, same as a manual
// release. Returns how many students the grades were released to (0 if the
// class wasn't fully cleared yet).
const releaseAfterApproval = async (cls, actorId, app) => {
  const released = await releaseGradesForClass(cls, actorId, app);
  if (!released) return 0;
  const io = app.get('io');
  if (io) emitGradesUpdated(io, { class_id: cls.id, message: 'Grades released' }, 'release');
  require('./promotionController').autoPromoteForClass(app, cls.id);
  return released;
};

// Catch-up at server start: any class Admin already fully approved whose
// grades still aren't out (approved before release became automatic, or a
// release that failed midway) is released now. Never throws.
const releaseApprovedBacklog = async (app) => {
  try {
    const candidates = await Class.findAll({
      where: { chairperson_verified: true, admin_class_record_approved: true, admin_grade_sheet_approved: true },
      include: [
        { model: Subject, as: 'subject' },
        { model: Grade, as: 'grades', where: { submitted: true, released: false }, attributes: ['id'], required: true },
      ],
    });
    if (!candidates.length) return;
    const admin = await User.findOne({ where: { role: 'Admin', status: 'Active' }, attributes: ['id'], order: [['id', 'ASC']] });
    for (const cls of candidates) {
      const released = await releaseAfterApproval(cls, admin?.id || null, app);
      if (released) console.log(`[auto-release] ${cls.subject?.code || `class ${cls.id}`}${cls.section ? ` ${cls.section}` : ''}: released to ${released} student(s).`);
    }
  } catch (err) {
    console.error('[auto-release] backlog check failed:', err.message);
  }
};

// ================= ADMIN: APPROVE PASSED GRADES FOR A CLASS =================
// Registrar-office sign-off, separate from `released` (which controls
// student visibility). Only ever touches Passed, submitted grades — INC/
// Dropped/Failed students are left untouched until their status is
// resolved. The actual process: Faculty encodes → Chairperson verifies →
// forwards to Admin → Admin checks/approves here. That does NOT release
// grades to students by itself — once this clears the class's last pending
// Passed grade (and the Chairperson has already verified it), the
// instructor is notified that it's fully cleared and ready for them to
// export the Class Record/Grade Sheet and release grades themselves
// (releaseClassGrades below) — Faculty stays the one who actually publishes
// their own class's grades, Admin/Chairperson only clear it for release.
const approveClassGrades = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: ['id', 'name'] },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  // Admin only acts after the Chairperson has verified (same rule as
  // approveDocument below) — and approving here is Admin's sign-off on the
  // class as a whole, so it also marks both documents approved, which is what
  // releasing to students checks (adminSignedOff).
  if (!cls.chairperson_verified) {
    return res.status(400).json({ message: "This class hasn't been verified and forwarded by the Chairperson yet." });
  }
  const approvedAt = new Date();
  cls.admin_class_record_approved = true;
  cls.admin_class_record_approved_at = approvedAt;
  cls.admin_grade_sheet_approved = true;
  cls.admin_grade_sheet_approved_at = approvedAt;
  await cls.save();

  const grades = await Grade.findAll({
    where: { class_id: cls.id, submitted: true, status: 'Passed', admin_approved: false },
  });

  await Promise.all(grades.map(g => g.update({ admin_approved: true, admin_approved_date: new Date() })));

  await logActivity(req.user.id, `approved ${grades.length} passed grade(s) for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`, 'Class', cls.id);

  // Fully approved → released to the students right away (students and the
  // instructor are notified by the release itself).
  const released = AUTO_RELEASE_ON_APPROVAL ? await releaseAfterApproval(cls, req.user.id, req.app) : 0;

  const io = req.app.get('io');
  if (io && !released) emitGradesUpdated(io, { class_id: cls.id, message: `Admin approved ${grades.length} grade(s)` }, 'pipeline');

  res.json({
    message: `Approved ${grades.length} student grade(s).${released ? ` Grades released to ${released} student(s).` : ''}`,
    approved: grades.length,
    released,
  });
});

const ADMIN_DOC_TYPES = {
  record: { field: 'admin_class_record_approved', atField: 'admin_class_record_approved_at', label: 'Class Record' },
  sheet: { field: 'admin_grade_sheet_approved', atField: 'admin_grade_sheet_approved_at', label: 'Grade Sheet' },
};

// ================= ADMIN: APPROVE ONE DOCUMENT AT A TIME =================
// POST /api/grades/class/:classId/approve-document — Body: { type: 'record' |
// 'sheet' }. Admin's side of the same per-document pattern Chairperson uses
// (verify-document above) — two independent Approve buttons instead of one
// combined "Approve All Passed". Only reachable for classes the Chairperson
// has already forwarded. Once BOTH documents are approved here, this also
// runs the same Passed-grade bulk-approval approveClassGrades does (so
// Grade.admin_approved — what release eligibility actually checks — stays
// correct) and fires the same "ready to export & release" notice to Faculty.
const approveDocument = asyncHandler(async (req, res) => {
  const doc = ADMIN_DOC_TYPES[req.body.type];
  if (!doc) return res.status(400).json({ message: 'type must be "record" or "sheet".' });

  const cls = await Class.findByPk(req.params.classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: ['id', 'name'] },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  if (!cls.chairperson_verified) {
    return res.status(400).json({ message: "This class hasn't been verified and forwarded by the Chairperson yet." });
  }

  const now = new Date();
  cls[doc.field] = true;
  cls[doc.atField] = now;

  const bothApproved = cls.admin_class_record_approved && cls.admin_grade_sheet_approved;
  await cls.save();

  const io = req.app.get('io');

  if (!bothApproved) {
    await logActivity(req.user.id, `approved the ${doc.label.toLowerCase()} for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`, 'Class', cls.id);
    if (io) emitGradesUpdated(io, { class_id: cls.id, message: `${doc.label} approved by Admin` }, 'pipeline');
    return res.json({ message: `${doc.label} approved. Approve the other document too to release the grades to the students.`, fullyApproved: false });
  }

  // Both documents are now approved — clear every pending Passed grade the
  // same way approveClassGrades does, so Grade.admin_approved (what release
  // eligibility actually checks) is consistent with the two flags above.
  const pendingGrades = await Grade.findAll({
    where: { class_id: cls.id, submitted: true, status: 'Passed', admin_approved: false },
  });
  await Promise.all(pendingGrades.map((g) => g.update({ admin_approved: true, admin_approved_date: now })));

  await logActivity(req.user.id, `approved both documents (${pendingGrades.length} passed grade(s)) for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`, 'Class', cls.id);

  // Both approved → the grades go out to the students right away (students
  // and the instructor are notified by the release itself).
  const released = AUTO_RELEASE_ON_APPROVAL ? await releaseAfterApproval(cls, req.user.id, req.app) : 0;
  if (io && !released) emitGradesUpdated(io, { class_id: cls.id, message: 'Both documents approved by Admin' }, 'pipeline');

  res.json({
    message: released
      ? `${doc.label} approved — both documents are approved and the grades were released to ${released} student(s).`
      : `${doc.label} approved — both documents are now approved. Release the grades from the dashboard (Release Grades to Students).`,
    fullyApproved: true,
    released,
  });
});

// ================= RELEASE CLASS GRADES TO STUDENTS =================
// POST /api/grades/class/:classId/release — the actual "make it visible to
// students" step, triggered by Faculty (normally, after exporting their
// Class Record/Grade Sheet) once both the Chairperson and Admin have
// cleared the class. Admin/Chairperson can also call this directly as a
// fallback, but the normal path is Faculty's own action.
const releaseClassGrades = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.classId, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only release grades for your own classes.' });
  }

  const grades = await Grade.findAll({ where: { class_id: cls.id, submitted: true } });
  if (grades.length === 0) {
    return res.status(400).json({ message: 'No submitted grades to release yet.' });
  }
  if (!cls.chairperson_verified) {
    return res.status(400).json({ message: 'Your Chairperson hasn\'t verified this class\'s Grade Sheet and Class Records yet.' });
  }
  if (!adminSignedOff(cls)) {
    return res.status(400).json({ message: 'Admin hasn\'t approved this class\'s Class Record and Grade Sheet yet.' });
  }
  const pendingAdminApproval = grades.filter((g) => g.status === 'Passed' && !g.admin_approved).length;
  if (pendingAdminApproval > 0) {
    return res.status(400).json({ message: `Admin still has ${pendingAdminApproval} passed grade(s) awaiting approval on this class.` });
  }
  if (grades.every((g) => g.released)) {
    return res.status(400).json({ message: 'This class\'s grades have already been released.' });
  }

  const released = await releaseGradesForClass(cls, req.user.id, req.app);

  // Every other grade-changing action (draft save, submit, INC) fires this so
  // an already-open page live-refreshes instead of needing a manual reload —
  // release is the one students actually care about seeing instantly, so it
  // needs this at least as much as the others do.
  const io = req.app.get('io');
  if (io) {
    emitGradesUpdated(io, { class_id: cls.id, message: 'Grades released' }, 'release');
  }

  res.json({ message: `Released grades to ${released} student(s).`, released });

  // Automatic promotion check for this class's students — after the response,
  // so releasing never waits on it (promotionController.autoPromoteForClass).
  require('./promotionController').autoPromoteForClass(req.app, cls.id);
});

module.exports = {
  undoSubmission,
  getGradesByClass,
  encodeGrades,
  submitGrades,
  markAsINC,
  undoINC,
  markAsDRP,
  undoDRP,
  getINCList,
  getMyReleasedINCList,
  getStudentGrades,
  getStudentProspectus,
  getGradeDistribution,
  getRecentSubmissions,
  getReportData,
  approveClassGrades,
  approveDocument,
  releaseClassGrades,
  releaseApprovedBacklog,
};