const crypto = require('crypto');
const { User, Semester } = require('../models');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { sendAccountSetupCodeEmail } = require('../utils/emailService');

// ── Student first-login account setup ───────────────────────────────────────
// Students are created/imported by Admin with the default password, so the
// first thing a student does is make the account theirs: replace that
// password, then add an email — Gmail or their SSU university email — and
// prove they own it with an emailed code. Only
// then is account_setup_at set — until it is, the frontend shows nothing but
// the setup wizard (AppLayout.js → AccountSetupWizard).
//
// Deliberately separate from Settings' Change Email (authController
// .requestEmailChange), which adds a first email WITHOUT a code — fine for
// staff, not for the one address Forgot Password will trust for a student.

const DEFAULT_PASSWORD = '12345678';
// Gmail, or the university's own email (@ssu.edu.ph, including sub-domains
// like @students.ssu.edu.ph) — same rule the old registration used.
const EMAIL_REGEX = /^[a-zA-Z0-9](\.?[a-zA-Z0-9_-]){2,}@(gmail\.com|([a-zA-Z0-9-]+\.)*ssu\.edu\.ph)$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

const hashCode = (code) => crypto.createHash('sha256').update(code).digest('hex');
const generateCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');

const loadStudent = async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user || user.role !== 'Student') {
    res.status(403).json({ message: 'Account setup is for student accounts only.' });
    return null;
  }
  if (user.account_setup_at) {
    res.status(400).json({ message: 'Your account is already set up.' });
    return null;
  }
  return user;
};

// POST /api/account-setup/password  { newPassword, confirmPassword }
const setPassword = asyncHandler(async (req, res) => {
  const user = await loadStudent(req, res);
  if (!user) return;

  const { newPassword, confirmPassword } = req.body;
  // Strong password required: 8+ characters with upper, lower, number, special.
  const weak = require('../utils/passwordRules').weakPasswordMessage(newPassword || '');
  if (weak) return res.status(400).json({ message: weak });
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }
  if (newPassword === DEFAULT_PASSWORD || await user.comparePassword(newPassword)) {
    return res.status(400).json({ message: 'Choose a new password — not the default one.' });
  }

  user.password = newPassword;
  user.password_changed_at = new Date();
  await user.save();
  await logActivity(user.id, 'set their own password (account setup)', 'User', user.id);

  res.json({ message: 'Password saved.', user: user.toSafeJSON() });
});

// POST /api/account-setup/email/request  { email }
const requestEmailCode = asyncHandler(async (req, res) => {
  const user = await loadStudent(req, res);
  if (!user) return;
  if (!user.password_changed_at) {
    return res.status(400).json({ message: 'Set your new password first.' });
  }

  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: 'Enter a valid Gmail or SSU university email (e.g. juandelacruz@gmail.com or jdelacruz@ssu.edu.ph).' });
  }
  const taken = await User.findOne({ where: { email }, attributes: ['id'] });
  if (taken && taken.id !== user.id) {
    return res.status(409).json({ message: 'That email is already used by another account.' });
  }

  // Offline mode: no code can be e-mailed, so the address is saved as it is
  // (not verified yet) and the account setup is finished right here.
  if (require('../utils/offline').isOffline()) {
    user.email = email;
    user.email_verified = false;
    user.pending_email = null;
    user.email_verification_code = null;
    user.email_verification_expires = null;
    user.account_setup_at = new Date();
    await user.save();
    await logActivity(user.id, 'finished account setup (offline mode — e-mail saved, not verified)', 'User', user.id);
    return res.json({ message: 'Your account is all set.', email, verified: true, offline: true, user: user.toSafeJSON() });
  }

  // Resend cooldown — a code for the SAME address sent under a minute ago.
  if (user.pending_email === email && user.email_verification_expires) {
    const sentAt = new Date(user.email_verification_expires).getTime() - CODE_TTL_MS;
    const waitMs = sentAt + RESEND_COOLDOWN_MS - Date.now();
    if (waitMs > 0) {
      return res.status(429).json({ message: `Please wait ${Math.ceil(waitMs / 1000)} seconds before requesting another code.` });
    }
  }

  const code = generateCode();
  user.pending_email = email;
  user.email_verification_code = hashCode(code);
  user.email_verification_expires = new Date(Date.now() + CODE_TTL_MS);
  await user.save();

  await sendAccountSetupCodeEmail(email, user.name, code);
  res.json({ message: `We sent a 6-digit code to ${email}.`, email });
});

