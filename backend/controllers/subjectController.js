const { Subject, Prerequisite, CoRequisite, Class } = require('../models');
const { Op } = require('sequelize');
const { logActivity } = require('../utils/activityLogger');
const { asyncHandler } = require('../middleware/errorHandler');

// `units` (Total Units) and `total_hours` (Total Hours) are NOT derived from the
// Lecture/Lab breakdown here — some subjects (Practicum, Thesis, OJT) legitimately
// have no Lecture/Lab split at all, just a standalone Total (e.g. "486 Hrs / 6
// Units" with both halves blank). The frontend offers a "Compute from Lecture +
// Lab" convenience button, but whatever Total value it sends is trusted as-is.

// GET /api/subjects
const getSubjects = asyncHandler(async (req, res) => {
  const { department, semester, search, all, program, archived } = req.query;
  // Archived subjects are left out unless asked for: ?archived=only lists
  // just them (the Subjects page's Archived section).
  const where = archived === 'only' ? { archived_at: { [Op.ne]: null } } : { archived_at: null };
  if (department) where.department = department;
  if (semester) where.semester = semester;
  // Explicit filter — used by e.g. the Student dashboard's regularization
  // subject picker, which isn't a Faculty/Chairperson account so the
  // auto-scoping below doesn't apply to it.
  if (program) where.program = program;
  // Faculty accounts are tagged with the `programs` array (a person can teach in more
  // than one program), so scope by membership rather than an exact singular match.
  // `?all=true` opts out of that scoping — used by the "Create Class" subject
  // picker, so a Faculty/Chairperson can pick up a class in another program
  // (cross-program teaching) instead of only ever seeing their own curriculum.
  // The Subjects page itself never passes this, so browsing "my curriculum"
  // stays scoped exactly as before.
  if ((req.user.role === 'Faculty' || req.user.role === 'Chairperson') && all !== 'true') {
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
    include: [
      { model: Subject, as: 'prerequisites', through: { attributes: [] } },
      { model: Subject, as: 'co_requisites', through: { attributes: [] } },
    ],
    // Pre-sorted in curriculum order (Year -> Semester -> Code) so any consumer
    // that doesn't re-group client-side still gets a sensible sequence.
    order: [['year_level', 'ASC'], ['semester', 'ASC'], ['code', 'ASC']],
  });

  res.json({ subjects });
});

// POST /api/subjects
// "2023", or a range like "2023-2024".
const CURRICULUM_YEAR_RE = /^\d{4}(-\d{4})?$/;
const cleanCurriculumYear = (v) => (v === undefined ? undefined : (String(v || '').trim() || null));

