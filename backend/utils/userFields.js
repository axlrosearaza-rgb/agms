// Columns that must never leave the server in an API response: the password
// hash, plus the one-time secrets used for password reset and email
// verification/change. Any endpoint that returns user rows (lists, "by id",
// a class's students/instructor, grade reports, ...) excludes these — before
// this, a Student could fetch any class and read every classmate's live
// password-reset token from the response.
const USER_SECRET_FIELDS = [
  'password',
  'reset_password_token',
  'reset_password_expires',
  'email_verification_code',
  'email_verification_expires',
  'pending_email',
];

module.exports = { USER_SECRET_FIELDS };
