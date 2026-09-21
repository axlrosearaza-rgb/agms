const { User, Class, Grade, Subject, Enrollment, ActivityLog, Semester } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { activityRetentionWhere, chairpersonActivityRetentionWhere } = require('../utils/activityLogger');

const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

// GET /api/dashboard/admin
const getAdminDashboard = asyncHandler(async (req, res) => {
  const { semester } = req.query;

  const totalStudents = await User.count({ where: { role: 'Student', status: 'Active' } });
  const totalFaculty = await User.count({ where: { role: 'Faculty', status: 'Active' } });
  const totalChairpersons = await User.count({ where: { role: 'Chairperson', status: 'Active' } });
  // Part-Time faculty aren't tied to any one program (tagged with all four
  // just so they're findable — see User Management's dedicated Part-Time
  // container), so Faculty by Program shows them as their own bar rather
  // than folding this same count into all four program bars.
  const totalPartTimeFaculty = await User.count({ where: { role: 'Faculty', status: 'Active', employment_type: 'Part Time' } });

  // GWA-based pass rate (1.0-3.0 = Passed, 5.0 = Failed) — only from classes
  // Admin has actually finished verifying (both the Class Record AND Grade
  // Sheet approved), not just submitted. A class sitting in the Grade
  // Approval queue hasn't been vetted yet; counting it here would show
  // outcomes Admin hasn't actually signed off on. (Grade.admin_approved
  // itself won't do for this filter — that flag is only ever set on Passed
  // grades specifically, never Failed/INC/DRP, so filtering by it would
  // zero those three buckets out entirely regardless of real approval
  // status.)
  const allGrades = await Grade.findAll({
    where: { submitted: true },
    include: [{
      model: Class,
      as: 'class',
      attributes: [],
      where: { admin_class_record_approved: true, admin_grade_sheet_approved: true },
    }],
  });
  const passRate = allGrades.length > 0
    ? Math.round((allGrades.filter((g) => g.status === 'Passed').length / allGrades.length) * 100)
    : 0;

  // Average GWA across all submitted grades
  const avgGWA = allGrades.length > 0
    ? (allGrades.reduce((sum, g) => sum + parseFloat(g.average || 0), 0) / allGrades.length).toFixed(2)
    : null;

  // Student outcome breakdown for the dashboard's third stat card — one
  // bucket per STUDENT, so the four numbers can never add up to more than
  // Total Students Verified. A student takes several subjects at once and
  // those don't always agree (Passed in one, Failed in another), so each
  // student is folded down to a single worst-outcome status: any Failed
  // grade puts them in Failed even if other subjects passed; otherwise any
  // INC puts them in INC; otherwise any DRP puts them in Dropped; only a
  // student whose submitted grades are ALL Passed counts as Passed. Pending
  // is left out — that's "not graded yet", not an outcome.
  const statusesByStudent = {};
  allGrades.forEach((g) => {
    if (!statusesByStudent[g.student_id]) statusesByStudent[g.student_id] = new Set();
    statusesByStudent[g.student_id].add(g.status);
  });
  const gradeStatusCounts = { Passed: 0, Failed: 0, DRP: 0, INC: 0 };
  Object.values(statusesByStudent).forEach((statuses) => {
    if (statuses.has('Failed')) gradeStatusCounts.Failed += 1;
    else if (statuses.has('INC')) gradeStatusCounts.INC += 1;
    else if (statuses.has('DRP')) gradeStatusCounts.DRP += 1;
    else if (statuses.has('Passed')) gradeStatusCounts.Passed += 1;
  });

  // Per-instructor breakdown of the stat above, for the "Grades Passed by
  // Faculty" section — now Faculty Submission Status: which instructors have
  // actually sent their Class Record + Grade Sheet (both documents come from
  // the same underlying grade rows, so "submitted" here means every one of a
  // class's grades has been submitted — same "sent" definition Chairperson's
  // own Faculty Pending Review card uses, just system-wide instead of scoped
  // to one Chairperson's program(s)). Grouped Program → Faculty → their
  // classes, each with a Sent/Pending status.
  const activeClasses = await Class.findAll({
    where: { status: 'Active' },
    include: [
      { model: Subject, as: 'subject', attributes: ['code', 'program'] },
      { model: User, as: 'instructor', attributes: ['id', 'name', 'avatar', 'employment_type'] },
    ],
  });
  const activeClassIds = activeClasses.map((c) => c.id);
  const gradesForActiveClasses = activeClassIds.length > 0
    ? await Grade.findAll({ where: { class_id: activeClassIds }, attributes: ['class_id', 'submitted'] })
    : [];
  const gradesByClassId = {};
  gradesForActiveClasses.forEach((g) => {
    if (!gradesByClassId[g.class_id]) gradesByClassId[g.class_id] = [];
    gradesByClassId[g.class_id].push(g);
  });
  const submissionByProgramInstructor = {};
  activeClasses.forEach((cls) => {
    const instr = cls.instructor;
    const program = cls.subject?.program;
    if (!instr || !program) return;
    const key = `${program}|${instr.id}`;
    if (!submissionByProgramInstructor[key]) {
      submissionByProgramInstructor[key] = {
        program,
        instructor_id: instr.id,
        instructor_name: instr.name,
        instructor_avatar: instr.avatar,
        classes: [],
      };
    }
    const clsGrades = gradesByClassId[cls.id] || [];
    const submittedCount = clsGrades.filter((g) => g.submitted).length;
    submissionByProgramInstructor[key].classes.push({
      class_id: cls.id,
      subject_code: cls.subject?.code,
      section: cls.section,
      year_level: cls.year_level,
      total_students: clsGrades.length,
      submitted_count: submittedCount,
      sent: clsGrades.length > 0 && submittedCount === clsGrades.length,
    });
  });
  const facultySubmissionStatus = Object.values(submissionByProgramInstructor).sort((a, b) =>
    a.program.localeCompare(b.program) || a.instructor_name.localeCompare(b.instructor_name)
  );

  // Per-Faculty, per-Section breakdown of how many of their classes have
  // actually cleared Grade Approval (both the Class Record AND the Grade
  // Sheet Admin-approved — not just Chairperson-verified) — reuses the same
  // activeClasses fetched above instead of a second query. This is
  // downstream of facultySubmissionStatus above: "sent" only means Faculty
  // submitted; this tracks whether Admin has actually finished approving it.
  const approvalByInstructorSection = {};
  activeClasses.forEach((cls) => {
    const instr = cls.instructor;
    const program = cls.subject?.program;
    if (!instr || !program) return;
    const key = `${instr.id}|${cls.year_level ?? '—'}|${cls.section || '—'}`;
    if (!approvalByInstructorSection[key]) {
      approvalByInstructorSection[key] = {
        program,
        instructor_id: instr.id,
        instructor_name: instr.name,
        instructor_avatar: instr.avatar,
        year_level: cls.year_level,
        section: cls.section,
        classes: [],
      };
    }
    approvalByInstructorSection[key].classes.push({
      class_id: cls.id,
      subject_code: cls.subject?.code,
      approved: !!(cls.admin_class_record_approved && cls.admin_grade_sheet_approved),
    });
  });
  const facultyApprovalBySection = Object.values(approvalByInstructorSection)
    .map((row) => ({
      ...row,
      approved_count: row.classes.filter((c) => c.approved).length,
      total_count: row.classes.length,
    }))
    .sort((a, b) =>
      a.program.localeCompare(b.program) ||
      a.instructor_name.localeCompare(b.instructor_name) ||
      (a.year_level || 0) - (b.year_level || 0) ||
      String(a.section || '').localeCompare(String(b.section || ''))
    );

  // System-wide count for the dashboard's own small Pending Registrations
  // card — same definition userController.getPendingStudents uses
  // (email_verified so an unconfirmed signup doesn't count as "pending"),
  // just without the Chairperson-only program scoping since Admin sees all.
  const pendingRegistrationsCount = await User.count({
    where: { role: 'Student', status: 'Pending', email_verified: true },
  });

  // System Activities on the dashboard only ever shows each entry's own
  // retention window — 7 days for most activity, 24h for promotion/
  // regularization entries (see activityRetentionWhere above) — older
  // entries "age out" of this feed (not deleted; still reachable via GET
  // /api/dashboard/activities?archived=true, see getActivities below) so the
  // feed doesn't grow without bound the longer the system has been running.
  const recentActivities = await ActivityLog.findAll({
    where: activityRetentionWhere(true),
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'role'] }],
    order: [['created_at', 'DESC']],
    limit: 100,
  });

  // Students by department
  const studentsByDept = await User.findAll({
    where: { role: 'Student', status: 'Active' },
    attributes: ['department', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['department'],
    raw: true,
  });

  // Current semester
  const currentSemester = await Semester.findOne({ where: { is_current: true } });

  // Per-program breakdown: enrolled students, faculty, active classes, pass rate, avg GWA
  const programBreakdown = await Promise.all(PROGRAMS.map(async (program) => {
    const students = await User.count({ where: { role: 'Student', status: 'Active', program } });
    // Part-Time faculty are tagged with every program just so they're findable
    // from a single "Part-Time Faculty" list (see User Management) — they're
    // not really staffed to any one program, so counting them here too would
    // count the same 43 people in all four bars instead of any one of them.
    const faculty = await User.count({
      where: { role: 'Faculty', status: 'Active', employment_type: { [Op.ne]: 'Part Time' }, programs: { [Op.contains]: [program] } },
    });

    const classWhere = { status: 'Active' };
    if (semester) classWhere.semester = semester;
    const classes = await Class.findAll({
      where: classWhere,
      include: [{ model: Subject, as: 'subject', where: { program }, attributes: [] }],
      attributes: ['id'],
    });
    const classIds = classes.map((c) => c.id);

    // Same admin-verified-only rule as the headline stats above — a class
    // still sitting in the Grade Approval queue shouldn't count toward a
    // program's pass rate/GWA yet.
    const programGrades = classIds.length > 0
      ? await Grade.findAll({
        where: { class_id: classIds, submitted: true },
        include: [{
          model: Class,
          as: 'class',
          attributes: [],
          where: { admin_class_record_approved: true, admin_grade_sheet_approved: true },
        }],
      })
      : [];
    const programPassRate = programGrades.length > 0
      ? Math.round((programGrades.filter((g) => g.status === 'Passed').length / programGrades.length) * 100)
      : 0;
    const programAvgGWA = programGrades.length > 0
      ? (programGrades.reduce((sum, g) => sum + parseFloat(g.average || 0), 0) / programGrades.length).toFixed(2)
      : null;

    return {
      program,
      students,
      faculty,
      active_classes: classIds.length,
      pass_rate: programPassRate,
      avg_gwa: programAvgGWA,
    };
  }));

  res.json({
    stats: {
      total_students: totalStudents,
      total_faculty: totalFaculty,
      total_chairpersons: totalChairpersons,
      total_part_time_faculty: totalPartTimeFaculty,
      grade_status_counts: gradeStatusCounts,
      pass_rate: passRate,
      avg_gwa: avgGWA,
      pending_registrations: pendingRegistrationsCount,
    },
    faculty_submission_status: facultySubmissionStatus,
    faculty_approval_by_section: facultyApprovalBySection,
    recent_activities: recentActivities,
    students_by_department: studentsByDept,
    current_semester: currentSemester,
    program_breakdown: programBreakdown,
  });
});

