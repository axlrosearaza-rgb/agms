const { Class, Subject, User, Enrollment, Grade, GradeComponent, ComponentItem, ComponentScore } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');

// Default grading breakdown (matches SAMPLE-CLASS-RECORD.xlsx exactly) — applied to
// every new class so instructors don't have to rebuild these from scratch each time.
const DEFAULT_COMPONENTS = [
  { name: 'Summative Test', weight: 25, items: [{ name: 'Test 1', max_score: 30 }, { name: 'Test 2', max_score: 30 }] },
  { name: 'Class Participation', weight: 5, items: [{ name: 'Quiz 1', max_score: 10 }, { name: 'Quiz 2', max_score: 10 }, { name: 'Ass. 1', max_score: 10 }, { name: 'Recit.', max_score: 100 }] },
  { name: 'Course Exercises/Laboratory', weight: 10, items: [{ name: 'Lab 1', max_score: 10 }, { name: 'Lab 2', max_score: 10 }, { name: 'Lab 3', max_score: 30 }] },
  { name: 'Project/Term Requirement', weight: 20, items: [{ name: 'Rate', max_score: 100 }] },
  { name: 'Major Exam', weight: 40, items: [{ name: '100 Items', max_score: 100 }] },
];

const createDefaultGradeComponents = async (classId) => {
  for (const period of ['Midterm', 'Finals']) {
    for (let i = 0; i < DEFAULT_COMPONENTS.length; i++) {
      const c = DEFAULT_COMPONENTS[i];
      const component = await GradeComponent.create({
        class_id: classId,
        name: c.name,
        period,
        weight: c.weight,
        order_index: i,
      });
      await ComponentItem.bulkCreate(
        c.items.map((item, j) => ({
          component_id: component.id,
          name: item.name,
          max_score: item.max_score,
          order_index: j,
        }))
      );
    }
  }
};

// Restricts a proposed student_ids list to Active students in the given program
// (only applied for Instructor callers; Admin can enroll any student)
const getEnrollableStudentIds = async (user, studentIds, program) => {
  if (user.role !== 'Instructor') return studentIds;
  const eligible = await User.findAll({
    where: { id: studentIds, role: 'Student', status: 'Active', program },
    attributes: ['id'],
  });
  return eligible.map((s) => s.id);
};

// GET /api/classes
const getClasses = asyncHandler(async (req, res) => {
  const { semester, department, instructor_id, search, page = 1, limit = 50 } = req.query;

  const where = {};
  if (semester) where.semester = semester;
  if (instructor_id) where.instructor_id = instructor_id;

  const includeOpts = [
    {
      model: Subject,
      as: 'subject',
      where: department ? { department } : undefined,
      ...(search ? {
        where: {
          [Op.or]: [
            { name: { [Op.iLike]: `%${search}%` } },
            { code: { [Op.iLike]: `%${search}%` } },
          ],
        },
      } : {}),
    },
    {
      model: User,
      as: 'instructor',
      attributes: ['id', 'name', 'email', 'department', 'avatar'],
    },
  ];

  // Chairperson can only browse classes within their own program (e.g. to find a
  // Grading Sheet an instructor sent) — always scoped, regardless of query params.
  if (req.user.role === 'Chairperson') {
    includeOpts[0].where = { ...(includeOpts[0].where || {}), program: { [Op.in]: req.user.programs || [] } };
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { rows: classes, count: total } = await Class.findAndCountAll({
    where,
    include: includeOpts,
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset,
    distinct: true,
  });

  // Attach student counts + a live Passed/INC/Dropped breakdown (used by the
  // Chairperson's Grading Sheets list to show status without opening each sheet)
  const classesWithCounts = await Promise.all(
    classes.map(async (cls) => {
      const studentCount = await Enrollment.count({ where: { class_id: cls.id } });
      const grades = await Grade.findAll({ where: { class_id: cls.id, submitted: true } });
      return {
        ...cls.toJSON(),
        student_count: studentCount,
        submitted_count: grades.length,
        progress: studentCount > 0 ? Math.round((grades.length / studentCount) * 100) : 0,
        passed_count: grades.filter((g) => g.status === 'Passed').length,
        inc_count: grades.filter((g) => g.status === 'INC').length,
        dropped_count: grades.filter((g) => g.status === 'DRP').length,
      };
    })
  );

  res.json({
    classes: classesWithCounts,
    pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) },
  });
});

// GET /api/classes/:id
const getClassById = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
      { model: User, as: 'students', attributes: { exclude: ['password'] }, through: { attributes: [] } },
      { model: Grade, as: 'grades', include: [{ model: User, as: 'student', attributes: ['id', 'name', 'student_no', 'avatar'] }] },
    ],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  res.json({ class: cls });
});

