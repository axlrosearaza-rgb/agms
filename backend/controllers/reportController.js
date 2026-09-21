const { Grade, Class, Subject, User, Enrollment, Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { createNotification } = require('./notificationController');
const { actsAsInstructor } = require('../utils/teachingAuth');

// GET /api/reports/grades — Instructor's own classes, grade summary by subject/class
const getInstructorGradeReport = asyncHandler(async (req, res) => {
  const { semester } = req.query;

  const classWhere = { instructor_id: req.user.id };
  if (semester) classWhere.semester = semester;

  const classes = await Class.findAll({
    where: classWhere,
    include: [{ model: Subject, as: 'subject' }],
    order: [['created_at', 'DESC']],
  });

  const classIds = classes.map((c) => c.id);
  const grades = await Grade.findAll({ where: { class_id: classIds, submitted: true } });

  const gradesByClass = {};
  grades.forEach((g) => {
    if (!gradesByClass[g.class_id]) gradesByClass[g.class_id] = [];
    gradesByClass[g.class_id].push(g);
  });

  const report = classes.map((cls) => {
    const clsGrades = gradesByClass[cls.id] || [];
    const graded = clsGrades.filter((g) => g.average !== null && g.status !== 'INC');
    const avgs = graded.map((g) => parseFloat(g.average));
    return {
      class_id: cls.id,
      subject_code: cls.subject?.code,
      subject_name: cls.subject?.name,
      year_level: cls.subject?.year_level,
      section: cls.section,
      semester: cls.semester,
      total_students: clsGrades.length,
      avg_gwa: avgs.length > 0 ? (avgs.reduce((s, v) => s + v, 0) / avgs.length).toFixed(1) : null,
      passed: clsGrades.filter((g) => g.status === 'Passed').length,
      failed: clsGrades.filter((g) => g.status === 'Failed').length,
      inc: clsGrades.filter((g) => g.status === 'INC').length,
    };
  });

  res.json({ report });
});

// POST /api/reports/send — notify Chairperson(s) of instructor's program + all Admins
const sendGradeReport = asyncHandler(async (req, res) => {
  const { semester } = req.body;

  const instructor = await User.findByPk(req.user.id);

  const recipients = await User.findAll({
    where: {
      status: 'Active',
      [Op.or]: [
        { role: 'Admin' },
        { role: 'Chairperson', programs: { [Op.overlap]: instructor.programs || [] } },
      ],
    },
  });

  const title = 'Grade Report Submitted';
  const message = semester
    ? `${instructor.name} sent their grade report for ${semester}.`
    : `${instructor.name} sent their grade report.`;

  // '/instructor/reports' was never a real route for either recipient role —
  // Chairperson's actual Reports page is /chairperson/reports; Admin has no
  // standalone one, so they land on their Dashboard (same grade/program
  // analytics, just not this one instructor-scoped report).
  await Promise.all(
    recipients.map((r) =>
      createNotification(req.app, {
        userId: r.id,
        title,
        message,
        type: 'report',
        link: r.role === 'Chairperson' ? '/chairperson/reports' : '/admin',
      })
    )
  );

  await logActivity(req.user.id, `sent grade report to ${recipients.length} recipient(s)${semester ? ` for ${semester}` : ''}`, 'Grade', null);

  res.json({ message: `Report sent to ${recipients.length} recipient(s).` });
});

// Shared by submitGrades (gradeController — fires this automatically the
// moment every enrolled student's grade is submitted, no separate "Send to
// Chairperson" click needed anymore) and sendGradingSheet below (kept as a
// manual fallback/API endpoint). Notifies only the Chairperson of this
// class's own SUBJECT program — Admin's turn is later, once the Chairperson
// actually forwards it (see forwardGradingSheetToAdmin/verifyDocument) — and
// flags cls.sent_to_chairperson so it's never sent twice. Returns null (does
// nothing) if it's already been sent or isn't actually ready — safe to call
// speculatively without the caller having to duplicate those checks.
const notifyGradingSheetSent = async (app, cls, actingUser) => {
  if (cls.sent_to_chairperson) return null;

  const enrolledCount = await Enrollment.count({ where: { class_id: cls.id } });
  const submittedCount = await Grade.count({ where: { class_id: cls.id, submitted: true } });
  if (enrolledCount === 0 || submittedCount < enrolledCount) return null;

  // Chairperson of this class's own SUBJECT program only — Admin's own
  // touchpoint is the Chairperson's later "Forward to Admin" step
  // (forwardGradingSheetToAdmin/verifyDocument below), not this one. A
  // submission still sitting with the Chairperson is exactly that: still
  // with the Chairperson, nobody else's move to make yet.
  //
  // Matched against cls.subject.program, NOT cls.instructor.programs — this
  // app supports cross-program teaching (a Faculty/Chairperson tagged for
  // one program teaching a subject that belongs to a different one), so the
  // instructor's own tag is not a reliable stand-in for "which Chairperson
  // owns this class." Using it here silently dropped the notification
  // whenever a class's actual subject program didn't match its instructor's
  // tag — the right Chairperson never heard about the submission at all.
  const recipients = await User.findAll({
    where: {
      status: 'Active',
      role: 'Chairperson',
      programs: { [Op.contains]: [cls.subject?.program] },
    },
  });

  const title = 'Grading Sheet Submitted';
  const message = `${cls.instructor?.name || actingUser?.name || 'Faculty'} sent the Grading Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} — ${submittedCount} of ${enrolledCount} student grade${enrolledCount !== 1 ? 's' : ''} submitted.`;

  await Promise.all(
    recipients.map((r) =>
      createNotification(app, {
        userId: r.id,
        title,
        message,
        type: 'report',
        // The actual Grade Approval work happens on this list page — not
        // /grading-sheet/:id, which is the read-only print preview.
        link: '/chairperson/grading-sheets',
      })
    )
  );

  // Locks this from ever firing twice for the same class until it's
  // actually bounced back to Faculty for revision (returnToFaculty resets
  // it) — it's sitting with the Chairperson/Admin pipeline now.
  cls.sent_to_chairperson = true;
  await cls.save();

  if (actingUser) {
    await logActivity(actingUser.id, `sent grading sheet for ${cls.subject?.code} to ${recipients.length} recipient(s)`, 'Class', cls.id);
  }

  return { recipientCount: recipients.length, submittedCount, enrolledCount };
};

// POST /api/reports/send-grading-sheet/:classId — manual fallback: Submit
// Grades now sends this automatically (see notifyGradingSheetSent above and
// gradeController.submitGrades), so the UI no longer has a "Send to
// Chairperson" button, but this stays callable directly in case a class
// somehow reaches "fully submitted" without going through submitGrades.
const sendGradingSheet = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  // actsAsInstructor also admits a Chairperson flagged is_teaching (own
  // classes only) — same pattern as gradeComponentController's ownership
  // checks, so a teaching Chairperson can send their own class's sheet too.
  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only send grading sheets for your own classes.' });
  }

  if (cls.sent_to_chairperson) {
    return res.status(400).json({ message: 'This class has already been sent to your Chairperson.' });
  }

  const result = await notifyGradingSheetSent(req.app, cls, req.user);
  if (!result) {
    return res.status(400).json({ message: 'Submit Grades for every student before sending to your Chairperson.' });
  }

  const io = req.app.get('io');
  if (io) io.emit('gradesUpdated', { class_id: cls.id, message: 'Grading sheet sent to Chairperson' });

  res.json({ message: `Grading sheet sent to ${result.recipientCount} recipient(s) (${result.submittedCount}/${result.enrolledCount} students submitted).` });
});

