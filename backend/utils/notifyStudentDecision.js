const { sendAccountApprovedEmail, sendAccountRejectedEmail } = require('./emailService');

// Fires the "your registration was approved/rejected" email exactly once, the
// moment a Student's account actually transitions out of Pending — regardless
// of whether a Faculty, Chairperson, or Admin account (or the class-scoped
// verification flow) is the one who decided. Deliberately NOT awaited by
// callers for the send itself: Gmail SMTP can take a couple of seconds to
// round-trip, and nothing in the approve/reject response depends on the email
// having actually left the server yet, so this kicks it off and returns
// immediately — a failed send is only logged, never surfaced to the caller
// (the account decision itself must never fail or stall because email did).
const notifyStudentDecision = async (user, previousStatus) => {
  if (!(user.role === 'Student' && previousStatus === 'Pending' && user.email)) return;

  if (user.status === 'Active') {
    const loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`;
    sendAccountApprovedEmail(user.email, user.name, loginUrl).catch((err) =>
      console.error(`Failed to send approval email to ${user.email}:`, err.message)
    );
  } else if (user.status === 'Rejected' || user.status === 'Deactivated') {
    sendAccountRejectedEmail(user.email, user.name).catch((err) =>
      console.error(`Failed to send rejection email to ${user.email}:`, err.message)
    );
  }
};

module.exports = { notifyStudentDecision };
