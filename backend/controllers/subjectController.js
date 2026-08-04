const { Subject, Prerequisite } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/subjects
const getSubjects = asyncHandler(async (req, res) => {
  const { department, semester, search } = req.query;
  const where = {};
  if (department) where.department = department;
  if (semester) where.semester = semester;
  // Faculty accounts are tagged with the `programs` array (a person can teach in more
  // than one program), so scope by membership rather than an exact singular match.
  if (req.user.role === 'Instructor' || req.user.role === 'Chairperson') {
    where.program = { [Op.in]: req.user.programs || [] };
  }
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { code: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const subjects = await Subject.findAll({
    where,
    include: [{ model: Subject, as: 'prerequisites', through: { attributes: [] } }],
    order: [['code', 'ASC']],
  });

  res.json({ subjects });
});

// POST /api/subjects
const createSubject = asyncHandler(async (req, res) => {
  const { code, name, units, department, program, year_level, semester, description, prerequisite_ids } = req.body;

  if ((req.user.role === 'Instructor' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(program)) {
    return res.status(403).json({ message: 'You may only create subjects for a program you teach in.' });
  }

  const subject = await Subject.create({ code, name, units, department, program, year_level, semester, description });

  if (prerequisite_ids && prerequisite_ids.length > 0) {
    const prereqs = prerequisite_ids.map((pid) => ({ subject_id: subject.id, prerequisite_subject_id: pid }));
    await Prerequisite.bulkCreate(prereqs);
  }

  await logActivity(req.user.id, `created subject ${code} - ${name}`, 'Subject', subject.id);
  res.status(201).json({ message: 'Subject created.', subject });
});

// PUT /api/subjects/:id
const updateSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findByPk(req.params.id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });

  if ((req.user.role === 'Instructor' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(subject.program)) {
    return res.status(403).json({ message: 'You may only edit subjects for a program you teach in.' });
  }

  const fields = ['code', 'name', 'units', 'department', 'program', 'year_level', 'semester', 'description'];
  fields.forEach((f) => { if (req.body[f] !== undefined) subject[f] = req.body[f]; });

  if ((req.user.role === 'Instructor' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(subject.program)) {
    return res.status(403).json({ message: 'You may only assign a subject to a program you teach in.' });
  }

  await subject.save();

  if (req.body.prerequisite_ids) {
    await Prerequisite.destroy({ where: { subject_id: subject.id } });
    const prereqs = req.body.prerequisite_ids.map((pid) => ({ subject_id: subject.id, prerequisite_subject_id: pid }));
    await Prerequisite.bulkCreate(prereqs);
  }

  await logActivity(req.user.id, `updated subject ${subject.code}`, 'Subject', subject.id);
  res.json({ message: 'Subject updated.', subject });
});

// DELETE /api/subjects/:id
const deleteSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findByPk(req.params.id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });

  await Prerequisite.destroy({ where: { [Op.or]: [{ subject_id: subject.id }, { prerequisite_subject_id: subject.id }] } });
  await subject.destroy();

  await logActivity(req.user.id, `deleted subject ${subject.code}`, 'Subject', subject.id);
  res.json({ message: 'Subject deleted.' });
});

module.exports = { getSubjects, createSubject, updateSubject, deleteSubject };