// POST /api/reports/forward-grading-sheet/:classId — Chairperson forwards a class's
// Grading Sheet to Admin for final approval (separate from the Instructor's earlier
// "send to Chairperson" step — this is the next hop in the chain, and it's the
// Chairperson's own review that's being forwarded, not a duplicate FYI).
const forwardGradingSheetToAdmin = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Chairperson' && !(req.user.programs || []).includes(cls.subject?.program)) {
    return res.status(403).json({ message: 'You may only forward grading sheets for classes in your own program.' });
  }

  // This IS the Chairperson's verification, not just a notification trigger —
  // it's the first of the two sign-offs (the other being Admin's per-student
  // grade approval) that unlocks releasing this class's grades to students
  // (see gradeController.releaseClassGrades). Forwarding covers the Class
  // Record and Grade Sheet together as one combined sign-off — Admin can
  // still later verify (or send back) each one separately from their own
  // preview, but the Chairperson's own action here isn't split.
  const now = new Date();
  cls.chairperson_verified = true;
  cls.chairperson_verified_at = now;
  cls.class_record_verified = true;
  cls.class_record_verified_at = now;
  cls.grade_sheet_verified = true;
  cls.grade_sheet_verified_at = now;
  await cls.save();

  const admins = await User.findAll({ where: { status: 'Active', role: 'Admin' } });

  const title = 'Grading Sheet Ready for Approval';
  const message = `${req.user.name} forwarded the Grading Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} for final approval.`;

  await Promise.all(
    admins.map((a) =>
      createNotification(req.app, { userId: a.id, title, message, type: 'report', link: `/admin/grade-approval/${cls.id}` })
    )
  );

  await logActivity(req.user.id, `forwarded grading sheet for ${cls.subject?.code} to ${admins.length} admin(s) for approval`, 'Class', cls.id);

  const io = req.app.get('io');
  if (io) io.emit('gradesUpdated', { class_id: cls.id, message: 'Grading sheet forwarded to Admin' });

  res.json({ message: `Grading sheet forwarded to ${admins.length} admin(s) for approval.` });
});

