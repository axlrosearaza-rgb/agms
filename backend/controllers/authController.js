const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User, PendingRegistration } = require('../models');
const { generateToken } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyChairpersonsByProgram, createNotification } = require('../controllers/notificationController');
const { sendPasswordResetEmail, sendVerificationCodeEmail } = require('../utils/emailService');
const { PRIVACY_POLICY_VERSION } = require('../config/privacy');

// True if this user still needs to see the Privacy Notice consent modal — either
// they've never accepted one, or the policy has changed since they last did.
const needsPrivacyConsent = (user) =>
  !user.privacy_accepted || user.privacy_policy_version !== PRIVACY_POLICY_VERSION;

// Settings lives at a role-prefixed route for every role (App.js) — used to
// give the account-identity-change notifications below (username/email/
// password changed) a real `link`, so clicking one in the bell actually goes
// somewhere instead of just marking itself read.
const settingsPathFor = (role) => `/${role.toLowerCase()}/settings`;

// Registration requires a real, working Gmail address OR an official SSU
// email — used solely for account recovery (forgot password), the
// verification code below, and status notifications (e.g. registration
// approved). Never a login credential.
const REGISTRATION_EMAIL_REGEX = /^[a-zA-Z0-9](\.?[a-zA-Z0-9_-]){2,}@(gmail\.com|([a-zA-Z0-9-]+\.)*ssu\.edu\.ph)$/;
const isValidRegistrationEmail = (email) => typeof email === 'string' && REGISTRATION_EMAIL_REGEX.test(email.trim().toLowerCase());
const EMAIL_FORMAT_HINT = 'Please enter a valid Gmail or SSU email address (e.g. juandelacruz@gmail.com or juandelacruz@ssu.edu.ph).';

// Verification codes are stored as a SHA-256 hash — same reasoning as
// reset_password_token: a leaked database alone should never be usable to
// complete someone else's registration.
const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
const generateVerificationCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

// POST /api/auth/login — Admin/Chairperson/Faculty log in with `username`;
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

  if (!user.email_verified) {
    return res.status(403).json({ message: 'Please verify your email before signing in. Check your inbox for the verification code sent when you registered.' });
  }

  if (user.status === 'Pending') {
    return res.status(403).json({ message: 'Your account is pending approval. Please wait for the administrator to activate your account.' });
  }

  if (user.status === 'Rejected') {
    return res.status(403).json({ message: 'Your registration was rejected. You cannot log in to the system.' });
  }

  if (user.status !== 'Active') {
    return res.status(403).json({ message: 'Your account has been deactivated. Contact the administrator.' });
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(401).json({ message: 'Invalid username/Student ID Number or password.' });
  }

  const token = generateToken(user);
  await logActivity(user.id, `${user.name} logged in`, 'User', user.id);

  res.json({
    message: 'Login successful',
    token,
    user: user.toSafeJSON(),
    needs_privacy_consent: needsPrivacyConsent(user),
    privacy_policy_version: PRIVACY_POLICY_VERSION,
    // The 8-character minimum only applies going forward (registration,
    // reset, change-password) — it can't retroactively touch an existing
    // bcrypt hash, so this is the one moment the actual plaintext is ever
    // available again to check it against the current rule. A soft nudge,
    // not a block: the frontend just shows a dismissible notice pointing at
    // Settings, nothing here stops the login itself.
    password_too_short: password.length < 8,
  });
});

