const { USER_SECRET_FIELDS } = require('../utils/userFields');
const { Class, Subject, User, Enrollment, Grade, GradeComponent, ComponentItem, ComponentScore, Semester } = require('../models');
const { Op, fn, col, QueryTypes } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { actsAsInstructor } = require('../utils/teachingAuth');
const { upsertImportedStudents } = require('../utils/studentImport');
const { syncMainYear } = require('../utils/mainYear');
const { afterEnrollment, syncRegularity } = require('../utils/enrollmentChecks');
const { encodingCounts, encodingFields } = require('../utils/encodingProgress');

// Fallback grading breakdown (matches SAMPLE-CLASS-RECORD.xlsx exactly) — only
// used when the class's own Subject has no grading_scheme of its own defined
// (Subjects page). Generic and department-agnostic, so it's a reasonable
// default, but it's never supposed to be what most classes actually end up
// with once subjects have their own schemes set.
const DEFAULT_COMPONENTS = [
  { name: 'Summative Test', weight: 25, items: [{ name: 'Test 1', max_score: 30 }, { name: 'Test 2', max_score: 30 }] },
  { name: 'Class Participation', weight: 5, items: [{ name: 'Quiz 1', max_score: 10 }, { name: 'Quiz 2', max_score: 10 }, { name: 'Ass. 1', max_score: 10 }, { name: 'Recit.', max_score: 100 }] },
  { name: 'Course Exercises/Laboratory', weight: 10, items: [{ name: 'Lab 1', max_score: 10 }, { name: 'Lab 2', max_score: 10 }, { name: 'Lab 3', max_score: 30 }] },
  { name: 'Project/Term Requirement', weight: 20, items: [{ name: 'Rate', max_score: 100 }] },
  { name: 'Major Exam', weight: 40, items: [{ name: '100 Items', max_score: 100 }] },
];

// Creates a new class's Midterm + Finals grade components from its subject's
// own grading_scheme (set on the Subjects page — [{ name, weight }], no
// items yet) if one is defined, so a class's Class Record actually matches
// what its subject was set up with — falling back to the generic
// DEFAULT_COMPONENTS above only when the subject has no scheme of its own.
// This used to always apply DEFAULT_COMPONENTS unconditionally, which meant
// a subject's own grading_scheme could never take effect on a new class —
// there was always already something there by the time anyone looked.
const createDefaultGradeComponents = async (classId, subject) => {
  const source = (subject?.grading_scheme && subject.grading_scheme.length > 0)
    ? subject.grading_scheme.map((c) => ({ name: c.name, weight: parseFloat(c.weight) || 0, items: [{ name: 'Score', max_score: 100 }] }))
    : DEFAULT_COMPONENTS;

  for (const period of ['Midterm', 'Finals']) {
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
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

// Graduated students (graduated_at set) are archived and never enrolled into a
// class again — every student query in this file excludes them.
// Restricts a proposed student_ids list to Active students in the given program
// (only applied for Instructor callers, including a teaching Chairperson; Admin
// and a non-teaching Chairperson can enroll any student)
// Any active, current student can be added to a class — irregular and
// cross-program students take subjects outside their own section/program
// (minors especially). `program` is kept for callers but no longer limits it.
// eslint-disable-next-line no-unused-vars
const getEnrollableStudentIds = async (user, studentIds, program) => {
  if (!actsAsInstructor(user)) return studentIds;
  const eligible = await User.findAll({
    where: { id: studentIds, role: 'Student', status: 'Active', graduated_at: null },
    attributes: ['id'],
  });
  return eligible.map((s) => s.id);
};

// GET /api/classes
// Classes with any Class Record score or grade row recorded: their subject can
// no longer be changed from Edit Class.
const classIdsWithScores = async (classIds) => {
  const rows = await Class.sequelize.query(
    `SELECT gc.class_id FROM component_scores cs
       JOIN component_items ci ON ci.id = cs.item_id
       JOIN grade_components gc ON gc.id = ci.component_id
      WHERE gc.class_id IN (:ids)
     UNION SELECT class_id FROM grades WHERE class_id IN (:ids)`,
    { replacements: { ids: classIds }, type: QueryTypes.SELECT },
  );
  return new Set(rows.map((r) => r.class_id));
};

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
      // `programs` (plural array) — not `program` (singular), which is
      // Student-only. Faculty/Chairperson use `programs` specifically to
      // support teaching more than one program.
      attributes: ['id', 'name', 'email', 'department', 'programs', 'avatar', 'employment_type'],
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
  // Two grouped queries for the whole page of classes instead of two queries
  // PER class (this list is asked for up to 200 classes at a time — that was
  // ~400 round trips per request).
  const listClassIds = classes.map((c) => c.id);
  const [enrollmentRows, submittedRows, encodedByClass, classesWithRecord] = listClassIds.length === 0 ? [[], [], new Map(), new Set()] : await Promise.all([
    Enrollment.findAll({
      where: { class_id: listClassIds },
      attributes: ['class_id', [fn('COUNT', col('id')), 'n']],
      group: ['class_id'],
      raw: true,
    }),
    Grade.findAll({
      where: { class_id: listClassIds, submitted: true },
      attributes: ['class_id', 'status', 'admin_approved', 'released'],
      raw: true,
    }),
    encodingCounts(listClassIds),
    classIdsWithScores(listClassIds),
  ]);
  const studentCountByClass = new Map(enrollmentRows.map((r) => [r.class_id, parseInt(r.n, 10)]));
  const submittedByClass = new Map();
  submittedRows.forEach((g) => {
    if (!submittedByClass.has(g.class_id)) submittedByClass.set(g.class_id, []);
    submittedByClass.get(g.class_id).push(g);
  });

  const classesWithCounts = classes.map((cls) => {
    const studentCount = studentCountByClass.get(cls.id) || 0;
    const grades = submittedByClass.get(cls.id) || [];
    return {
      ...cls.toJSON(),
      student_count: studentCount,
      submitted_count: grades.length,
      progress: studentCount > 0 ? Math.round((grades.length / studentCount) * 100) : 0,
      ...encodingFields(encodedByClass.get(cls.id), studentCount),
      passed_count: grades.filter((g) => g.status === 'Passed').length,
      inc_count: grades.filter((g) => g.status === 'INC').length,
      dropped_count: grades.filter((g) => g.status === 'DRP').length,
      // Used by Admin's Grade Approval list to filter/flag classes still
      // awaiting their sign-off, without opening each one individually.
      pending_admin_approval: grades.filter((g) => g.status === 'Passed' && !g.admin_approved).length,
      // Admin releases the grades from Grade Approval once both documents are approved.
      all_released: grades.length > 0 && grades.every((g) => g.released),
      has_scores: classesWithRecord.has(cls.id),
    };
  });

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
      { model: User, as: 'instructor', attributes: { exclude: USER_SECRET_FIELDS } },
      { model: User, as: 'students', attributes: { exclude: USER_SECRET_FIELDS }, through: { attributes: [] } },
      { model: Grade, as: 'grades', include: [{ model: User, as: 'student', attributes: ['id', 'name', 'student_no', 'avatar'] }] },
    ],
  });

  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  res.json({ class: cls });
});

