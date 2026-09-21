const { Class, Subject, Enrollment } = require('../models');

// Enrolls a just-approved (Pending -> Active) student into every already-existing
// Class that matches their Year Level + Section — the same "match the section
// roster" rule classController.createClass already applies in the other
// direction (a new class auto-enrolls students who were already Active). This
// is what makes picking a Year + Section at registration actually mean
// something: no separate "Enroll Students" step needed for a section that was
// already up and running before the student's account got approved.
//
// Regular students match on their single year_level/section. Irregular
// students can be enrolled across several Year Levels at once — one class-
// matching pass per entry in their irregular_sections array (e.g. retaking a
// Year 2 subject while also carrying a full Year 3 load).
const enrollStudentIntoMatchingClasses = async (student) => {
  if (student.role !== 'Student' || !student.program) return 0;

  const pairs = student.student_status === 'Irregular'
    ? (student.irregular_sections || []).filter((p) => p.year_level && p.section)
    : (student.year_level && student.section ? [{ year_level: student.year_level, section: student.section }] : []);

  if (pairs.length === 0) return 0;

  const subjects = await Subject.findAll({ where: { program: student.program }, attributes: ['id'] });
  const subjectIds = subjects.map((s) => s.id);
  if (subjectIds.length === 0) return 0;

  const { Op } = require('sequelize');
  const classes = await Class.findAll({
    where: {
      subject_id: { [Op.in]: subjectIds },
      [Op.or]: pairs.map((p) => ({ year_level: p.year_level, section: p.section })),
    },
    attributes: ['id'],
  });

  if (classes.length === 0) return 0;

  await Enrollment.bulkCreate(
    classes.map((c) => ({ class_id: c.id, student_id: student.id })),
    { ignoreDuplicates: true },
  );
  return classes.length;
};

module.exports = { enrollStudentIntoMatchingClasses };
