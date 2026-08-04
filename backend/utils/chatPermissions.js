// Who can message whom (1:1 only):
//   Student <-> Instructor
//   Admin <-> Chairperson <-> Instructor (any pair among these three, staff are fully interconnected)
// No Student<->Chairperson, no Student<->Admin, no Student<->Student.
// Self-messaging is rejected separately by the caller (same user id), not here.
const STAFF_ROLES = ['Admin', 'Chairperson', 'Instructor'];

const canMessage = (roleA, roleB) => {
  if (STAFF_ROLES.includes(roleA) && STAFF_ROLES.includes(roleB)) return true;
  if (roleA === 'Student' && roleB === 'Instructor') return true;
  if (roleA === 'Instructor' && roleB === 'Student') return true;
  return false;
};

module.exports = { canMessage };