// A Failed grade never blocks promotion (see promotionController.js) — the
// student advances on schedule and just owes a retake alongside next term's
// normal load. This is the other half of that: once a new class of the
// failed subject actually opens, find who needs to be dropped into it
// automatically, so nobody has to remember to manually re-enroll every
// retaking student by hand. A candidate is anyone who:
//   1. has a submitted Failed grade for this subject at some point, AND
//   2. hasn't since passed it (no submitted Passed grade for it), AND
//   3. isn't already sitting in another still-open (ungraded) class of it, AND
//   4. has cleared the subject's OWN prerequisite/co-requisite chain — same
//      rule a first-time enrollment would need, so retaking can't jump ahead
//      of what it itself requires.
const getRetakeCandidateIds = async (subject) => {
  const subjectClassIds = (await Class.findAll({ where: { subject_id: subject.id }, attributes: ['id'] })).map((c) => c.id);
  if (subjectClassIds.length === 0) return [];

  const pastGrades = await Grade.findAll({
    where: { class_id: { [Op.in]: subjectClassIds }, submitted: true, status: { [Op.in]: ['Failed', 'Passed'] } },
    attributes: ['student_id', 'status'],
  });
  const everFailedIds = new Set(pastGrades.filter((g) => g.status === 'Failed').map((g) => g.student_id));
  const everPassedIds = new Set(pastGrades.filter((g) => g.status === 'Passed').map((g) => g.student_id));
  const needsRetakeIds = [...everFailedIds].filter((id) => !everPassedIds.has(id));
  if (needsRetakeIds.length === 0) return [];

  // Already sitting in an ungraded class of this same subject — mid-retake
  // already, don't double-enroll them into yet another one.
  const currentEnrollments = await Enrollment.findAll({
    where: { student_id: { [Op.in]: needsRetakeIds } },
    include: [{ model: Class, as: 'class', where: { subject_id: subject.id }, attributes: [] }],
    attributes: ['student_id'],
  });
  const currentlyEnrolledIds = new Set(currentEnrollments.map((e) => e.student_id));
  const stillNeedIds = needsRetakeIds.filter((id) => !currentlyEnrolledIds.has(id));
  if (stillNeedIds.length === 0) return [];

  // Must be Active, and must have passed everything the subject itself
  // requires — otherwise this specific retake still isn't enrollable yet.
  const subjectWithReqs = await Subject.findByPk(subject.id, {
    include: [
      { model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id'] },
      { model: Subject, as: 'co_requisites', through: { attributes: [] }, attributes: ['id'] },
    ],
  });
  const requiredSubjectIds = [...(subjectWithReqs?.prerequisites || []), ...(subjectWithReqs?.co_requisites || [])].map((s) => s.id);

  const candidates = await User.findAll({ where: { id: { [Op.in]: stillNeedIds }, role: 'Student', status: 'Active', graduated_at: null }, attributes: ['id'] });
  if (candidates.length === 0 || requiredSubjectIds.length === 0) return candidates.map((s) => s.id);

  const candidateIds = candidates.map((s) => s.id);
  const passedRequired = await Grade.findAll({
    where: { student_id: { [Op.in]: candidateIds }, status: 'Passed', submitted: true },
    include: [{ model: Class, as: 'class', where: { subject_id: { [Op.in]: requiredSubjectIds } }, attributes: ['subject_id'] }],
    attributes: ['student_id'],
  });
  const passedByStudent = {};
  passedRequired.forEach((g) => {
    if (!passedByStudent[g.student_id]) passedByStudent[g.student_id] = new Set();
    passedByStudent[g.student_id].add(g.class.subject_id);
  });

  return candidateIds.filter((id) => requiredSubjectIds.every((rid) => passedByStudent[id]?.has(rid)));
};

// POST /api/classes
const createClass = asyncHandler(async (req, res) => {
  const { subject_id, schedule, section, semester, academic_year, student_ids, year_level } = req.body;
  let { instructor_id } = req.body;

  if (actsAsInstructor(req.user)) instructor_id = req.user.id;

  if (!subject_id || !instructor_id || !semester) {
    return res.status(400).json({ message: 'Subject, faculty, and semester are required.' });
  }

  const subject = await Subject.findByPk(subject_id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });

  // A semester that already ended has had all its classes archived
  // (semesterController.archiveEndedSemester) — a class created under it now
  // would sit Active in a finished term, never archived. New classes belong
  // to a running or upcoming semester only.
  const semesterRow = await Semester.findOne({ where: { name: semester }, attributes: ['status'] });
  if (semesterRow?.status === 'Completed') {
    return res.status(400).json({ message: `${semester} has already ended and its classes are archived. Create this class under the current semester instead.` });
  }

  // Cross-program teaching is allowed on purpose — a Faculty/Chairperson
  // tagged for one program can pick up a class in another program's
  // curriculum too (e.g. covering a shortage, or a shared elective), not
  // just their own subjects. Curriculum ownership (who may create/edit the
  // Subject record itself) is a separate, still-enforced check in
  // subjectController.js — this only concerns who may teach a class of it.

  const instructor = await User.findOne({ where: { id: instructor_id } });
  if (!instructor || !actsAsInstructor(instructor)) return res.status(404).json({ message: 'Faculty member not found.' });

  // Defaults to the Subject's own curriculum year if the Faculty member
  // doesn't override it — most classes are offered to their subject's normal
  // year, but this stays independently editable for retake/cross-year cases.
  const resolvedYearLevel = year_level || subject.year_level || null;

  // One Section of a Subject can only be created once for this exact
  // offering (same Subject + Year Level + Section + Semester) — including by
  // the SAME instructor re-submitting the form a second time (that used to
  // be excepted here, which is exactly how the same Faculty ended up with
  // two identical "CAP102 - Section D" classes, double-counting students and
  // splitting their grades across both). Only checked against still-Active
  // classes — one an instructor archived themselves (status flipped to
  // Completed/Cancelled) no longer holds the section, so re-creating it is
  // fine. Never applies when no Section was actually set.
  if (section) {
    const claimedBy = await Class.findOne({
      where: {
        subject_id,
        section,
        year_level: resolvedYearLevel,
        semester,
        status: 'Active',
      },
      include: [{ model: User, as: 'instructor', attributes: ['name'] }],
    });
    if (claimedBy) {
      const sameInstructor = claimedBy.instructor_id === instructor_id;
      return res.status(409).json({
        message: sameInstructor
          ? `You already have an active class for ${subject.code} - Section ${section} this semester. Edit or archive it instead of creating another.`
          : `${subject.code} - Section ${section} already has a class this semester, taught by ${claimedBy.instructor?.name || 'another faculty member'}. Contact your Chairperson if this needs to change.`,
      });
    }
  }

  const cls = await Class.create({
    subject_id,
    instructor_id,
    schedule,
    section: section || null,
    semester,
    academic_year,
    year_level: resolvedYearLevel,
  });

  await createDefaultGradeComponents(cls.id, subject);

  // Enroll any explicitly-picked students first...
  if (student_ids && student_ids.length > 0) {
    const validIds = await getEnrollableStudentIds(req.user, student_ids, subject.program);
    const enrollments = validIds.map((sid) => ({ class_id: cls.id, student_id: sid }));
    await Enrollment.bulkCreate(enrollments, { ignoreDuplicates: true });
  }

  // No automatic enrollment — the faculty member decides who is in the class
  // right after creating it (Add Students: pick from the advisory class
  // lists, or Import Class List).
  const enrolledCount = await Enrollment.count({ where: { class_id: cls.id } });
  await logActivity(req.user.id, `created class ${subject.code} - ${subject.name}${section ? ` Section ${section}` : ''}`, 'Class', cls.id);

  const fullClass = await Class.findByPk(cls.id, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: USER_SECRET_FIELDS } },
    ],
  });

  res.status(201).json({
    message: 'Class created — now add its students.',
    class: fullClass,
    enrolled_count: enrolledCount,
  });
});

