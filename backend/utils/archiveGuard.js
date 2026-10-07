const { Semester } = require('../models');

// An archived class is a record, not work in progress: its class list, class
// record (components + scores) and grades are kept exactly as they were.
// A class is archived when it was archived itself (status Completed /
// Cancelled) or when its whole semester has ended (Semester Completed).
// Returns the refusal message for anything that would remove its data, or
// null when the class is still running.
async function archivedClassMessage(cls) {
  if (!cls) return null;
  if (['Completed', 'Cancelled'].includes(cls.status)) {
    return 'This class is archived — its class list, class record and grades are kept as they are and can\'t be changed. Restore the class first if it is still running.';
  }
  const semester = cls.semester ? await Semester.findOne({ where: { name: cls.semester }, attributes: ['status'] }) : null;
  if (semester?.status === 'Completed') {
    return `${cls.semester} has ended — this class is archived, so its class list, class record and grades are kept as they are and can't be changed.`;
  }
  return null;
}

module.exports = { archivedClassMessage };
