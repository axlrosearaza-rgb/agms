const { Grade, Class, Subject, User, Enrollment, Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { createNotification } = require('./notificationController');

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
      avg_gwa: avgs.length > 0 ? (avgs.reduce((s, v) => s + v, 0) / avgs.length).toFixed(2) : null,
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

  await Promise.all(
    recipients.map((r) =>
      createNotification(req.app, { userId: r.id, title, message, type: 'report', link: '/instructor/reports' })
    )
  );

  await logActivity(req.user.id, `sent grade report to ${recipients.length} recipient(s)${semester ? ` for ${semester}` : ''}`, 'Grade', null);

  res.json({ message: `Report sent to ${recipients.length} recipient(s).` });
});

// POST /api/reports/send-grading-sheet/:classId — notify Chairperson(s) of this
// instructor's program + all Admins that a specific class's official Grading
// Sheet is ready for review (mirrors sendGradeReport, scoped to one class).
const sendGradingSheet = asyncHandler(async (req, res) => {
  const { classId } = req.params;

  const cls = await Class.findByPk(classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only send grading sheets for your own classes.' });
  }

  const recipients = await User.findAll({
    where: {
      status: 'Active',
      [Op.or]: [
        { role: 'Admin' },
        { role: 'Chairperson', programs: { [Op.overlap]: cls.instructor?.programs || [] } },
      ],
    },
  });

  const title = 'Grading Sheet Submitted';
  const message = `${cls.instructor?.name || req.user.name} sent the Grading Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}.`;

  await Promise.all(
    recipients.map((r) =>
      createNotification(req.app, { userId: r.id, title, message, type: 'report', link: `/grading-sheet/${cls.id}` })
    )
  );

  await logActivity(req.user.id, `sent grading sheet for ${cls.subject?.code} to ${recipients.length} recipient(s)`, 'Class', cls.id);

  res.json({ message: `Grading sheet sent to ${recipients.length} recipient(s).` });
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

  const admins = await User.findAll({ where: { status: 'Active', role: 'Admin' } });

  const title = 'Grading Sheet Ready for Approval';
  const message = `${req.user.name} forwarded the Grading Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} for final approval.`;

  await Promise.all(
    admins.map((a) =>
      createNotification(req.app, { userId: a.id, title, message, type: 'report', link: `/admin/grade-approval/${cls.id}` })
    )
  );

  await logActivity(req.user.id, `forwarded grading sheet for ${cls.subject?.code} to ${admins.length} admin(s) for approval`, 'Class', cls.id);

  res.json({ message: `Grading sheet forwarded to ${admins.length} admin(s) for approval.` });
});

// GET /api/reports/chairperson — per-program grade ratings (from faculty-submitted
// grades) plus student counts (enrolled this semester vs. total in system), scoped
// to the calling Chairperson's own program(s).
const getChairpersonReport = asyncHandler(async (req, res) => {
  const programs = req.user.programs || [];
  const currentSemester = await Semester.findOne({ where: { is_current: true } });

  const programReports = await Promise.all(programs.map(async (program) => {
    const totalStudents = await User.count({ where: { role: 'Student', status: 'Active', program } });

    const classes = await Class.findAll({
      where: { status: 'Active' },
      include: [{ model: Subject, as: 'subject', where: { program }, attributes: [] }],
      attributes: ['id', 'semester'],
    });
    const classIds = classes.map((c) => c.id);
    const currentClassIds = currentSemester ? classes.filter((c) => c.semester === currentSemester.name).map((c) => c.id) : [];

    const enrolledThisSemester = currentClassIds.length > 0
      ? await Enrollment.count({ where: { class_id: currentClassIds }, distinct: true, col: 'student_id' })
      : 0;

    const grades = classIds.length > 0 ? await Grade.findAll({ where: { class_id: classIds, submitted: true } }) : [];
    const passRate = grades.length > 0
      ? Math.round((grades.filter((g) => g.status === 'Passed').length / grades.length) * 100)
      : 0;
    const avgGWA = grades.length > 0
      ? (grades.reduce((sum, g) => sum + parseFloat(g.average || 0), 0) / grades.length).toFixed(2)
      : null;

    return {
      program,
      total_students: totalStudents,
      enrolled_this_semester: enrolledThisSemester,
      total_grades_submitted: grades.length,
      passed: grades.filter((g) => g.status === 'Passed').length,
      failed: grades.filter((g) => g.status === 'Failed').length,
      inc: grades.filter((g) => g.status === 'INC').length,
      pass_rate: passRate,
      avg_gwa: avgGWA,
    };
  }));

  res.json({ current_semester: currentSemester?.name || null, programs: programReports });
});

module.exports = { getInstructorGradeReport, sendGradeReport, sendGradingSheet, forwardGradingSheetToAdmin, getChairpersonReport };