// PUT /api/classes/:id
const updateClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id);
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only update your own classes.' });
  }

  const { schedule, section, semester, academic_year, status, encoding_open, instructor_id, year_level, subject_id } = req.body;
  // A different subject: only while no score or grade has been recorded,
  // since every score belongs to the old subject's Class Record. The default
  // Class Record parts are rebuilt for the new subject after the save.
  let newSubject = null;
  if (subject_id !== undefined && Number(subject_id) !== Number(cls.subject_id)) {
    newSubject = await Subject.findByPk(subject_id);
    if (!newSubject) return res.status(400).json({ message: 'That subject was not found.' });
    if ((await classIdsWithScores([cls.id])).has(cls.id)) {
      return res.status(400).json({ message: 'The subject can no longer be changed: scores or grades have already been recorded for this class. Create a new class for the other subject instead.' });
    }
    const enrolledIds = (await Enrollment.findAll({ where: { class_id: cls.id }, attributes: ['student_id'], raw: true })).map((e) => e.student_id);
    const blocked = await prerequisiteBlocks(newSubject.id, enrolledIds, cls.semester);
    if (blocked.size > 0) {
      return res.status(400).json({ message: `${blocked.size} student(s) on this class list have not passed the prerequisites of ${newSubject.code}. Remove them first, or create a new class for ${newSubject.code}.` });
    }
    cls.subject_id = newSubject.id;
  }
  if (schedule !== undefined) cls.schedule = schedule;
  if (section !== undefined) cls.section = section;
  if (year_level !== undefined) cls.year_level = year_level;
  if (semester !== undefined) cls.semester = semester;
  if (academic_year !== undefined) cls.academic_year = academic_year;
  if (status !== undefined) cls.status = status;
  if (encoding_open !== undefined) cls.encoding_open = encoding_open;
  if (instructor_id !== undefined && !actsAsInstructor(req.user)) cls.instructor_id = instructor_id;

  // Same one-Section-per-Faculty rule createClass enforces at creation time —
  // re-checked here too so editing a class's Section/Year Level/Semester (or
  // reassigning its instructor) can't be used to sidestep it after the fact.
  // Only matters when this class is actually still Active and a Section is
  // actually set; unaffected by anything about itself (excludes its own id).
  if (cls.section && (section !== undefined || year_level !== undefined || semester !== undefined || instructor_id !== undefined || subject_id !== undefined) && (status === undefined || status === 'Active')) {
    const claimedBy = await Class.findOne({
      where: {
        id: { [Op.ne]: cls.id },
        subject_id: cls.subject_id,
        section: cls.section,
        year_level: cls.year_level,
        semester: cls.semester,
        status: 'Active',
        instructor_id: { [Op.ne]: cls.instructor_id },
      },
      include: [{ model: User, as: 'instructor', attributes: ['name'] }, { model: Subject, as: 'subject', attributes: ['code'] }],
    });
    if (claimedBy) {
      return res.status(409).json({
        message: `${claimedBy.subject?.code || 'This subject'} - Section ${cls.section} already has a class this semester, taught by ${claimedBy.instructor?.name || 'another faculty member'}. Contact your Chairperson if this needs to change.`,
      });
    }
  }

  if (newSubject) {
    await Class.sequelize.transaction(async (transaction) => {
      await cls.save({ transaction });
      const componentIds = (await GradeComponent.findAll({ where: { class_id: cls.id }, attributes: ['id'], raw: true, transaction })).map((c) => c.id);
      if (componentIds.length) await ComponentItem.destroy({ where: { component_id: componentIds }, transaction });
      await GradeComponent.destroy({ where: { class_id: cls.id }, transaction });
    });
    await createDefaultGradeComponents(cls.id, newSubject);
  } else {
    await cls.save();
  }
  await logActivity(req.user.id, `updated class #${cls.id}`, 'Class', cls.id);
  res.json({ message: 'Class updated successfully.', class: cls });
});