// POST /api/auth/register — Students only. Student ID Number is both their unique
// identity and their future login credential, so it's the one thing that must never
// collide with an existing account.
//
// No `users` row is created here. The submitted data (with the password already
// bcrypt-hashed) is staged in `pending_registrations` until the emailed code is
// confirmed in verifyEmail() below, which is what actually creates the account —
// see that function's comment for why. That also means calling this again with
// the same email/student number before verifying (e.g. the student closed the
// verify screen and came back) simply overwrites the stale attempt with a fresh
// code instead of bouncing off a phantom "account already exists" error.
const register = asyncHandler(async (req, res) => {
  const { first_name, middle_initial, last_name, name: legacyName, email, password, confirmPassword, student_no, program, year_level, section, student_status, student_type, irregular_sections, privacy_consent } = req.body;
  const isIrregular = student_status === 'Irregular';

  const normalizeMiddleInitial = (raw = '') => {
    const cleaned = String(raw || '').trim();
    if (!cleaned || /^n\/?a$/i.test(cleaned) || cleaned.toLowerCase() === 'none') {
      return '';
    }
    const firstLetter = cleaned.replace(/\./g, '').trim().slice(0, 1).toUpperCase();
    if (!firstLetter) {
      return '';
    }
    return `${firstLetter}.`;
  };

  const firstName = String(first_name || '').trim() || (typeof legacyName === 'string' ? legacyName.trim().split(/\s+/)[0] || '' : '');
  const lastName = String(last_name || '').trim() || (typeof legacyName === 'string' ? legacyName.trim().split(/\s+/).slice(-1)[0] || '' : '');
  const middleValue = String(middle_initial || '').trim() || (typeof legacyName === 'string' ? legacyName.trim().split(/\s+/).slice(1, -1).join(' ') || '' : '');
  const middleInitial = normalizeMiddleInitial(middleValue);
  const canonicalName = middleInitial ? `${firstName} ${middleInitial} ${lastName}` : `${firstName} ${lastName}`;

  if (!firstName || !lastName || !email || !password || !confirmPassword || !student_no || !program || (!isIrregular && !year_level)) {
    return res.status(400).json({ message: 'All required fields must be filled out.' });
  }

  // This email is how a forgotten password gets recovered and how you're notified
  // once your registration is approved — must be a real, correctly-formatted
  // Gmail or SSU address, and confirmed via the verification code sent below.
  const emailTrimmed = email.trim().toLowerCase();
  if (!isValidRegistrationEmail(emailTrimmed)) {
    return res.status(400).json({ message: EMAIL_FORMAT_HINT });
  }

  // Only a real, already-verified account should block re-registration —
  // unconfirmed attempts live in pending_registrations, never here.
  const existingEmail = await User.findOne({ where: { email: emailTrimmed } });
  if (existingEmail) {
    if (existingEmail.status === 'Rejected') {
      await existingEmail.destroy();
    } else {
      return res.status(409).json({ message: 'An account with this email address already exists.' });
    }
  }

  // Data Privacy Act (RA 10173) — registration cannot proceed without explicit
  // consent to the Privacy Notice. Mirrors the required checkbox on the frontend.
  if (privacy_consent !== true) {
    return res.status(400).json({ message: 'You must accept the Privacy Notice to register.' });
  }

  // Irregular students pick one Section per Year level they're taking classes
  // under, instead of a single year/section — validate the shape here since it
  // drives which singular year_level/section get stored below, AND drives
  // automatic enrollment into any already-existing class for each pair (see
  // utils/autoEnroll.js, run once the account clears Chairperson/Admin/Faculty
  // approval). Exactly one pair is marked `is_current` — the Year the student
  // is actually progressing through normally; the rest are back subjects
  // they're retaking. That distinction is what lets the Student Dashboard's
  // "Path to Regular Status" picker only offer the back-subject Years.
  let cleanIrregularSections = [];
  if (isIrregular) {
    if (!Array.isArray(irregular_sections) || irregular_sections.length === 0) {
      return res.status(400).json({ message: 'Irregular students must select at least one Year level.' });
    }
    cleanIrregularSections = irregular_sections
      .map((p) => ({
        year_level: parseInt(p?.year_level),
        section: (p?.section || '').trim().toUpperCase(),
        // Which term THAT Year's classes fall in — a back subject can be a
        // Year retaken in either term, not necessarily the one matching the
        // student's own current-year term, so it's carried per Year rather
        // than assumed from the account's own semester.
        semester: (p?.semester || '').trim(),
        is_current: p?.is_current === true,
      }))
      .filter((p) => p.year_level >= 1 && p.year_level <= 4 && p.section && p.semester);
    if (cleanIrregularSections.length === 0) {
      return res.status(400).json({ message: 'Please select a Section and Semester for every Year you checked.' });
    }
    const uniqueYears = new Set(cleanIrregularSections.map((p) => p.year_level));
    if (uniqueYears.size !== cleanIrregularSections.length) {
      return res.status(400).json({ message: 'Only one Section may be selected per Year level.' });
    }
    const currentPairs = cleanIrregularSections.filter((p) => p.is_current);
    if (currentPairs.length !== 1) {
      return res.status(400).json({ message: 'Please mark exactly one Year as your current one.' });
    }
    cleanIrregularSections.sort((a, b) => a.year_level - b.year_level);
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  const studentNoTrimmed = student_no.trim();

  const existingStudentNo = await User.findOne({ where: { student_no: studentNoTrimmed } });
  if (existingStudentNo) {
    if (existingStudentNo.status === 'Rejected') {
      await existingStudentNo.destroy();
    } else {
      return res.status(409).json({ message: 'An account with this Student ID Number already exists.' });
    }
  }

  // Housekeeping: sweep out expired attempts so they never pile up or collide
  // with someone re-using the same email/student number later.
  await PendingRegistration.destroy({ where: { verification_expires: { [Op.lt]: new Date() } } });

  // Hashed here (same cost factor as User's own beforeCreate hook) since this
  // row isn't a User instance and won't go through that hook — verifyEmail()
  // passes this hash straight into User.create() with hooks disabled so the
  // password is only ever hashed once.
  const passwordHash = await bcrypt.hash(password, await bcrypt.genSalt(10));

  // Verification code is generated fresh each submission so the raw code is
  // only ever held in memory here and in the outgoing email — the stored
  // value is always just its hash.
  const verificationCode = generateVerificationCode();

  // Irregular students keep their primary/home year+section as their marked
  // CURRENT pair (not just whichever was checked first), so every existing
  // grouping/scoping feature that reads the singular fields points at the
  // Year they're actually progressing through, not an arbitrary back subject.
  const currentPair = isIrregular ? cleanIrregularSections.find((p) => p.is_current) : null;

  const pendingData = {
    name: canonicalName,
    email: emailTrimmed,
    password_hash: passwordHash,
    student_no: studentNoTrimmed,
    program: program.trim(),
    year_level: isIrregular ? currentPair.year_level : parseInt(year_level),
    section: isIrregular ? currentPair.section : (section ? section.trim() : null),
    student_status: isIrregular ? 'Irregular' : 'Regular',
    student_type: student_type || null,
    irregular_sections: isIrregular ? cleanIrregularSections : null,
    verification_code: hashCode(verificationCode),
    verification_expires: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
  };

  // Look up any earlier unconfirmed attempt under this email OR this student
  // number and overwrite it in place — this is the recovery path for a student
  // who abandoned the code screen and came back to submit again.
  const existingPending = await PendingRegistration.findOne({
    where: { [Op.or]: [{ email: emailTrimmed }, { student_no: studentNoTrimmed }] },
  });
  if (existingPending) {
    await existingPending.update(pendingData);
  } else {
    await PendingRegistration.create(pendingData);
  }

  await sendVerificationCodeEmail(emailTrimmed, pendingData.name, verificationCode);

  res.status(201).json({
    message: 'We sent a 6-digit verification code to your email. Enter it to finish registering.',
    student_no: studentNoTrimmed,
  });
});

// POST /api/auth/verify-email — Body: { student_no, code }. Confirms the code
// staged by register() and — only now — actually creates the `users` row
// (status 'Pending', email already verified) and notifies the program's
// Chairperson(s). Doing account creation here instead of in register() is the
// whole point: nothing claims the email/student number in `users` until the
// student proves they control the inbox, so an abandoned registration never
// leaves a phantom account blocking a later retry.
const verifyEmail = asyncHandler(async (req, res) => {
  const { student_no, code } = req.body;
  if (!student_no || !code) {
    return res.status(400).json({ message: 'Student ID Number and code are required.' });
  }

  const pending = await PendingRegistration.findOne({ where: { student_no: student_no.trim() } });
  if (!pending) {
    // Either already verified/approved before, or never submitted at all (or
    // the code expired and got swept up by later housekeeping).
    const alreadyUser = await User.findOne({ where: { student_no: student_no.trim(), role: 'Student' } });
    if (alreadyUser) {
      return res.status(400).json({ message: 'This email is already verified.' });
    }
    return res.status(404).json({ message: 'No pending registration found for that Student ID Number. Please register again.' });
  }

  if (pending.verification_expires < new Date()) {
    return res.status(400).json({ message: 'This code has expired. Request a new one and try again.' });
  }

  if (pending.verification_code !== hashCode(String(code).trim())) {
    return res.status(400).json({ message: 'Incorrect code. Please try again.' });
  }

  // Guard against the rare race where the email/student number got claimed by
  // someone else between register() and now.
  const conflict = await User.findOne({
    where: { [Op.or]: [{ email: pending.email }, { student_no: pending.student_no }] },
  });
  if (conflict) {
    await pending.destroy();
    return res.status(409).json({ message: 'An account with this email or Student ID Number was already created. Please try signing in, or contact the administrator.' });
  }

  // hooks: false — the password is already bcrypt-hashed (see register()), so
  // the beforeCreate hook must not hash it a second time. That hook is also
  // where the avatar initial normally gets set, so it's set explicitly here.
  const user = await User.create({
    name: pending.name,
    email: pending.email,
    password: pending.password_hash,
    role: 'Student',
    student_no: pending.student_no,
    program: pending.program,
    year_level: pending.year_level,
    section: pending.section,
    student_status: pending.student_status,
    student_type: pending.student_type,
    irregular_sections: pending.irregular_sections,
    status: 'Pending',
    email_verified: true,
    avatar: pending.name.trim().charAt(0).toUpperCase(),
    // Registration's required checkbox IS their Privacy Notice consent — record it
    // now so self-registered students aren't redundantly re-prompted with the
    // first-login modal too (that modal exists for staff accounts Admin/Chairperson
    // creates directly, which never go through this consent checkbox).
    privacy_accepted: true,
    privacy_accepted_at: new Date(),
    privacy_policy_version: PRIVACY_POLICY_VERSION,
  }, { hooks: false });

  await pending.destroy();

  await logActivity(user.id, 'registered and verified their email (pending admin approval)', 'User', user.id);

  // New registrations go to the Chairperson of the program first — they see the
  // pending queue grouped by Year/Section. Faculty verify later, in context, once
  // they create a matching class (see classController.getPendingMatches/verifyStudent).
  await notifyChairpersonsByProgram(req.app, user.program, {
    title: 'New Student Registration',
    message: `${user.name} (${user.student_no}) has registered and is waiting for review.`,
    type: 'registration',
    link: '/chairperson/pending-students',
  });

  res.json({
    message: 'Email verified! Your registration is pending approval by the administrator. You will be able to log in once your account is activated.',
  });
});

// POST /api/auth/resend-verification-code — Body: { student_no }.
const resendVerificationCode = asyncHandler(async (req, res) => {
  const { student_no } = req.body;
  if (!student_no) {
    return res.status(400).json({ message: 'Student ID Number is required.' });
  }

  const pending = await PendingRegistration.findOne({ where: { student_no: student_no.trim() } });
  if (!pending) {
    const alreadyUser = await User.findOne({ where: { student_no: student_no.trim(), role: 'Student' } });
    if (alreadyUser) {
      return res.status(400).json({ message: 'This email is already verified.' });
    }
    return res.status(404).json({ message: 'No pending registration found for that Student ID Number. Please register again.' });
  }

  const verificationCode = generateVerificationCode();
  pending.verification_code = hashCode(verificationCode);
  pending.verification_expires = new Date(Date.now() + 15 * 60 * 1000);
  await pending.save();

  await sendVerificationCodeEmail(pending.email, pending.name, verificationCode);
  res.json({ message: 'A new verification code has been sent to your email.' });
});

// GET /api/auth/me
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }
  res.json({
    user: user.toSafeJSON(),
    needs_privacy_consent: needsPrivacyConsent(user),
    privacy_policy_version: PRIVACY_POLICY_VERSION,
  });
});