// POST /api/classes
const createClass = asyncHandler(async (req, res) => {
  const { subject_id, schedule, section, semester, academic_year, student_ids } = req.body;
  let { instructor_id } = req.body;

  if (req.user.role === 'Instructor') instructor_id = req.user.id;

  if (!subject_id || !instructor_id || !semester) {
    return res.status(400).json({ message: 'Subject, instructor, and semester are required.' });
  }

  const subject = await Subject.findByPk(subject_id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });

  if (req.user.role === 'Instructor' && !(req.user.programs || []).includes(subject.program)) {
    return res.status(403).json({ message: 'You may only create classes for subjects in your own program.' });
  }

  const instructor = await User.findOne({ where: { id: instructor_id, role: 'Instructor' } });
  if (!instructor) return res.status(404).json({ message: 'Instructor not found.' });

  const cls = await Class.create({
    subject_id,
    instructor_id,
    schedule,
    section: section || null,
    semester,
    academic_year,
  });

  await createDefaultGradeComponents(cls.id);

  // Enroll students if provided
  if (student_ids && student_ids.length > 0) {
    const validIds = await getEnrollableStudentIds(req.user, student_ids, subject.program);
    const enrollments = validIds.map((sid) => ({ class_id: cls.id, student_id: sid }));
    await Enrollment.bulkCreate(enrollments, { ignoreDuplicates: true });
  }

  await logActivity(req.user.id, `created class ${subject.code} - ${subject.name}${section ? ` Section ${section}` : ''}`, 'Class', cls.id);

  const fullClass = await Class.findByPk(cls.id, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });

  res.status(201).json({ message: 'Class created successfully.', class: fullClass });
});

// PUT /api/classes/:id
const updateClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id);
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only update your own classes.' });
  }

  const { schedule, section, semester, academic_year, status, encoding_open, instructor_id } = req.body;
  if (schedule !== undefined) cls.schedule = schedule;
  if (section !== undefined) cls.section = section;
  if (semester !== undefined) cls.semester = semester;
  if (academic_year !== undefined) cls.academic_year = academic_year;
  if (status !== undefined) cls.status = status;
  if (encoding_open !== undefined) cls.encoding_open = encoding_open;
  if (instructor_id !== undefined && req.user.role !== 'Instructor') cls.instructor_id = instructor_id;

  await cls.save();
  await logActivity(req.user.id, `updated class #${cls.id}`, 'Class', cls.id);
  res.json({ message: 'Class updated successfully.', class: cls });
});

// DELETE /api/classes/:id
const deleteClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  const gradeCount = await Grade.count({ where: { class_id: cls.id, submitted: true } });
  if (gradeCount > 0) {
    return res.status(400).json({ message: 'Cannot delete a class with submitted grades. Cancel it instead.' });
  }

  const componentIds = (await GradeComponent.findAll({ where: { class_id: cls.id }, attributes: ['id'] })).map((c) => c.id);
  if (componentIds.length > 0) {
    const itemIds = (await ComponentItem.findAll({ where: { component_id: componentIds }, attributes: ['id'] })).map((i) => i.id);
    if (itemIds.length > 0) await ComponentScore.destroy({ where: { item_id: itemIds } });
    await ComponentItem.destroy({ where: { component_id: componentIds } });
  }
  await GradeComponent.destroy({ where: { class_id: cls.id } });
  await Enrollment.destroy({ where: { class_id: cls.id } });
  await Grade.destroy({ where: { class_id: cls.id } });
  await cls.destroy();

  await logActivity(req.user.id, `deleted class ${cls.subject?.code}`, 'Class', cls.id);
  res.json({ message: 'Class deleted successfully.' });
});

// POST /api/classes/:id/enroll
const enrollStudents = asyncHandler(async (req, res) => {
  const { student_ids } = req.body;
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only enroll students in your own classes.' });
  }

  const validIds = await getEnrollableStudentIds(req.user, student_ids, cls.subject?.program);
  const enrollments = validIds.map((sid) => ({ class_id: cls.id, student_id: sid }));
  await Enrollment.bulkCreate(enrollments, { ignoreDuplicates: true });

  await logActivity(req.user.id, `enrolled ${validIds.length} students in class #${cls.id}`, 'Class', cls.id);
  res.json({ message: `${validIds.length} students enrolled.` });
});

// GET /api/classes/instructor/:instructorId
const getInstructorClasses = asyncHandler(async (req, res) => {
  const { semester } = req.query;
  const where = { instructor_id: req.params.instructorId };
  if (semester) where.semester = semester;

  const classes = await Class.findAll({
    where,
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'students', attributes: ['id', 'name', 'student_no', 'avatar', 'program', 'year_level'], through: { attributes: [] } },
    ],
    order: [['created_at', 'DESC']],
  });

  const withCounts = await Promise.all(
    classes.map(async (cls) => {
      const studentCount = await Enrollment.count({ where: { class_id: cls.id } });
      const gradeCount = await Grade.count({ where: { class_id: cls.id, submitted: true } });
      return {
        ...cls.toJSON(),
        student_count: studentCount,
        submitted_count: gradeCount,
        progress: studentCount > 0 ? Math.round((gradeCount / studentCount) * 100) : 0,
      };
    })
  );

  res.json({ classes: withCounts });
});

module.exports = { getClasses, getClassById, createClass, updateClass, deleteClass, enrollStudents, getInstructorClasses };