const { USER_SECRET_FIELDS } = require('../utils/userFields');
const { User, Grade, Enrollment, Class, Subject, Semester } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('../utils/bcrypt');
const { sequelize } = require('../config/database');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyStudentDecision } = require('../utils/notifyStudentDecision');
const { enrollStudentIntoMatchingClasses } = require('../utils/autoEnroll');
const { presenceFor } = require('../utils/presence');
const { upsertImportedStudents } = require('../utils/studentImport');
const { nameKey } = require('../utils/nameMatch');
const { logSectionActivity, recentSectionActivity } = require('../utils/sectionActivity');
const { cached, buildJsonEntry, sendJsonEntry } = require('../utils/responseCache');
const { createNotification } = require('./notificationController');

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
  const { role, department, search, status, program, year_level, section, page = 1, limit = 100, all, include_graduated } = req.query;

  const where = {};
  // Graduated students are archived — left out of every user list (enroll
  // pickers, Students List, counts) unless the caller explicitly asks for
  // them (User Management, which shows them in their own Graduated section).
  if (include_graduated !== 'true') where.graduated_at = null;
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
    // Both a Faculty account's and a Chairperson's Students List are scoped
    // to their own program(s) only — a GE class doesn't widen this: GE is
    // just a bonus tag on top of whichever real program's department the
    // Faculty account actually belongs to (see GE_PROGRAM above), so "their
    // own program(s)" already covers it.
    const studentScope = { role: 'Student', program: { [Op.in]: myPrograms } };
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
    // This is the heaviest read in the app (every student, every time a list
    // page opens: ~3,000 rows / ~2.8 MB at full size) and is identical for
    // everyone in the same scope, so it's built ONCE and shared — concurrent
    // requests wait on the one build (see utils/responseCache.js) instead of
    // each running the query and re-serializing thousands of rows. Dropped the
    // instant any user is created/edited/removed. The scope is part of the key
    // so a Chairperson's own-program list is never served to a Faculty.
    const scope = `${req.user.role}|${req.user.is_teaching ? 1 : 0}|${(req.user.programs || []).join(',')}`;
    const key = `users:all:${scope}:${JSON.stringify(req.query)}`;
    const entry = await cached(key, { ttlMs: 15000, tags: ['users'] }, async () => {
      // raw: plain rows, skipping the cost of building thousands of model
      // instances just to serialize them straight back out.
      const users = await User.findAll({
        where,
        attributes: { exclude: USER_SECRET_FIELDS },
        order: [['name', 'ASC']],
        raw: true,
      });
      return buildJsonEntry({
        users,
        pagination: { total: users.length, page: 1, limit: users.length, pages: 1 },
      });
    });
    return sendJsonEntry(req, res, entry);
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { rows: users, count: total } = await User.findAndCountAll({
    where,
    attributes: { exclude: USER_SECRET_FIELDS },
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
    attributes: { exclude: USER_SECRET_FIELDS },
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
  if (req.user.role === 'Admin' && !['Chairperson', 'Faculty', 'Student'].includes(role)) {
    return res.status(403).json({ message: 'Admins may only create Chairperson, Faculty, or Student accounts.' });
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
    // Part-Time faculty are tagged with every program purely so Admin can
    // find them from one "Part-Time Faculty" container — they're not really
    // staffed to any one Chairperson's program (and don't even show up in a
    // Chairperson's own Faculty list, see UserManagement.js's own filter),
    // so a Chairperson may only ever create Full Time faculty. Admin can
    // still create either.
    if (employment_type === 'Part Time') {
      return res.status(403).json({ message: 'Chairpersons may only create Full Time faculty — Part Time hires are created by Admin.' });
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

  const cleanEmail = email && String(email).trim() ? String(email).trim().toLowerCase() : null;

  if (cleanEmail) {
    const existing = await User.findOne({ where: { email: cleanEmail } });
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
    email: cleanEmail,
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
    curriculum_year: role === 'Student' ? await require('../utils/studentCurriculum').curriculumForNewStudent(program, year_level) : null,
    employee_no: isFaculty ? employee_no : null,
    academic_rank: isFaculty ? academic_rank : null,
    specialization: isFaculty ? specialization : null,
    highest_education: isFaculty ? highest_education : null,
    employment_type: isFaculty ? (employment_type || 'Full Time') : null,
    position: role === 'Chairperson' ? (position || 'Chairperson') : null,
    is_teaching: role === 'Chairperson' ? !!is_teaching : false,
  });

  if (role === 'Student') {
    await enrollStudentIntoMatchingClasses(user);
  }

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

  // Student accounts are view-only for Admin and Chairperson — a student's
  // details and account status are managed by their adviser (My Advisory →
  // updateAdvisee) and by the student themself.
  if (user.role === 'Student') {
    return res.status(403).json({ message: 'Student accounts are view-only here. Their adviser edits their information from My Advisory.' });
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

  // Admin loses edit rights over a Student's info once they're verified
  // (status Active) — deactivating the account is still available (that's
  // its own action, not an "info edit"), but name/program/year level/
  // section/student no. etc. are locked at that point. Chairperson is
  // exempt from this lock (they still go through the scope check above —
  // only within their own program) — they're the one who actually deals
  // with a verified student's record day to day (section/year corrections,
  // irregular-status fixes, etc.), so they keep edit rights past
  // verification instead of having to route every change through Admin.
  // Faculty never had general edit rights to begin with (see the early
  // return above — they can only approve/reject a still-Pending
  // registration).
  if (req.user.role === 'Admin' && user.role === 'Student' && user.status === 'Active') {
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

  // Deactivated = archived. A deactivated account goes straight to User
  // Management's Archived section; activating it again brings it back.
  if (user.status === 'Deactivated' && !user.archived_at) user.archived_at = new Date();
  if (user.status === 'Active' && user.archived_at) user.archived_at = null;

  await user.save();
  await notifyStudentDecision(user, previousStatus);
  if (previousStatus === 'Pending' && user.status === 'Active') {
    await enrollStudentIntoMatchingClasses(user);
  }
  await logActivity(req.user.id, `updated user ${user.name}`, 'User', user.id);
  res.json({ message: 'User updated successfully.', user: user.toSafeJSON() });
});

// Accounts are never deleted. PUT /api/users/:id/archive archives one: it
// is deactivated (can't sign in), leaves the active lists and shows under
// User Management's Archived section. Every record tied to it — grades,
// classes, messages, logs — stays. PUT /api/users/:id/restore brings it back.
const canManageAccount = (req, user) => {
  if (user.role === 'Admin') return 'Admin accounts can\'t be archived.';
  if (req.user.role === 'Chairperson') {
    if (!['Student', 'Faculty'].includes(user.role)) return 'You may only archive Student or Faculty accounts.';
    const myPrograms = req.user.programs || [];
    const inScope = user.role === 'Student'
      ? myPrograms.includes(user.program)
      : (user.programs || []).some((p) => myPrograms.includes(p));
    if (!inScope) return 'You may only archive accounts within your own program(s).';
  }
  if (user.role === 'Student' && req.user.role !== 'Admin') return 'Only the Administrator can archive student accounts.';
  return null;
};

const archiveUser = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  if (user.id === req.user.id) return res.status(400).json({ message: 'You can\'t archive your own account.' });
  const denied = canManageAccount(req, user);
  if (denied) return res.status(403).json({ message: denied });
  if (user.archived_at) return res.json({ message: `${user.name} is already archived.`, user: user.toSafeJSON() });

  user.archived_at = new Date();
  user.status = 'Deactivated';
  await user.save({ validate: false });
  await logActivity(req.user.id, `archived account ${user.name}${user.student_no ? ` (${user.student_no})` : ''}`, 'User', user.id);
  res.json({ message: `${user.name}'s account was archived.`, user: user.toSafeJSON() });
});

const restoreUser = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const denied = canManageAccount(req, user);
  if (denied) return res.status(403).json({ message: denied.replace('archive', 'restore') });

  user.archived_at = null;
  user.status = 'Active';
  await user.save({ validate: false });
  await logActivity(req.user.id, `restored account ${user.name}`, 'User', user.id);
  res.json({ message: `${user.name}'s account was restored.`, user: user.toSafeJSON() });
});

