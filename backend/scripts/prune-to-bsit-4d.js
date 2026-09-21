/**
 * Deletes every Student and every Class EXCEPT those matching
 * Program = Bachelor of Science in Information Technology, Year Level = 4,
 * Section = D (across all semesters/academic years) — plus everything that
 * hangs off the removed rows (enrollments, grades, grade components/items/
 * scores, notifications, endorsements, activity logs, chat conversations/
 * participants/messages, verification assignments).
 *
 * Left untouched: Faculty/Chairperson/Admin accounts, Subjects, Semesters,
 * PendingRegistrations — none of these are "students" or "classes".
 *
 * Run: node scripts/prune-to-bsit-4d.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  User, Class, Subject, Enrollment, Grade, GradeComponent, ComponentItem,
  ComponentScore, Notification, Endorsement, ActivityLog, Conversation,
  ConversationParticipant, Message, VerificationAssignment,
} = require('../models');

const PROGRAM = 'Bachelor of Science in Information Technology';
const YEAR_LEVEL = 4;
const SECTION = 'D';

async function main() {
  const keepClasses = await Class.findAll({
    include: [{ model: Subject, as: 'subject', where: { program: PROGRAM }, required: true }],
    where: { year_level: YEAR_LEVEL, section: SECTION },
    attributes: ['id'],
  });
  const keepClassIds = keepClasses.map((c) => c.id);

  const keepStudents = await User.findAll({
    where: { role: 'Student', program: PROGRAM, year_level: YEAR_LEVEL, section: SECTION },
    attributes: ['id'],
  });
  const keepStudentIds = keepStudents.map((u) => u.id);

  const classesToDelete = await Class.findAll({ where: { id: { [Op.notIn]: keepClassIds.length ? keepClassIds : [0] } }, attributes: ['id'] });
  const classIdsToDelete = classesToDelete.map((c) => c.id);

  const studentsToDelete = await User.findAll({
    where: { role: 'Student', id: { [Op.notIn]: keepStudentIds.length ? keepStudentIds : [0] } },
    attributes: ['id'],
  });
  const studentIdsToDelete = studentsToDelete.map((u) => u.id);

  console.log(`Keeping ${keepClassIds.length} class(es), deleting ${classIdsToDelete.length}.`);
  console.log(`Keeping ${keepStudentIds.length} student(s), deleting ${studentIdsToDelete.length}.`);

  if (classIdsToDelete.length === 0 && studentIdsToDelete.length === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
  }

  await sequelize.transaction(async (t) => {
    const classWhere = { class_id: { [Op.in]: classIdsToDelete } };
    const studentWhere = { student_id: { [Op.in]: studentIdsToDelete } };
    const userWhere = { user_id: { [Op.in]: studentIdsToDelete } };

    // ── Grade components (per removed class): scores → items → components ──
    const components = await GradeComponent.findAll({ where: classIdsToDelete.length ? classWhere : { class_id: -1 }, attributes: ['id'], transaction: t });
    const componentIds = components.map((c) => c.id);
    const items = componentIds.length
      ? await ComponentItem.findAll({ where: { component_id: { [Op.in]: componentIds } }, attributes: ['id'], transaction: t })
      : [];
    const itemIds = items.map((i) => i.id);

    const scoreWhere = {
      [Op.or]: [
        studentIdsToDelete.length ? { student_id: { [Op.in]: studentIdsToDelete } } : null,
        itemIds.length ? { item_id: { [Op.in]: itemIds } } : null,
      ].filter(Boolean),
    };
    if (scoreWhere[Op.or].length) {
      const n = await ComponentScore.destroy({ where: scoreWhere, transaction: t });
      console.log(`  ComponentScore: ${n}`);
    }
    if (itemIds.length) {
      const n = await ComponentItem.destroy({ where: { id: { [Op.in]: itemIds } }, transaction: t });
      console.log(`  ComponentItem: ${n}`);
    }
    if (componentIds.length) {
      const n = await GradeComponent.destroy({ where: { id: { [Op.in]: componentIds } }, transaction: t });
      console.log(`  GradeComponent: ${n}`);
    }

    // ── Grades / Enrollments (either side: removed class OR removed student) ──
    const gradeWhere = {
      [Op.or]: [
        classIdsToDelete.length ? { class_id: { [Op.in]: classIdsToDelete } } : null,
        studentIdsToDelete.length ? { student_id: { [Op.in]: studentIdsToDelete } } : null,
      ].filter(Boolean),
    };
    if (gradeWhere[Op.or].length) {
      const n = await Grade.destroy({ where: gradeWhere, transaction: t });
      console.log(`  Grade: ${n}`);
      const n2 = await Enrollment.destroy({ where: gradeWhere, transaction: t });
      console.log(`  Enrollment: ${n2}`);
    }

    if (studentIdsToDelete.length) {
      const n1 = await Endorsement.destroy({ where: studentWhere, transaction: t });
      console.log(`  Endorsement: ${n1}`);
      const n2 = await ActivityLog.destroy({ where: userWhere, transaction: t });
      console.log(`  ActivityLog: ${n2}`);
      const n3 = await Notification.destroy({ where: userWhere, transaction: t });
      console.log(`  Notification: ${n3}`);
      const n4 = await VerificationAssignment.destroy({
        where: { [Op.or]: [{ student_id: { [Op.in]: studentIdsToDelete } }, { verifier_id: { [Op.in]: studentIdsToDelete } }, { assigned_by: { [Op.in]: studentIdsToDelete } }] },
        transaction: t,
      });
      console.log(`  VerificationAssignment: ${n4}`);

      // Chat: any conversation involving a removed student gets its messages
      // and participant rows removed, then the conversation itself.
      const convos = await Conversation.findAll({
        where: { [Op.or]: [{ user_a_id: { [Op.in]: studentIdsToDelete } }, { user_b_id: { [Op.in]: studentIdsToDelete } }] },
        attributes: ['id'],
        transaction: t,
      });
      const convoIds = convos.map((c) => c.id);
      if (convoIds.length) {
        const n5 = await Message.destroy({ where: { conversation_id: { [Op.in]: convoIds } }, transaction: t });
        console.log(`  Message: ${n5}`);
        const n6 = await ConversationParticipant.destroy({ where: { conversation_id: { [Op.in]: convoIds } }, transaction: t });
        console.log(`  ConversationParticipant: ${n6}`);
        const n7 = await Conversation.destroy({ where: { id: { [Op.in]: convoIds } }, transaction: t });
        console.log(`  Conversation: ${n7}`);
      }
    }

    // ── Classes, then Students ──
    if (classIdsToDelete.length) {
      const n = await Class.destroy({ where: { id: { [Op.in]: classIdsToDelete } }, transaction: t });
      console.log(`  Class: ${n}`);
    }
    if (studentIdsToDelete.length) {
      const n = await User.destroy({ where: { id: { [Op.in]: studentIdsToDelete } }, transaction: t });
      console.log(`  User (Student): ${n}`);
    }
  });

  const remainingStudents = await User.count({ where: { role: 'Student' } });
  const remainingClasses = await Class.count();
  console.log(`\n✅ Done. Remaining: ${remainingStudents} student(s), ${remainingClasses} class(es).`);
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