// POST /api/account-setup/email/confirm  { code }
const confirmEmailCode = asyncHandler(async (req, res) => {
  const user = await loadStudent(req, res);
  if (!user) return;

  const code = String(req.body.code || '').trim();
  if (!user.pending_email || !user.email_verification_code) {
    return res.status(400).json({ message: 'Request a code first.' });
  }
  if (user.email_verification_expires && new Date() > new Date(user.email_verification_expires)) {
    return res.status(400).json({ message: 'That code has expired. Send a new one.' });
  }
  if (hashCode(code) !== user.email_verification_code) {
    return res.status(400).json({ message: 'Incorrect code.' });
  }

  // Re-checked here too — someone else may have claimed it since the code was sent.
  const taken = await User.findOne({ where: { email: user.pending_email }, attributes: ['id'] });
  if (taken && taken.id !== user.id) {
    return res.status(409).json({ message: 'That email is already used by another account.' });
  }

  user.email = user.pending_email;
  user.email_verified = true;
  user.pending_email = null;
  user.email_verification_code = null;
  user.email_verification_expires = null;
  user.account_setup_at = new Date();
  await user.save();
  await logActivity(user.id, 'verified their email and finished account setup', 'User', user.id);

  res.json({ message: 'Your account is all set.', user: user.toSafeJSON() });
});

// GET /api/account-setup/contacts — who the student should tell if their
// details are wrong: their adviser and the faculty who added their account.
const getContacts = asyncHandler(async (req, res) => {
  const { Op } = require('sequelize');
  const me = await User.findByPk(req.user.id, { attributes: ['program', 'year_level', 'section', 'created_by'] });
  const adviser = me?.year_level && me?.section ? await User.findOne({
    where: {
      role: { [Op.in]: ['Faculty', 'Chairperson'] },
      advisories: { [Op.contains]: [{ program: me.program, year_level: me.year_level, section: me.section }] },
    },
    attributes: ['id', 'name'],
  }) : null;
  const addedBy = me?.created_by ? await User.findByPk(me.created_by, { attributes: ['id', 'name'] }) : null;
  res.json({
    adviser: adviser ? { id: adviser.id, name: adviser.name } : null,
    added_by: addedBy ? { id: addedBy.id, name: addedBy.name } : null,
  });
});

// ── Status declaration (every semester) ─────────────────────────────────────
// After account setup, and again whenever a new semester becomes current, the
// student declares whether they're Regular or Irregular and their student
// type (New, Old, Shifter, Transferee, Quitter). status_declared_semester
// records which semester the declaration is for.
const STUDENT_TYPES = ['New', 'Old', 'Shifter', 'Transferee', 'Quitter'];

// GET /api/account-setup/status
const getStatusDeclaration = asyncHandler(async (req, res) => {
  const current = await Semester.findOne({ where: { is_current: true }, attributes: ['name'] });
  const semester = current?.name || null;
  const before = await User.findByPk(req.user.id, { attributes: ['status_declared_semester', 'declared_status', 'role'] });
  let needs = !!semester && (before.status_declared_semester !== semester || !before.declared_status);
  // Only worked out when a declaration is due: bring Regular / Irregular up
  // to date from the student's grades (a subject they failed / left INC —
  // promoted with retake by the adviser — keeps them Irregular).
  if (needs && before.role === 'Student') await require('../utils/enrollmentChecks').syncRegularity(req.app, [req.user.id]);
  const user = await User.findByPk(req.user.id);

  let suggestedType = user.student_type || null;
  if (needs && user.role === 'Student') {
    const { Grade, Class } = require('../models');
    const { Op } = require('sequelize');
    const earlier = await Grade.count({
      where: { student_id: req.user.id, submitted: true },
      include: [{ model: Class, as: 'class', where: { semester: { [Op.ne]: semester } }, attributes: [] }],
    });
    if (earlier > 0) {
      // A continuing student — the system already knows both answers
      // (Regular / Irregular from their grades, Old Student), so it records
      // them itself and the pop-up is never shown. Only students with no
      // grades here yet (new, shifters, transferees…) are asked.
      suggestedType = 'Old';
      user.declared_status = user.student_status || 'Regular';
      user.student_type = 'Old';
      user.status_declared_semester = semester;
      user.status_declared_at = new Date();
      await user.save();
      await logActivity(user.id, `status set automatically from grades: ${user.declared_status}, Old (${semester})`, 'User', user.id);
      needs = false;
    }
  }

  res.json({
    suggested_status: user.student_status || 'Regular',
    suggested_type: suggestedType,
    current_semester: semester,
    declared_semester: user.status_declared_semester,
    declared_at: user.status_declared_at,
    student_status: user.student_status,
    declared_status: user.declared_status,
    student_type: user.student_type,
    // Needed when there's a current semester this student hasn't declared for
    // yet — or declared only their student type (before Regular / Irregular
    // was asked again), so they're asked once more.
    needs_declaration: needs,
  });
});

