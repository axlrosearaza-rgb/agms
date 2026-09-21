const { Endorsement, User, Grade, Class, Subject, Enrollment, Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
// Shared "notify every Admin" helper — emits the real-time
// `notification:${userId}` Socket.IO event the frontend bell (and its
// notification sound) listens for, unlike a bare Notification.create which
// would leave it silently sitting there until the recipient's next page
// load/manual refresh.
const { notifyAdmins } = require('./notificationController');

// Resolve the semester to endorse/flag/override for: explicit value from the
// client, or the school's current active Semester (matches the free-text
// convention Class.semester already relies on elsewhere in this app).
const resolveSemester = async (explicit) => {
  if (explicit) return explicit;
  const current = await Semester.findOne({ where: { is_current: true } });
  return current ? current.name : null;
};

// GET /api/endorsements
const getEndorsements = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const where = {};

  if (req.user.role === 'Chairperson') {
    where.chairperson_id = req.user.id;
  }
  if (status) where.status = status;

  const endorsements = await Endorsement.findAll({
    where,
    include: [
      { model: User, as: 'student', attributes: { exclude: ['password'] } },
      { model: User, as: 'chairperson', attributes: ['id', 'name', 'department', 'program'] },
    ],
    order: [['created_at', 'DESC']],
  });

  res.json({ endorsements });
});

// GET /api/endorsements/department-students
const getDepartmentStudents = asyncHandler(async (req, res) => {
  const chairperson = await User.findByPk(req.user.id);
  if (!chairperson || chairperson.role !== 'Chairperson') {
    return res.status(403).json({ message: 'Only chairpersons can access this.' });
  }

  if (!chairperson.programs || chairperson.programs.length === 0) {
    return res.status(400).json({ message: 'Chairperson has no assigned program. Please contact the Admin.' });
  }

  const semester = await resolveSemester(req.query.semester);

  // Filter students by program (not department)
  const students = await User.findAll({
    where: { role: 'Student', program: { [Op.in]: chairperson.programs }, status: 'Active' },
    attributes: { exclude: ['password'] },
    order: [['year_level', 'ASC'], ['name', 'ASC']],
  });

  const studentData = await Promise.all(
    students.map(async (student) => {
      const grades = await Grade.findAll({
        where: { student_id: student.id, submitted: true },
        include: [{
          model: Class,
          as: 'class',
          include: [{ model: Subject, as: 'subject' }],
        }],
      });

      const gwa = grades.length > 0
        ? (grades.reduce((sum, g) => sum + parseFloat(g.average), 0) / grades.length).toFixed(2)
        : null;

      const endorsement = semester
        ? await Endorsement.findOne({ where: { student_id: student.id, chairperson_id: req.user.id, semester } })
        : null;

      // Current-semester class enrollment — gives Endorsements its Faculty/Subject/
      // Section context without adding new columns to Endorsement itself.
      const currentEnrollments = semester
        ? await Enrollment.findAll({
            where: { student_id: student.id },
            include: [{
              model: Class,
              as: 'class',
              where: { semester },
              include: [
                { model: Subject, as: 'subject', attributes: ['id', 'code', 'name'] },
                { model: User, as: 'instructor', attributes: ['id', 'name'] },
              ],
            }],
          })
        : [];
      const currentClasses = currentEnrollments
        .filter((e) => e.class)
        .map((e) => ({
          subject_code: e.class.subject?.code,
          subject_name: e.class.subject?.name,
          instructor_name: e.class.instructor?.name,
          section: e.class.section,
        }));

      const prereqIssues = [];
      for (const grade of grades) {
        if (!grade.class || !grade.class.subject) continue;
        const subject = grade.class.subject;
        const prereqs = await Subject.findAll({
          include: [{
            model: Subject,
            as: 'prerequisites',
            through: { attributes: [] },
          }],
          where: { id: subject.id },
        });

        if (prereqs[0]?.prerequisites) {
          for (const prereq of prereqs[0].prerequisites) {
            const prereqGrade = grades.find((g) =>
              g.class?.subject?.id === prereq.id && g.status === 'Passed'
            );
            if (!prereqGrade) {
              prereqIssues.push({
                subject: subject.code,
                missing_prereq: prereq.code,
                prereq_name: prereq.name,
              });
            }
          }
        }
      }

      return {
        ...student.toJSON(),
        gwa,
        grades: grades.map((g) => ({
          id: g.id,
          subject_code: g.class?.subject?.code,
          subject_name: g.class?.subject?.name,
          midterm: g.midterm,
          finals: g.finals,
          average: g.average,
          status: g.status,
        })),
        endorsement: endorsement ? endorsement.toJSON() : null,
        current_classes: currentClasses,
        prereq_issues: prereqIssues,
        is_regular: prereqIssues.length === 0,
        completed_count: grades.filter((g) => g.status === 'Passed').length,
        failed_count: grades.filter((g) => g.status === 'Failed').length,
      };
    })
  );

  res.json({
    department: chairperson.department || 'College of Arts and Sciences',
    programs: chairperson.programs,
    semester,
    students: studentData,
    summary: {
      total: studentData.length,
      endorsed: studentData.filter((s) => s.endorsement?.status === 'Endorsed').length,
      flagged: studentData.filter((s) => s.endorsement?.status === 'Flagged').length,
      pending: studentData.filter((s) => !s.endorsement).length,
    },
  });
});