// GET /api/dashboard/admin/analytics — chart-ready aggregates for the Admin
// Analytics page. Kept separate from getAdminDashboard so the plain dashboard
// stays fast; this one does the heavier grouping/trend queries.
const getAdminAnalytics = asyncHandler(async (req, res) => {
  // Active users by role (donut)
  const roleCounts = await User.findAll({
    where: { status: 'Active' },
    attributes: ['role', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['role'],
    raw: true,
  });

  // Submitted grades by status (donut)
  const statusCounts = await Grade.findAll({
    where: { submitted: true },
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });

  // Active students by program (bar)
  const programCounts = await User.findAll({
    where: { role: 'Student', status: 'Active', program: { [Op.ne]: null } },
    attributes: ['program', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['program'],
    raw: true,
  });

  // Classes by status (donut)
  const classStatusCounts = await Class.findAll({
    attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: ['status'],
    raw: true,
  });

  // Pass-rate trend across semesters, ordered chronologically via the Semester
  // table's start_date (Class.semester is just a name string, not a FK — see
  // classController.js's own note on this). Falls back to a plain name sort for
  // any semester name that has no matching Semester row.
  const semesterRows = await Semester.findAll({ attributes: ['name', 'start_date'], raw: true });
  const semesterOrder = {};
  semesterRows.forEach((s) => { semesterOrder[s.name] = s.start_date; });

  const classesWithGrades = await Class.findAll({
    attributes: ['id', 'semester'],
    include: [{ model: Grade, as: 'grades', where: { submitted: true }, required: false, attributes: ['status'] }],
  });
  const bySemester = {};
  classesWithGrades.forEach((c) => {
    const key = c.semester || 'Unspecified';
    if (!bySemester[key]) bySemester[key] = { passed: 0, total: 0 };
    (c.grades || []).forEach((g) => {
      bySemester[key].total++;
      if (g.status === 'Passed') bySemester[key].passed++;
    });
  });
  const passRateTrend = Object.entries(bySemester)
    .filter(([, v]) => v.total > 0)
    .map(([semester, v]) => ({ semester, pass_rate: Math.round((v.passed / v.total) * 100), total: v.total }))
    .sort((a, b) => {
      const da = semesterOrder[a.semester];
      const db = semesterOrder[b.semester];
      if (da && db) return new Date(da) - new Date(db);
      return a.semester.localeCompare(b.semester);
    });

  // New-registration trend, last 6 months, split by role (line)
  const monthKeys = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    monthKeys.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) });
  }
  const rangeStart = new Date();
  rangeStart.setDate(1);
  rangeStart.setMonth(rangeStart.getMonth() - 5);
  rangeStart.setHours(0, 0, 0, 0);
  const newUsers = await User.findAll({
    where: { createdAt: { [Op.gte]: rangeStart } },
    attributes: ['role', 'createdAt'],
    raw: true,
  });
  const monthIndex = {};
  monthKeys.forEach((m, i) => { monthIndex[m.key] = i; });
  const userGrowth = monthKeys.map((m) => ({ label: m.label, students: 0, faculty: 0, others: 0 }));
  newUsers.forEach((u) => {
    const d = new Date(u.createdAt);
    const idx = monthIndex[`${d.getFullYear()}-${d.getMonth()}`];
    if (idx === undefined) return;
    if (u.role === 'Student') userGrowth[idx].students++;
    else if (u.role === 'Faculty') userGrowth[idx].faculty++;
    else userGrowth[idx].others++;
  });

  // Top subjects by fail rate — needs at least 5 submitted grades to qualify,
  // so a single unlucky section doesn't dominate the ranking (bar)
  const subjectGrades = await Grade.findAll({
    where: { submitted: true },
    include: [{
      model: Class,
      as: 'class',
      attributes: [],
      include: [{ model: Subject, as: 'subject', attributes: ['code', 'name'] }],
    }],
    attributes: ['status'],
  });
  const bySubject = {};
  subjectGrades.forEach((g) => {
    const subj = g.class?.subject;
    if (!subj) return;
    if (!bySubject[subj.code]) bySubject[subj.code] = { code: subj.code, name: subj.name, total: 0, failed: 0 };
    bySubject[subj.code].total++;
    if (g.status === 'Failed') bySubject[subj.code].failed++;
  });
  const topFailingSubjects = Object.values(bySubject)
    .filter((s) => s.total >= 5)
    .map((s) => ({ ...s, fail_rate: Math.round((s.failed / s.total) * 100) }))
    .sort((a, b) => b.fail_rate - a.fail_rate)
    .slice(0, 6);

  res.json({
    role_distribution: roleCounts,
    grade_status_breakdown: statusCounts,
    program_enrollment: programCounts,
    class_status_distribution: classStatusCounts,
    pass_rate_trend: passRateTrend,
    user_growth: { months: monthKeys.map((m) => m.label), data: userGrowth },
    top_failing_subjects: topFailingSubjects,
  });
});