const ADVISORY_SECTIONS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)); // A-Z

const ADVISER_ROLES = ['Faculty', 'Chairperson'];
const advisoryKey = (a) => `${a.program}|${a.year_level}|${a.section}`;
const advisoryText = (a) => `${a.program} ${a.year_level}-${a.section}`;

// Section history: who became / stopped being each section's adviser.
const logAdviserChanges = async (adviser, before, after, actingUser) => {
  const beforeKeys = new Set((before || []).map(advisoryKey));
  const afterKeys = new Set((after || []).map(advisoryKey));
  for (const a of after || []) {
    if (!beforeKeys.has(advisoryKey(a))) await logSectionActivity(a, actingUser, `assigned ${adviser.name} as adviser`);
  }
  const lost = (before || []).filter((a) => !afterKeys.has(advisoryKey(a)));
  for (const a of lost) await logSectionActivity(a, actingUser, `removed ${adviser.name} as adviser`);
  // What this adviser had is kept on record (Manage Advisory → Past Advisers).
  await require('../utils/adviserArchive').archivePastAdvisory(adviser, lost, actingUser);
};

// PUT /api/users/:id/advisory  { advisories: [{ program, year_level, section }, ...] }
// — the full list of sections this faculty member advises ([] clears them).
// Admin only (routes/users.js), any program. One adviser per section: a
// section already advised by another faculty member has to be removed from
// them first.
const setAdvisory = asyncHandler(async (req, res) => {
  const faculty = await User.findByPk(req.params.id);
  // Advisers can be Faculty or Chairpersons.
  if (!faculty || !ADVISER_ROLES.includes(faculty.role)) {
    return res.status(404).json({ message: 'Faculty or Chairperson account not found.' });
  }

  const incoming = Array.isArray(req.body.advisories) ? req.body.advisories : null;
  if (!incoming) return res.status(400).json({ message: 'Send the list of advisory sections.' });

  const cleaned = [];
  const seen = new Set();
  for (const a of incoming) {
    const program = a?.program;
    const year = parseInt(a?.year_level, 10);
    const section = String(a?.section || '').trim().toUpperCase();
    if (!program || program === GE_PROGRAM) {
      return res.status(400).json({ message: 'Choose a program for each advisory.' });
    }
    if (!(year >= 1 && year <= 4)) return res.status(400).json({ message: 'Year level must be 1 to 4.' });
    if (!ADVISORY_SECTIONS.includes(section)) return res.status(400).json({ message: 'Choose a valid section.' });
    const entry = { program, year_level: year, section };
    if (seen.has(advisoryKey(entry))) continue;
    seen.add(advisoryKey(entry));

    const taken = await User.findOne({
      where: { role: { [Op.in]: ADVISER_ROLES }, id: { [Op.ne]: faculty.id }, advisories: { [Op.contains]: [entry] } },
      attributes: ['id', 'name'],
    });
    if (taken) {
      return res.status(409).json({ message: `${taken.name} is already the adviser of ${advisoryText(entry)}. Remove it from their advisory first.` });
    }
    cleaned.push(entry);
  }

  const previous = Array.isArray(faculty.advisories) ? faculty.advisories : [];
  const next = cleaned;
  const prevKeys = new Set(previous.map(advisoryKey));
  const added = cleaned.filter((a) => !prevKeys.has(advisoryKey(a)));

  faculty.advisories = next;
  faculty.changed('advisories', true);
  await faculty.save();
  await logAdviserChanges(faculty, previous, next, req.user);

  await logActivity(
    req.user.id,
    next.length ? `set ${faculty.name}'s advisory to ${next.map(advisoryText).join(', ')}` : `cleared ${faculty.name}'s advisory`,
    'User',
    faculty.id
  );
  if (added.length) {
    await createNotification(req.app, {
      userId: faculty.id,
      title: 'Advisory assigned',
      message: `${req.user.name} assigned you as the adviser of ${added.map(advisoryText).join(', ')}.`,
      type: 'advisory',
      link: faculty.role === 'Chairperson' ? '/chairperson/advisory' : '/faculty/advisory',
    });
  }

  res.json({ message: next.length ? 'Advisory saved.' : 'Advisory cleared.', user: faculty.toSafeJSON() });
});