// PUT /api/classes/:id/archive — Body: { archived: boolean }. A narrow
// sibling of updateClass (which Chairperson has no general access to, so
// they can't reach 'em all the way to schedule/instructor/section edits)
// just for the one thing Grade Approval/Grading Sheets' own "Done" section
// needs: flipping status Active <-> Completed to move a fully-approved class
// into/out of Archived. Same status values Faculty's own Archive button
// (routes through the regular updateClass) already uses, so all three roles'
// "archived" concept stays one and the same field.
const archiveClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (req.user.role === 'Chairperson' && !(req.user.programs || []).includes(cls.subject?.program)) {
    return res.status(403).json({ message: 'You may only archive classes within your own program(s).' });
  }
  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only archive your own classes.' });
  }

  const { archived } = req.body;
  cls.status = archived ? 'Completed' : 'Active';
  await cls.save();
  await logActivity(req.user.id, `${archived ? 'archived' : 'restored'} class #${cls.id}`, 'Class', cls.id);
  res.json({ message: archived ? 'Class archived.' : 'Class restored.', class: cls });
});

// Classes are never deleted — they are archived (PUT /api/classes/:id/archive
// above) and can be restored from the Archived tab.

// POST /api/classes/:id/enroll
// POST /api/classes/:id/import-class-list  { students: [...], row_offset? }
// The Faculty member (or teaching Chairperson) who teaches this class imports
// its class list — Student ID Number, name, Program, Year and Section. New
// students get an account (default password; they set their own at first
// login), students who already have one are simply added — and everyone on
// the list is enrolled in THIS class. Student accounts are created here and
// nowhere else, so they show up in the Admin's User Management on their own.
// The frontend sends big lists in chunks, so this handles one chunk.
// studentId → [prerequisite codes they took and haven't passed] for a subject.
const prerequisiteBlocks = async (subjectId, studentIds, semester = null) => {
  const blocked = new Map();
  if (!studentIds.length) return blocked;

  // Prerequisite checking starts at the second semester of deployment
  if (semester) {
    const semLower = semester.toLowerCase();
    if (semLower.includes('1st') || semLower.includes('first')) {
      return blocked;
    }
  }

  const subject = await Subject.findByPk(subjectId, {
    include: [{ model: Subject, as: 'prerequisites', through: { attributes: [] }, attributes: ['id', 'code'] }],
  });
  const prereqs = subject?.prerequisites || [];
  if (!prereqs.length) return blocked;
  const codeOf = new Map(prereqs.map((p) => [p.id, p.code]));
  const grades = await Grade.findAll({
    where: { student_id: { [Op.in]: studentIds }, submitted: true },
    attributes: ['student_id', 'status'],
    include: [{ model: Class, as: 'class', attributes: ['subject_id'], where: { subject_id: { [Op.in]: [...codeOf.keys()] } } }],
  });
  const passed = new Set();
  const attempted = new Map(); // `${student}|${subject}` → true
  grades.forEach((g) => {
    const k = `${g.student_id}|${g.class.subject_id}`;
    if (g.status === 'Passed') passed.add(k);
    else if (['Failed', 'INC', 'DRP'].includes(g.status)) attempted.set(k, true);
  });
  for (const k of attempted.keys()) {
    if (passed.has(k)) continue;
    const [sid, subj] = k.split('|').map(Number);
    blocked.set(sid, [...(blocked.get(sid) || []), codeOf.get(subj)]);
  }
  return blocked;
};