// POST /api/auth/accept-privacy — records DPA (RA 10173) consent for the logged-in
// user. Called when they click "Accept" on the first-login Privacy Notice modal.
const acceptPrivacyPolicy = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  user.privacy_accepted = true;
  user.privacy_accepted_at = new Date();
  user.privacy_policy_version = PRIVACY_POLICY_VERSION;
  await user.save();

  await logActivity(user.id, `accepted the Privacy Notice (v${PRIVACY_POLICY_VERSION})`, 'User', user.id);

  res.json({ message: 'Privacy Notice accepted. Thank you.', user: user.toSafeJSON() });
});

// PUT /api/auth/username — Body: { newLogin, currentPassword }. Lets any
// logged-in user change their own login identifier — `username` for Admin/
// Chairperson/Faculty, `student_no` for Students (their actual login
// credential, per User.hasLoginCredential). Requires the current password as
// confirmation, same safeguard changePassword below already uses, since this
// changes what they'll type in at the login screen next time.
const changeUsername = asyncHandler(async (req, res) => {
  const { newLogin, currentPassword } = req.body;
  if (!newLogin || !newLogin.trim()) {
    return res.status(400).json({ message: `New ${req.user.role === 'Student' ? 'Student Number' : 'username'} is required.` });
  }
  if (!currentPassword) {
    return res.status(400).json({ message: 'Enter your current password to confirm this change.' });
  }

  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }

  const field = user.role === 'Student' ? 'student_no' : 'username';
  const value = newLogin.trim();

  const existing = await User.findOne({ where: { [field]: field === 'username' ? value.toLowerCase() : value } });
  if (existing && existing.id !== user.id) {
    return res.status(409).json({ message: `That ${field === 'student_no' ? 'Student Number' : 'username'} is already taken.` });
  }

  user[field] = value;
  await user.save();

  const fieldLabel = field === 'student_no' ? 'Student Number' : 'Username';
  await logActivity(user.id, `changed their ${field === 'student_no' ? 'student number' : 'username'}`, 'User', user.id);
  // Self-notification — so the account holder actually notices this
  // happened, the same way changePassword/confirmEmailChange below do for
  // their own account-identity changes. Not an audit trail (that's what
  // logActivity is for) — this is what shows up in THEIR OWN bell, in case
  // it wasn't them who changed it.
  await createNotification(req.app, {
    userId: user.id,
    title: `${fieldLabel} Changed`,
    message: `Your ${fieldLabel.toLowerCase()} was changed to "${value}". If this wasn't you, change your password immediately and contact an administrator.`,
    type: 'security',
    link: settingsPathFor(user.role),
  });
  res.json({ message: `${fieldLabel} updated successfully.`, user: user.toSafeJSON() });
});

