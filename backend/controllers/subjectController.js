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

// A course code is unique within one program's curriculum (another curriculum
// may reuse it). Returns the subject already holding it, if any.
const sameCodeIn = (code, program, curriculumYear, exceptId = null) => Subject.findOne({
  where: { code: String(code || '').trim(), program: program || null, curriculum_year: curriculumYear || null, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) },
  attributes: ['id', 'code', 'curriculum_year', 'archived_at'],
});
const duplicateMessage = (s) => `${s.code} is already in this program's ${s.curriculum_year ? `${s.curriculum_year} curriculum` : 'subjects with no curriculum set'}${s.archived_at ? ' (archived — restore it instead)' : ''}.`;

const createSubject = asyncHandler(async (req, res) => {
  const { code, name, department, program, year_level, semester, description, prerequisite_ids, co_requisite_ids, lecture_hours, lecture_units, lab_hours, lab_units, total_hours, units, prerequisite_note, grading_scheme } = req.body;
  const curriculum_year = cleanCurriculumYear(req.body.curriculum_year);
  if (curriculum_year && !CURRICULUM_YEAR_RE.test(curriculum_year)) {
    return res.status(400).json({ message: 'Curriculum year should look like 2023 (or 2023-2024).' });
  }

  if ((req.user.role === 'Faculty' || req.user.role === 'Chairperson') && !(req.user.programs || []).includes(program)) {
    return res.status(403).json({ message: 'You may only create subjects for a program you teach in.' });
  }

  const taken = await sameCodeIn(code, program, curriculum_year);
  if (taken) return res.status(409).json({ message: duplicateMessage(taken) });

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

  const taken = await sameCodeIn(subject.code, subject.program, subject.curriculum_year, subject.id);
  if (taken) return res.status(409).json({ message: duplicateMessage(taken) });

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

// ── Import a curriculum ──────────────────────────────────────────────────────
// POST /api/subjects/import  { curriculum_year, subjects: [...] }  (Admin)
// Every row lands in the given curriculum year. A row whose code is already in
// that program's curriculum updates that subject (and restores it if it was
// archived); any other row is added. Pre- and co-requisites are given as
// course codes and matched inside the same program and curriculum.
const PROGRAM_DEPARTMENT = {
  'Bachelor of Science in Information Technology': 'Information Technology',
  'Bachelor of Science in Information Systems': 'Information Systems',
  'Bachelor of Science in Psychology': 'Psychology',
  'Bachelor of Science in Statistics': 'Statistics',
};
const SEMESTER_NAMES = ['1st Semester', '2nd Semester', 'Summer'];
const intOrNull = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const codesOf = (v) => (Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/)).map((c) => String(c).trim()).filter(Boolean);

const importSubjects = asyncHandler(async (req, res) => {
  const curriculumYear = cleanCurriculumYear(req.body.curriculum_year);
  if (!curriculumYear || !CURRICULUM_YEAR_RE.test(curriculumYear)) {
    return res.status(400).json({ message: 'Enter the curriculum year, like 2023 (or 2023-2024).' });
  }
  const rows = Array.isArray(req.body.subjects) ? req.body.subjects : [];
  if (rows.length === 0) return res.status(400).json({ message: 'No subjects to import.' });
  if (rows.length > 1000) return res.status(413).json({ message: 'Import at most 1000 subjects at a time.' });

  // Check every row first — nothing is saved unless the whole file is good.
  const errors = [];
  const seen = new Set();
  const clean = rows.map((r, i) => {
    const row = i + 1;
    const code = String(r.code || '').trim();
    const name = String(r.name || '').trim();
    const program = String(r.program || '').trim();
    const units = intOrNull(r.units);
    const yearLevel = intOrNull(r.year_level);
    const semester = SEMESTER_NAMES.includes(r.semester) ? r.semester : null;
    if (!code) errors.push({ row, message: 'Course Code is missing.' });
    if (!name) errors.push({ row, message: 'Course Description is missing.' });
    if (!PROGRAM_DEPARTMENT[program]) errors.push({ row, message: `Program "${program || '(blank)'}" is not one of the four programs.` });
    if (!(yearLevel >= 1 && yearLevel <= 4)) errors.push({ row, message: 'Year Level must be 1 to 4.' });
    if (!semester) errors.push({ row, message: 'Semester must be 1st Semester, 2nd Semester or Summer.' });
    if (!(units >= 1 && units <= 6)) errors.push({ row, message: 'Total Units must be 1 to 6.' });
    const key = `${program}|${code.toLowerCase()}`;
    if (code && seen.has(key)) errors.push({ row, message: `${code} appears more than once for this program.` });
    seen.add(key);
    return {
      code, name, program, department: PROGRAM_DEPARTMENT[program], year_level: yearLevel, semester, units,
      subject_type: r.subject_type === 'Minor' ? 'Minor' : 'Major',
      lecture_hours: intOrNull(r.lecture_hours) ?? 0, lecture_units: intOrNull(r.lecture_units) ?? 0,
      lab_hours: intOrNull(r.lab_hours) ?? 0, lab_units: intOrNull(r.lab_units) ?? 0,
      total_hours: intOrNull(r.total_hours),
      prerequisite_note: String(r.prerequisite_note || '').trim() || null,
      prereqCodes: codesOf(r.prerequisites), coreqCodes: codesOf(r.co_requisites),
    };
  });
  if (errors.length) {
    return res.status(400).json({ message: `${errors.length} problem(s) in the file — nothing was imported.`, errors: errors.slice(0, 50) });
  }

  const { curriculaOf, applyNewCurriculum } = require('../utils/studentCurriculum');
  const programsInFile = [...new Set(clean.map((c) => c.program))];
  // Programs for which this curriculum year did not exist before this import.
  const newFor = [];
  for (const p of programsInFile) if (!(await curriculaOf(p)).includes(curriculumYear)) newFor.push(p);

  const { sequelize } = require('../config/database');
  const t = await sequelize.transaction();
  let created = 0; let updated = 0; const warnings = [];
  try {
    const saved = [];
    for (const c of clean) {
      const { prereqCodes, coreqCodes, ...fields } = c;
      // Same code written with different spacing ("CC 101" / "CC101") is the same subject.
      const sameSquash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const existing = (await Subject.findAll({ where: { program: c.program, curriculum_year: curriculumYear }, transaction: t })).find((s) => sameSquash(s.code) === sameSquash(c.code));
      if (existing) {
        await existing.update({ ...fields, archived_at: null }, { transaction: t });
        updated += 1; saved.push({ subject: existing, prereqCodes, coreqCodes });
      } else {
        const subject = await Subject.create({ ...fields, curriculum_year: curriculumYear }, { transaction: t });
        created += 1; saved.push({ subject, prereqCodes, coreqCodes });
      }
    }
    // Requisites, now that every subject of this curriculum exists.
    const inCurriculum = await Subject.findAll({ where: { curriculum_year: curriculumYear, program: { [Op.in]: [...new Set(clean.map((c) => c.program))] } }, attributes: ['id', 'code', 'program'], transaction: t });
    // Codes are compared without spaces or punctuation ("CC 101" = "CC101"),
    // and a short form is accepted when exactly one code starts with it
    // ("PE1" for "PE 1 (PATH Fit 1)").
    const squash = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const findId = (program, code) => {
      const mine = inCurriculum.filter((s) => s.program === program);
      const exact = mine.find((s) => squash(s.code) === squash(code));
      if (exact) return exact.id;
      const starts = mine.filter((s) => squash(code).length >= 3 && squash(s.code).startsWith(squash(code)));
      return starts.length === 1 ? starts[0].id : null;
    };
    for (const { subject, prereqCodes, coreqCodes } of saved) {
      const unmatched = [];
      const resolve = (codes, kind) => codes.map((code) => {
        const id = findId(subject.program, code);
        if (!id) { unmatched.push(code); warnings.push(`${subject.code}: ${kind} "${code}" did not match a course code in this curriculum — kept as a note on the subject.`); }
        return id;
      }).filter((id) => id && id !== subject.id);
      const pre = [...new Set(resolve(prereqCodes, 'pre-requisite'))];
      const co = [...new Set(resolve(coreqCodes, 'co-requisite'))];
      // Whatever could not be linked still shows on the subject, as its note.
      if (unmatched.length) await subject.update({ prerequisite_note: unmatched.join(', ') }, { transaction: t });
      await Prerequisite.destroy({ where: { subject_id: subject.id }, transaction: t });
      await CoRequisite.destroy({ where: { subject_id: subject.id }, transaction: t });
      if (pre.length) await Prerequisite.bulkCreate(pre.map((pid) => ({ subject_id: subject.id, prerequisite_subject_id: pid })), { transaction: t });
      if (co.length) await CoRequisite.bulkCreate(co.map((cid) => ({ subject_id: subject.id, co_requisite_subject_id: cid })), { transaction: t });
    }
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  // A new curriculum applies to the incoming batch only: students in 1st year,
  // 1st semester with no grades yet. Everyone else keeps their own curriculum.
  const moved = newFor.length ? await applyNewCurriculum(newFor, curriculumYear) : 0;
  await logActivity(req.user.id, `imported the ${curriculumYear} curriculum: ${created} subject(s) added, ${updated} updated${moved ? `, ${moved} first-year student(s) moved to it` : ''}`, 'Subject', null);
  res.status(201).json({
    message: `${curriculumYear} Curriculum: ${created} subject(s) added, ${updated} updated.${newFor.length ? ` ${moved} first-year student(s) now follow it; students in higher years keep their own curriculum.` : ''}`,
    created, updated, students_moved: moved, warnings: warnings.slice(0, 50),
  });
});

// PUT /api/subjects/curriculum/archive  { program, curriculum_year, archived }  (Admin)
// Archives (or restores) every subject of one program's curriculum at once.
// Nothing is deleted: classes, grades and prospectuses that use them keep them.
const archiveCurriculum = asyncHandler(async (req, res) => {
  const program = String(req.body.program || '').trim();
  const curriculumYear = cleanCurriculumYear(req.body.curriculum_year) || null;
  const archived = req.body.archived !== false;
  if (!program) return res.status(400).json({ message: 'Choose the program.' });

  const subjects = await Subject.findAll({
    where: { program, curriculum_year: curriculumYear, archived_at: archived ? null : { [Op.ne]: null } },
    attributes: ['id', 'code'],
  });
  const label = curriculumYear ? `${curriculumYear} Curriculum` : 'subjects with no curriculum set';
  if (subjects.length === 0) return res.status(404).json({ message: `Nothing to ${archived ? 'archive' : 'restore'} in the ${label} of that program.` });

  const ids = subjects.map((s) => s.id);
  if (archived) {
    const running = await Class.count({ where: { subject_id: { [Op.in]: ids }, status: 'Active' } });
    if (running > 0) {
      return res.status(400).json({ message: `${running} active class(es) still use subjects of this curriculum — archive it once those classes are done.` });
    }
  }
  await Subject.update({ archived_at: archived ? new Date() : null }, { where: { id: { [Op.in]: ids } } });
  await logActivity(req.user.id, `${archived ? 'archived' : 'restored'} the ${label} of ${program} (${ids.length} subject(s))`, 'Subject', null);
  res.json({ message: `${label}: ${ids.length} subject(s) ${archived ? 'archived' : 'restored'}.`, count: ids.length });
});

module.exports = { getSubjects, createSubject, updateSubject, archiveSubject, importSubjects, archiveCurriculum };