// null when the class's own section already has students (its adviser
// imported the class list); otherwise the message explaining who must do it.
const sectionRosterMissing = async (cls) => {
  const program = cls.subject?.program;
  if (!program || !cls.year_level || !cls.section) return null;
  const count = await User.count({ where: { role: 'Student', program, year_level: cls.year_level, section: cls.section, graduated_at: null } });
  if (count > 0) return null;
  const adviser = await User.findOne({
    where: { role: { [Op.in]: ['Faculty', 'Chairperson'] }, advisories: { [Op.contains]: [{ program, year_level: cls.year_level, section: cls.section }] } },
    attributes: ['name'],
  });
  const label = `Year ${cls.year_level} - Section ${cls.section}`;
  return adviser
    ? `The class list of ${label} hasn't been imported yet. Its adviser, ${adviser.name}, must import it first (My Advisory → Import Class List) — then you can add its students to this class.`
    : `The class list of ${label} hasn't been imported yet, and no adviser is assigned to that section. Ask the Admin to assign an adviser, who then imports the class list.`;
};

const importClassList = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  if (cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You can only import the class list of a class you teach.' });
  }
  if (cls.status !== 'Active') {
    return res.status(400).json({ message: 'This class is archived — restore it before importing a class list.' });
  }

  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ message: 'No students in the class list.' });
  }
  if (students.length > 5000) {
    return res.status(413).json({ message: 'Send at most 5000 students per request.' });
  }

  // Student accounts are created by their ADVISER's class list. A faculty's
  // own class list import can enroll students who already have an account
  // (regular or irregular from other sections). Any student without an account
  // yet is skipped so their respective section's adviser can import them first.
  const { created, existing, skipped, errors } = await upsertImportedStudents(students, { rowOffset: parseInt(req.body.row_offset, 10) || 0, createdBy: req.user.id, createNew: false });

  // Prerequisites: a student who TOOK a prerequisite of this subject here and
  // didn't pass it (Failed / INC / Dropped, with no later Pass) can't enroll
  // yet — they have to pass the prerequisite first. Students with no record
  // of it in the system (history from before the system) aren't blocked.
  // Enforcement begins at 2nd Semester onward.
  const prereqBlocked = await prerequisiteBlocks(cls.subject_id, existing.map((u) => u.id), cls.semester);
  existing.filter((u) => prereqBlocked.has(u.id)).forEach((u) => skipped.push({
    student_no: u.student_no,
    name: u.name,
    reason: `Must pass ${prereqBlocked.get(u.id).join(', ')} first (prerequisite of ${cls.subject?.code || 'this subject'})`,
  }));

  const ids = [...created, ...existing].map((u) => u.id).filter((id) => !prereqBlocked.has(id));
  const already = ids.length
    ? new Set((await Enrollment.findAll({ where: { class_id: cls.id, student_id: { [Op.in]: ids } }, attributes: ['student_id'] })).map((e) => e.student_id))
    : new Set();
  const toEnroll = ids.filter((id) => !already.has(id));
  if (toEnroll.length > 0) {
    await Enrollment.bulkCreate(toEnroll.map((sid) => ({ class_id: cls.id, student_id: sid })), { ignoreDuplicates: true });
  }

  if (created.length > 0 || toEnroll.length > 0) {
    await logActivity(req.user.id, `imported the class list of ${cls.subject?.code || 'class'}${cls.section ? ` ${cls.year_level || ''}-${cls.section}` : ''}: ${created.length} new student account(s), ${toEnroll.length} enrolled`, 'Class', cls.id);
  }

  // A major subject sets the main year level of the students taking it
  // (the highest year among their current majors — minors never change it).
  const yearChanges = cls.subject?.subject_type === 'Major' ? await syncMainYear(ids, req.user.id) : [];
  // Back subject → Irregular; class outside their Year + Section → they confirm.
  await afterEnrollment(req.app, cls, ids, req.user.id);
  const yearNote = yearChanges.length ? ` ${yearChanges.length} student(s) moved to their major-subject year: ${yearChanges.map((c) => `${c.name} (Year ${c.from} → ${c.to})`).join(', ')}.` : '';

  res.status(201).json({
    message: `${toEnroll.length} enrolled (${created.length} new account${created.length !== 1 ? 's' : ''}), ${already.size} already in this class, ${skipped.length} skipped, ${errors.length} error(s).${yearNote}`,
    yearChanges,
    createdCount: created.length,
    existingCount: existing.length,
    enrolledCount: toEnroll.length,
    alreadyEnrolledCount: already.size,
    skippedCount: skipped.length,
    errorCount: errors.length,
    skipped,
    errors,
  });
});