// PUT /api/auth/email/request — step 1 of the self-service "Change Email"
// flow (Settings page). Only the account owner can trigger this — there's no
// Admin/Chairperson-facing equivalent; email, like username and password, is
// something only the account holder changes for themselves from here on. The
// new address isn't written to `email` yet — it sits in `pending_email` until
// confirmed via the code just sent, so a typo'd/unreachable new address can
// never lock someone out of the one that still works.
const requestEmailChange = asyncHandler(async (req, res) => {
  const { newEmail, currentPassword } = req.body;
  if (!newEmail || !isValidRegistrationEmail(newEmail)) {
    return res.status(400).json({ message: EMAIL_FORMAT_HINT });
  }
  if (!currentPassword) {
    return res.status(400).json({ message: 'Enter your current password to confirm this change.' });
  }

  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }

  const value = newEmail.trim().toLowerCase();
  const existing = await User.findOne({ where: { email: value } });
  if (existing && existing.id !== user.id) {
    return res.status(409).json({ message: 'That email address is already in use on another account.' });
  }

  const verificationCode = generateVerificationCode();
  user.pending_email = value;
  user.email_verification_code = hashCode(verificationCode);
  user.email_verification_expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  await user.save();

  await sendVerificationCodeEmail(value, user.name, verificationCode);
  res.json({ message: `Verification code sent to ${value}.` });
});

