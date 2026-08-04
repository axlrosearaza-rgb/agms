const { User, Grade, Class, Subject, Enrollment, Notification, Endorsement } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');

// ── Helper: detect semester order from name ───────────────────────────────────
const getSemesterOrder = (semesterName = '') => {
  const lower = semesterName.toLowerCase();
  if (lower.includes('2nd') || lower.includes('second')) return '2nd';
  if (lower.includes('1st') || lower.includes('first')) return '1st';
  return null;
};

// ── Helper: notify admins ─────────────────────────────────────────────────────
const notifyAdmins = async (title, message) => {
  const admins = await User.findAll({ where: { role: 'Admin', status: 'Active' } });
  await Promise.all(
    admins.map(admin =>
      Notification.create({
        user_id: admin.id,
        title,
        message,
        type: 'promotion',
        link: '/admin/promotions',
      })
    )
  );
};

// ================= GET /api/promotions/evaluate =================
// Fetches ALL students and ALL their grades in just 2 queries total.
// No more 1 query per student — much faster regardless of student count.
const evaluateStudents = asyncHandler(async (req, res) => {
  const { semester, program, year_level } = req.query;

  if (!semester) {
    return res.status(400).json({ message: 'Semester is required.' });
  }

  const semOrder = getSemesterOrder(semester);

  // ── Query 1: Get all matching students ───────────────────────────────
  const studentWhere = { role: 'Student', status: 'Active' };
  // Chairpersons are always scoped to their own program(s), regardless of what was requested
  studentWhere.program = req.user.role === 'Chairperson' ? { [Op.in]: req.user.programs || [] } : (program || undefined);
  if (!studentWhere.program) delete studentWhere.program;
  if (year_level) studentWhere.year_level = parseInt(year_level);

  const students = await User.findAll({
    where: studentWhere,
    attributes: { exclude: ['password'] },
    order: [
      ['program', 'ASC'],
      ['year_level', 'ASC'],
      ['section', 'ASC'],
      ['name', 'ASC'],
    ],
  });

  if (students.length === 0) {
    return res.json({
      semester,
      semester_order: semOrder,
      students: [],
      summary: { total: 0, eligible: 0, failed: 0, graduating: 0, no_grades: 0 },
    });
  }

  const studentIds = students.map(s => s.id);

  // ── Query 2: Get ALL submitted grades for ALL students in one shot ───
  // Instead of 1 query per student, we fetch everything at once and
  // group them in JavaScript — much faster.
  const allGrades = await Grade.findAll({
    where: {
      student_id: { [Op.in]: studentIds },
      submitted: true,
    },
    include: [{
      model: Class,
      as: 'class',
      where: { semester },
      required: true,
      include: [{
        model: Subject,
        as: 'subject',
        attributes: ['id', 'code', 'name'],
      }],
    }],
  });

  // ── Group grades by student_id in JavaScript ─────────────────────────
  const gradesByStudent = {};
  allGrades.forEach(g => {
    const sid = g.student_id;
    if (!gradesByStudent[sid]) gradesByStudent[sid] = [];
    gradesByStudent[sid].push(g);
  });

  // ── Endorsement status for this semester (Chairperson view) ──────────
  const endorsementsByStudent = {};
  if (req.user.role === 'Chairperson') {
    const endorsements = await Endorsement.findAll({
      where: { student_id: { [Op.in]: studentIds }, chairperson_id: req.user.id, semester },
    });
    endorsements.forEach(e => { endorsementsByStudent[e.student_id] = e.status; });
  }

  // ── Build student data using the pre-grouped grades ──────────────────
  const studentData = students.map(student => {
    const grades = gradesByStudent[student.id] || [];

    const passedCount = grades.filter(g => g.status === 'Passed').length;
    const failedCount = grades.filter(g => g.status === 'Failed').length;

    const gwa = grades.length > 0
      ? (grades.reduce((sum, g) => sum + parseFloat(g.average || 0), 0) / grades.length).toFixed(2)
      : null;

    // Determine promotion status
    let promotionStatus;
    if (grades.length === 0) {
      promotionStatus = 'No Grades';
    } else if (failedCount > 0) {
      promotionStatus = 'Failed Subjects';
    } else if (student.year_level >= 4 && semOrder === '2nd') {
      promotionStatus = 'For Graduation';
    } else {
      promotionStatus = 'Eligible';
    }

    // Determine next step label
    const nextStep = (() => {
      if (promotionStatus === 'For Graduation') return 'Graduation';
      if (promotionStatus !== 'Eligible') return null;
      if (semOrder === '1st') return `Year ${student.year_level} — 2nd Semester`;
      if (semOrder === '2nd') return `Year ${student.year_level + 1} — 1st Semester`;
      return null;
    })();

    return {
      id: student.id,
      name: student.name,
      student_no: student.student_no,
      email: student.email,
      avatar: student.avatar,
      program: student.program,
      year_level: student.year_level,
      section: student.section,
      gwa,
      passed_count: passedCount,
      failed_count: failedCount,
      promotion_status: promotionStatus,
      next_step: nextStep,
      endorsement_status: endorsementsByStudent[student.id] || null,
      grades: grades.map(g => ({
        subject_code: g.class?.subject?.code,
        subject_name: g.class?.subject?.name,
        midterm: g.midterm,
        finals: g.finals,
        average: g.average,
        status: g.status,
        released: g.released,
      })),
    };
  });

  res.json({
    semester,
    semester_order: semOrder,
    students: studentData,
    summary: {
      total: studentData.length,
      eligible: studentData.filter(s => s.promotion_status === 'Eligible').length,
      failed: studentData.filter(s => s.promotion_status === 'Failed Subjects').length,
      graduating: studentData.filter(s => s.promotion_status === 'For Graduation').length,
      no_grades: studentData.filter(s => s.promotion_status === 'No Grades').length,
    },
  });
});

