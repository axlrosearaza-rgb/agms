const { User, VerificationAssignment } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');
const { notifyStudentDecision } = require('../utils/notifyStudentDecision');
const { createNotification } = require('./notificationController');

// Shared "does this Chairperson/Admin have authority over this student" check —
// mirrors the scoping already used in userController.updateUser.
const chairHasScope = (user, student) => {
  if (user.role === 'Admin') return true;
  if (user.role !== 'Chairperson') return false;
  return (user.programs || []).includes(student.program);
};

// POST /api/verification-assignments  { student_id, verifier_ids: [...] }
// Chairperson delegates the Approve/Reject decision on a pending student to
// one or more verifiers — Faculty in the program, or another already-Active
// Student acting as a trusted helper — so the Chairperson doesn't have to
// personally review every registration. The Chairperson keeps override power
// regardless (see decideAssigned).
//
// Replace semantics, not additive: whatever verifier_ids is sent becomes the
// *complete* assigned list for the student — anyone previously assigned but
// left out this time is unassigned. That's what makes this double as
// "reassign": pick a different Faculty member and submit, the old one is
// dropped automatically.
const assignVerifiers = asyncHandler(async (req, res) => {
  const { student_id, verifier_ids } = req.body;
  if (!student_id || !Array.isArray(verifier_ids)) {
    return res.status(400).json({ message: 'student_id and verifier_ids are required.' });
  }

  const student = await User.findByPk(student_id);
  if (!student || student.role !== 'Student' || student.status !== 'Pending') {
    return res.status(400).json({ message: 'Student is not a pending registration.' });
  }
  if (!chairHasScope(req.user, student)) {
    return res.status(403).json({ message: 'You may only assign verifiers for students in your own program.' });
  }

  let validVerifiers = [];
  if (verifier_ids.length > 0) {
    const candidates = await User.findAll({
      where: { id: { [Op.in]: verifier_ids }, status: 'Active', role: { [Op.in]: ['Faculty', 'Student'] } },
    });
    // Faculty must teach in this exact program; Student verifiers must be an
    // already-verified student in this exact program — a Chairperson managing
    // several programs can't cross-assign someone from a different one.
    validVerifiers = candidates.filter((v) => {
      if (v.id === student.id) return false;
      if (v.role === 'Faculty') return (v.programs || []).includes(student.program);
      return v.role === 'Student' && v.program === student.program;
    });
    if (validVerifiers.length === 0) {
      return res.status(400).json({ message: 'None of the selected people are eligible to verify this student (must be Active Faculty or an Active Student in the same program).' });
    }
  }

  const existing = await VerificationAssignment.findAll({ where: { student_id: student.id } });
  const existingVerifierIds = new Set(existing.map((a) => a.verifier_id));
  const keepIds = new Set(validVerifiers.map((v) => v.id));

  // Drop anyone no longer selected.
  const toRemoveIds = [...existingVerifierIds].filter((id) => !keepIds.has(id));
  if (toRemoveIds.length > 0) {
    await VerificationAssignment.destroy({ where: { student_id: student.id, verifier_id: { [Op.in]: toRemoveIds } } });
  }

  // Add anyone newly selected (only these get notified — people who were
  // already assigned and stay assigned don't need a repeat notification).
  const newVerifiers = validVerifiers.filter((v) => !existingVerifierIds.has(v.id));
  if (newVerifiers.length > 0) {
    await VerificationAssignment.bulkCreate(
      newVerifiers.map((v) => ({ student_id: student.id, verifier_id: v.id, assigned_by: req.user.id })),
      { ignoreDuplicates: true }
    );
    for (const v of newVerifiers) {
      await createNotification(req.app, {
        userId: v.id,
        title: 'Registration assigned to you',
        message: `${req.user.name} asked you to verify ${student.name}'s registration.`,
        type: 'registration',
        link: v.role === 'Faculty' ? '/faculty/assigned-students' : '/student/assigned-students',
      });
    }
  }

  if (newVerifiers.length > 0 || toRemoveIds.length > 0) {
    await logActivity(req.user.id, `updated verifier assignment for ${student.name}'s registration`, 'User', student.id);
  }

  const verifiers = await student.getVerifiers({ attributes: ['id', 'name', 'role', 'avatar'] });
  res.status(201).json({ message: `${validVerifiers.length} verifier(s) assigned.`, verifiers });
});