// PUT /api/auth/email/confirm — step 2: checks the code sent above and, only
// then, actually moves pending_email into email.
const confirmEmailChange = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ message: 'Enter the verification code.' });

  const user = await User.findByPk(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found.' });

  if (!user.pending_email || !user.email_verification_code) {
    return res.status(400).json({ message: 'No email change is in progress. Request a new code first.' });
  }
  if (user.email_verification_expires && new Date() > new Date(user.email_verification_expires)) {
    return res.status(400).json({ message: 'That code has expired. Request a new one.' });
  }
  if (hashCode(String(code).trim()) !== user.email_verification_code) {
    return res.status(400).json({ message: 'Incorrect code.' });
  }

  const newEmail = user.pending_email;
  user.email = newEmail;
  user.email_verified = true;
  user.pending_email = null;
  user.email_verification_code = null;
  user.email_verification_expires = null;
  await user.save();

  await logActivity(user.id, 'changed their email address', 'User', user.id);
  await createNotification(req.app, {
    userId: user.id,
    title: 'Email Address Changed',
    message: `Your email address was changed to ${newEmail}. If this wasn't you, change your password immediately and contact an administrator.`,
    type: 'security',
    link: settingsPathFor(user.role),
  });
  res.json({ message: 'Email address updated and verified.', user: user.toSafeJSON() });
});

