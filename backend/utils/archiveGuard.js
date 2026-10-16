const { Semester } = require('../models');

// An archived class is a record, not work in progress: its class list, class
// record (components + scores) and grades are kept exactly as they were.
// A class is archived when it was archived itself (status Completed /
// Cancelled) or when its whole semester has ended (Semester Completed).
// Returns the refusal message for anything that would remove its data, or
// null when the class is still running.
async function archivedClassMessage(cls) {
  if (!cls) return null;
  if (['Cancelled'].includes(cls.status)) {
    return 'This class is cancelled and cannot be modified.';
  }
  // Classes from completed/ended semesters allow late grade encoding and submission.
  return null;
}

module.exports = { archivedClassMessage };
