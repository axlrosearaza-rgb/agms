// One-time cleanup for the old email-verification flow, where register()
// created the `users` row immediately (unverified) instead of staging it in
// pending_registrations — any student who never entered their code was left
// stuck: the row existed but was permanently unusable, and its email/student
// number blocked every later registration attempt with "already exists".
//
// Safe to delete: role Student, email_verified false, status Pending — never
// approved, never logged in (login() already refuses unverified accounts).
require('dotenv').config();
const { Op } = require('sequelize');
const { User, ActivityLog } = require('../models');

(async () => {
  const stale = await User.findAll({
    where: { role: 'Student', email_verified: false, status: 'Pending' },
    attributes: ['id', 'name', 'email', 'student_no'],
  });

  if (stale.length === 0) {
    console.log('No stale unverified student rows found.');
    process.exit(0);
  }

  console.log(`Deleting ${stale.length} stale unverified student row(s):`);
  stale.forEach((u) => console.log(`  #${u.id} ${u.name} <${u.email}> student_no=${u.student_no}`));

  const ids = stale.map((u) => u.id);

  // These accounts have no real activity beyond the "registered" log entry
  // itself — clear it first so the users FK delete doesn't fail.
  await ActivityLog.destroy({ where: { user_id: { [Op.in]: ids } } });

  await User.destroy({
    where: { id: { [Op.in]: ids } },
  });

  console.log('Done.');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