// GET /api/dashboard/activities — plain paginated log. Pass `?archived=true`
// for the Admin Dashboard's "Archived Activities" view, which is exactly the
// entries that just aged out of getAdminDashboard's recent-activity feed
// (see activityRetentionWhere above for each entry type's own window).
// `?action=<substring>` narrows to actions containing it (case-insensitive) —
// used by the Login History card's own "View Archived", which passes
// action=logged in so pagination counts only login rows instead of the
// whole mixed activity log.
//
// Admin sees every account's activity. A Chairperson should see every activity
// performed by the student/faculty/chairperson accounts that belong to the
// chairperson's own program scope (their department/programs), rather than
// only their personal log. That mirrors the department-wide visibility the
// role already has elsewhere in the system.
//
// A Chairperson's own feed also uses a flat 24h window (chairpersonActivity-
// RetentionWhere) instead of Admin's 7-day/24h-promotion-only split — every
// entry, not just promotion actions, moves into that role's own "View
// Archived" the day after it happens. Admin's side of this same endpoint
// (always called with archived=true, never without) is untouched.
const getActivities = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, archived, action, search } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const isChairperson = req.user.role === 'Chairperson';
  const where = archived === 'true'
    ? (isChairperson ? chairpersonActivityRetentionWhere(false) : activityRetentionWhere(false))
    : (isChairperson ? chairpersonActivityRetentionWhere(true) : {});
  if (action) where.action = { [Op.iLike]: `%${action}%` };

  if (req.user.role === 'Chairperson') {
    const myPrograms = req.user.programs || [];
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { role: 'Student', program: { [Op.in]: myPrograms } },
          { role: { [Op.in]: ['Faculty', 'Chairperson'] }, programs: { [Op.overlap]: myPrograms } },
        ],
      },
      attributes: ['id'],
    });

    where.user_id = { [Op.in]: users.map((u) => u.id) };
  }

  // Free-text search box on the Archived Activities modal — matches either
  // the action text itself or the acting user's name, since that's the only
  // two things rendered in each row.
  const include = [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'role'] }];
  if (search) {
    where[Op.and] = [
      ...(where[Op.and] || []),
      { [Op.or]: [{ action: { [Op.iLike]: `%${search}%` } }, { '$user.name$': { [Op.iLike]: `%${search}%` } }] },
    ];
  }

  const { rows: activities, count: total } = await ActivityLog.findAndCountAll({
    where,
    include,
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset,
    subQuery: false,
  });

  res.json({
    activities,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

// GET /api/dashboard/login-history — who's been logging in, for the Chairperson
// Dashboard's own "Login Activity" card. This feed intentionally mirrors the
// same department/program scope as getActivities above: it shows logins from
// the students, faculty, and chairpersons inside the caller's assigned
// program(s), while Admin continues to see every login. `?limit=` caps the
// list (default 20).
const getLoginHistory = asyncHandler(async (req, res) => {
  const { limit = 20 } = req.query;
  const where = { action: { [Op.iLike]: '%logged in%' } };

  if (req.user.role === 'Chairperson') {
    const myPrograms = req.user.programs || [];
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { role: 'Student', program: { [Op.in]: myPrograms } },
          { role: { [Op.in]: ['Faculty', 'Chairperson'] }, programs: { [Op.overlap]: myPrograms } },
        ],
      },
      attributes: ['id'],
    });
    where.user_id = { [Op.in]: users.map((u) => u.id) };
  }

  const activities = await ActivityLog.findAll({
    where,
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'role', 'email'] }],
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
  });

  res.json({ activities });
});

