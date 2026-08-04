require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  User, Subject, Prerequisite, Class, Enrollment, Grade, Endorsement,
  ActivityLog, Semester, GradeComponent, ComponentScore, Notification,
  Conversation, ConversationParticipant, Message,
} = require('../models');

const reset = async () => {
  const t = await sequelize.transaction();
  try {
    console.log('🔄 Resetting system, keeping only Admin account(s)...\n');

    // Delete children before parents to respect foreign keys.
    const steps = [
      ['ComponentScore', ComponentScore],
      ['Message', Message],
      ['ConversationParticipant', ConversationParticipant],
      ['Conversation', Conversation],
      ['GradeComponent', GradeComponent],
      ['Grade', Grade],
      ['Enrollment', Enrollment],
      ['Endorsement', Endorsement],
      ['ActivityLog', ActivityLog],
      ['Notification', Notification],
      ['Prerequisite', Prerequisite],
      ['Class', Class],
      ['Subject', Subject],
      ['Semester', Semester],
    ];

    for (const [name, Model] of steps) {
      const count = await Model.destroy({ where: {}, transaction: t });
      console.log(`✅ Cleared ${name}: ${count} row(s)`);
    }

    const userCount = await User.destroy({ where: { role: { [Op.ne]: 'Admin' } }, transaction: t });
    console.log(`✅ Cleared non-Admin Users: ${userCount} row(s)`);

    await t.commit();

    const remainingAdmins = await User.findAll({ where: { role: 'Admin' }, attributes: ['id', 'name', 'email'] });
    console.log('\n🎉 Reset complete. Remaining Admin account(s):');
    remainingAdmins.forEach((a) => console.log(`   - ${a.name} <${a.email}> (id ${a.id})`));

    process.exit(0);
  } catch (err) {
    await t.rollback();
    console.error('❌ Reset failed, rolled back:', err);
    process.exit(1);
  }
};

reset();