// POST /api/auth/verify-password
const verifyPassword = asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ message: 'Password is required.' });
  }

  const user = await User.findByPk(req.user.id);
  if (!user) {
    return res.status(404).json({ message: 'User not found.' });
  }

  // 400, not 401 — same as every other "confirm your current password" check
  // in this file (changeUsername/requestEmailChange/changePassword above). The
  // caller (the session-lock unlock screen) already has a valid auth token; a
  // wrong password here is a business-logic rejection, not an authentication
  // failure — a 401 would trip API.js's global interceptor into treating it
  // as an expired session and force-logging them out instead of just letting
  // them retype the password.
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    return res.status(400).json({ message: 'Incorrect password.' });
  }

  return res.json({ message: 'Password verified.', user: user.toSafeJSON() });
});

// PUT /api/auth/password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findByPk(req.user.id);

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ message: 'New password must be at least 8 characters.' });
  }

  user.password = newPassword;
  await user.save();

  await logActivity(user.id, 'changed password', 'User', user.id);
  await createNotification(req.app, {
    userId: user.id,
    title: 'Password Changed',
    message: 'Your password was just changed. If this wasn\'t you, contact an administrator immediately.',
    type: 'security',
    link: settingsPathFor(user.role),
  });
  res.json({ message: 'Password changed successfully.' });
});

// POST /api/auth/forgot-password — Body: { email }. Always responds with the same
// generic message whether or not the email is registered, so this endpoint can't
// be used to probe which email addresses have an account (account enumeration).
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const GENERIC_MESSAGE = 'If that email address is registered, a password reset link has been sent to it.';

  if (!email) {
    return res.status(400).json({ message: 'Email address is required.' });
  }

  const user = await User.findOne({ where: { email: email.trim().toLowerCase() } });
  if (!user) {
    // Deliberately identical response/timing-insensitive path — no account leak.
    return res.json({ message: GENERIC_MESSAGE });
  }

  // Raw token goes in the email link; only its SHA-256 hash is stored, so a
  // database leak alone can never be used to reset someone's password.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.reset_password_token = hashedToken;
  user.reset_password_expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  await user.save();

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetLink = `${frontendUrl}/reset-password?token=${rawToken}`;

  await sendPasswordResetEmail(user.email, user.name, resetLink);
  await logActivity(user.id, 'requested a password reset', 'User', user.id);

  res.json({ message: GENERIC_MESSAGE });
});

// POST /api/auth/reset-password — Body: { token, password, confirmPassword }.
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password, confirmPassword } = req.body;

  if (!token || !password || !confirmPassword) {
    return res.status(400).json({ message: 'All fields are required.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters.' });
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    where: {
      reset_password_token: hashedToken,
      reset_password_expires: { [Op.gt]: new Date() },
    },
  });

  if (!user) {
    return res.status(400).json({ message: 'This password reset link is invalid or has expired. Please request a new one.' });
  }

  user.password = password;
  user.reset_password_token = null;
  user.reset_password_expires = null;
  await user.save();

  await logActivity(user.id, 'reset their password', 'User', user.id);
  res.json({ message: 'Your password has been reset. You may now sign in with your new password.' });
});

module.exports = { login, register, verifyEmail, resendVerificationCode, getMe, changeUsername, requestEmailChange, confirmEmailChange, verifyPassword, changePassword, acceptPrivacyPolicy, forgotPassword, resetPassword };