// DELETE /api/classes/:id/students/:studentId — the class's instructor takes a
// student off the class (wrong section, dropped the subject before any grade,
// etc.). Their unsubmitted Class Record scores and draft grade for this class
// go with them. Not allowed once the class is sent to the Chairperson or the
// student's grade was submitted — undo the submission / mark them Dropped instead.
const unenrollStudent = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only unenroll students from your own classes.' });
  }
  const studentId = parseInt(req.params.studentId, 10);
  const enrollment = await Enrollment.findOne({ where: { class_id: cls.id, student_id: studentId } });
  if (!enrollment) return res.status(404).json({ message: 'That student is not enrolled in this class.' });
  const archivedMsg = await require('../utils/archiveGuard').archivedClassMessage(cls);
  if (archivedMsg) return res.status(400).json({ message: archivedMsg });
  if (cls.sent_to_chairperson) {
    return res.status(400).json({ message: 'This class was already sent to your Chairperson — undo the submission first.' });
  }
  const grade = await Grade.findOne({ where: { class_id: cls.id, student_id: studentId } });
  if (grade?.submitted) {
    return res.status(400).json({ message: 'This student\'s grade was already submitted — mark them as Dropped instead.' });
  }

  const student = await User.findByPk(studentId, { attributes: ['id', 'name'] });
  const itemIds = (await ComponentItem.findAll({
    attributes: ['id'],
    include: [{ model: GradeComponent, as: 'component', where: { class_id: cls.id }, attributes: [] }],
  })).map((i) => i.id);
  if (itemIds.length) await ComponentScore.destroy({ where: { student_id: studentId, item_id: { [Op.in]: itemIds } } });
  if (grade) await grade.destroy();
  await enrollment.destroy();

  await logActivity(req.user.id, `unenrolled ${student?.name || 'a student'} from ${cls.subject?.code || 'a class'}${cls.section ? ` ${cls.year_level || ''}-${cls.section}` : ''}`, 'Class', cls.id);
  // Off a back / other-section subject → may be Regular again.
  await syncRegularity(req.app, [studentId], req.user.id);
  res.json({ message: `${student?.name || 'Student'} was unenrolled from ${cls.subject?.code || 'the class'}.` });
});

const enrollStudents = asyncHandler(async (req, res) => {
  const { student_ids } = req.body;
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only enroll students in your own classes.' });
  }

  const eligibleIds = await getEnrollableStudentIds(req.user, student_ids, cls.subject?.program);
  // Same prerequisite rule as class-list import.
  const blocked = await prerequisiteBlocks(cls.subject_id, eligibleIds, cls.semester);
  const validIds = eligibleIds.filter((id) => !blocked.has(id));
  const enrollments = validIds.map((sid) => ({ class_id: cls.id, student_id: sid }));
  await Enrollment.bulkCreate(enrollments, { ignoreDuplicates: true });
  // Major subjects set the students' main year level (utils/mainYear.js).
  const yearChanges = cls.subject?.subject_type === 'Major' ? await syncMainYear(validIds, req.user.id) : [];
  // Back subject → Irregular; class outside their Year + Section → they confirm.
  await afterEnrollment(req.app, cls, validIds, req.user.id);

  await logActivity(req.user.id, `enrolled ${validIds.length} students in ${cls.subject?.code || `class #${cls.id}`}`, 'Class', cls.id);
  const blockedNote = blocked.size ? ` ${blocked.size} not enrolled — prerequisite not yet passed (${[...new Set([...blocked.values()].flat())].join(', ')}).` : '';
  res.json({ message: `${validIds.length} student(s) enrolled.${blockedNote}`, enrolled: validIds.length, prerequisite_held: blocked.size, yearChanges });
});

