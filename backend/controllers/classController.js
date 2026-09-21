const { Class, Subject, User, Enrollment, Grade, GradeComponent, ComponentItem, ComponentScore, Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { actsAsInstructor } = require('../utils/teachingAuth');

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

// Restricts a proposed student_ids list to Active students in the given program
// (only applied for Instructor callers, including a teaching Chairperson; Admin
// and a non-teaching Chairperson can enroll any student)
const getEnrollableStudentIds = async (user, studentIds, program) => {
  if (!actsAsInstructor(user)) return studentIds;
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
        // Used by Admin's Grade Approval list to filter/flag classes still
        // awaiting their sign-off, without opening each one individually.
        pending_admin_approval: grades.filter((g) => g.status === 'Passed' && !g.admin_approved).length,
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

  const candidates = await User.findAll({ where: { id: { [Op.in]: stillNeedIds }, role: 'Student', status: 'Active' }, attributes: ['id'] });
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
    return res.status(400).json({ message: 'Subject, instructor, and semester are required.' });
  }

  const subject = await Subject.findByPk(subject_id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });

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

  // One Section of a Subject belongs to whichever Faculty already claimed it
  // for this exact offering (same Subject + Year Level + Section + Semester)
  // — a different instructor can't also create a class for it, which would
  // otherwise auto-enroll the same students into two parallel classes for
  // the same subject (see the auto-enroll pass below) and split their grades
  // across both. Only checked against still-Active classes — one an
  // instructor archived themselves (status flipped to Completed/Cancelled)
  // no longer holds the section. The original creator re-creating their own
  // is unaffected (instructor_id excluded), and this never applies when no
  // Section was actually set.
  if (section) {
    const claimedBy = await Class.findOne({
      where: {
        subject_id,
        section,
        year_level: resolvedYearLevel,
        semester,
        status: 'Active',
        instructor_id: { [Op.ne]: instructor_id },
      },
      include: [{ model: User, as: 'instructor', attributes: ['name'] }],
    });
    if (claimedBy) {
      return res.status(409).json({
        message: `${subject.code} - Section ${section} already has a class this semester, taught by ${claimedBy.instructor?.name || 'another faculty member'}. Contact your Chairperson if this needs to change.`,
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

  // ...then auto-enroll everyone else already Active in this exact Year Level
  // + Section, so a Faculty member doesn't have to separately open "Enroll
  // Students" right after creating a class for their own section's roster.
  // This plain year_level/section match already covers an Irregular student's
  // FIRST Year+Section pair too (User.irregular_sections keeps year_level/
  // section mirroring that first entry) — the second pass below only needs to
  // catch any of their OTHER Year+Section pairs.
  let autoEnrolledCount = 0;
  const matchingIds = new Set();
  if (cls.year_level && cls.section) {
    const matching = await User.findAll({
      where: { role: 'Student', status: 'Active', program: subject.program, year_level: cls.year_level, section: cls.section },
      attributes: ['id'],
    });
    matching.forEach((s) => matchingIds.add(s.id));

    const irregularCandidates = await User.findAll({
      where: { role: 'Student', status: 'Active', program: subject.program, student_status: 'Irregular' },
      attributes: ['id', 'irregular_sections'],
    });
    irregularCandidates.forEach((s) => {
      const hasMatch = (s.irregular_sections || []).some(
        (p) => String(p.year_level) === String(cls.year_level) && p.section === cls.section,
      );
      if (hasMatch) matchingIds.add(s.id);
    });

    if (matchingIds.size > 0) {
      await Enrollment.bulkCreate([...matchingIds].map((sid) => ({ class_id: cls.id, student_id: sid })), { ignoreDuplicates: true });
      autoEnrolledCount = matchingIds.size;
    }
  }

  // ...and finally, auto-enroll anyone who's been carrying a Failed grade
  // for this exact subject from an earlier term (and has since cleared
  // whatever it itself requires) — they likely won't match this class's own
  // year_level/section, since a retake usually rides alongside a lower
  // year's normal offering. bulkCreate's ignoreDuplicates covers anyone the
  // section-roster pass above already caught.
  let retakeEnrolledCount = 0;
  const retakeCandidateIds = await getRetakeCandidateIds(subject);
  if (retakeCandidateIds.length > 0) {
    await Enrollment.bulkCreate(retakeCandidateIds.map((sid) => ({ class_id: cls.id, student_id: sid })), { ignoreDuplicates: true });
    retakeEnrolledCount = retakeCandidateIds.length;
  }

  const autoEnrollNote = [
    autoEnrolledCount > 0 ? `${autoEnrolledCount} from Year ${cls.year_level}/Section ${cls.section}` : null,
    retakeEnrolledCount > 0 ? `${retakeEnrolledCount} retaking` : null,
  ].filter(Boolean).join(', ');
  await logActivity(req.user.id, `created class ${subject.code} - ${subject.name}${section ? ` Section ${section}` : ''}${autoEnrollNote ? ` (${autoEnrollNote} student(s) auto-enrolled)` : ''}`, 'Class', cls.id);

  const fullClass = await Class.findByPk(cls.id, {
    include: [
      { model: Subject, as: 'subject' },
      { model: User, as: 'instructor', attributes: { exclude: ['password'] } },
    ],
  });

  res.status(201).json({
    message: autoEnrollNote
      ? `Class created successfully. ${autoEnrollNote} student(s) auto-enrolled.`
      : 'Class created successfully.',
    class: fullClass,
    auto_enrolled_count: autoEnrolledCount,
    retake_enrolled_count: retakeEnrolledCount,
  });
});

// PUT /api/classes/:id
const updateClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id);
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only update your own classes.' });
  }

  const { schedule, section, semester, academic_year, status, encoding_open, instructor_id, year_level } = req.body;
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
  if (cls.section && (section !== undefined || year_level !== undefined || semester !== undefined || instructor_id !== undefined) && (status === undefined || status === 'Active')) {
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

  await cls.save();
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

// DELETE /api/classes/:id
const deleteClass = asyncHandler(async (req, res) => {
  const cls = await Class.findByPk(req.params.id, { include: [{ model: Subject, as: 'subject' }] });
  if (!cls) return res.status(404).json({ message: 'Class not found.' });

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only delete your own classes.' });
  }

  // Deleting a class with submitted grades is allowed on request — this
  // permanently destroys those Grade rows along with everything else below
  // (components/items/scores/enrollments). There's no soft-delete or
  // recovery path once this runs; the frontend's own confirm dialog is the
  // only warning before this point.
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

  if (actsAsInstructor(req.user) && cls.instructor_id !== req.user.id) {
    return res.status(403).json({ message: 'You may only enroll students in your own classes.' });
  }

  const validIds = await getEnrollableStudentIds(req.user, student_ids, cls.subject?.program);
  const enrollments = validIds.map((sid) => ({ class_id: cls.id, student_id: sid }));
  await Enrollment.bulkCreate(enrollments, { ignoreDuplicates: true });

  await logActivity(req.user.id, `enrolled ${validIds.length} students in class #${cls.id}`, 'Class', cls.id);
  res.json({ message: `${validIds.length} students enrolled.` });
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

  const where = { role: 'Student', status: 'Active', program: cls.subject.program };
  if (cls.year_level) where.year_level = cls.year_level;
  if (cls.section) where.section = cls.section;

  const students = await User.findAll({
    where,
    attributes: { exclude: ['password'] },
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
      where: { role: 'Student', status: 'Active', program: cls.subject.program, student_status: 'Irregular' },
      attributes: { exclude: ['password'] },
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

  const withCounts = await Promise.all(
    classes.map(async (cls) => {
      const studentCount = await Enrollment.count({ where: { class_id: cls.id } });
      const submittedGrades = await Grade.findAll({ where: { class_id: cls.id, submitted: true }, attributes: ['status', 'admin_approved', 'released'] });
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
        can_release: gradeCount > 0 && cls.chairperson_verified && pendingAdminApproval === 0 && !allReleased,
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

module.exports = { getClasses, getClassById, createClass, updateClass, archiveClass, deleteClass, enrollStudents, getInstructorClasses, getEligibleStudents, getPendingApprovalCount };