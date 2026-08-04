const { Op } = require('sequelize');
const { User } = require('../models');
const { generateToken } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyInstructorsByProgram } = require('../controllers/notificationController');

// POST /api/auth/login — Admin/Chairperson/Instructor log in with `username`;
// Students log in with `student_no`. One shared field on the login form, matched
// against whichever identifier actually applies.
const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ message: 'Username/Student ID Number and password are required.' });
  }

  const trimmed = identifier.trim();
  const user = await User.findOne({
    where: {
      [Op.or]: [
        { username: trimmed.toLowerCase() },
        { student_no: trimmed },
      ],
    },
  });
  if (!user) {
    return res.status(401).json({ message: 'Invalid username/Student ID Number or password.' });
  }

  if (user.status === 'Pending') {
    return res.status(403).json({ message: 'Your account is pending approval. Please wait for the administrator to activate your account.' });
  }

  if (user.status !== 'Active') {
    return res.status(403).json({ message: 'Your account has been deactivated. Contact the administrator.' });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid username/Student ID Number or password.' });
  }

  const token = generateToken(user);
  await logActivity(user.id, 'logged in', 'User', user.id);

  res.json({
    message: 'Login successful',
    token,
    user: user.toSafeJSON(),
  });
});

// POST /api/auth/register — Students only. Student ID Number is both their unique
// identity and their future login credential, so it's the one thing that must never
// collide with an existing account.
const register = asyncHandler(async (req, res) => {
  const { name, password, confirmPassword, student_no, program, year_level, section, student_status, irregular_sections } = req.body;
  const isIrregular = student_status === 'Irregular';

  if (!name || !password || !confirmPassword || !student_no || !program || (!isIrregular && !year_level)) {
    return res.status(400).json({ message: 'All required fields must be filled out.' });
  }

  // Irregular students pick one Section + Semester per Year level they're taking
  // classes under, instead of a single year/section — validate the shape here
  // since it drives which singular year_level/section get stored below.
  let cleanIrregularSections = [];
  if (isIrregular) {
    if (!Array.isArray(irregular_sections) || irregular_sections.length === 0) {
      return res.status(400).json({ message: 'Irregular students must select at least one Year level.' });
    }
    cleanIrregularSections = irregular_sections
      .map((p) => ({
        year_level: parseInt(p?.year_level),
        section: (p?.section || '').trim().toUpperCase(),
        semester: (p?.semester || '').trim(),
      }))
      .filter((p) => p.year_level >= 1 && p.year_level <= 4 && p.section && p.semester);
    if (cleanIrregularSections.length === 0) {
      return res.status(400).json({ message: 'Please select a Section and Semester for every Year you checked.' });
    }
    const uniqueYears = new Set(cleanIrregularSections.map((p) => p.year_level));
    if (uniqueYears.size !== cleanIrregularSections.length) {
      return res.status(400).json({ message: 'Only one Section and Semester may be selected per Year level.' });
    }
    cleanIrregularSections.sort((a, b) => a.year_level - b.year_level);
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  }

  const studentNoTrimmed = student_no.trim();

  const existingStudentNo = await User.findOne({ where: { student_no: studentNoTrimmed } });
  if (existingStudentNo) {
    return res.status(409).json({ message: 'An account with this Student ID Number already exists.' });
  }

  const user = await User.create({
    name: name.trim(),
    password,
    role: 'Student',
    student_no: studentNoTrimmed,
    program: program.trim(),
    // Irregular students keep their primary/home year+section as the first
    // selected pair, so every existing grouping/scoping feature that reads the
    // singular fields keeps working unchanged.
    year_level: isIrregular ? cleanIrregularSections[0].year_level : parseInt(year_level),
    section: isIrregular ? cleanIrregularSections[0].section : (section ? section.trim() : null),
    student_status: isIrregular ? 'Irregular' : 'Regular',
    irregular_sections: isIrregular ? cleanIrregularSections : null,
    status: 'Pending',
  });

  await logActivity(user.id, 'registered as a new student (pending approval)', 'User', user.id);

  // Notify Instructors in the same program about the new registration awaiting verification
  await notifyInstructorsByProgram(req.app, user.program, {
    title: 'New Student Registration',
    message: `${name.trim()} (${studentNoTrimmed}) has registered and is waiting for verification.`,
    type: 'registration',
    link: '/instructor/verify',
  });

  res.status(201).json({
    message: 'Registration successful! Your account is pending approval by the administrator. You will be able to log in once your account is activated.',
  });
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }
  res.json({ user: user.toSafeJSON() });
});

// PUT /api/auth/password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findByPk(req.user.id);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ message: 'New password must be at least 6 characters.' });
  }

  user.password = newPassword;
  await user.save();

  await logActivity(user.id, 'changed password', 'User', user.id);
  res.json({ message: 'Password changed successfully.' });
});

module.exports = { login, register, getMe, changePassword };