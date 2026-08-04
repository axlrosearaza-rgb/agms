const { Semester } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/semesters
const getSemesters = asyncHandler(async (req, res) => {
  const { status, academic_year } = req.query;
  const where = {};
  if (status) where.status = status;
  if (academic_year) where.academic_year = academic_year;

  const semesters = await Semester.findAll({
    where,
    order: [['academic_year', 'DESC'], ['term', 'ASC']],
  });

  res.json({ semesters });
});

// GET /api/semesters/current
const getCurrentSemester = asyncHandler(async (req, res) => {
  const current = await Semester.findOne({ where: { is_current: true } });
  res.json({ semester: current });
});

// POST /api/semesters
const createSemester = asyncHandler(async (req, res) => {
  const { term, academic_year, start_date, end_date, is_current, status } = req.body;

  if (!term || !academic_year) {
    return res.status(400).json({ message: 'Term and academic year are required.' });
  }

  const name = `${term} ${academic_year}`;

  const existing = await Semester.findOne({ where: { name } });
  if (existing) {
    return res.status(409).json({ message: 'This semester already exists.' });
  }

  // If marking as current, unset all others
  if (is_current) {
    await Semester.update({ is_current: false }, { where: { is_current: true } });
  }

  const semester = await Semester.create({
    name,
    term,
    academic_year,
    start_date: start_date || null,
    end_date: end_date || null,
    is_current: is_current || false,
    status: status || 'Upcoming',
  });

  await logActivity(req.user.id, `created semester ${name}`, 'Semester', semester.id);
  res.status(201).json({ message: 'Semester created successfully.', semester });
});

// PUT /api/semesters/:id
const updateSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });

  const { term, academic_year, start_date, end_date, is_current, status } = req.body;

  if (term !== undefined) semester.term = term;
  if (academic_year !== undefined) semester.academic_year = academic_year;
  if (term || academic_year) {
    semester.name = `${semester.term} ${semester.academic_year}`;
  }
  if (start_date !== undefined) semester.start_date = start_date;
  if (end_date !== undefined) semester.end_date = end_date;
  if (status !== undefined) semester.status = status;

  if (is_current) {
    await Semester.update({ is_current: false }, { where: { is_current: true } });
    semester.is_current = true;
  } else if (is_current === false) {
    semester.is_current = false;
  }

  await semester.save();
  await logActivity(req.user.id, `updated semester ${semester.name}`, 'Semester', semester.id);
  res.json({ message: 'Semester updated successfully.', semester });
});

// DELETE /api/semesters/:id
const deleteSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });

  if (semester.is_current) {
    return res.status(400).json({ message: 'Cannot delete the current semester.' });
  }

  await semester.destroy();
  await logActivity(req.user.id, `deleted semester ${semester.name}`, 'Semester', semester.id);
  res.json({ message: 'Semester deleted successfully.' });
});

// PUT /api/semesters/:id/set-current
const setCurrentSemester = asyncHandler(async (req, res) => {
  await Semester.update({ is_current: false }, { where: { is_current: true } });

  const semester = await Semester.findByPk(req.params.id);
  if (!semester) return res.status(404).json({ message: 'Semester not found.' });

  semester.is_current = true;
  semester.status = 'Active';
  await semester.save();

  await logActivity(req.user.id, `set ${semester.name} as current semester`, 'Semester', semester.id);
  res.json({ message: `${semester.name} is now the current semester.`, semester });
});

module.exports = { getSemesters, getCurrentSemester, createSemester, updateSemester, deleteSemester, setCurrentSemester };