// POST /api/users/advisories/import  { assignments: [{ user_id, program, year_level, section }], replace_all }
// Admin only — the whole adviser list at once (read from a Room Assignment-
// style document on the frontend and matched to accounts there). Each listed
// section goes to its adviser and is taken off anyone else who had it (that
// earlier adviser's record is archived). Sections that are not in the list
// keep their adviser — nothing is ever cleared wholesale.
const importAdvisories = asyncHandler(async (req, res) => {
  const { assignments } = req.body;
  const replaceAll = false;
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ message: 'Nothing to import.' });
  }

  // Validate + one adviser per section (the last row wins if a section repeats).
  const bySection = new Map();
  for (const a of assignments) {
    const year = parseInt(a?.year_level, 10);
    const section = String(a?.section || '').trim().toUpperCase();
    const userId = parseInt(a?.user_id, 10);
    if (!a?.program || a.program === GE_PROGRAM || !(year >= 1 && year <= 4) || !ADVISORY_SECTIONS.includes(section) || !userId) {
      return res.status(400).json({ message: `Invalid row: ${a?.program || '?'} ${a?.year_level || '?'}-${a?.section || '?'}.` });
    }
    const entry = { program: a.program, year_level: year, section };
    bySection.set(advisoryKey(entry), { userId, entry });
  }

  const userIds = [...new Set([...bySection.values()].map((v) => v.userId))];
  const advisers = await User.findAll({ where: { id: { [Op.in]: userIds }, role: { [Op.in]: ADVISER_ROLES } } });
  if (advisers.length !== userIds.length) {
    return res.status(400).json({ message: 'Some matched accounts are not Faculty or Chairperson accounts.' });
  }
  const importedKeys = new Set(bySection.keys());

  const touched = new Map(); // userId -> { user, before }
  await sequelize.transaction(async (t) => {
    const holders = await User.findAll({
      where: { role: { [Op.in]: ADVISER_ROLES }, advisories: { [Op.ne]: null } },
      transaction: t,
    });
    const byId = new Map([...holders, ...advisers].map((u) => [u.id, u]));
    const listOf = (u) => (Array.isArray(u.advisories) ? u.advisories : []);
    const set = (u, list) => {
      if (!touched.has(u.id)) touched.set(u.id, { user: u, before: listOf(u) });
      u.advisories = list;
      u.changed('advisories', true);
    };

    // Clear everything (replace_all) or just the imported sections from their current holders.
    for (const u of byId.values()) {
      const kept = replaceAll ? [] : listOf(u).filter((a) => !importedKeys.has(advisoryKey(a)));
      if (kept.length !== listOf(u).length) set(u, kept);
    }
    for (const { userId, entry } of bySection.values()) {
      const u = byId.get(userId);
      set(u, [...listOf(u), entry]);
    }
    for (const { user } of touched.values()) await user.save({ transaction: t });
  });

  // Tell each adviser about their newly assigned sections.
  for (const { user, before } of touched.values()) {
    await logAdviserChanges(user, before, user.advisories || [], req.user);
    const beforeKeys = new Set(before.map(advisoryKey));
    const added = (user.advisories || []).filter((a) => !beforeKeys.has(advisoryKey(a)));
    if (!added.length) continue;
    await createNotification(req.app, {
      userId: user.id,
      title: 'Advisory assigned',
      message: `${req.user.name} assigned you as the adviser of ${added.map(advisoryText).join(', ')}.`,
      type: 'advisory',
      link: user.role === 'Chairperson' ? '/chairperson/advisory' : '/faculty/advisory',
    });
  }

  await logActivity(req.user.id, `imported advisers for ${bySection.size} section(s)${replaceAll ? ' (replaced all advisories)' : ''}`, 'User', null);
  // How many sections actually changed hands or got their first adviser.
  let changed = 0;
  for (const { user, before } of touched.values()) {
    const beforeKeys = new Set(before.map(advisoryKey));
    changed += (user.advisories || []).filter((x) => !beforeKeys.has(advisoryKey(x))).length;
  }
  res.json({
    message: changed
      ? `Adviser list updated: ${changed} section(s) changed, ${bySection.size - changed} already up to date.`
      : `No changes — all ${bySection.size} section(s) already have the adviser in this list.`,
    sections: bySection.size, advisers: userIds.length, changed,
  });
});

