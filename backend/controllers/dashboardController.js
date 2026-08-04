const { User, Class, Grade, Subject, Enrollment, ActivityLog, Semester } = require('../models');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');

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
  const totalFaculty = await User.count({ where: { role: 'Instructor', status: 'Active' } });
  const totalChairpersons = await User.count({ where: { role: 'Chairperson', status: 'Active' } });

  // GWA-based pass rate (1.0-3.0 = Passed, 5.0 = Failed)
  const allGrades = await Grade.findAll({ where: { submitted: true } });
  const passRate = allGrades.length > 0
    ? Math.round((allGrades.filter((g) => g.status === 'Passed').length / allGrades.length) * 100)
    : 0;

  // Average GWA across all submitted grades
  const avgGWA = allGrades.length > 0
    ? (allGrades.reduce((sum, g) => sum + parseFloat(g.average || 0), 0) / allGrades.length).toFixed(2)
    : null;

  const totalGradesPassedByFaculty = allGrades.filter((g) => g.status === 'Passed').length;

  // Fetch a larger recent-activity pool than we display at once, so the frontend
  // can bucket into Faculty / Students / Chairpersons boxes and still have enough
  // rows per box rather than starving from a shared pool of just 10.
  const recentActivities = await ActivityLog.findAll({
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'role'] }],
    order: [['created_at', 'DESC']],
    limit: 60,
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
    const faculty = await User.count({ where: { role: 'Instructor', status: 'Active', programs: { [Op.contains]: [program] } } });

    const classWhere = { status: 'Active' };
    if (semester) classWhere.semester = semester;
    const classes = await Class.findAll({
      where: classWhere,
      include: [{ model: Subject, as: 'subject', where: { program }, attributes: [] }],
      attributes: ['id'],
    });
    const classIds = classes.map((c) => c.id);

    const programGrades = classIds.length > 0
      ? await Grade.findAll({ where: { class_id: classIds, submitted: true } })
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
      total_grades_passed_by_faculty: totalGradesPassedByFaculty,
      pass_rate: passRate,
      avg_gwa: avgGWA,
    },
    recent_activities: recentActivities,
    students_by_department: studentsByDept,
    current_semester: currentSemester,
    program_breakdown: programBreakdown,
  });
});

// GET /api/dashboard/activities
const getActivities = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { rows: activities, count: total } = await ActivityLog.findAndCountAll({
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'avatar', 'role'] }],
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset,
  });

  res.json({
    activities,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

// GET /api/dashboard/chairperson-faculty-review — for the Chairperson dashboard's
// "Faculty Pending Review" panel: every instructor teaching in the chairperson's
// program(s), each of their active classes, whether grades are fully submitted yet
// (i.e. effectively "sent"), and a live Passed/INC/Dropped/Failed breakdown.
const getChairpersonFacultyReview = asyncHandler(async (req, res) => {
  const programs = req.user.programs || [];

  const classes = await Class.findAll({
    where: { status: 'Active' },
    include: [
      { model: Subject, as: 'subject', where: { program: { [Op.in]: programs } }, attributes: ['code', 'name'] },
      { model: User, as: 'instructor', attributes: ['id', 'name', 'avatar'] },
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
    if (!byInstructor[inst.id]) byInstructor[inst.id] = { instructor: { id: inst.id, name: inst.name, avatar: inst.avatar }, classes: [] };

    const clsGrades = gradesByClass[cls.id] || [];
    const submittedCount = clsGrades.filter((g) => g.submitted).length;

    byInstructor[inst.id].classes.push({
      class_id: cls.id,
      subject_code: cls.subject?.code,
      subject_name: cls.subject?.name,
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

module.exports = { getAdminDashboard, getActivities, getChairpersonFacultyReview };