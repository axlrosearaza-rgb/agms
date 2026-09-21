const { User, Grade, Enrollment, Class, Subject } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyStudentDecision } = require('../utils/notifyStudentDecision');
const { enrollStudentIntoMatchingClasses } = require('../utils/autoEnroll');
const { presenceFor } = require('../utils/presence');

// GE is a *bonus* tag, not its own department — a Faculty account teaching
// General Education still belongs to whichever real program's Chairperson
// created them (e.g. IT, Psych), and that real program is what scopes their
// visibility/management, same as any other Faculty account. This constant only
// lets a Chairperson tag a new/existing Faculty account with GE on top of their
// own real program(s) when creating or editing — it never grants visibility
// across programs. Same string the frontend offers (UserManagement.js's GE_OPTION).
const GE_PROGRAM = 'General Education (GE)';

// GET /api/users
const getUsers = asyncHandler(async (req, res) => {
  const { role, department, search, status, program, year_level, section, page = 1, limit = 100, all } = req.query;

  const where = {};
  if (role) where.role = role;
  if (department) where.department = department;
  if (status) {
    where.status = status;
  } else {
    // Rejected registrations must never appear in User Management
    where.status = { [Op.ne]: 'Rejected' };
  }
  // Student-only narrowing — used by the Faculty "Enroll Students" picker to
  // find Active students matching a specific class's Year Level + Section.
  if (program) where.program = program;
  if (year_level) where.year_level = year_level;
  if (section) where.section = section;

  // Instructor/Chairperson callers are scoped to their own program(s) — Students
  // use the singular `program` column, but Instructor/Chairperson accounts use the
  // `programs` array, so the two branches need different operators. GE isn't a
  // routing category on its own — a GE-teaching Faculty account still carries
  // whichever real program's department they belong to (see GE_PROGRAM below),
  // and that real program is what determines which Chairperson sees them.
  if (req.user.role === 'Faculty' || req.user.role === 'Chairperson') {
    const myPrograms = req.user.programs || [];
    // A Faculty account's Students List covers EVERY program — an instructor
    // can teach (and needs to look up) students outside their own program's
    // Chairperson scope, e.g. General Education classes. That only widens
    // Student rows; other Faculty/Chairperson accounts stay scoped to the
    // caller's own program(s) exactly as before, and a Chairperson's own
    // scoping is unchanged.
    // A Chairperson who also teaches gets the same all-programs view, but only
    // on request (all_programs=true, sent by the Students List page) — their
    // normal User Management keeps its own-program scoping.
    const allProgramStudents = req.user.role === 'Faculty'
      || (req.user.role === 'Chairperson' && req.user.is_teaching && req.query.all_programs === 'true');
    const studentScope = allProgramStudents
      ? { role: 'Student' }
      : { role: 'Student', program: { [Op.in]: myPrograms } };
    where[Op.and] = [{
      [Op.or]: [
        studentScope,
        { role: { [Op.in]: ['Faculty', 'Chairperson'] }, programs: { [Op.overlap]: myPrograms } },
      ],
    }];
  }
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
      { username: { [Op.iLike]: `%${search}%` } },
      { student_no: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // If 'all=true' is passed, return all results without pagination (for dropdowns/enrollment)
  if (all === 'true') {
    const users = await User.findAll({
      where,
      attributes: { exclude: ['password'] },
      order: [['name', 'ASC']],
    });

    return res.json({
      users,
      pagination: {
        total: users.length,
        page: 1,
        limit: users.length,
        pages: 1,
      },
    });
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { rows: users, count: total } = await User.findAndCountAll({
    where,
    attributes: { exclude: ['password'] },
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset,
  });

  res.json({
    users,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
});

// GET /api/users/:id
const getUserById = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id, {
    attributes: { exclude: ['password'] },
  });
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }
  res.json({ user });
});

