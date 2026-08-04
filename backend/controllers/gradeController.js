const { Grade, Class, Subject, User, Enrollment } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');

// Valid GWA values
const VALID_GWA = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 5.0];

// ================= GET CLASS GRADES =================
const getGradesByClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.classId, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: ['id', 'name'] },
    ],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
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

  res.json({ class: cls, student_grades: studentGrades });
});

// ================= ENCODE GRADES =================
const encodeGrades = asyncHandler(async (req, res) => {
  const { class_id, grades } = req.body;

  const cls = await Class.findByPk(class_id, {
    include: [{ model: Subject, as: 'subject' }],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
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
      // ✅ Never overwrite an INC grade through normal encode — use resolveINC instead
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

  const cls = await Class.findByPk(class_id, {
    include: [{ model: Subject, as: 'subject' }],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only mark INC for your own classes.' });
  }

  const enrolled = await Enrollment.findOne({ where: { class_id, student_id } });
  if (!enrolled) return res.status(404).json({ message: 'Student not enrolled in this class.' });

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

  // ✅ Manually set INC — bypasses the auto-compute hook
  grade.status = 'INC';
  grade.average = null;
  grade.midterm = null;
  grade.finals = null;
  grade.is_draft = false;
  grade.submitted = true;
  grade.submitted_date = new Date();
  grade.inc_remarks = inc_remarks || grade.inc_remarks;
  grade.inc_deadline = inc_deadline || grade.inc_deadline;
  grade.inc_resolved_date = null;

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

// ================= RESOLVE INC =================
// POST /api/grades/inc/resolve
// Called when the student has complied and the instructor gives a final grade
const resolveINC = asyncHandler(async (req, res) => {
  const { grade_id, midterm, finals } = req.body;

  const grade = await Grade.findByPk(grade_id, {
    include: [{
      model: Class,
      as: 'class',
      include: [{ model: Subject, as: 'subject' }],
    }],
  });

  if (!grade) return res.status(404).json({ message: 'Grade record not found.' });
  if (grade.status !== 'INC') {
    return res.status(400).json({ message: 'This grade is not marked as INC.' });
  }

  if (req.user.role === 'Instructor' && grade.class.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only resolve INC for your own classes.' });
  }

  // Validate the final grades
  if (!midterm || !finals) {
    return res.status(400).json({ message: 'Both midterm and finals are required to resolve INC.' });
  }
  if (parseFloat(midterm) < 1.0 || parseFloat(midterm) > 5.0 || parseFloat(finals) < 1.0 || parseFloat(finals) > 5.0) {
    return res.status(400).json({ message: 'GWA values must be between 1.0 and 5.0.' });
  }

  // Compute the resolved average
  const resolvedAverage = Math.round(((parseFloat(midterm) + parseFloat(finals)) / 2) * 100) / 100;
  const resolvedStatus = resolvedAverage <= 3.0 ? 'Passed' : 'Failed';

  // ✅ Use update() to bypass beforeSave hook which would re-trigger
  await Grade.update(
    {
      midterm: parseFloat(midterm),
      finals: parseFloat(finals),
      average: resolvedAverage,
      status: resolvedStatus,
      inc_resolved_date: new Date(),
      submitted: true,
      is_draft: false,
    },
    { where: { id: grade_id } }
  );

  await logActivity(
    req.user.id,
    `resolved INC for student in ${grade.class.subject.code} → ${resolvedStatus} (${resolvedAverage})`,
    'Grade',
    grade_id
  );

  const io = req.app.get('io');
  if (io) {
    io.emit('gradesUpdated', { class_id: grade.class_id, message: 'INC resolved' });
  }

  const updated = await Grade.findByPk(grade_id);
  res.json({
    message: `INC resolved. Student ${resolvedStatus} with average ${resolvedAverage}.`,
    grade: updated,
  });
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
  if (req.user.role === 'Instructor') {
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
    include: [{ model: Subject, as: 'subject' }],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Instructor' && cls.instructor_id !== req.user.id) {
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

  let message = 'Grades submitted successfully.';
  if (incCount > 0) message += ` ${incCount} student(s) marked as INC.`;
  if (pendingCount > 0) message += ` ${pendingCount} student(s) still pending.`;

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

  const grades = await Grade.findAll({ where: { student_id: studentId } });

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
    ? (submittedGrades.reduce((sum, g) => sum + parseFloat(g.average), 0) / submittedGrades.length).toFixed(2)
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

// ================= GWA DISTRIBUTION =================
const getGradeDistribution = asyncHandler(async (req, res) => {
  const { semester } = req.query;

  let grades;
  if (semester) {
    grades = await Grade.findAll({
      where: { submitted: true },
      include: [{
        model: Class,
        as: 'class',
        where: { semester },
        attributes: ['semester'],
      }],
    });
  } else {
    grades = await Grade.findAll({ where: { submitted: true } });
  }

  // Grades are now continuous (e.g. 2.86), so bucket into the familiar quarter-point
  // display buckets for charting purposes only — this doesn't touch the stored value.
  const distribution = {};
  VALID_GWA.forEach(g => { distribution[g.toFixed(2)] = 0; });

  grades.forEach(g => {
    if (g.average !== null) {
      const avg = parseFloat(g.average);
      const bucket = avg > 3.0 ? 5.0 : Math.min(3.0, Math.max(1.0, Math.round(avg * 4) / 4));
      const key = bucket.toFixed(2);
      if (distribution[key] !== undefined) {
        distribution[key]++;
      }
    }
  });

  const allClasses = await Class.findAll({
    attributes: ['semester'],
    group: ['semester'],
    raw: true,
  });
  const semesters = allClasses.map(c => c.semester).filter(Boolean);

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
          avg_gwa: avgs.length > 0 ? (avgs.reduce((s, v) => s + v, 0) / avgs.length).toFixed(2) : null,
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
          ? (validGrades.reduce((sum, g) => sum + parseFloat(g.average), 0) / validGrades.length).toFixed(2)
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
      const instrWhere = { role: 'Instructor', status: 'Active' };
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

// ================= ADMIN: APPROVE PASSED GRADES FOR A CLASS =================
// Registrar-office sign-off, separate from `released` (which the Chairperson
// controls for student visibility). Only ever touches Passed, submitted grades —
// INC/Dropped/Failed students are left untouched until their status is resolved.
const approveClassGrades = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.classId, {
    include: [{ model: Subject, as: 'subject' }],
  });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  const grades = await Grade.findAll({
    where: { class_id: cls.id, submitted: true, status: 'Passed', admin_approved: false },
  });

  await Promise.all(grades.map(g => g.update({ admin_approved: true, admin_approved_date: new Date() })));

  await logActivity(req.user.id, `approved ${grades.length} passed grade(s) for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}`, 'Class', cls.id);

  res.json({ message: `Approved ${grades.length} student grade(s).`, approved: grades.length });
});

module.exports = {
  getGradesByClass,
  encodeGrades,
  submitGrades,
  markAsINC,
  resolveINC,
  getINCList,
  getStudentGrades,
  getGradeDistribution,
  getRecentSubmissions,
  getReportData,
  approveClassGrades,
};