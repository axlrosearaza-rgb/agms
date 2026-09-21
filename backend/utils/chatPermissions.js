// Who can message whom (1:1 only) — every pair is scoped to an ACTUAL
// working relationship right now, not just matching roles/program tags:
//
//   Admin <-> Chairperson        any pair, unrestricted
//   Chairperson <-> Faculty      only if that Faculty currently teaches at
//                                 least one Active class whose SUBJECT
//                                 belongs to the Chairperson's own program(s)
//   Faculty <-> Student          only if that Student is currently enrolled
//                                 in at least one of that Faculty's Active classes
//   Chairperson <-> Student      only if that Student is currently enrolled
//                                 in at least one Active class whose SUBJECT
//                                 belongs to the Chairperson's own program(s)
//                                 — same "actual enrollment" scoping as
//                                 Faculty<->Student, just by program instead
//                                 of by a specific instructor
//
// No Admin<->Faculty, no Admin<->Student, no Faculty<->Faculty, no
// Student<->Student, no Chairperson<->Chairperson —
// every conversation has to go through the person who actually connects the
// two ends of the chain (a Chairperson relays between Admin and their own
// Faculty; a Faculty relays between a Chairperson and their own students).
//
// Scoped by the class's SUBJECT program, not by matching `programs` tags
// directly — this app supports cross-program teaching (a Faculty tagged for
// one program can still teach a class that belongs to a different one), so
// two accounts sharing a program tag doesn't necessarily mean they have any
// actual class in common, and two accounts with NO tag overlap still might
// (see reportController's notifyGradingSheetSent for the same lesson
// learned the first time this distinction mattered).
//
// Self-messaging is rejected separately by the caller (same user id), not here.
const { Class, Subject, Enrollment } = require('../models');
const { Op } = require('sequelize');

// Chairperson <-> Faculty: does this Faculty currently teach anything that
// belongs to one of this Chairperson's own programs?
const chairpersonOverseesTeaching = async (chairpersonPrograms, facultyId) => {
  if (!chairpersonPrograms || chairpersonPrograms.length === 0) return false;
  const count = await Class.count({
    where: { instructor_id: facultyId, status: 'Active' },
    include: [{ model: Subject, as: 'subject', where: { program: { [Op.in]: chairpersonPrograms } }, attributes: [] }],
  });
  return count > 0;
};

// Faculty <-> Student: is this Student currently enrolled in one of this
// Faculty's Active classes?
const studentEnrolledWithFaculty = async (studentId, facultyId) => {
  const count = await Enrollment.count({
    where: { student_id: studentId },
    include: [{ model: Class, as: 'class', where: { instructor_id: facultyId, status: 'Active' }, attributes: [] }],
  });
  return count > 0;
};

// Chairperson <-> Student: is this Student currently enrolled in an Active
// class whose SUBJECT belongs to one of this Chairperson's own programs?
// Scoped by the class's subject program, same reasoning as
// chairpersonOverseesTeaching above — not by matching the student's own
// `program` tag directly.
const studentEnrolledUnderChairperson = async (studentId, chairpersonPrograms) => {
  if (!chairpersonPrograms || chairpersonPrograms.length === 0) return false;
  const count = await Enrollment.count({
    where: { student_id: studentId },
    include: [{
      model: Class,
      as: 'class',
      where: { status: 'Active' },
      attributes: [],
      include: [{ model: Subject, as: 'subject', where: { program: { [Op.in]: chairpersonPrograms } }, attributes: [] }],
    }],
  });
  return count > 0;
};

// Async — needs the DB to answer, unlike the old pure-role version. Takes
// full user records (needs .id, .role, and — for a Chairperson — .programs).
const canMessage = async (userA, userB) => {
  const roleA = userA.role;
  const roleB = userB.role;

  if ((roleA === 'Admin' && roleB === 'Chairperson') || (roleA === 'Chairperson' && roleB === 'Admin')) {
    return true;
  }

  if (roleA === 'Chairperson' && roleB === 'Faculty') return chairpersonOverseesTeaching(userA.programs, userB.id);
  if (roleA === 'Faculty' && roleB === 'Chairperson') return chairpersonOverseesTeaching(userB.programs, userA.id);

  if (roleA === 'Faculty' && roleB === 'Student') return studentEnrolledWithFaculty(userB.id, userA.id);
  if (roleA === 'Student' && roleB === 'Faculty') return studentEnrolledWithFaculty(userA.id, userB.id);

  if (roleA === 'Chairperson' && roleB === 'Student') return studentEnrolledUnderChairperson(userB.id, userA.programs);
  if (roleA === 'Student' && roleB === 'Chairperson') return studentEnrolledUnderChairperson(userA.id, userB.programs);

  return false;
};

module.exports = { canMessage, chairpersonOverseesTeaching, studentEnrolledWithFaculty, studentEnrolledUnderChairperson };