// GET /api/dashboard/chairperson-faculty-review — for the "Faculty Pending
// Review" panel: every instructor teaching in the chairperson's program(s),
// each of their active classes, whether grades are fully submitted yet (i.e.
// effectively "sent"), and a live Passed/INC/Dropped/Failed breakdown. Also
// reused as-is on the Admin Dashboard (see getAdminDashboard's own
// facultySubmissionStatus, which this predates and overlaps with) — Admin
// just sees every program instead of being scoped to one Chairperson's own.
const getChairpersonFacultyReview = asyncHandler(async (req, res) => {
  const subjectWhere = {};
  if (req.user.role !== 'Admin') subjectWhere.program = { [Op.in]: req.user.programs || [] };

  const classes = await Class.findAll({
    where: { status: 'Active' },
    include: [
      { model: Subject, as: 'subject', where: subjectWhere, attributes: ['code', 'name', 'program'] },
      { model: User, as: 'instructor', attributes: ['id', 'name', 'avatar', 'programs', 'employment_type'] },
    ],
  });

  const classIds = classes.map((c) => c.id);
  const grades = classIds.length > 0 ? await Grade.findAll({ where: { class_id: classIds } }) : [];
  const gradesByClass = {};
  grades.forEach((g) => {
    if (!gradesByClass[g.class_id]) gradesByClass[g.class_id] = [];
    gradesByClass[g.class_id].push(g);
  });

  const byInstructor = {};
  classes.forEach((cls) => {
    const inst = cls.instructor;
    if (!inst) return;
    if (!byInstructor[inst.id]) byInstructor[inst.id] = {
      instructor: { id: inst.id, name: inst.name, avatar: inst.avatar, programs: inst.programs, employment_type: inst.employment_type },
      classes: [],
    };

    const clsGrades = gradesByClass[cls.id] || [];
    const submittedCount = clsGrades.filter((g) => g.submitted).length;

    byInstructor[inst.id].classes.push({
      class_id: cls.id,
      subject_code: cls.subject?.code,
      subject_name: cls.subject?.name,
      program: cls.subject?.program,
      year_level: cls.year_level,
      section: cls.section,
      total_students: clsGrades.length,
      submitted_count: submittedCount,
      sent: clsGrades.length > 0 && submittedCount === clsGrades.length,
      passed: clsGrades.filter((g) => g.status === 'Passed').length,
      inc: clsGrades.filter((g) => g.status === 'INC').length,
      dropped: clsGrades.filter((g) => g.status === 'DRP').length,
      failed: clsGrades.filter((g) => g.status === 'Failed').length,
    });
  });

  res.json({ faculty: Object.values(byInstructor) });
});

module.exports = { getAdminDashboard, getAdminAnalytics, getActivities, getChairpersonFacultyReview };