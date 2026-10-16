const { Op } = require('sequelize');
const bcrypt = require('./bcrypt');
const { sequelize } = require('../config/database');
const { User } = require('../models');
const { nameKey } = require('./nameMatch');

// ── Bulk student accounts from an imported class list ───────────────────────
// Used by classController.importClassList — a Faculty member imports the
// class list of a class they teach; every student on it ends up with an
// account (created here when new) and is then enrolled in that class.
// Built for volume:
//   - the default password is hashed ONCE per call, not per student (bcrypt
//     is deliberately slow — ~0.1s per hash). Every new student gets the same
//     default and must replace it at first login (accountSetupController);
//   - existing accounts (by Student ID Number) are found with one query;
//   - new rows are inserted IMPORT_BATCH at a time; if a batch is rejected,
//     it's retried row by row so one bad row can't sink the others.
// A Student ID Number that already belongs to a STUDENT isn't an error — that
// student simply goes on the class list (`existing`). One that belongs to a
// staff account, or an email already in use, is.

const DEFAULT_STUDENT_PASSWORD = '12345678';
const IMPORT_BATCH = 500;

// createNew: false — existing accounts only (a faculty's class list): a
// Student ID with no account is skipped, never created. Accounts are created
// by the section's ADVISER importing their class list.
async function upsertImportedStudents(rawStudents, { rowOffset = 0, createdBy = null, createNew = true } = {}) {
  const batchNos = rawStudents.map((s) => String(s.student_no || '').trim()).filter(Boolean);
  const batchEmails = rawStudents.map((s) => (s.email ? String(s.email).trim().toLowerCase() : '')).filter(Boolean);
  const found = batchNos.length || batchEmails.length ? await User.findAll({
    where: {
      [Op.or]: [
        ...(batchNos.length ? [{ student_no: { [Op.in]: batchNos } }] : []),
        ...(batchEmails.length ? [{ email: { [Op.in]: batchEmails } }] : []),
      ],
    },
    attributes: ['id', 'name', 'student_no', 'email', 'role', 'program', 'year_level', 'section', 'graduated_at'],
  }) : [];
  const byNo = new Map(found.filter((u) => u.student_no).map((u) => [u.student_no.trim(), u]));
  const takenEmails = new Set(found.map((u) => u.email?.trim().toLowerCase()).filter(Boolean));

  const toCreate = [];
  const existing = [];
  const skipped = [];
  const errors = [];
  const seenNos = new Set();

  rawStudents.forEach((raw, idx) => {
    const row = rowOffset + idx + 1;
    const student_no = String(raw.student_no || '').trim();
    const name = String(raw.name || '').trim().replace(/\s+/g, ' ');
    const program = String(raw.program || '').trim();

    if (!student_no) return errors.push({ row, student_no: '—', name: name || 'Unnamed', error: 'Student ID Number is required' });
    if (seenNos.has(student_no)) return skipped.push({ row, student_no, name, reason: `Student ID Number ${student_no} appears twice in this list` });
    seenNos.add(student_no);

    const acct = byNo.get(student_no);
    if (acct) {
      if (acct.role !== 'Student') return errors.push({ row, student_no, name, error: `Student ID Number ${student_no} belongs to a ${acct.role} account` });
      // An existing Student ID is simply that student — imported as is, even
      // if the name on the list is spelled differently from the account's.
      return existing.push({ row, user: acct });
    }
    if (!createNew) {
      return skipped.push({ row, student_no, name: name || '—', reason: 'No account yet — the adviser must import this student in their advisory class list first' });
    }
    if (!name) return errors.push({ row, student_no, name: 'Unnamed', error: 'Student Full Name is required' });
    if (!program) return errors.push({ row, student_no, name, error: 'Program is required' });

    const email = raw.email && String(raw.email).trim() ? String(raw.email).trim().toLowerCase() : null;
    if (email && takenEmails.has(email)) return skipped.push({ row, student_no, name, reason: `Email address ${email} already exists on another account` });
    if (email) takenEmails.add(email);

    const year = parseInt(raw.year_level, 10);
    toCreate.push({
      row,
      confirmed: !!raw.confirmed,
      data: {
        name,
        email,
        username: null,
        role: 'Student',
        program,
        student_no,
        year_level: year >= 1 && year <= 6 ? year : 1,
        section: raw.section ? String(raw.section).trim().toUpperCase().slice(0, 10) : null,
        student_status: raw.student_status === 'Irregular' ? 'Irregular' : 'Regular',
        student_type: raw.student_type ? String(raw.student_type).trim() : 'New',
        department: 'College of Arts and Sciences',
        created_by: createdBy,
        status: 'Active',
        avatar: name.charAt(0).toUpperCase(),
      },
    });
  });

  // A NEW Student ID whose name already belongs to a student under another
  // ID is most likely that student with a mistyped ID — creating it would
  // leave a stray duplicate account. Held back unless the row is confirmed
  // (genuinely two students with the same name).
  if (toCreate.some((c) => !c.confirmed)) {
    const byKey = new Map();
    (await User.findAll({ where: { role: 'Student' }, attributes: ['name', 'student_no'], raw: true }))
      .forEach((u) => { const k = nameKey(u.name); if (k) (byKey.get(k) || byKey.set(k, []).get(k)).push(u); });
    for (let i = toCreate.length - 1; i >= 0; i -= 1) {
      const c = toCreate[i];
      if (c.confirmed) continue;
      const twin = (byKey.get(nameKey(c.data.name)) || []).find((u) => u.student_no !== c.data.student_no);
      if (twin) {
        skipped.push({ row: c.row, student_no: c.data.student_no, name: c.data.name, reason: `${twin.name} already has an account under Student ID Number ${twin.student_no} — check the ID, or confirm the row if it's a different student` });
        toCreate.splice(i, 1);
      }
    }
  }

  const created = [];
  if (toCreate.length > 0) {
    // Each new student follows the curriculum of their own batch.
    const { curriculumForNewStudent } = require('./studentCurriculum');
    const curriculumCache = new Map();
    for (const c of toCreate) c.data.curriculum_year = await curriculumForNewStudent(c.data.program, c.data.year_level, curriculumCache);
    const passwordHash = await bcrypt.hash(DEFAULT_STUDENT_PASSWORD, await bcrypt.genSalt(10));
    const withPassword = (d) => ({ ...d, password: passwordHash });
    for (let i = 0; i < toCreate.length; i += IMPORT_BATCH) {
      const chunk = toCreate.slice(i, i + IMPORT_BATCH);
      try {
        // hooks: false — the model's beforeCreate would re-hash the already-
        // hashed password (and set the avatar, done above instead).
        const rows = await sequelize.transaction((t) => User.bulkCreate(chunk.map((c) => withPassword(c.data)), { hooks: false, validate: true, transaction: t }));
        created.push(...rows);
      } catch (batchErr) {
        for (const c of chunk) {
          try {
            created.push(await User.create(withPassword(c.data), { hooks: false }));
          } catch (err) {
            errors.push({ row: c.row, student_no: c.data.student_no, name: c.data.name, error: err.errors?.[0]?.message || err.message || 'Database error creating student' });
          }
        }
      }
    }
  }

  errors.sort((a, b) => a.row - b.row);
  skipped.sort((a, b) => (a.row || 0) - (b.row || 0));
  return { created, existing: existing.map((e) => e.user), skipped, errors };
}

module.exports = { upsertImportedStudents, DEFAULT_STUDENT_PASSWORD };