// ================= POST /api/promotions/promote =================
// Also optimized — fetches all grades for selected students in one query.
const promoteStudents = asyncHandler(async (req, res) => {
  const { student_ids, semester } = req.body;

  if (!student_ids || student_ids.length === 0) {
    return res.status(400).json({ message: 'No students selected.' });
  }

  const semOrder = getSemesterOrder(semester);
  if (!semOrder) {
    return res.status(400).json({
      message: `Cannot determine semester order from: "${semester}". Make sure semester name includes "1st" or "2nd".`,
    });
  }

  // ── Fetch all selected students, scoped to the Chairperson's own program ──
  const studentWhere = { id: { [Op.in]: student_ids }, role: 'Student' };
  if (req.user.role === 'Chairperson') studentWhere.program = { [Op.in]: req.user.programs || [] };
  const students = await User.findAll({ where: studentWhere });

  // ── Only students the Chairperson has Endorsed for this semester are eligible ──
  const endorsedIds = new Set();
  const endorsements = await Endorsement.findAll({
    where: { student_id: { [Op.in]: students.map(s => s.id) }, chairperson_id: req.user.id, semester, status: 'Endorsed' },
  });
  endorsements.forEach(e => endorsedIds.add(e.student_id));

  // ── Fetch all their grades in one query ──────────────────────────────
  const allGrades = await Grade.findAll({
    where: {
      student_id: { [Op.in]: student_ids },
      submitted: true,
    },
    include: [{
      model: Class,
      as: 'class',
      where: { semester },
      required: true,
    }],
  });

  // Group grades by student
  const gradesByStudent = {};
  allGrades.forEach(g => {
    const sid = g.student_id;
    if (!gradesByStudent[sid]) gradesByStudent[sid] = [];
    gradesByStudent[sid].push(g);
  });

  let processed = 0;
  const resultNames = [];
  const updatePromises = [];

  for (const student of students) {
    // Skip students the Chairperson hasn't endorsed for this semester
    if (req.user.role === 'Chairperson' && !endorsedIds.has(student.id)) continue;

    const grades = gradesByStudent[student.id] || [];
    const failedCount = grades.filter(g => g.status === 'Failed').length;

    // Skip students with failed subjects
    if (failedCount > 0) continue;

    if (semOrder === '1st') {
      // 1st semester passed → no year_level change, just cleared for 2nd sem
      processed++;
      resultNames.push(`${student.name} (cleared for 2nd Semester)`);

    } else if (semOrder === '2nd') {
      if (student.year_level < 4) {
        // Queue all year_level updates to run in parallel
        updatePromises.push(student.update({ year_level: student.year_level + 1 }));
        processed++;
        resultNames.push(`${student.name} → Year ${student.year_level + 1}`);
      } else {
        // Year 4 graduating
        // Optionally: updatePromises.push(student.update({ student_status: 'Graduated' }));
        processed++;
        resultNames.push(`${student.name} (Graduating)`);
      }
    }
  }

  // Run all DB updates at the same time instead of one by one
  await Promise.all(updatePromises);

  const actionLabel = semOrder === '1st'
    ? `cleared ${processed} students for 2nd semester (${semester})`
    : `promoted ${processed} students to next year level (${semester})`;

  await logActivity(req.user.id, actionLabel, 'User', null);

  const notifTitle = semOrder === '1st' ? 'Students Advanced to 2nd Semester' : 'Students Promoted';
  const notifMsg = semOrder === '1st'
    ? `${processed} student(s) have been cleared for 2nd semester enrollment (${semester}).`
    : `${processed} student(s) have been promoted to the next year level (${semester}).`;

  await notifyAdmins(notifTitle, notifMsg);

  res.json({
    message: semOrder === '1st'
      ? `Successfully cleared ${processed} student(s) for 2nd semester.`
      : `Successfully promoted ${processed} student(s) to the next year level.`,
    promoted: processed,
    semester_order: semOrder,
    names: resultNames,
  });
});

