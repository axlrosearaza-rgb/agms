// Removes every TEST student created by scripts/seed-test-students-cap102.js
// (identified ONLY by their @agms.test email — real accounts are never
// touched), along with their enrollments, scores, grades, notifications and
// activity. Runs in one transaction: all removed, or nothing.
//
// Run: node scripts/remove-test-students.js
const { sequelize } = require('../config/database');
const { Op } = require('sequelize');
const { User, Enrollment, Grade, ComponentScore, Notification, ActivityLog } = require('../models');

(async () => {
  const testUsers = await User.findAll({ where: { email: { [Op.like]: '%@agms.test' }, role: 'Student' }, attributes: ['id'] });
  const ids = testUsers.map((u) => u.id);
  if (ids.length === 0) { console.log('No test students found.'); return sequelize.close(); }

  await sequelize.transaction(async (transaction) => {
    const where = { student_id: ids };
    const scores = await ComponentScore.destroy({ where, transaction });
    const grades = await Grade.destroy({ where, transaction });
    const enrollments = await Enrollment.destroy({ where, transaction });
    await Notification.destroy({ where: { user_id: ids }, transaction });
    await ActivityLog.destroy({ where: { user_id: ids }, transaction });
    const users = await User.destroy({ where: { id: ids }, transaction });
    console.log(`Removed ${users} test students, ${enrollments} enrollments, ${grades} grades, ${scores} scores.`);
  });
  await sequelize.close();
})().catch((e) => { console.error('Failed — nothing was removed:', e.message); process.exit(1); });