// POST /api/account-setup/status  { student_status, student_type }
const declareStatus = asyncHandler(async (req, res) => {
  const user = await User.findByPk(req.user.id);
  if (!user || user.role !== 'Student') return res.status(403).json({ message: 'Only students declare a status.' });
  if (!user.account_setup_at) return res.status(400).json({ message: 'Finish setting up your account first.' });

  // The student answers Regular or Irregular (and their student type). The
  // system can still switch them to Irregular automatically from their class
  // lists — an incomplete load, a back / advance subject, another section
  // (utils/enrollmentChecks.js).
  const { student_status: declared, student_type: type } = req.body;
  if (!['Regular', 'Irregular'].includes(declared)) {
    return res.status(400).json({ message: 'Choose Regular or Irregular.' });
  }
  if (!STUDENT_TYPES.includes(type)) {
    return res.status(400).json({ message: 'Choose your student type.' });
  }
  const current = await Semester.findOne({ where: { is_current: true }, attributes: ['name'] });

  user.declared_status = declared;
  user.student_type = type;
  user.status_declared_semester = current?.name || null;
  user.status_declared_at = new Date();
  await user.save();
  // Live status: their answer, unless their classes say Irregular.
  await require('../utils/enrollmentChecks').syncRegularity(req.app, [user.id]);
  await user.reload();
  await logActivity(user.id, `declared their status: ${declared}, ${type}${current ? ` (${current.name})` : ''}`, 'User', user.id);

  res.json({ message: 'Thank you — your status is saved.', user: user.toSafeJSON() });
});

// ── Subjects to retake ───────────────────────────────────────────────────────
// GET /api/account-setup/retakes — every subject the student failed, left
// INC or dropped (released grades only) and hasn't passed since. A subject
// drops off this list by itself as soon as they're enrolled in it again (a
// different, still-running class of the same subject) or pass it.
const UNFINISHED = ['Failed', 'INC', 'DRP', 'Dropped'];
const getRetakes = asyncHandler(async (req, res) => {
  const { Grade, Class, Subject, Enrollment } = require('../models');
  const grades = await Grade.findAll({
    where: { student_id: req.user.id, submitted: true, released: true },
    attributes: ['id', 'class_id', 'status', 'average', 'released_date'],
    include: [{
      model: Class, as: 'class', attributes: ['id', 'semester', 'year_level', 'section', 'subject_id'],
      include: [{ model: Subject, as: 'subject', attributes: ['id', 'code', 'name', 'units', 'year_level', 'semester'] }],
    }],
    order: [['released_date', 'ASC']],
  });

  const passed = new Set(grades.filter((g) => g.status === 'Passed').map((g) => g.class?.subject_id));
  const latest = {};
  grades.forEach((g) => {
    const sid = g.class?.subject_id;
    if (!sid || passed.has(sid) || !UNFINISHED.includes(g.status)) return;
    latest[sid] = g; // ordered oldest → newest, so the last one wins
  });

  // Enrolled again: in a still-running class of the same subject other than
  // the one the unfinished grade came from.
  const enrolledNow = await Enrollment.findAll({
    where: { student_id: req.user.id },
    attributes: ['class_id'],
    include: [{ model: Class, as: 'class', where: { status: 'Active' }, attributes: ['id', 'subject_id'] }],
  });
  const reEnrolled = (g) => enrolledNow.some((e) => e.class.subject_id === g.class.subject_id && e.class.id !== g.class_id);

  const retakes = Object.values(latest).filter((g) => !reEnrolled(g)).map((g) => ({
    subject_id: g.class.subject_id,
    code: g.class.subject?.code,
    name: g.class.subject?.name,
    units: g.class.subject?.units,
    curriculum_year: g.class.subject?.year_level,
    curriculum_semester: g.class.subject?.semester,
    taken_semester: g.class.semester,
    taken_section: g.class.year_level && g.class.section ? `${g.class.year_level}-${g.class.section}` : null,
    status: g.status,
    grade: g.average,
  }));
  retakes.sort((a, b) => (a.curriculum_year || 0) - (b.curriculum_year || 0) || String(a.code).localeCompare(String(b.code)));
  res.json({ retakes });
});

// ── "Is this your class?" ────────────────────────────────────────────────────
// Classes the student was put in that aren't their own Year + Section.

// GET /api/account-setup/class-confirmations
const getClassConfirmations = asyncHandler(async (req, res) => {
  const { Enrollment, Class, Subject } = require('../models');
  const rows = await Enrollment.findAll({
    where: { student_id: req.user.id, needs_confirmation: true },
    include: [{
      model: Class,
      as: 'class',
      attributes: ['id', 'year_level', 'section', 'semester'],
      include: [
        { model: Subject, as: 'subject', attributes: ['code', 'name'] },
        { model: User, as: 'instructor', attributes: ['id', 'name'] },
      ],
    }],
    order: [['id', 'ASC']],
  });
  res.json({
    pending: rows.filter((r) => r.class).map((r) => ({
      enrollment_id: r.id,
      class_id: r.class.id,
      subject_code: r.class.subject?.code,
      subject_name: r.class.subject?.name,
      year_level: r.class.year_level,
      section: r.class.section,
      semester: r.class.semester,
      instructor_name: r.class.instructor?.name || null,
    })),
  });
});