// ================= POST /api/promotions/mark-irregular =================
const markIrregular = asyncHandler(async (req, res) => {
  const { student_id } = req.body;

  const student = await User.findByPk(student_id);
  if (!student || student.role !== 'Student') {
    return res.status(404).json({ message: 'Student not found.' });
  }

  if (req.user.role === 'Chairperson' && !(req.user.programs || []).includes(student.program)) {
    return res.status(403).json({ message: 'You may only mark students in your own program.' });
  }

  await student.update({ student_status: 'Irregular' });

  await logActivity(req.user.id, `marked ${student.name} as Irregular`, 'User', student_id);

  await Notification.create({
    user_id: student_id,
    title: 'Academic Status Update',
    message: 'Your academic status has been updated. Please see your adviser for re-enrollment guidance.',
    type: 'promotion',
    link: '/student/grades',
  });

  res.json({
    message: `${student.name} has been marked as Irregular.`,
    student: student.toSafeJSON(),
  });
});

// ================= POST /api/promotions/release-grades =================
const releaseGrades = asyncHandler(async (req, res) => {
  const { student_ids, semester } = req.body;

  if (!student_ids || student_ids.length === 0 || !semester) {
    return res.status(400).json({ message: 'Students and semester are required.' });
  }

  const studentWhere = { id: { [Op.in]: student_ids }, role: 'Student' };
  if (req.user.role === 'Chairperson') studentWhere.program = { [Op.in]: req.user.programs || [] };
  const students = await User.findAll({ where: studentWhere });
  const scopedIds = students.map(s => s.id);

  const grades = await Grade.findAll({
    where: { student_id: { [Op.in]: scopedIds }, submitted: true, released: false },
    include: [{ model: Class, as: 'class', where: { semester }, required: true }],
  });

  await Promise.all(grades.map(g => g.update({ released: true, released_date: new Date() })));

  const releasedStudentIds = [...new Set(grades.map(g => g.student_id))];
  await Promise.all(releasedStudentIds.map(sid => Notification.create({
    user_id: sid,
    title: 'Grades Released',
    message: `Your grades for ${semester} have been released and are now visible.`,
    type: 'grade',
    link: '/student/grades',
  })));

  await logActivity(req.user.id, `released grades for ${releasedStudentIds.length} students (${semester})`, 'Grade', null);

  res.json({ message: `Released ${grades.length} grade(s) for ${releasedStudentIds.length} student(s).`, released: grades.length });
});

// ================= GET /api/promotions/history =================
const getPromotionHistory = asyncHandler(async (req, res) => {
  const { ActivityLog } = require('../models');

  const logs = await ActivityLog.findAll({
    where: {
      action: { [Op.iLike]: '%promoted%' },
    },
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'role'] }],
    order: [['created_at', 'DESC']],
    limit: 50,
  });

  res.json({ history: logs });
});

module.exports = {
  evaluateStudents,
  promoteStudents,
  markIrregular,
  releaseGrades,
  getPromotionHistory,
};