// GET /api/classes/:id/section-students?program=&year_level=&section=
// The students already in the system for one Program / Year / Section (the
// roster its adviser imported), flagged with whether each is already in this
// class — for adding them to the class without importing a list.
const getSectionStudents = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only add students to your own classes.' });
  }
  const { program, section } = req.query;
  const year = parseInt(req.query.year_level, 10);
  if (!program || !year || !section) return res.status(400).json({ message: 'Choose a program, year and section.' });

  const students = await User.findAll({
    where: { role: 'Student', status: 'Active', graduated_at: null, program, year_level: year, section },
    attributes: ['id', 'name', 'student_no', 'program', 'year_level', 'section', 'student_status'],
  });
  const enrolled = new Set((await Enrollment.findAll({ where: { class_id: cls.id }, attributes: ['student_id'] })).map((e) => e.student_id));
  const blocked = await prerequisiteBlocks(cls.subject_id, students.map((s) => s.id), cls.semester);
  // Who advises this section (for the picker's header).
  const adviser = await User.findOne({
    where: { role: { [Op.in]: ['Faculty', 'Chairperson'] }, advisories: { [Op.contains]: [{ program, year_level: year, section }] } },
    attributes: ['name'],
  });
  res.json({
    adviser: adviser?.name || null,
    students: students.map((s) => ({
      ...s.toJSON(),
      is_enrolled: enrolled.has(s.id),
      prerequisite_needed: blocked.get(s.id) || null,
    })).sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  });
});