// GET /api/users/advisers/archive (Admin) — past advisers: each section an
// adviser used to have, with the advisees in it when it ended.
const getAdviserArchive = asyncHandler(async (req, res) => {
  res.json({ archive: await require('../utils/adviserArchive').listPastAdvisories() });
});

// GET /api/users/my-advisory — Faculty / Chairperson: every advisory section they
// hold and the current (non-graduated) students in them.
// GET /api/users/advisers/summary (Admin) — one row per adviser + advisory
// section: how many students it has, how many set up their account,
// Regular / Irregular, how many still owe a subject (Failed / INC / Dropped,
// released and not yet passed), and how many the adviser already promoted
// for the current semester.
const getAdviserSummary = asyncHandler(async (req, res) => {
  const advisers = await User.findAll({
    where: { role: { [Op.in]: ['Faculty', 'Chairperson'] }, archived_at: null },
    attributes: ['id', 'name', 'role', 'advisories', 'employment_type', 'status'],
  });
  const withAdvisory = advisers.filter((a) => Array.isArray(a.advisories) && a.advisories.length);

  const students = await User.findAll({
    where: { role: 'Student', graduated_at: null, archived_at: null },
    attributes: ['id', 'program', 'year_level', 'section', 'account_setup_at', 'student_status', 'last_promoted_semester', 'status'],
    raw: true,
  });
  const current = await Semester.findOne({ where: { is_current: true }, attributes: ['name'] });

  // Students still owing a subject.
  const grades = await Grade.findAll({
    where: { released: true, status: { [Op.in]: ['Passed', 'Failed', 'INC', 'DRP'] } },
    attributes: ['student_id', 'status'],
    include: [{ model: Class, as: 'class', attributes: ['subject_id'] }],
    raw: true,
    nest: true,
  });
  const passed = new Set(); const owed = {};
  grades.forEach((g) => {
    const key = `${g.student_id}|${g.class?.subject_id}`;
    if (g.status === 'Passed') passed.add(key);
    else (owed[g.student_id] = owed[g.student_id] || new Set()).add(key);
  });
  const owesSubject = (sid) => [...(owed[sid] || [])].some((k) => !passed.has(k));

  const bySection = {};
  students.forEach((s) => { (bySection[`${s.program}|${s.year_level}|${s.section}`] = bySection[`${s.program}|${s.year_level}|${s.section}`] || []).push(s); });

  const rows = [];
  withAdvisory.forEach((a) => {
    a.advisories.forEach((adv) => {
      const list = bySection[`${adv.program}|${adv.year_level}|${adv.section}`] || [];
      rows.push({
        adviser_id: a.id,
        adviser_name: a.name,
        adviser_role: a.role,
        employment_type: a.employment_type,
        program: adv.program,
        year_level: adv.year_level,
        section: adv.section,
        students: list.length,
        set_up: list.filter((s) => s.account_setup_at).length,
        deactivated: list.filter((s) => s.status === 'Deactivated').length,
        regular: list.filter((s) => s.student_status === 'Regular').length,
        irregular: list.filter((s) => s.student_status === 'Irregular').length,
        with_retakes: list.filter((s) => owesSubject(s.id)).length,
        promoted: current ? list.filter((s) => s.last_promoted_semester === current.name).length : 0,
      });
    });
  });
  rows.sort((x, y) => String(x.program).localeCompare(String(y.program)) || x.year_level - y.year_level || String(x.section).localeCompare(String(y.section)));
  res.json({ semester: current?.name || null, rows });
});