// POST /api/users
const createUser = asyncHandler(async (req, res) => {
  const { name, email, username, password, role, program, programs, student_no, year_level, section, employee_no, academic_rank, specialization, highest_education, employment_type, position, student_status, student_type, is_teaching } = req.body;

  if (!name || !password || !role) {
    return res.status(400).json({ message: 'Name, password, and role are required.' });
  }

  // Students self-register (see authController.register) and are then verified,
  // not manually created here — so account creation through this endpoint is
  // split by role instead: Admins seed the Chairperson for each program (and
  // can also add Faculty directly, e.g. Part Time hires who report straight
  // to Admin rather than through a Chairperson), and each Chairperson in
  // turn can staff their own program(s) with Faculty too. Unlike a
  // Chairperson creating Faculty, Admin isn't scoped to any particular
  // program(s) — they can assign any.
  if (req.user.role === 'Admin' && !['Chairperson', 'Faculty'].includes(role)) {
    return res.status(403).json({ message: 'Admins may only create Chairperson or Faculty accounts.' });
  }
  if (req.user.role === 'Chairperson') {
    if (role !== 'Faculty') {
      return res.status(403).json({ message: 'Chairpersons may only create Faculty accounts.' });
    }
    const myPrograms = req.user.programs || [];
    const targetPrograms = programs || [];
    if (targetPrograms.length === 0 || !targetPrograms.every((p) => p === GE_PROGRAM || myPrograms.includes(p))) {
      return res.status(403).json({ message: 'You may only create accounts within your own program(s).' });
    }
  }

  if (role === 'Student') {
    if (!student_no) return res.status(400).json({ message: 'Student ID Number is required.' });
  } else if (!username) {
    return res.status(400).json({ message: 'Username is required for Admin/Chairperson/Faculty accounts.' });
  }

  if ((role === 'Faculty' || role === 'Chairperson') && (!programs || programs.length === 0)) {
    return res.status(400).json({ message: 'Select at least one program.' });
  }

  if (username) {
    const existingUsername = await User.findOne({ where: { username: username.toLowerCase() } });
    if (existingUsername) {
      return res.status(409).json({ message: 'This username is already taken.' });
    }
  }

  if (email) {
    const existing = await User.findOne({ where: { email: email.toLowerCase() } });
    if (existing) {
      return res.status(409).json({ message: 'A user with this email already exists.' });
    }
  }

  if (role === 'Student' && student_no) {
    const existingNo = await User.findOne({ where: { student_no } });
    if (existingNo) {
      return res.status(409).json({ message: 'This student number is already taken.' });
    }
  }

  if ((role === 'Faculty' || role === 'Chairperson') && employee_no) {
    const existingEmp = await User.findOne({ where: { employee_no } });
    if (existingEmp) {
      return res.status(409).json({ message: 'This employee number is already taken.' });
    }
  }

  const isFaculty = role === 'Faculty' || role === 'Chairperson';

  const user = await User.create({
    name,
    email: email ? email.toLowerCase() : null,
    username: role !== 'Student' ? username : null,
    password,
    role,
    program: role === 'Student' ? (program || null) : null,
    programs: isFaculty ? (programs || []) : null,
    student_no: role === 'Student' ? student_no : null,
    year_level: role === 'Student' ? year_level : null,
    section: role === 'Student' ? section : null,
    student_status: role === 'Student' ? (student_status || 'Regular') : null,
    student_type: role === 'Student' ? (student_type || null) : null,
    employee_no: isFaculty ? employee_no : null,
    academic_rank: isFaculty ? academic_rank : null,
    specialization: isFaculty ? specialization : null,
    highest_education: isFaculty ? highest_education : null,
    employment_type: isFaculty ? (employment_type || 'Full Time') : null,
    position: role === 'Chairperson' ? (position || 'Chairperson') : null,
    is_teaching: role === 'Chairperson' ? !!is_teaching : false,
  });

  await logActivity(req.user.id, `created ${role.toLowerCase()} account for ${name}`, 'User', user.id);
  res.status(201).json({ message: 'User created successfully.', user: user.toSafeJSON() });
});

