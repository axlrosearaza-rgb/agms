// Shared helper for the "Chairperson who also teaches" capability. A Chairperson
// account with `is_teaching = true` gets Instructor-equivalent permissions for
// class-ownership checks (their own classes only) ON TOP OF their normal, broader
// Chairperson visibility — this never restricts a non-teaching Chairperson or an
// Admin, and never widens what a teaching Chairperson can see beyond their own
// classes for the mutating (encode/submit/create/etc.) actions specifically.

// True if this user should be treated like an Instructor for ownership-scoped
// class/grade actions — either they really are one, or they're a Chairperson
// who's also been flagged as teaching.
const actsAsInstructor = (user) =>
  user?.role === 'Faculty' || (user?.role === 'Chairperson' && !!user?.is_teaching);

// Express middleware factory — like authorize(...roles), but additionally admits
// a teaching Chairperson wherever 'Faculty' is in the allowed list. Use this
// (instead of authorize()) on routes that let an Instructor act on their OWN
// classes/grades, so a teaching Chairperson can reach them too.
const authorizeTeaching = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required.' });
  }
  const allowed = roles.includes(req.user.role) || (roles.includes('Faculty') && actsAsInstructor(req.user));
  if (!allowed) {
    return res.status(403).json({
      message: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}`,
    });
  }
  next();
};

module.exports = { actsAsInstructor, authorizeTeaching };