// GET /api/classes/:id/eligible-students
// Registration approval now happens entirely on the Chairperson's Pending
// Registrations page — by the time a class exists, every student it could
// enroll is already Active. This just makes them easy to find: Active
// students in the class's Subject program, filtered down to this class's own
// Year Level + Section (both explicitly set by the Faculty member at
// creation, not derived), so the Enroll Students picker isn't a scroll
// through every active student in the system.
const getEligibleStudents = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });
  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only view eligible students for your own classes.' });
  }

  const where = { role: 'Student', status: 'Active', graduated_at: null, program: cls.subject.program };
  if (cls.year_level) where.year_level = cls.year_level;
  if (cls.section) where.section = cls.section;

  const students = await User.findAll({
    where,
    attributes: { exclude: USER_SECRET_FIELDS },
    order: [['name', 'ASC']],
  });

  // An Irregular student's plain year_level/section only mirrors whichever
  // Year+Section pair is marked `is_current` (their normal, on-track
  // coursework) — the query above alone would miss one who's enrolled here
  // as a BACK subject instead (e.g. this class is their Year 2 retake while
  // they're primarily a Year 4 student). Same matching classController's own
  // auto-enroll-on-class-creation pass already applies, just run here too so
  // the picker (and its "already enrolled" flag) doesn't silently drop them.
  const matchedIds = new Set(students.map((s) => s.id));
  let irregularMatches = [];
  if (cls.year_level && cls.section) {
    const irregularCandidates = await User.findAll({
      where: { role: 'Student', status: 'Active', graduated_at: null, program: cls.subject.program, student_status: 'Irregular' },
      attributes: { exclude: USER_SECRET_FIELDS },
    });
    irregularMatches = irregularCandidates.filter((s) => {
      if (matchedIds.has(s.id)) return false; // already caught by the plain year/section query above
      return (s.irregular_sections || []).some(
        (p) => String(p.year_level) === String(cls.year_level) && p.section === cls.section,
      );
    });
  }

  const allStudents = [...students, ...irregularMatches];

  // Flag who's already in this exact class, so the picker can show that
  // instead of just silently no-op'ing a re-enroll (Enrollment.bulkCreate
  // below already ignores duplicates either way).
  const existingEnrollments = await Enrollment.findAll({ where: { class_id: cls.id }, attributes: ['student_id'] });
  const enrolledIds = new Set(existingEnrollments.map((e) => e.student_id));
  // Students enrolled from another section (added by Import Class List) are
  // listed too, so they can be seen and unenrolled here as well.
  const listedIds = new Set(allStudents.map((s) => s.id));
  const fromOtherSections = [...enrolledIds].filter((id) => !listedIds.has(id));
  if (fromOtherSections.length) {
    allStudents.push(...await User.findAll({ where: { id: { [Op.in]: fromOtherSections } }, attributes: { exclude: USER_SECRET_FIELDS } }));
  }
  const withEnrollmentFlag = allStudents
    .map((s) => ({ ...s.toJSON(), is_enrolled: enrolledIds.has(s.id) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  res.json({ students: withEnrollmentFlag });
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

  // Class.semester is just a name string, not a FK — look up each name's
  // actual Semester row so the frontend can tell which classes belong to a
  // term that's since been marked Completed (i.e. should move to Archived).
  const semesterRows = await Semester.findAll({ attributes: ['name', 'status', 'is_current'] });
  const semesterByName = {};
  semesterRows.forEach((s) => { semesterByName[s.name] = s; });

  // Grouped instead of per-class — see getClasses for the reasoning.
  const instClassIds = classes.map((c) => c.id);
  const [instEnrollRows, instGradeRows, instEncodedByClass, instRecordIds] = instClassIds.length === 0 ? [[], [], new Map(), new Set()] : await Promise.all([
    Enrollment.findAll({
      where: { class_id: instClassIds },
      attributes: ['class_id', [fn('COUNT', col('id')), 'n']],
      group: ['class_id'],
      raw: true,
    }),
    Grade.findAll({
      where: { class_id: instClassIds, submitted: true },
      attributes: ['class_id', 'status', 'admin_approved', 'released'],
      raw: true,
    }),
    encodingCounts(instClassIds),
    classIdsWithScores(instClassIds),
  ]);
  const instCountByClass = new Map(instEnrollRows.map((r) => [r.class_id, parseInt(r.n, 10)]));
  const instGradesByClass = new Map();
  instGradeRows.forEach((g) => {
    if (!instGradesByClass.has(g.class_id)) instGradesByClass.set(g.class_id, []);
    instGradesByClass.get(g.class_id).push(g);
  });

  const withCounts = await Promise.all(
    classes.map(async (cls) => {
      const studentCount = instCountByClass.get(cls.id) || 0;
      const submittedGrades = instGradesByClass.get(cls.id) || [];
      const gradeCount = submittedGrades.length;
      const semesterRow = semesterByName[cls.semester];
      // Same eligibility check releaseClassGrades enforces server-side — lets
      // "My Classes" show/enable the Release Grades action directly instead
      // of only ever being reachable from inside Grade Encoding.
      const pendingAdminApproval = submittedGrades.filter((g) => g.status === 'Passed' && !g.admin_approved).length;
      const allReleased = gradeCount > 0 && submittedGrades.every((g) => g.released);
      return {
        ...cls.toJSON(),
        student_count: studentCount,
        submitted_count: gradeCount,
        progress: studentCount > 0 ? Math.round((gradeCount / studentCount) * 100) : 0,
        ...encodingFields(instEncodedByClass.get(cls.id), studentCount),
        semester_status: semesterRow?.status || null,
        // Archived either because the whole semester was marked Completed by
        // Admin, or because the Faculty/Chairperson archived this one class
        // themselves (status set directly, semester itself may still be
        // ongoing) — `manually_archived` lets the frontend tell those two
        // apart, since only the second one makes sense to ever un-archive.
        is_archived: semesterRow?.status === 'Completed' || ['Completed', 'Cancelled'].includes(cls.status),
        manually_archived: semesterRow?.status !== 'Completed' && ['Completed', 'Cancelled'].includes(cls.status),
        pending_admin_approval: pendingAdminApproval,
        all_released: allReleased,
        has_scores: instRecordIds.has(cls.id),
        // Both sign-offs: Chairperson verification AND Admin's approval of
        // the Class Record + Grade Sheet (see gradeController's adminSignedOff).
        can_release: gradeCount > 0 && !!cls.chairperson_verified && !!cls.admin_class_record_approved && !!cls.admin_grade_sheet_approved && pendingAdminApproval === 0 && !allReleased,
      };
    })
  );

  res.json({ classes: withCounts });
});

// GET /api/classes/pending-approval-count — the sidebar badge on "Grade
// Approval" for both Admin and Chairperson, each scoped to their own stage
// of the same pipeline instead of one shared meaning:
//   Admin        — chairperson_verified, but not yet both of Admin's own
//                  approvals. Mirrors GradeApproval.js's "needs_approval" stage.
//   Chairperson  — not yet chairperson_verified, but Faculty has submitted
//                  at least one grade, scoped to their own program(s) via
//                  the class's SUBJECT (not the instructor's own tag — see
//                  reportController's notifyGradingSheetSent for why that
//                  distinction matters). Mirrors GradingSheets.js's own
//                  "submitted" stage (topGroupOf).
// Either way, a single COUNT-shaped query instead of fetching every class
// plus its full student/grade breakdown just to answer one badge number.
const getPendingApprovalCount = asyncHandler(async (req, res) => {
  if (req.user.role === 'Admin') {
    const count = await Class.count({
      where: {
        chairperson_verified: true,
        [Op.or]: [
          { admin_class_record_approved: false },
          { admin_grade_sheet_approved: false },
        ],
      },
    });
    return res.json({ count });
  }

  const classes = await Class.findAll({
    where: { chairperson_verified: false },
    include: [{ model: Subject, as: 'subject', where: { program: { [Op.in]: req.user.programs || [] } }, attributes: [] }],
    attributes: ['id'],
  });
  const classIds = classes.map((c) => c.id);
  if (classIds.length === 0) return res.json({ count: 0 });

  const submittedGroups = await Grade.findAll({
    where: { class_id: { [Op.in]: classIds }, submitted: true },
    attributes: ['class_id'],
    group: ['class_id'],
  });
  res.json({ count: submittedGroups.length });
});

module.exports = { getClasses, getClassById, createClass, updateClass, archiveClass, enrollStudents, unenrollStudent, getSectionStudents, importClassList, getInstructorClasses, getEligibleStudents, getPendingApprovalCount };