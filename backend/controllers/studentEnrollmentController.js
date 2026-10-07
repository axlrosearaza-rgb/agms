const { Op } = require('sequelize');
const { User, Class, Subject, Enrollment, Semester } = require('../models');
const { asyncHandler } = require('../middleware/errorHandler');

// ── Student: "My Subjects Taking" ───────────────────────────────────────────
// Students don't declare or add/drop anything themselves: a student is in a
// class because the Faculty member teaching it imported the class list
// (classController.importClassList). This only reports which classes that
// is for the current semester — read by the dashboard's My Subjects Taking.

// GET /api/student-enrollment
const getMyEnrollment = asyncHandler(async (req, res) => {
  const student = await User.findByPk(req.user.id, { attributes: ['id', 'student_status'] });
  const semester = await Semester.findOne({ where: { is_current: true }, attributes: ['name'] });
  if (!student || !semester) return res.json({ semester: null });

  const enrollments = await Enrollment.findAll({
    where: { student_id: student.id },
    attributes: ['class_id'],
    include: [{
      model: Class,
      as: 'class',
      where: { semester: semester.name, status: { [Op.ne]: 'Cancelled' } },
      attributes: ['id', 'subject_id', 'year_level', 'section', 'schedule'],
      include: [
        { model: Subject, as: 'subject', attributes: ['id', 'code', 'name', 'units'] },
        { model: User, as: 'instructor', attributes: ['id', 'name'] },
      ],
    }],
  });

  const enrolled = enrollments
    .map((e) => e.class)
    .filter((c) => c && c.subject)
    .map((c) => ({
      id: c.id,
      subject_id: c.subject_id,
      code: c.subject.code,
      name: c.subject.name,
      units: c.subject.units,
      year_level: c.year_level,
      section: c.section,
      schedule: c.schedule,
      instructor: c.instructor ? { id: c.instructor.id, name: c.instructor.name } : null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  res.json({
    semester: { name: semester.name },
    student_status: student.student_status,
    units: enrolled.reduce((sum, c) => sum + (c.units || 0), 0),
    enrolled,
  });
});

module.exports = { getMyEnrollment };
