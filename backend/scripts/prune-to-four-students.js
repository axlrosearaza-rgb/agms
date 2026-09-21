/**
 * Follow-up to prune-to-bsit-4d.js — narrows the remaining 61 BSIT 4th Year D
 * students down to exactly 4: Axl Rose G. Araza, Aldea P. Lagarto, Jake Alfie
 * D. Gabane, Joedre Marl Villanueva. Classes are untouched (still all 10 BSIT
 * 4th Year D classes) — only the Student accounts and everything hanging off
 * the removed ones (enrollments, grades, notifications, endorsements,
 * activity logs, chat, verification assignments) go. Same cascade order as
 * prune-to-bsit-4d.js.
 *
 * Run: node scripts/prune-to-four-students.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  User, Grade, Enrollment, Notification, Endorsement, ActivityLog,
  Conversation, ConversationParticipant, Message, VerificationAssignment,
  ComponentScore,
} = require('../models');

const KEEP_IDS = [68, 69, 74, 75]; // Axl, Jake, Joedre, Aldea — verified by name below

async function main() {
  const keep = await User.findAll({ where: { id: { [Op.in]: KEEP_IDS }, role: 'Student' }, attributes: ['id', 'name'] });
  if (keep.length !== KEEP_IDS.length) {
    throw new Error(`Expected ${KEEP_IDS.length} matching students, found ${keep.length}. Aborting.`);
  }
  console.log('Keeping:', keep.map((s) => s.name).join(', '));

  const toDelete = await User.findAll({ where: { role: 'Student', id: { [Op.notIn]: KEEP_IDS } }, attributes: ['id'] });
  const ids = toDelete.map((u) => u.id);
  console.log(`Deleting ${ids.length} student(s).`);
  if (ids.length === 0) { console.log('Nothing to delete.'); process.exit(0); }

  await sequelize.transaction(async (t) => {
    const studentWhere = { student_id: { [Op.in]: ids } };
    const userWhere = { user_id: { [Op.in]: ids } };

    console.log('  ComponentScore:', await ComponentScore.destroy({ where: studentWhere, transaction: t }));
    console.log('  Grade:', await Grade.destroy({ where: studentWhere, transaction: t }));
    console.log('  Enrollment:', await Enrollment.destroy({ where: studentWhere, transaction: t }));
    console.log('  Endorsement:', await Endorsement.destroy({ where: studentWhere, transaction: t }));
    console.log('  ActivityLog:', await ActivityLog.destroy({ where: userWhere, transaction: t }));
    console.log('  Notification:', await Notification.destroy({ where: userWhere, transaction: t }));
    console.log('  VerificationAssignment:', await VerificationAssignment.destroy({
      where: { [Op.or]: [{ student_id: { [Op.in]: ids } }, { verifier_id: { [Op.in]: ids } }, { assigned_by: { [Op.in]: ids } }] },
      transaction: t,
    }));

    const convos = await Conversation.findAll({
      where: { [Op.or]: [{ user_a_id: { [Op.in]: ids } }, { user_b_id: { [Op.in]: ids } }] },
      attributes: ['id'],
      transaction: t,
    });
    const convoIds = convos.map((c) => c.id);
    if (convoIds.length) {
      console.log('  Message:', await Message.destroy({ where: { conversation_id: { [Op.in]: convoIds } }, transaction: t }));
      console.log('  ConversationParticipant:', await ConversationParticipant.destroy({ where: { conversation_id: { [Op.in]: convoIds } }, transaction: t }));
      console.log('  Conversation:', await Conversation.destroy({ where: { id: { [Op.in]: convoIds } }, transaction: t }));
    }

    console.log('  User (Student):', await User.destroy({ where: { id: { [Op.in]: ids } }, transaction: t }));
  });

  const remaining = await User.findAll({ where: { role: 'Student' }, attributes: ['id', 'name'] });
  console.log(`\n✅ Done. Remaining students (${remaining.length}):`, remaining.map((s) => s.name).join(', '));
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