const DOC_TYPES = {
  record: { field: 'class_record_verified', atField: 'class_record_verified_at', label: 'Class Record', link: (id) => `/class-record/${id}` },
  sheet: { field: 'grade_sheet_verified', atField: 'grade_sheet_verified_at', label: 'Grade Sheet', link: (id) => `/grading-sheet/${id}` },
};

// POST /api/reports/verify-document/:classId — Body: { type: 'record' | 'sheet' }.
// Chairperson approves ONE of the two documents at a time (replaces the old
// single "forward both at once" button — forwardGradingSheetToAdmin above is
// kept for backward compatibility but the UI no longer calls it). Only once
// BOTH are true does this actually forward to Admin — same combined
// chairperson_verified gate and Admin notification the old single-button
// version fired, just reached incrementally instead of in one shot.
const verifyDocument = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const doc = DOC_TYPES[req.body.type];
  if (!doc) return res.status(400).json({ message: 'type must be "record" or "sheet".' });

  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Chairperson' && !(req.user.programs || []).includes(cls.subject?.program)) {
    return res.status(403).json({ message: 'You may only verify classes in your own program.' });
  }

  // Nothing to verify if Faculty hasn't actually submitted anything yet —
  // the frontend already hides the Approve button in that case (Grading
  // Sheets' "Not Yet Submitted by Faculty" stage), but re-checked here too
  // so a direct API call can't approve an empty Class Record/Grade Sheet.
  const submittedCount = await Grade.count({ where: { class_id: cls.id, submitted: true } });
  if (submittedCount === 0) {
    return res.status(400).json({ message: 'Faculty has not submitted any grades for this class yet — nothing to verify.' });
  }

  const now = new Date();
  cls[doc.field] = true;
  cls[doc.atField] = now;
  // Acting on it at all clears any "Admin sent this back" flag — the
  // Chairperson has now addressed it, one way or another.
  cls.admin_return_reason = null;
  cls.admin_returned_at = null;

  const bothVerified = cls.class_record_verified && cls.grade_sheet_verified;
  if (bothVerified && !cls.chairperson_verified) {
    cls.chairperson_verified = true;
    cls.chairperson_verified_at = now;
  }
  await cls.save();

  const io = req.app.get('io');

  if (bothVerified) {
    const admins = await User.findAll({ where: { status: 'Active', role: 'Admin' } });
    const title = 'Grading Sheet Ready for Approval';
    const message = `${req.user.name} forwarded the Grading Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} for final approval.`;
    await Promise.all(
      admins.map((a) =>
        createNotification(req.app, { userId: a.id, title, message, type: 'report', link: `/admin/grade-approval/${cls.id}` })
      )
    );
    // Faculty previously only heard about their submitted grades again once
    // Admin fully approved (approveDocument's fullyCleared notice below) or
    // if the Chairperson bounced it back — this is the one real pipeline
    // step in between that went silent. Not actionable for Faculty (nothing
    // to click), just visibility that their submission actually moved.
    if (cls.instructor_id) {
      const instructorBase = cls.instructor?.role === 'Chairperson' ? '/chairperson' : '/faculty';
      await createNotification(req.app, {
        userId: cls.instructor_id,
        title: 'Verified by Chairperson',
        message: `Your Chairperson verified ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}'s Class Record and Grade Sheet and forwarded it to Admin for final approval.`,
        type: 'grade',
        link: `${instructorBase}/encode/${cls.id}`,
      });
    }
    await logActivity(req.user.id, `verified the ${doc.label.toLowerCase()} and forwarded ${cls.subject?.code} to ${admins.length} admin(s) for approval`, 'Class', cls.id);
    if (io) io.emit('gradesUpdated', { class_id: cls.id, message: 'Forwarded to Admin' });
    return res.json({ message: `${doc.label} verified — both documents are now verified, forwarded to ${admins.length} admin(s) for approval.`, fullyVerified: true });
  }

  await logActivity(req.user.id, `verified the ${doc.label.toLowerCase()} for ${cls.subject?.code}`, 'Class', cls.id);
  if (io) io.emit('gradesUpdated', { class_id: cls.id, message: `${doc.label} verified` });
  res.json({ message: `${doc.label} verified. Verify the other document too to forward this class to Admin.`, fullyVerified: false });
});