const getMyAdvisory = asyncHandler(async (req, res) => {
  const me = await User.findByPk(req.user.id, { attributes: ['advisories'] });
  const advisories = Array.isArray(me?.advisories) ? me.advisories : [];
  if (!advisories.length) return res.json({ advisories: [], students: [] });

  const students = await User.findAll({
    where: {
      role: 'Student',
      // Deactivated advisees stay on the list (greyed out) so the adviser
      // can activate them again.
      status: { [Op.in]: ['Active', 'Deactivated'] },
      graduated_at: null,
      [Op.or]: advisories.map((a) => ({ program: a.program, year_level: a.year_level, section: a.section })),
    },
    attributes: ['id', 'name', 'student_no', 'email', 'avatar', 'program', 'year_level', 'section', 'student_status', 'student_type', 'irregular_sections', 'account_setup_at', 'status', 'last_promoted_semester'],
  });
  // How many classes each advisee is in this semester — they're added by
  // their faculty's class lists, so 0 means no faculty has listed them yet.
  const current = await Semester.findOne({ where: { is_current: true }, attributes: ['name'] });
  const counts = new Map();
  if (current && students.length) {
    const rows = await Enrollment.findAll({
      where: { student_id: { [Op.in]: students.map((s) => s.id) } },
      attributes: ['student_id'],
      include: [{ model: Class, as: 'class', where: { semester: current.name }, attributes: [] }],
      raw: true,
    });
    rows.forEach((r) => counts.set(r.student_id, (counts.get(r.student_id) || 0) + 1));
  }

  // This semester's results per advisee (released grades only — what the
  // student can see too), for the page's semester overview: who passed
  // everything, and who has a subject to take again (Failed / INC / Dropped).
  const { semesterResults, archivedOverviewsFor } = require('../utils/advisoryOverview');
  const results = await semesterResults(students.map((st) => st.id), current?.name);
  // Overviews of semesters that already ended, kept per section.
  const archivedOverviews = await archivedOverviewsFor(req.user.id, advisories);

  // Each section's history — everything done to it, by this adviser or any
  // earlier one (imports, promotions, adviser changes).
  const activity = await recentSectionActivity(advisories, 15);

  res.json({
    advisories,
    current_semester: current?.name || null,
    students: students.map((s) => {
      const r = results.get(s.id) || { graded: 0, passed: 0, retakes: [] };
      const { last_promoted_semester, ...rest } = s.toJSON();
      return {
        ...rest,
        class_count: counts.get(s.id) || 0,
        graded_count: r.graded,
        passed_count: r.passed,
        retakes: r.retakes,
        promoted: !!current && last_promoted_semester === current.name,
      };
    }),
    activity,
    archived_overviews: archivedOverviews,
  });
});