// DELETE /api/verification-assignments/:id
const unassignVerifier = asyncHandler(async (req, res) => {
  const assignment = await VerificationAssignment.findByPk(req.params.id, {
    include: [{ model: User, as: 'student' }],
  });
  if (!assignment) return res.status(404).json({ message: 'Assignment not found.' });
  if (!chairHasScope(req.user, assignment.student)) {
    return res.status(403).json({ message: 'You may only manage assignments for students in your own program.' });
  }
  await assignment.destroy();
  res.json({ message: 'Verifier unassigned.' });
});

// GET /api/verification-assignments/mine
// The Faculty/Student "Assigned to Me" list — pending students a Chairperson
// specifically delegated to this user.
const getMyAssignments = asyncHandler(async (req, res) => {
  const assignments = await VerificationAssignment.findAll({
    where: { verifier_id: req.user.id },
    include: [{ model: User, as: 'student', attributes: { exclude: ['password'] } }],
    order: [['created_at', 'ASC']],
  });

  const students = assignments
    .map((a) => a.student)
    .filter((s) => s && s.status === 'Pending');

  res.json({ students });
});

// POST /api/verification-assignments/:studentId/decide  { status }
// The actual Approve/Reject action — usable by: an assigned verifier (Faculty
// or Student), or the Chairperson/Admin overriding directly regardless of
// assignment. Cleans up all assignment rows for the student once decided.
const decideAssigned = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['Active', 'Deactivated', 'Rejected'].includes(status)) {
    return res.status(400).json({ message: 'status must be Active, Deactivated, or Rejected.' });
  }

  const student = await User.findByPk(req.params.studentId);
  if (!student || student.role !== 'Student' || student.status !== 'Pending') {
    return res.status(400).json({ message: 'Student is not a pending registration.' });
  }

  let authorized = chairHasScope(req.user, student);
  if (!authorized) {
    const assignment = await VerificationAssignment.findOne({
      where: { student_id: student.id, verifier_id: req.user.id },
    });
    authorized = !!assignment;
  }
  if (!authorized) {
    return res.status(403).json({ message: 'You are not assigned to verify this student.' });
  }

  const previousStatus = student.status;
  student.status = (status === 'Deactivated' || status === 'Rejected') ? 'Rejected' : 'Active';
  await student.save();
  await notifyStudentDecision(student, previousStatus);
  await VerificationAssignment.destroy({ where: { student_id: student.id } });

  await logActivity(req.user.id, `${student.status === 'Active' ? 'verified' : 'rejected'} student ${student.name} (assigned verification)`, 'User', student.id);
  res.json({ message: `${student.name} has been ${student.status === 'Active' ? 'verified' : 'rejected'}.` });
});

// GET /api/verification-assignments/mine/count — sidebar "Assigned Work"
// badge for Faculty/Student verifiers, same lightweight COUNT-only pattern
// as classService.getPendingApprovalCount/chatService.getUnreadCount
// instead of making the sidebar pull getMyAssignments' full student rows
// just to read .length off them. Same "still actually Pending" filter
// getMyAssignments applies — a student decided on elsewhere (Chairperson
// override) shouldn't keep padding this count even if its assignment row
// hasn't been cleaned up for some reason.
const getMyAssignmentCount = asyncHandler(async (req, res) => {
  const assignments = await VerificationAssignment.findAll({
    where: { verifier_id: req.user.id },
    include: [{ model: User, as: 'student', attributes: ['id', 'status'] }],
  });
  const count = assignments.filter((a) => a.student?.status === 'Pending').length;
  res.json({ count });
});

module.exports = { assignVerifiers, unassignVerifier, getMyAssignments, getMyAssignmentCount, decideAssigned };