// POST /api/reports/return-to-chairperson/:classId — Body: { message }.
// Admin found a problem while reviewing — sends the WHOLE class back, not
// just whichever document happened to be open. Class Record and Grade Sheet
// always move together: both verification flags (and both of Admin's own
// approval flags, in case one had already been approved before the other
// turned up a problem) reset as one unit, and so does the combined
// chairperson_verified gate everything downstream relies on. A real state
// change, not just a chat message (see forwardGradingSheetToAdmin/
// verifyDocument for the normal forward path this reverses).
const returnToChairperson = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'Explain what needs to be revised.' });
  }

  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  cls.class_record_verified = false;
  cls.class_record_verified_at = null;
  cls.grade_sheet_verified = false;
  cls.grade_sheet_verified_at = null;
  cls.chairperson_verified = false;
  cls.chairperson_verified_at = null;
  cls.admin_class_record_approved = false;
  cls.admin_class_record_approved_at = null;
  cls.admin_grade_sheet_approved = false;
  cls.admin_grade_sheet_approved_at = null;
  // Lets the Chairperson's own Grade Approval page single these out into a
  // dedicated "Returned by Admin" container with the reason shown, instead
  // of blending back into the generic "not yet verified" pile.
  cls.admin_return_reason = message.trim();
  cls.admin_returned_at = new Date();
  await cls.save();

  const chairpersons = await User.findAll({
    where: {
      status: 'Active',
      role: 'Chairperson',
      programs: { [Op.overlap]: cls.subject?.program ? [cls.subject.program] : [] },
    },
  });

  const title = 'Class Record & Grade Sheet Sent Back for Revision';
  const notifyMessage = `The Admin sent back ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}'s Class Record and Grade Sheet: "${message.trim()}"`;

  // Chairperson only — Admin never hands a class straight back to Faculty.
  // The Chairperson is the one who reviews Admin's reason and decides
  // whether/when to bounce it on to Faculty themselves (returnToFaculty
  // below), so the instructor isn't notified or messaged at this step at
  // all; nothing here unlocks their grades for editing either.
  await Promise.all(
    chairpersons.map((c) =>
      // Grading Sheets (not /class-record/:id, the read-only preview) is
      // where a Chairperson actually re-verifies or bounces this to Faculty.
      createNotification(req.app, { userId: c.id, title, message: notifyMessage, type: 'report', link: '/chairperson/grading-sheets' })
    )
  );

  await logActivity(req.user.id, `sent back the class record & grade sheet for ${cls.subject?.code} for revision: "${message.trim()}"`, 'Class', cls.id);

  const io = req.app.get('io');
  if (io) io.emit('gradesUpdated', { class_id: cls.id, message: 'Sent back by Admin' });

  res.json({ message: `Sent back to ${chairpersons.length} chairperson(s) for revision.` });
});