// Is this Program / Year / Section one of the user's own advisory sections?
const advisesSection = async (userId, program, yearLevel, section) => {
  const me = await User.findByPk(userId, { attributes: ['advisories'] });
  return (Array.isArray(me?.advisories) ? me.advisories : [])
    .some((a) => a.program === program && Number(a.year_level) === Number(yearLevel) && a.section === section);
};

// PUT /api/users/my-advisory/students/:id  { name, student_no, student_status, student_type, status }
// The adviser corrects one of their own advisees' details (a misspelled name,
// a wrong ID number, Regular/Irregular, student type), or moves them into
// another of the adviser's own advisory sections. Only students currently in
// one of the adviser's advisory sections.
const STUDENT_TYPES = ['New', 'Old', 'Shifter', 'Transferee', 'Quitter'];
const updateAdvisee = asyncHandler(async (req, res) => {
  const student = await User.findByPk(req.params.id);
  if (!student || student.role !== 'Student') return res.status(404).json({ message: 'Student not found.' });
  if (!(await advisesSection(req.user.id, student.program, student.year_level, student.section))) {
    return res.status(403).json({ message: 'You can only edit students in your own advisory section.' });
  }

  const fromSection = { program: student.program, year_level: student.year_level, section: student.section };
  const changes = [];
  if (req.body.name !== undefined) {
    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    if (!name) return res.status(400).json({ message: 'Student name is required.' });
    if (name !== student.name) { changes.push(`name "${student.name}" → "${name}"`); student.name = name; student.avatar = name.charAt(0).toUpperCase(); }
  }
  if (req.body.student_no !== undefined) {
    const no = String(req.body.student_no || '').trim().replace(/\s+/g, '');
    if (!no) return res.status(400).json({ message: 'Student ID Number is required.' });
    if (no !== student.student_no) {
      const taken = await User.findOne({ where: { student_no: no, id: { [Op.ne]: student.id } }, attributes: ['name'] });
      if (taken) return res.status(400).json({ message: `Student ID Number ${no} already belongs to ${taken.name}.` });
      changes.push(`ID number ${student.student_no || '—'} → ${no}`);
      student.student_no = no;
    }
  }
  // The email is never changed here — it's the student's own, verified by them.
  if (req.body.student_status !== undefined && req.body.student_status !== student.student_status) {
    if (!['Regular', 'Irregular'].includes(req.body.student_status)) return res.status(400).json({ message: 'Status must be Regular or Irregular.' });
    changes.push(`${student.student_status} → ${req.body.student_status}`);
    student.student_status = req.body.student_status;
  }
  if (req.body.student_type !== undefined && req.body.student_type !== student.student_type) {
    if (!STUDENT_TYPES.includes(req.body.student_type)) return res.status(400).json({ message: 'Student type is not valid.' });
    changes.push(`type ${student.student_type || '—'} → ${req.body.student_type}`);
    student.student_type = req.body.student_type;
  }

  // Take the student out of this advisory section (imported by mistake / not
  // in this section). Nothing is deleted — the account, grades and class
  // enrollments stay; the Admin can place them, and re-importing the class
  // list brings them back.
  if (req.body.remove_from_section === true) {
    student.section = null;
    await student.save();
    const note = `removed ${student.name}${student.student_no ? ` (${student.student_no})` : ''} from the section`;
    await logActivity(req.user.id, `${note} ${fromSection.program} ${fromSection.year_level}-${fromSection.section}`, 'User', student.id);
    await logSectionActivity(fromSection, req.user, note);
    return res.json({ message: `${student.name} was removed from the section.`, student: student.toSafeJSON() });
  }

  // Move to another of this adviser's own advisory sections (a student
  // imported into the wrong one). Any other section stays the Admin's to set.
  if (req.body.section !== undefined || req.body.year_level !== undefined || req.body.program !== undefined) {
    const program = req.body.program ?? student.program;
    const year = parseInt(req.body.year_level ?? student.year_level, 10);
    const section = req.body.section ?? student.section;
    const moved = program !== student.program || year !== Number(student.year_level) || section !== student.section;
    if (moved) {
      if (!(await advisesSection(req.user.id, program, year, section))) {
        return res.status(403).json({ message: 'You can only move a student into one of your own advisory sections.' });
      }
      changes.push(`moved ${student.program} ${student.year_level}-${student.section} → ${program} ${year}-${section}`);
      student.program = program;
      student.year_level = year;
      student.section = section;
    }
  }

  // Deactivate / activate the account — a deactivated student can't sign in.
  if (req.body.status !== undefined && req.body.status !== student.status) {
    if (!['Active', 'Deactivated'].includes(req.body.status) || !['Active', 'Deactivated'].includes(student.status)) {
      return res.status(400).json({ message: 'This account can only be switched between Active and Deactivated.' });
    }
    changes.push(req.body.status === 'Active' ? 'account activated' : 'account deactivated');
    student.status = req.body.status;
  }

  if (changes.length === 0) return res.json({ message: 'Nothing to change.', student: student.toSafeJSON() });
  await student.save();
  await logActivity(req.user.id, `edited advisee ${student.name}: ${changes.join(', ')}`, 'User', student.id);
  await logSectionActivity({ program: student.program, year_level: student.year_level, section: student.section }, req.user, `edited ${student.name} (${changes.join(', ')})`);
  if (fromSection.program !== student.program || Number(fromSection.year_level) !== Number(student.year_level) || fromSection.section !== student.section) {
    await logSectionActivity(fromSection, req.user, `edited ${student.name} (${changes.join(', ')})`);
  }
  res.json({ message: `${student.name} was updated.`, student: student.toSafeJSON() });
});

