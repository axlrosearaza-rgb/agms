/**
 * Removes everything seed-test-data.js created:
 *   - Grades/Enrollments belonging to the tagged test Classes or test Students
 *   - Classes tagged schedule = '[TEST DATA]'
 *   - Users with student_no >= '900001' (the reserved test range — real
 *     student_no's in this DB all start with '2', so this never touches them)
 *
 * Run: node scripts/remove-test-data.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { User, Class, Enrollment, Grade } = require('../models');

const TEST_STUDENT_NO_START = '900001';
const TEST_SCHEDULE_TAG = '[TEST DATA]';

async function main() {
  const testStudents = await User.findAll({ where: { role: 'Student', student_no: { [Op.gte]: TEST_STUDENT_NO_START } }, attributes: ['id'] });
  const testStudentIds = testStudents.map((s) => s.id);

  const testClasses = await Class.findAll({ where: { schedule: TEST_SCHEDULE_TAG }, attributes: ['id'] });
  const testClassIds = testClasses.map((c) => c.id);

  if (testStudentIds.length === 0 && testClassIds.length === 0) {
    console.log('✅ Nothing to remove — no test data found.');
    await sequelize.close();
    return;
  }

  console.log(`🔎 Found ${testStudentIds.length} test student(s) and ${testClassIds.length} test class(es).`);

  const gradeWhere = { [Op.or]: [] };
  if (testClassIds.length) gradeWhere[Op.or].push({ class_id: { [Op.in]: testClassIds } });
  if (testStudentIds.length) gradeWhere[Op.or].push({ student_id: { [Op.in]: testStudentIds } });
  const gradesDeleted = gradeWhere[Op.or].length ? await Grade.destroy({ where: gradeWhere }) : 0;
  console.log(`🗑️  Deleted ${gradesDeleted} grade(s).`);

  const enrollWhere = { [Op.or]: [] };
  if (testClassIds.length) enrollWhere[Op.or].push({ class_id: { [Op.in]: testClassIds } });
  if (testStudentIds.length) enrollWhere[Op.or].push({ student_id: { [Op.in]: testStudentIds } });
  const enrollmentsDeleted = enrollWhere[Op.or].length ? await Enrollment.destroy({ where: enrollWhere }) : 0;
  console.log(`🗑️  Deleted ${enrollmentsDeleted} enrollment(s).`);

  const classesDeleted = testClassIds.length ? await Class.destroy({ where: { id: { [Op.in]: testClassIds } } }) : 0;
  console.log(`🗑️  Deleted ${classesDeleted} class(es).`);

  const studentsDeleted = testStudentIds.length ? await User.destroy({ where: { id: { [Op.in]: testStudentIds } } }) : 0;
  console.log(`🗑️  Deleted ${studentsDeleted} student(s).`);

  console.log('\n🎉 All test data removed.');
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('❌ Cleanup failed:', err);
    await sequelize.close();
    process.exit(1);
  });