// POST /api/reports/return-to-faculty/:classId — Body: { message }.
// Chairperson's counterpart to the one above: bounces the whole class back
// to Faculty instead of re-verifying a document that still has a problem.
// Resets the same full set of flags (nothing was actually cleared yet from
// this point, but this keeps both "send back" paths symmetric and safe to
// call regardless of how far the class got), AND un-submits every grade so
// Faculty can actually edit again (submitGrades/encodeGrades both refuse to
// touch an already-submitted grade otherwise) — the whole pipeline restarts
// from Faculty once they fix and resubmit.
const returnToFaculty = asyncHandler(async (req, res) => {
  const { classId } = req.params;
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ message: 'Explain what needs to be revised.' });
  }

  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Chairperson' && !(req.user.programs || []).includes(cls.subject?.program)) {
    return res.status(403).json({ message: 'You may only return classes in your own program.' });
  }

  cls.class_record_verified = false;
  cls.class_record_verified_at = null;
  cls.grade_sheet_verified = false;
  cls.grade_sheet_verified_at = null;
  cls.chairperson_verified = false;
  cls.chairperson_verified_at = null;
  cls.admin_class_record_approved = false;
  cls.admin_class_record_approved_at = null;
  cls.admin_grade_sheet_approved = false;
  cls.admin_grade_sheet_approved_at = null;
  cls.encoding_open = true;
  // The Chairperson has now acted on whatever Admin flagged (by bouncing it
  // further to Faculty), so it no longer belongs in the "Returned by Admin"
  // container either.
  cls.admin_return_reason = null;
  cls.admin_returned_at = null;
  // This is now Faculty's problem, not the Chairperson's — filtered off the
  // Chairperson's own Grade Approval page entirely until Faculty resubmits
  // (cleared in gradeController.submitGrades), instead of sitting in "Not
  // Yet Submitted" looking like a class nobody's touched yet.
  cls.awaiting_faculty_revision = true;
  // Own reason text — lets Faculty's Dashboard/My Classes single this out
  // into a "Returned by Chairperson" container with the reason shown, the
  // same way admin_return_reason drives the Chairperson's own container.
  cls.chairperson_return_reason = message.trim();
  cls.chairperson_returned_at = new Date();
  // Un-does the lock sendGradingSheet set — this is exactly the "returned
  // for revision" moment that's supposed to make Faculty's "Send to
  // Chairperson" button clickable again.
  cls.sent_to_chairperson = false;
  await cls.save();

  await Grade.update(
    { submitted: false, submitted_date: null, is_draft: true, admin_approved: false, admin_approved_date: null, released: false, released_date: null },
    { where: { class_id: cls.id } }
  );

  if (cls.instructor_id) {
    const instructorBase = cls.instructor?.role === 'Chairperson' ? '/chairperson' : '/faculty';
    await createNotification(req.app, {
      userId: cls.instructor_id,
      title: 'Class Record & Grade Sheet Sent Back for Revision',
      message: `Your Chairperson sent back ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}'s Class Record and Grade Sheet: "${message.trim()}". Please review, resubmit, and it will go through Chairperson and Admin review again.`,
      type: 'report',
      link: `${instructorBase}/encode/${cls.id}`,
    });

    // The bell notification above is easy to miss — put the actual revision
    // reason directly in Faculty's Messages inbox too, from the Chairperson
    // who sent it back, so it's impossible not to notice.
    const { sendSystemMessage } = require('./chatController');
    await sendSystemMessage(req.app, {
      fromUserId: req.user.id,
      toUserId: cls.instructor_id,
      body: `I sent back ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}'s Class Record and Grade Sheet for revision: "${message.trim()}"\n\n[Class Record](${instructorBase}/encode/${cls.id}?tab=components) · [Grade Sheet](${instructorBase}/encode/${cls.id}?tab=grades)`,
    });
  }

  await logActivity(req.user.id, `sent back the class record & grade sheet for ${cls.subject?.code} to Faculty for revision: "${message.trim()}"`, 'Class', cls.id);

  const io = req.app.get('io');
  if (io) io.emit('gradesUpdated', { class_id: cls.id, message: 'Sent back to Faculty' });

  res.json({ message: `Sent back to ${cls.instructor?.name || 'the instructor'} for revision.` });
});

// POST /api/reports/send-approved-grade-sheet/:classId — Admin's final step once
// a class has cleared both sign-offs (Chairperson-verified + every Passed grade
// Admin-approved): notifies the instructor and that program's Chairperson(s)
// that the Class Record / Grade Sheet is fully approved and finalized on record.
const sendApprovedGradeSheet = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (!cls.chairperson_verified) {
    return res.status(400).json({ message: 'This class has not been verified by the Chairperson yet.' });
  }

  const passedGrades = await Grade.count({ where: { class_id: cls.id, submitted: true, status: 'Passed' } });
  const stillPending = await Grade.count({ where: { class_id: cls.id, submitted: true, status: 'Passed', admin_approved: false } });
  if (passedGrades === 0 || stillPending > 0) {
    return res.status(400).json({ message: `${stillPending} student(s) are still awaiting your approval.` });
  }

  const recipients = await User.findAll({
    where: {
      status: 'Active',
      [Op.or]: [
        ...(cls.instructor_id ? [{ id: cls.instructor_id }] : []),
        { role: 'Chairperson', programs: { [Op.overlap]: cls.subject?.program ? [cls.subject.program] : [] } },
      ],
    },
  });

  const title = 'Grade Sheet Approved';
  const message = `The Class Record and Grade Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} has been fully approved and finalized by the Admin.`;

  await Promise.all(
    recipients.map((r) =>
      createNotification(req.app, { userId: r.id, title, message, type: 'report', link: `/class-record/${cls.id}` })
    )
  );

  await logActivity(req.user.id, `sent the approved grade sheet for ${cls.subject?.code} to ${recipients.length} recipient(s)`, 'Class', cls.id);

  res.json({ message: `Approved Grade Sheet sent to ${recipients.length} recipient(s).` });
});