// POST /api/endorsements/endorse
const endorseStudent = asyncHandler(async (req, res) => {
  const { student_id, notes } = req.body;

  const student = await User.findByPk(student_id);
  if (!student || student.role !== 'Student') {
    return res.status(404).json({ message: 'Student not found.' });
  }

  const chairperson = await User.findByPk(req.user.id);

  // Verify same program
  if (!(chairperson.programs || []).includes(student.program)) {
    return res.status(403).json({ message: 'You can only endorse students in your program.' });
  }

  const semester = await resolveSemester(req.body.semester);
  if (!semester) {
    return res.status(400).json({ message: 'No current semester is set. Ask the Admin to set one, or specify a semester.' });
  }

  const [endorsement, created] = await Endorsement.findOrCreate({
    where: { student_id, chairperson_id: req.user.id, semester },
    defaults: { status: 'Endorsed', notes, endorsed_date: new Date() },
  });

  if (!created) {
    endorsement.status = 'Endorsed';
    endorsement.notes = notes;
    endorsement.endorsed_date = new Date();
    endorsement.flagged_reason = null;
    await endorsement.save();
  }

  await logActivity(req.user.id, `endorsed student ${student.name}`, 'Endorsement', endorsement.id);

  // Notify admins
  await notifyAdmins(req.app, {
    title: 'Student Endorsed',
    message: `${req.user.name} endorsed ${student.name} (${student.program} - Year ${student.year_level}, Section ${student.section}).`,
    type: 'endorsement',
    link: '/admin/endorsements',
  });

  res.json({ message: 'Student endorsed successfully.', endorsement });
});

// POST /api/endorsements/flag
const flagStudent = asyncHandler(async (req, res) => {
  const { student_id, flagged_reason, notes } = req.body;

  const student = await User.findByPk(student_id);
  if (!student || student.role !== 'Student') {
    return res.status(404).json({ message: 'Student not found.' });
  }

  const chairperson = await User.findByPk(req.user.id);

  // Verify same program
  if (!(chairperson.programs || []).includes(student.program)) {
    return res.status(403).json({ message: 'You can only flag students in your program.' });
  }

  const semester = await resolveSemester(req.body.semester);
  if (!semester) {
    return res.status(400).json({ message: 'No current semester is set. Ask the Admin to set one, or specify a semester.' });
  }

  const [endorsement, created] = await Endorsement.findOrCreate({
    where: { student_id, chairperson_id: req.user.id, semester },
    defaults: { status: 'Flagged', flagged_reason, notes },
  });

  if (!created) {
    endorsement.status = 'Flagged';
    endorsement.flagged_reason = flagged_reason;
    endorsement.notes = notes;
    endorsement.endorsed_date = null;
    await endorsement.save();
  }

  await logActivity(req.user.id, `flagged student ${student.name}: ${flagged_reason}`, 'Endorsement', endorsement.id);

  // Notify admins
  await notifyAdmins(req.app, {
    title: 'Student Flagged',
    message: `${req.user.name} flagged ${student.name} (${student.program} - Year ${student.year_level}, Section ${student.section}). Reason: ${flagged_reason}`,
    type: 'endorsement',
    link: '/admin/endorsements',
  });

  res.json({ message: 'Student flagged.', endorsement });
});

// PUT /api/endorsements/override (Admin only)
const overrideEndorsement = asyncHandler(async (req, res) => {
  const { student_id, status, notes, flagged_reason } = req.body;

  if (req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Only admins can override endorsements.' });
  }

  const student = await User.findByPk(student_id);
  if (!student) return res.status(404).json({ message: 'Student not found.' });

  const semester = await resolveSemester(req.body.semester);
  const endorsement = semester
    ? await Endorsement.findOne({ where: { student_id, semester } })
    : await Endorsement.findOne({ where: { student_id }, order: [['created_at', 'DESC']] });
  if (!endorsement) return res.status(404).json({ message: 'No endorsement record found for this student.' });

  endorsement.status = status;
  if (notes) endorsement.notes = notes;
  if (status === 'Flagged') {
    endorsement.flagged_reason = flagged_reason;
    endorsement.endorsed_date = null;
  } else {
    endorsement.endorsed_date = new Date();
    endorsement.flagged_reason = null;
  }
  await endorsement.save();

  await logActivity(req.user.id, `overrode endorsement for ${student.name} to ${status}`, 'Endorsement', endorsement.id);

  res.json({ message: `Endorsement overridden to ${status}.`, endorsement });
});

module.exports = { getEndorsements, getDepartmentStudents, endorseStudent, flagStudent, overrideEndorsement };