// PUT /api/users/:id
const updateUser = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (req.user.role === 'Faculty') {
    if (user.role !== 'Student' || !(req.user.programs || []).includes(user.program)) {
      return res.status(403).json({ message: 'You may only verify students in your own program.' });
    }
    if (user.status !== 'Pending' || !['Active', 'Deactivated', 'Rejected'].includes(req.body.status)) {
      return res.status(403).json({ message: 'You may only approve or reject pending student registrations.' });
    }
    const previousStatus = user.status;
    user.status = (req.body.status === 'Deactivated' || req.body.status === 'Rejected') ? 'Rejected' : 'Active';
    await user.save();
    await notifyStudentDecision(user, previousStatus);
    if (previousStatus === 'Pending' && user.status === 'Active') {
      await enrollStudentIntoMatchingClasses(user);
    }
    await logActivity(req.user.id, `${user.status === 'Active' ? 'verified' : 'rejected'} student ${user.name}`, 'User', user.id);
    return res.json({ message: 'User updated successfully.', user: user.toSafeJSON() });
  }

  // Chairpersons may fully manage Student/Instructor accounts within their own
  // program(s), but may not touch Chairperson/Admin accounts, change a user's
  // role, or reassign someone outside their own program(s).
  if (req.user.role === 'Chairperson') {
    if (!['Student', 'Faculty'].includes(user.role)) {
      return res.status(403).json({ message: 'You may only manage Student or Faculty accounts.' });
    }
    const myPrograms = req.user.programs || [];
    const inScope = user.role === 'Student'
      ? myPrograms.includes(user.program)
      : (user.programs || []).some((p) => myPrograms.includes(p));
    if (!inScope) {
      return res.status(403).json({ message: 'You may only manage accounts within your own program(s).' });
    }
    if (req.body.role && req.body.role !== user.role) {
      return res.status(403).json({ message: "Chairpersons may not change a user's role." });
    }
    if (req.body.program && !myPrograms.includes(req.body.program)) {
      return res.status(403).json({ message: 'You may only assign your own program(s).' });
    }
    if (req.body.programs && !req.body.programs.every((p) => p === GE_PROGRAM || myPrograms.includes(p))) {
      return res.status(403).json({ message: 'You may only assign your own program(s).' });
    }
  }

  // Admin and Chairperson both lose edit rights over a Student's info once
  // they're verified (status Active) — deactivating the account is still
  // available (that's its own action, not an "info edit"), but name/program/
  // year level/section/student no. etc. are locked at that point. Faculty
  // never had general edit rights to begin with (see the early return above —
  // they can only approve/reject a still-Pending registration).
  if (['Admin', 'Chairperson'].includes(req.user.role) && user.role === 'Student' && user.status === 'Active') {
    const infoFields = ['name', 'program', 'programs', 'student_no', 'year_level', 'section', 'student_status', 'student_type'];
    const attemptedInfoChange = infoFields.some((f) => req.body[f] !== undefined && req.body[f] !== user[f]);
    if (attemptedInfoChange) {
      return res.status(403).json({
        message: `${user.name} is already verified — their information can no longer be edited. Deactivating the account is still available.`,
      });
    }
  }

  const previousStatus = user.status;
  const allowedFields = ['name', 'role', 'program', 'programs', 'student_no', 'year_level', 'section', 'status', 'employee_no', 'academic_rank', 'specialization', 'highest_education', 'employment_type', 'position', 'student_status', 'student_type', 'can_manage_semester', 'is_teaching'];
  const uniqueFields = ['student_no', 'employee_no'];
  // Boolean fields must bypass the `|| null` coercion below — `false || null` would
  // silently turn an explicit "false" into null, which fails can_manage_semester's/
  // is_teaching's NOT NULL constraint and would make it impossible to ever revoke them.
  const booleanFields = ['can_manage_semester', 'is_teaching'];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      if (booleanFields.includes(field)) {
        user[field] = !!req.body[field];
      } else if (uniqueFields.includes(field) && req.body[field] === '') {
        // Convert empty strings to null for unique fields to avoid constraint errors
        user[field] = null;
      } else {
        user[field] = req.body[field] || null;
      }
    }
  });

  // Keep non-nullable fields from being set to null
  if (req.body.name) user.name = req.body.name;
  if (req.body.role) user.role = req.body.role;

  // Username, email, and password are intentionally never settable here once
  // an account exists — each is chosen once at creation (a student's own
  // choice at registration, or the default a Admin/Chairperson sets for a new
  // staff account), and from then on only the account owner can change any of
  // them, via their own Settings page (PUT /auth/username, /auth/email/*,
  // /auth/password). Any of the three sent to this endpoint is ignored — this
  // is Admin/Chairperson's user-management edit, not an account-recovery tool
  // (that's the separate PUT /users/:id/reset-credentials, for genuine lockouts).

  // If a pending student registration is being rejected, set status to 'Rejected'
  // so it never appears in User Management as a deactivated user
  if (user.role === 'Student' && previousStatus === 'Pending' && (req.body.status === 'Deactivated' || req.body.status === 'Rejected')) {
    user.status = 'Rejected';
  }

  await user.save();
  await notifyStudentDecision(user, previousStatus);
  if (previousStatus === 'Pending' && user.status === 'Active') {
    await enrollStudentIntoMatchingClasses(user);
  }
  await logActivity(req.user.id, `updated user ${user.name}`, 'User', user.id);
  res.json({ message: 'User updated successfully.', user: user.toSafeJSON() });
});

// DELETE /api/users/:id — permanently deletes the account (not a soft
// deactivate). Most related tables (activity logs, classes taught, grades,
// notifications, messages, endorsements, etc.) use ON DELETE NO ACTION, so
// Postgres itself blocks deleting anyone with real history — caught below and
// turned into a clear message rather than a raw 500, since the alternative
// (cascading the delete through every one of those tables) would silently
// wipe out academic records tied to the account.
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (user.role === 'Admin') {
    return res.status(403).json({ message: 'Cannot delete admin accounts.' });
  }

  if (req.user.role === 'Chairperson') {
    if (!['Student', 'Faculty'].includes(user.role)) {
      return res.status(403).json({ message: 'You may only delete Student or Faculty accounts.' });
    }
    const myPrograms = req.user.programs || [];
    const inScope = user.role === 'Student'
      ? myPrograms.includes(user.program)
      : (user.programs || []).some((p) => myPrograms.includes(p));
    if (!inScope) {
      return res.status(403).json({ message: 'You may only delete accounts within your own program(s).' });
    }
  }

  const { id: userId, name: userName } = user;
  try {
    await user.destroy();
  } catch (err) {
    if (err.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({
        message: `${userName} has existing records (activity, classes, grades, messages, etc.) and can't be permanently deleted. Deactivate the account instead.`,
      });
    }
    throw err;
  }

  await logActivity(req.user.id, `deleted user ${userName}`, 'User', userId);
  res.json({ message: 'User deleted successfully.' });
});

