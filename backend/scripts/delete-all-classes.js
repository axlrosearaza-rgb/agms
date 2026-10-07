/**
 * Permanently deletes every Class in the system, along with everything that
 * hangs off one (ComponentScore -> ComponentItem -> GradeComponent ->
 * Enrollment -> Grade -> Class) — the exact same cascade order
 * classController.js's own deleteClass uses for a single class, just done
 * in bulk for all of them, inside one transaction so a failure partway
 * through rolls back instead of leaving things half-deleted.
 *
 * Run: node scripts/delete-all-classes.js
 */
require('dotenv').config();
const { sequelize } = require('../config/database');
const { Class, Grade, Enrollment, GradeComponent, ComponentItem, ComponentScore } = require('../models');

async function main() {
  const classCount = await Class.count();
  const gradeCount = await Grade.count();
  const enrollmentCount = await Enrollment.count();
  const componentCount = await GradeComponent.count();
  const itemCount = await ComponentItem.count();
  const scoreCount = await ComponentScore.count();

  console.log('Before delete:');
  console.log('  Classes:', classCount);
  console.log('  Grades:', gradeCount);
  console.log('  Enrollments:', enrollmentCount);
  console.log('  GradeComponents:', componentCount);
  console.log('  ComponentItems:', itemCount);
  console.log('  ComponentScores:', scoreCount);

  if (classCount === 0) {
    console.log('\nNo classes to delete.');
    return;
  }

  await sequelize.transaction(async (t) => {
    await ComponentScore.destroy({ where: {}, truncate: false, transaction: t });
    await ComponentItem.destroy({ where: {}, truncate: false, transaction: t });
    await GradeComponent.destroy({ where: {}, truncate: false, transaction: t });
    await Enrollment.destroy({ where: {}, truncate: false, transaction: t });
    await Grade.destroy({ where: {}, truncate: false, transaction: t });
    await Class.destroy({ where: {}, truncate: false, transaction: t });
  });

  console.log('\nAfter delete:');
  console.log('  Classes:', await Class.count());
  console.log('  Grades:', await Grade.count());
  console.log('  Enrollments:', await Enrollment.count());
  console.log('  GradeComponents:', await GradeComponent.count());
  console.log('  ComponentItems:', await ComponentItem.count());
  console.log('  ComponentScores:', await ComponentScore.count());
  console.log('\nDone.');
}

main()
  .then(() => sequelize.close())
  .catch((err) => {
    console.error(err);
    return sequelize.close().then(() => process.exit(1));
  });