const ADMIN_REPORT_PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

// Shared by both getAdminGradesReport (every program) and
// getChairpersonReport (just the caller's own program(s)) — one row per
// class currently running in `program` this semester, with the
// Passed/Incomplete/Failed/Dropped breakdown a Grades Monitoring Form needs.
const buildProgramClassBreakdown = async (program, currentSemester) => {
  const classes = await Class.findAll({
    where: { status: 'Active' },
    include: [
      { model: Subject, as: 'subject', where: { program }, attributes: ['id', 'code', 'name'] },
      { model: User, as: 'instructor', attributes: ['id', 'name'] },
    ],
    attributes: ['id', 'semester', 'year_level', 'section'],
  });
  const currentClasses = currentSemester ? classes.filter((c) => c.semester === currentSemester.name) : [];

  const classBreakdown = await Promise.all(currentClasses.map(async (cls) => {
    const clsGrades = await Grade.findAll({ where: { class_id: cls.id, submitted: true } });
    // The class-level "sent to chairperson" flag isn't timestamped, so the
    // closest real date to "submitted" is the latest of this class's own
    // individual Grade.submitted_date values (set by submitGrades).
    const submittedDates = clsGrades.map((g) => g.submitted_date).filter(Boolean);
    const dateSubmitted = submittedDates.length > 0
      ? new Date(Math.max(...submittedDates.map((d) => new Date(d).getTime())))
      : null;
    return {
      class_id: cls.id,
      year_level: cls.year_level,
      section: cls.section,
      subject_code: cls.subject?.code,
      subject_name: cls.subject?.name,
      instructor_name: cls.instructor?.name || '',
      date_submitted: dateSubmitted,
      passed: clsGrades.filter((g) => g.status === 'Passed').length,
      inc: clsGrades.filter((g) => g.status === 'INC').length,
      failed: clsGrades.filter((g) => g.status === 'Failed').length,
      dropped: clsGrades.filter((g) => g.status === 'DRP').length,
    };
  }));
  classBreakdown.sort((a, b) =>
    (a.year_level || 0) - (b.year_level || 0) ||
    String(a.section || '').localeCompare(String(b.section || '')) ||
    String(a.subject_code || '').localeCompare(String(b.subject_code || ''))
  );
  return classBreakdown;
};

// GET /api/reports/admin — one row per class currently running in each of
// the college's 4 programs, this semester only. Unlike the Chairperson's own
// equivalent (scoped to req.user.programs), Admin sees every program — this
// is the whole-college version.
const getAdminGradesReport = asyncHandler(async (req, res) => {
  const currentSemester = await Semester.findOne({ where: { is_current: true } });

  const programReports = await Promise.all(ADMIN_REPORT_PROGRAMS.map(async (program) => ({
    program,
    class_breakdown: await buildProgramClassBreakdown(program, currentSemester),
  })));

  res.json({ current_semester: currentSemester?.name || null, programs: programReports });
});

// GET /api/reports/chairperson — same shape as getAdminGradesReport above,
// scoped to just the calling Chairperson's own program(s) instead of every
// program in the college.
const getChairpersonReport = asyncHandler(async (req, res) => {
  const programs = req.user.programs || [];
  const currentSemester = await Semester.findOne({ where: { is_current: true } });

  const programReports = await Promise.all(programs.map(async (program) => ({
    program,
    class_breakdown: await buildProgramClassBreakdown(program, currentSemester),
  })));

  res.json({ current_semester: currentSemester?.name || null, programs: programReports });
});

module.exports = { getInstructorGradeReport, sendGradeReport, sendGradingSheet, notifyGradingSheetSent, forwardGradingSheetToAdmin, verifyDocument, returnToChairperson, returnToFaculty, sendApprovedGradeSheet, getAdminGradesReport, getChairpersonReport };