const createSubject = asyncHandler(async (req, res) => {
  const { code, name, department, program, year_level, semester, description, prerequisite_ids, co_requisite_ids, lecture_hours, lecture_units, lab_hours, lab_units, total_hours, units, prerequisite_note, grading_scheme } = req.body;
  const curriculum_year = cleanCurriculumYear(req.body.curriculum_year);
  if (curriculum_year && !CURRICULUM_YEAR_RE.test(curriculum_year)) {
    return res.status(400).json({ message: 'Curriculum year should look like 2023 (or 2023-2024).' });
  }

  if ((req.user.role === 'Faculty' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(program)) {
    return res.status(403).json({ message: 'You may only create subjects for a program you teach in.' });
  }

  const subject_type = req.body.subject_type === 'Minor' ? 'Minor' : 'Major';
  const subject = await Subject.create({
    code, name, department, program, year_level, semester, description, curriculum_year, subject_type,
    lecture_hours, lecture_units, lab_hours, lab_units, total_hours, units, prerequisite_note, grading_scheme,
  });

  if (prerequisite_ids && prerequisite_ids.length > 0) {
    const prereqs = prerequisite_ids.map((pid) => ({ subject_id: subject.id, prerequisite_subject_id: pid }));
    await Prerequisite.bulkCreate(prereqs);
  }
  if (co_requisite_ids && co_requisite_ids.length > 0) {
    const coreqs = co_requisite_ids.map((cid) => ({ subject_id: subject.id, co_requisite_subject_id: cid }));
    await CoRequisite.bulkCreate(coreqs);
  }

  await logActivity(req.user.id, `created subject ${code} - ${name}`, 'Subject', subject.id);
  res.status(201).json({ message: 'Subject created.', subject });
});

// PUT /api/subjects/:id
const updateSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findByPk(req.params.id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });

  if ((req.user.role === 'Faculty' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(subject.program)) {
    return res.status(403).json({ message: 'You may only edit subjects for a program you teach in.' });
  }

  if (req.body.curriculum_year !== undefined) {
    const cy = cleanCurriculumYear(req.body.curriculum_year);
    if (cy && !CURRICULUM_YEAR_RE.test(cy)) {
      return res.status(400).json({ message: 'Curriculum year should look like 2023 (or 2023-2024).' });
    }
    req.body.curriculum_year = cy;
  }
  if (req.body.subject_type !== undefined) req.body.subject_type = req.body.subject_type === 'Minor' ? 'Minor' : 'Major';
  const fields = ['code', 'name', 'department', 'program', 'year_level', 'semester', 'description', 'curriculum_year', 'subject_type', 'lecture_hours', 'lecture_units', 'lab_hours', 'lab_units', 'total_hours', 'units', 'prerequisite_note', 'grading_scheme'];
  fields.forEach((f) => { if (req.body[f] !== undefined) subject[f] = req.body[f]; });

  if ((req.user.role === 'Faculty' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(subject.program)) {
    return res.status(403).json({ message: 'You may only assign a subject to a program you teach in.' });
  }

  await subject.save();

  if (req.body.prerequisite_ids) {
    await Prerequisite.destroy({ where: { subject_id: subject.id } });
    const prereqs = req.body.prerequisite_ids.map((pid) => ({ subject_id: subject.id, prerequisite_subject_id: pid }));
    await Prerequisite.bulkCreate(prereqs);
  }
  if (req.body.co_requisite_ids) {
    await CoRequisite.destroy({ where: { subject_id: subject.id } });
    const coreqs = req.body.co_requisite_ids.map((cid) => ({ subject_id: subject.id, co_requisite_subject_id: cid }));
    await CoRequisite.bulkCreate(coreqs);
  }

  await logActivity(req.user.id, `updated subject ${subject.code}`, 'Subject', subject.id);
  res.json({ message: 'Subject updated.', subject });
});

// PUT /api/subjects/:id/archive  { archived: boolean }
// Subjects are never deleted. An archived subject leaves the Subjects list
// and the Create Class picker; classes, grades and prospectuses that already
// use it keep it. Restoring ({ archived: false }) brings it back.
const archiveSubject = asyncHandler(async (req, res) => {
  const subject = await Subject.findByPk(req.params.id);
  if (!subject) return res.status(404).json({ message: 'Subject not found.' });

  if ((req.user.role === 'Faculty' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(subject.program)) {
    return res.status(403).json({ message: 'You may only archive subjects for a program you teach in.' });
  }

  const archived = req.body.archived !== false;
  if (archived) {
    const running = await Class.count({ where: { subject_id: subject.id, status: 'Active' } });
    if (running > 0) {
      return res.status(400).json({ message: `${subject.code} is still used by ${running} active class(es) — archive it once those classes are done.` });
    }
  }
  subject.archived_at = archived ? new Date() : null;
  await subject.save();

  await logActivity(req.user.id, `${archived ? 'archived' : 'restored'} subject ${subject.code}`, 'Subject', subject.id);
  res.json({ message: archived ? `${subject.code} archived.` : `${subject.code} restored.`, subject });
});

module.exports = { getSubjects, createSubject, updateSubject, archiveSubject };
