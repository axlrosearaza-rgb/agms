const { User, Grade, Enrollment, Class, Subject } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/users
const getUsers = asyncHandler(async (req, res) => {
  const { role, department, search, status, page = 1, limit = 100, all } = req.query;

  const where = {};
  if (role) where.role = role;
  if (department) where.department = department;
  if (status) where.status = status;

  // Instructor/Chairperson callers are scoped to their own program(s) — Students
  // use the singular `program` column, but Instructor/Chairperson accounts use the
  // `programs` array, so the two branches need different operators.
  if (req.user.role === 'Instructor' || req.user.role === 'Chairperson') {
    const myPrograms = req.user.programs || [];
    where[Op.and] = [{
      [Op.or]: [
        { role: 'Student', program: { [Op.in]: myPrograms } },
        { role: { [Op.in]: ['Instructor', 'Chairperson'] }, programs: { [Op.overlap]: myPrograms } },
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
  const { name, email, username, password, role, program, programs, student_no, year_level, section, employee_no, academic_rank, specialization, highest_education, employment_type, position, student_status } = req.body;

  if (!name || !password || !role) {
    return res.status(400).json({ message: 'Name, password, and role are required.' });
  }

  // Chairpersons may only create Student/Instructor accounts, and only within
  // their own program(s) — Chairperson/Admin creation stays Admin-only.
  if (req.user.role === 'Chairperson') {
    if (!['Student', 'Instructor'].includes(role)) {
      return res.status(403).json({ message: 'Chairpersons may only create Student or Instructor accounts.' });
    }
    const targetProgram = role === 'Student' ? program : null;
    const targetPrograms = role === 'Instructor' ? (programs || []) : (targetProgram ? [targetProgram] : []);
    const myPrograms = req.user.programs || [];
    if (targetPrograms.length === 0 || !targetPrograms.every((p) => myPrograms.includes(p))) {
      return res.status(403).json({ message: 'You may only create accounts within your own program(s).' });
    }
  }

  if (role === 'Student') {
    if (!student_no) return res.status(400).json({ message: 'Student ID Number is required.' });
  } else if (!username) {
    return res.status(400).json({ message: 'Username is required for Admin/Chairperson/Instructor accounts.' });
  }

  if ((role === 'Instructor' || role === 'Chairperson') && (!programs || programs.length === 0)) {
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

  if ((role === 'Instructor' || role === 'Chairperson') && employee_no) {
    const existingEmp = await User.findOne({ where: { employee_no } });
    if (existingEmp) {
      return res.status(409).json({ message: 'This employee number is already taken.' });
    }
  }

  const isFaculty = role === 'Instructor' || role === 'Chairperson';

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
    employee_no: isFaculty ? employee_no : null,
    academic_rank: isFaculty ? academic_rank : null,
    specialization: isFaculty ? specialization : null,
    highest_education: isFaculty ? highest_education : null,
    employment_type: isFaculty ? (employment_type || 'Full Time') : null,
    position: role === 'Chairperson' ? (position || 'Chairperson') : null,
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

  if (req.user.role === 'Instructor') {
    if (user.role !== 'Student' || !(req.user.programs || []).includes(user.program)) {
      return res.status(403).json({ message: 'You may only verify students in your own program.' });
    }
    if (user.status !== 'Pending' || !['Active', 'Deactivated'].includes(req.body.status)) {
      return res.status(403).json({ message: 'You may only approve or reject pending student registrations.' });
    }
    user.status = req.body.status;
    await user.save();
    await logActivity(req.user.id, `${req.body.status === 'Active' ? 'verified' : 'rejected'} student ${user.name}`, 'User', user.id);
    return res.json({ message: 'User updated successfully.', user: user.toSafeJSON() });
  }

  // Chairpersons may fully manage Student/Instructor accounts within their own
  // program(s), but may not touch Chairperson/Admin accounts, change a user's
  // role, or reassign someone outside their own program(s).
  if (req.user.role === 'Chairperson') {
    if (!['Student', 'Instructor'].includes(user.role)) {
      return res.status(403).json({ message: 'You may only manage Student or Instructor accounts.' });
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
    if (req.body.programs && !req.body.programs.every((p) => myPrograms.includes(p))) {
      return res.status(403).json({ message: 'You may only assign your own program(s).' });
    }
  }

  const allowedFields = ['name', 'email', 'username', 'role', 'program', 'programs', 'student_no', 'year_level', 'section', 'status', 'employee_no', 'academic_rank', 'specialization', 'highest_education', 'employment_type', 'position', 'student_status', 'can_manage_semester'];
  const uniqueFields = ['student_no', 'employee_no', 'email', 'username'];
  // Boolean fields must bypass the `|| null` coercion below — `false || null` would
  // silently turn an explicit "false" into null, which fails can_manage_semester's
  // NOT NULL constraint and would make it impossible to ever revoke the flag.
  const booleanFields = ['can_manage_semester'];

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
  if (req.body.email) user.email = req.body.email;
  if (req.body.role) user.role = req.body.role;

  if (req.body.password) {
    user.password = req.body.password;
  }

  await user.save();
  await logActivity(req.user.id, `updated user ${user.name}`, 'User', user.id);
  res.json({ message: 'User updated successfully.', user: user.toSafeJSON() });
});

// DELETE /api/users/:id (soft delete - deactivate)
const deactivateUser = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (user.role === 'Admin') {
    return res.status(403).json({ message: 'Cannot deactivate admin accounts.' });
  }

  if (req.user.role === 'Chairperson') {
    if (!['Student', 'Instructor'].includes(user.role)) {
      return res.status(403).json({ message: 'You may only deactivate Student or Instructor accounts.' });
    }
    const myPrograms = req.user.programs || [];
    const inScope = user.role === 'Student'
      ? myPrograms.includes(user.program)
      : (user.programs || []).some((p) => myPrograms.includes(p));
    if (!inScope) {
      return res.status(403).json({ message: 'You may only deactivate accounts within your own program(s).' });
    }
  }

  user.status = 'Deactivated';
  await user.save();

  await logActivity(req.user.id, `deactivated user ${user.name}`, 'User', user.id);
  res.json({ message: 'User deactivated successfully.' });
});

// GET /api/users/pending
const getPendingStudents = asyncHandler(async (req, res) => {
  const where = { role: 'Student', status: 'Pending' };
  if (req.user.role === 'Instructor') where.program = { [Op.in]: req.user.programs || [] };

  const users = await User.findAll({
    where,
    attributes: { exclude: ['password'] },
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

module.exports = { getUsers, getUserById, createUser, updateUser, deactivateUser, getUsersByDepartment, getPendingStudents };