// POST /api/users/my-advisory/import  { program, year_level, section, students, row_offset }
// The adviser brings in their section's class list: new students get an
// account; students who already have one are placed in this section (their
// Program / Year / Section set to it). Everyone listed ends up in the section.
const importAdvisoryList = asyncHandler(async (req, res) => {
  const { program, section } = req.body;
  const year = parseInt(req.body.year_level, 10);
  if (!(await advisesSection(req.user.id, program, year, section))) {
    return res.status(403).json({ message: 'You can only import the class list of your own advisory section.' });
  }
  const { students } = req.body;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ message: 'No students in the class list.' });
  }
  if (students.length > 5000) {
    return res.status(413).json({ message: 'Send at most 5000 students per request.' });
  }

  // The list is this section's roster — every row belongs to it.
  const rows = students.map((s) => ({ ...s, program, year_level: year, section }));
  const { created, existing, skipped, errors } = await upsertImportedStudents(rows, { rowOffset: parseInt(req.body.row_offset, 10) || 0, createdBy: req.user.id });

  const inSection = (u) => u.program === program && Number(u.year_level) === year && u.section === section;
  const toMove = existing.filter((u) => !inSection(u) && !u.graduated_at);
  const graduated = existing.filter((u) => u.graduated_at);
  if (toMove.length) {
    await User.update({ program, year_level: year, section }, { where: { id: { [Op.in]: toMove.map((u) => u.id) } }, validate: false });
  }
  const alreadyCount = existing.length - toMove.length - graduated.length;
  graduated.forEach((u) => skipped.push({ student_no: u.student_no, name: u.name, reason: 'Already graduated' }));

  const label = `${program} ${year}-${section}`;
  if (created.length || toMove.length) {
    await logActivity(req.user.id, `imported the class list of ${label}: ${created.length} new student account(s), ${toMove.length} moved into the section`, 'User', null);
    await logSectionActivity({ program, year_level: year, section }, req.user,
      `imported the class list — ${created.length} new student account(s)${toMove.length ? `, ${toMove.length} moved into this section` : ''}`);
  }

  res.status(201).json({
    message: `${created.length + toMove.length} added to ${label} (${created.length} new account${created.length !== 1 ? 's' : ''}), ${alreadyCount} already in the section, ${skipped.length} skipped, ${errors.length} error(s).`,
    createdCount: created.length,
    existingCount: existing.length,
    enrolledCount: created.length + toMove.length,
    alreadyEnrolledCount: alreadyCount,
    skippedCount: skipped.length,
    errorCount: errors.length,
    skipped,
    errors,
  });
});

