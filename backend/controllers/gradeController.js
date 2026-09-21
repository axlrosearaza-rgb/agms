const { Grade, Class, Subject, User, Enrollment, GradeComponent, ComponentItem, ComponentScore } = require('../models');
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

  const enrollments = await Enrollment.findAll({
    where: { class_id: cls.id },
    include: [{
      model: User,
      as: 'student',
      attributes: ['id', 'name', 'student_no', 'avatar', 'program', 'year_level'],
    }],
  });

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
    admin_finalized: pendingAdminApproval === 0,
    pending_admin_approval: pendingAdminApproval,
    submitted_count: submitted.length,
    already_released: alreadyReleased,
    can_release: submitted.length > 0 && cls.chairperson_verified && pendingAdminApproval === 0 && !alreadyReleased,
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
      await grade.save(); // beforeSave hook will auto-compute average & status
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
    io.emit('gradesUpdated', { class_id, message: 'Grades updated (draft)' });
  }

  res.json({ message: 'Grades saved as draft.', grades: results });
});

// ================= MARK AS INC =================
// POST /api/grades/inc
const markAsINC = asyncHandler(async (req, res) => {
  const { class_id, student_id, inc_remarks, inc_deadline } = req.body;

  // Required, not optional — an INC has to state what the student is
  // actually missing (the frontend already blocks submitting without it;
  // this is the real gate, same reasoning as every other frontend-validated
  // field in this app).
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

  // The real gate behind the frontend's disabled "Mark INC" button — a
  // student with every component item already scored has nothing left to be
  // incomplete about, so this blocks a direct API call from bypassing that.
  const classItemIds = (
    await ComponentItem.findAll({
      include: [{ model: GradeComponent, as: 'component', where: { class_id }, attributes: [] }],
      attributes: ['id'],
    })
  ).map((i) => i.id);
  if (classItemIds.length > 0) {
    const scoredCount = await ComponentScore.count({
      where: { student_id, item_id: classItemIds, score: { [Op.ne]: null } },
    });
    if (scoredCount === classItemIds.length) {
      return res.status(400).json({ message: 'This student is already fully scored — nothing left to mark incomplete.' });
    }
  }

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

  // ✅ Use update() instead of save() to bypass the beforeSave hook
  await Grade.update(
    {
      status: 'INC',
      average: null,
      midterm: null,
      finals: null,
      is_draft: false,
      submitted: true,
      submitted_date: new Date(),
      inc_remarks: inc_remarks || null,
      inc_deadline: inc_deadline || null,
      inc_resolved_date: null,
    },
    { where: { id: grade.id } }
  );

  await logActivity(
    req.user.id,
    `marked ${(await User.findByPk(student_id))?.name} as INC in ${cls.subject.code}`,
    'Grade',
    grade.id
  );

  const io = req.app.get('io');
  if (io) {
    io.emit('gradesUpdated', { class_id, message: 'INC grade recorded' });
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
  const { grade_id } = req.body;

  const grade = await Grade.findByPk(grade_id, {
    include: [{ model: Class, as: 'class', include: [{ model: Subject, as: 'subject' }] }],
  });
  if (!grade) return res.status(404).json({ message: 'Grade record not found.' });
  if (grade.status !== 'INC') return res.status(400).json({ message: 'This grade is not marked as INC.' });

  if (actsAsInstructor(req.user) && grade.class.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only undo an INC for your own classes.' });
  }

  await Grade.update(
    {
      status: 'Pending',
      average: null,
      midterm: null,
      finals: null,
      submitted: false,
      is_draft: true,
      submitted_date: null,
      inc_remarks: null,
      inc_deadline: null,
      inc_resolved_date: null,
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
  if (io) io.emit('gradesUpdated', { class_id: grade.class_id, message: 'INC undone' });

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
  if (io) io.emit('gradesUpdated', { class_id, message: 'Student marked Dropped' });

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
  if (io) io.emit('gradesUpdated', { class_id: grade.class_id, message: 'Drop undone' });

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

// ================= SUBMIT GRADES =================
const submitGrades = asyncHandler(async (req, res) => {
  const { class_id } = req.body;

  const cls = await Class.findByPk(class_id, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
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
    await Grade.update(
      { submitted: true, is_draft: false, submitted_date: new Date() },
      { where: { id: { [Op.in]: idsToSubmit } } }
    );
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
    io.emit('gradesUpdated', { class_id, message: 'Grades submitted' });
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

// ================= STUDENT GRADES =================
const getStudentGrades = asyncHandler(async (req, res) => {
  const studentId = req.params.studentId;
  const { semester } = req.query;

  if (req.user.role === 'Student' && req.user.id !== parseInt(studentId)) {
    return res.status(403).json({ message: 'You can only view your own grades.' });
  }

  const student = await User.findByPk(studentId, {
    attributes: { exclude: ['password'] },
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

  // A student viewing their own record only ever sees grades Faculty has
  // actually released (matching getStudentProspectus, which the My Grades
  // page itself calls) — `submitted` alone isn't enough, since a grade sits
  // submitted-but-unreleased through the whole Chairperson/Admin review
  // pipeline first. Staff viewing a student's record (Admin/Chairperson/
  // Faculty) still see everything, released or not.
  const isOwnRecord = req.user.role === 'Student';
  const grades = isOwnRecord ? allGrades.filter((g) => g.released) : allGrades;

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

  if (req.user.role === 'Student' && req.user.id !== parseInt(studentId)) {
    return res.status(403).json({ message: 'You can only view your own prospectus.' });
  }

  const student = await User.findByPk(studentId, { attributes: { exclude: ['password'] } });
  if (!student) return res.status(404).json({ message: 'Student not found.' });

  if (!student.program) {
    return res.json({
      student,
      years: {},
      chairperson: null,
      summary: { total_subjects: 0, passed: 0, failed: 0, in_progress: 0, not_taken: 0, units_earned: 0, total_curriculum_units: 0, gwa: null },
    });
  }

  const subjects = await Subject.findAll({
    where: { program: student.program },
    include: [
      { model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id', 'code'] },
      { model: Subject, as: 'co_requisites', through: { attributes: [] }, attributes: ['id', 'code'] },
    ],
    order: [['year_level', 'ASC'], ['semester', 'ASC'], ['code', 'ASC']],
  });

  const enrollments = await Enrollment.findAll({
    where: { student_id: studentId },
    include: [{ model: Class, as: 'class' }],
  });
  const enrolledSubjectIds = new Set(enrollments.filter((e) => e.class).map((e) => e.class.subject_id));

  const grades = await Grade.findAll({
    where: { student_id: studentId },
    include: [{ model: Class, as: 'class' }],
    order: [['created_at', 'DESC']],
  });

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
    ? (gwaEligible.reduce((sum, r) => sum + parseFloat(r.grade.average), 0) / gwaEligible.length).toFixed(1)
    : null;
  const unitsEarned = passed.reduce((sum, r) => sum + (r.subject.units || 0), 0);

  // For the "Verified By" line on the Evaluation of Grades export — the
  // actual Chairperson of the student's own program, not a hardcoded name,
  // so this stays correct as chairperson assignments change and for
  // students in any of the college's programs, not just one.
  const chairperson = await User.findOne({
    where: { role: 'Chairperson', programs: { [Op.contains]: [student.program] } },
    attributes: ['id', 'name'],
  });

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
    chairperson: chairperson ? { id: chairperson.id, name: chairperson.name } : null,
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

  // Admin sees the system-wide distribution; a Chairperson only sees their
  // own program(s) — otherwise this endpoint would leak other programs'
  // grades into what's meant to read as "my program's" chart.
  const classWhere = {};
  if (semester) classWhere.semester = semester;
  if (academic_year) classWhere.academic_year = academic_year;
  const classInclude = [{ model: Class, as: 'class', where: classWhere, attributes: ['semester', 'academic_year'] }];
  if (req.user.role === 'Chairperson') {
    classInclude[0].include = [{ model: Subject, as: 'subject', where: { program: { [Op.in]: req.user.programs || [] } }, attributes: [] }];
  }

  const grades = await Grade.findAll({
    where: { submitted: true },
    include: (semester || academic_year || req.user.role === 'Chairperson') ? classInclude : undefined,
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
        attributes: { exclude: ['password'] },
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
        attributes: { exclude: ['password'] },
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

  return toRelease.length;
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

  const grades = await Grade.findAll({
    where: { class_id: cls.id, submitted: true, status: 'Passed', admin_approved: false },
  });

  await Promise.all(grades.map(g => g.update({ admin_approved: true, admin_approved_date: new Date() })));

  await logActivity(req.user.id, `approved ${grades.length} passed grade(s) for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`, 'Class', cls.id);

  // Fully cleared now? Notify Faculty they can export & release — checked
  // fresh (not just "grades.length > 0") since a class could already have
  // had 0 pending Passed grades and just been waiting on this last check.
  const allGrades = await Grade.findAll({ where: { class_id: cls.id, submitted: true } });
  const stillPending = allGrades.filter((g) => g.status === 'Passed' && !g.admin_approved).length;
  const fullyCleared = cls.chairperson_verified && stillPending === 0 && allGrades.some((g) => !g.released);
  if (fullyCleared && cls.instructor_id) {
    await createNotification(req.app, {
      userId: cls.instructor_id,
      title: 'Class Record and Grade Sheet Approved',
      message: `${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} has been verified by your Chairperson and approved by Admin — you can now export the Class Record/Grade Sheet and release the grades to your students.`,
      type: 'grade',
      link: `/faculty/encode/${cls.id}`,
    });
  }

  const io = req.app.get('io');
  if (io) io.emit('gradesUpdated', { class_id: cls.id, message: `Admin approved ${grades.length} grade(s)` });

  res.json({ message: `Approved ${grades.length} student grade(s).`, approved: grades.length });
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
    if (io) io.emit('gradesUpdated', { class_id: cls.id, message: `${doc.label} approved by Admin` });
    return res.json({ message: `${doc.label} approved. Approve the other document too to notify Faculty.`, fullyApproved: false });
  }

  // Both documents are now approved — clear every pending Passed grade the
  // same way approveClassGrades does, so Grade.admin_approved (what release
  // eligibility actually checks) is consistent with the two flags above.
  const pendingGrades = await Grade.findAll({
    where: { class_id: cls.id, submitted: true, status: 'Passed', admin_approved: false },
  });
  await Promise.all(pendingGrades.map((g) => g.update({ admin_approved: true, admin_approved_date: now })));

  await logActivity(req.user.id, `approved both documents (${pendingGrades.length} passed grade(s)) for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`, 'Class', cls.id);

  const allGrades = await Grade.findAll({ where: { class_id: cls.id, submitted: true } });
  const hasUnreleased = allGrades.some((g) => !g.released);
  if (hasUnreleased && cls.instructor_id) {
    await createNotification(req.app, {
      userId: cls.instructor_id,
      title: 'Class Record and Grade Sheet Approved',
      message: `${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} has been verified by your Chairperson and approved by Admin — you can now export the Class Record/Grade Sheet and release the grades to your students.`,
      type: 'grade',
      link: `/faculty/encode/${cls.id}`,
    });
  }

  if (io) io.emit('gradesUpdated', { class_id: cls.id, message: 'Both documents approved by Admin' });

  res.json({ message: `${doc.label} approved — both documents are now approved. Faculty has been notified.`, fullyApproved: true });
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
    io.emit('gradesUpdated', { class_id: cls.id, message: 'Grades released' });
  }

  res.json({ message: `Released grades to ${released} student(s).`, released });
});

module.exports = {
  getGradesByClass,
  encodeGrades,
  submitGrades,
  markAsINC,
  undoINC,
  markAsDRP,
  undoDRP,
  getINCList,
  getStudentGrades,
  getStudentProspectus,
  getGradeDistribution,
  getRecentSubmissions,
  getReportData,
  approveClassGrades,
  approveDocument,
  releaseClassGrades,
};