// POST /api/account-setup/class-confirmations/:id  { answer: 'yes' | 'no' }
const answerClassConfirmation = asyncHandler(async (req, res) => {
  const { Enrollment, Class, Subject } = require('../models');
  const { createNotification } = require('./notificationController');
  const row = await Enrollment.findOne({
    where: { id: req.params.id, student_id: req.user.id },
    include: [{ model: Class, as: 'class', include: [{ model: Subject, as: 'subject', attributes: ['code'] }, { model: User, as: 'instructor', attributes: ['id', 'role'] }] }],
  });
  if (!row) return res.status(404).json({ message: 'That class was not found on your list.' });
  if (!row.class) return res.status(404).json({ message: 'That class no longer exists.' });
  const yes = req.body.answer === 'yes';
  if (!yes && req.body.answer !== 'no') return res.status(400).json({ message: 'Answer yes or no.' });

  const cls = row.class;
  const label = `${cls?.subject?.code || 'the class'}${cls?.section ? ` ${cls.year_level || ''}-${cls.section}` : ''}`;
  const instructorLink = `${cls?.instructor?.role === 'Chairperson' ? '/chairperson' : '/faculty'}/classes`;

  if (yes) {
    row.needs_confirmation = false;
    row.confirmed_at = new Date();
    row.disputed_at = null;
    await row.save();
    await logActivity(req.user.id, `confirmed they are in ${label}`, 'Class', row.class_id);
    return res.json({ message: 'Thank you — confirmed.' });
  }

  // "No, not mine" → the student is taken off the class list right away and
  // the instructor is told. (Not possible once a grade was submitted for them
  // or the class went to the Chairperson — then the instructor handles it.)
  const { Grade, ComponentItem, GradeComponent, ComponentScore } = require('../models');
  const grade = await Grade.findOne({ where: { class_id: row.class_id, student_id: req.user.id } });
  // An archived class is never changed — the instructor is only told.
  const archivedMsg = await require('../utils/archiveGuard').archivedClassMessage(cls);
  const removable = !cls?.sent_to_chairperson && !grade?.submitted && !archivedMsg;

  if (!removable) {
    row.needs_confirmation = false;
    row.disputed_at = new Date();
    await row.save();
    await logActivity(req.user.id, `reported they are NOT in ${label}`, 'Class', row.class_id);
    await require('../utils/classDisputes').recordDispute({ cls, student: req.user, removed: false });
    if (cls?.instructor) {
      await createNotification(req.app, {
        userId: cls.instructor.id,
        title: 'Student says: not my class',
        message: `${req.user.name} says they are not taking ${label}, but their grade was already submitted so they could not be removed automatically. Please check your class list.`,
        type: 'enrollment',
        link: instructorLink,
      });
    }
    return res.json({ message: 'Thank you — your faculty has been told.' });
  }

  const itemIds = (await ComponentItem.findAll({
    attributes: ['id'],
    include: [{ model: GradeComponent, as: 'component', where: { class_id: row.class_id }, attributes: [] }],
  })).map((i) => i.id);
  if (itemIds.length) await ComponentScore.destroy({ where: { student_id: req.user.id, item_id: itemIds } });
  if (grade) await grade.destroy();
  await row.destroy();
  await logActivity(req.user.id, `said they are not taking ${label} — removed from its class list`, 'Class', cls?.id);
  await require('../utils/classDisputes').recordDispute({ cls, student: req.user, removed: true });

  // Regular / Irregular, recalculated without that class.
  await require('../utils/enrollmentChecks').syncRegularity(req.app, [req.user.id], req.user.id);
  const me = await User.findByPk(req.user.id);

  if (cls?.instructor) {
    await createNotification(req.app, {
      userId: cls.instructor.id,
      title: 'Student removed from your class',
      message: `${req.user.name} said they are not taking ${label} and was removed from its class list automatically. Add them again if this was a mistake.`,
      type: 'enrollment',
      link: instructorLink,
    });
  }
  // Open pages (the instructor's class list, progress counts) refresh live.
  const io = req.app.get('io');
  if (io) require('../utils/realtime').emitGradesUpdated(io, { class_id: cls.id, message: 'Student removed from class list' }, 'pipeline');

  res.json({ message: `You were removed from ${cls?.subject?.code || 'that class'}. Your faculty has been told.`, removed: true, user: me.toSafeJSON() });
});

module.exports = { setPassword, requestEmailCode, confirmEmailCode, getStatusDeclaration, declareStatus, getClassConfirmations, answerClassConfirmation, getContacts, getRetakes };