// GET /api/users/department/:department
const getUsersByDepartment = asyncHandler(async (req, res) => {
  const { department } = req.params;
  const { role } = req.query;

  const where = { department, status: 'Active' };
  if (role) where.role = role;

  const users = await User.findAll({
    where,
    attributes: { exclude: USER_SECRET_FIELDS },
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

// POST /api/users/check-student-nos  { student_nos: [...] }
// Which of these Student ID Numbers already belong to an account. The class
// list import calls this while the list is reviewed, so students who already
// have an account show up as "will be added to the class" before importing.
// Optional `names: [...]` — also returns `same_name`: student accounts whose
// name matches one of these (any format), so a new row whose name already
// has an account under a different ID can be flagged as a likely typo.
const checkStudentNos = asyncHandler(async (req, res) => {
  const nos = [...new Set((Array.isArray(req.body.student_nos) ? req.body.student_nos : [])
    .map((n) => String(n || '').trim()).filter(Boolean))].slice(0, 20000);
  const keys = new Set((Array.isArray(req.body.names) ? req.body.names : []).slice(0, 20000).map(nameKey).filter(Boolean));
  const existing = nos.length ? await User.findAll({
    where: { student_no: { [Op.in]: nos } },
    attributes: ['student_no', 'name', 'program', 'year_level', 'section', 'role'],
    raw: true,
  }) : [];
  const same_name = keys.size
    ? (await User.findAll({ where: { role: 'Student' }, attributes: ['student_no', 'name', 'program', 'year_level', 'section'], raw: true }))
      .filter((u) => keys.has(nameKey(u.name)))
    : [];
  res.json({ existing, same_name });
});


module.exports = { getAdviserSummary, getUsers, getUserById, createUser, checkStudentNos, updateUser, archiveUser, restoreUser, getUsersByDepartment, setAdvisory, importAdvisories, getAdviserArchive, getMyAdvisory, importAdvisoryList, updateAdvisee, setRegularizationSubjects, getPresence };