// GET /api/users/pending
// Chairpersons are the primary audience now (first stop for new registrations,
// per-program) — Faculty keeps access too since the class-scoped verification
// flow reads pending students under the hood via classController.
const getPendingStudents = asyncHandler(async (req, res) => {
  // email_verified: true excludes registrations still waiting on the student
  // to confirm their verification code — those shouldn't appear in anyone's
  // queue until they're a real, confirmed registration.
  const where = { role: 'Student', status: 'Pending', email_verified: true };
  if (req.user.role === 'Faculty' || req.user.role === 'Chairperson') {
    where.program = { [Op.in]: req.user.programs || [] };
  }

  const users = await User.findAll({
    where,
    attributes: { exclude: ['password'] },
    // Who's already been delegated to verify this student (if anyone) — shown
    // on the Chairperson's Pending Registrations cards.
    include: [{ model: User, as: 'verifiers', attributes: ['id', 'name', 'role', 'avatar'], through: { attributes: [] } }],
    order: [['created_at', 'DESC']],
  });

  res.json({ users });
});

// GET /api/users/department/:department
const getUsersByDepartment = asyncHandler(async (req, res) => {
  const { department } = req.params;
  const { role } = req.query;

  const where = { department, status: 'Active' };
  if (role) where.role = role;

  const users = await User.findAll({
    where,
    attributes: { exclude: ['password'] },
    order: [['name', 'ASC']],
  });

  res.json({ users });
});

// PUT /api/users/:id/regularization-subjects — Body: { subject_ids: [1, 4, 7] }.
// Self-service only: an Irregular student picks which Subject IDs of their own
// program they intend to clear to become Regular again — the actual status
// flip happens on its own once every one of them has a released Passed grade
// (gradeController.checkAndRegularizeStudent), not here. One-shot: the first
// save stamps regularization_locked_at and every call after that is rejected
// — "once selected and saved, it cannot be undone" — until the student
// actually regularizes and (potentially) goes Irregular again later, which
// clears the lock for a fresh pick.
const setRegularizationSubjects = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { subject_ids } = req.body;
  if (!Array.isArray(subject_ids)) {
    return res.status(400).json({ message: 'subject_ids must be an array.' });
  }
  if (req.user.role !== 'Student' || String(req.user.id) !== String(id)) {
    return res.status(403).json({ message: 'You may only manage your own regularization subjects.' });
  }

  const student = await User.findByPk(id);
  if (!student || student.role !== 'Student') {
    return res.status(404).json({ message: 'Student not found.' });
  }
  if (student.student_status !== 'Irregular') {
    return res.status(400).json({ message: 'Only Irregular students can have regularization subjects set.' });
  }
  if (student.regularization_locked_at) {
    return res.status(403).json({ message: 'Your subject selection has already been saved and can no longer be changed.' });
  }

  if (subject_ids.length > 0) {
    const validSubjects = await Subject.count({ where: { id: { [Op.in]: subject_ids } } });
    if (validSubjects !== subject_ids.length) {
      return res.status(400).json({ message: 'One or more subject IDs are invalid.' });
    }
  }

  student.regularization_subjects = subject_ids.length > 0 ? subject_ids : null;
  student.regularization_locked_at = new Date();
  await student.save();

  await logActivity(req.user.id, `set ${subject_ids.length} regularization subject(s) for ${student.name}`, 'User', student.id);

  res.json({ message: 'Regularization subjects saved.', regularization_subjects: student.regularization_subjects, regularization_locked_at: student.regularization_locked_at });
});

// GET /api/users/presence?ids=1,2,3 — Online/offline + "how long ago" for a
// batch of accounts at once (a contact list, a roster table, ...) instead of
// one request per row. `online` is live, straight off the actual Socket.IO
// connections tracked in utils/presence.js — never stale or persisted.
// `last_seen_at` is only meaningful for an offline account (null while
// online, since "how long ago" doesn't apply to someone here right now).
const getPresence = asyncHandler(async (req, res) => {
  const idsParam = req.query.ids || '';
  const ids = idsParam.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  if (ids.length === 0) return res.json({ presence: {} });

  const presence = await presenceFor(ids);
  res.json({ presence });
});

module.exports = { getUsers, getUserById, createUser, updateUser, deleteUser, getUsersByDepartment, getPendingStudents, setRegularizationSubjects, getPresence };