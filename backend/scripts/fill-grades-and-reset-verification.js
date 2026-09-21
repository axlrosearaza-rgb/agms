/**
 * 1. Gives every grade record real input — fills in midterm/finals for any
 *    still-blank (Pending) or half-blank (INC) grade, and creates a Grade
 *    row for any enrollment that's missing one entirely. Letting the
 *    Grade model's own beforeSave hook compute average/status from those
 *    values (not duplicating that math here) so it stays consistent with
 *    how the app computes it everywhere else.
 * 2. Resets the whole approval pipeline back to "nothing verified/approved/
 *    released yet" — every class's chairperson_verified/class_record_verified/
 *    grade_sheet_verified flags, and every grade's admin_approved/released
 *    flags — so Grade Approval's containers reflect a fresh, real pipeline
 *    instead of a mix left over from however this data was originally seeded.
 *
 * Run: node scripts/fill-grades-and-reset-verification.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Grade, Enrollment, Class } = require('../models');

// Realistic academic spread — mostly passing (1.00-3.00), a minority failing
// (3.25-5.00), matching the proportion already present in this dataset.
function randomScore() {
  const passing = Math.random() < 0.82;
  return passing
    ? Math.round((1 + Math.random() * 2) * 100) / 100   // 1.00–3.00
    : Math.round((3.25 + Math.random() * 1.75) * 100) / 100; // 3.25–5.00
}

async function main() {
  // ── 1a. Fill in blank/half-blank grades ──────────────────────────────
  const incomplete = await Grade.findAll({ where: { status: { [Op.in]: ['Pending', 'INC'] } } });
  console.log(`Filling input for ${incomplete.length} incomplete grade(s)...`);
  let filled = 0;
  for (const g of incomplete) {
    if (g.midterm === null) g.midterm = randomScore();
    if (g.finals === null) g.finals = randomScore();
    g.status = 'Pending'; // clears INC/DRP so the beforeSave hook actually recomputes average+status
    g.submitted = true;
    g.submitted_date = g.submitted_date || new Date();
    await g.save();
    filled++;
    if (filled % 200 === 0) console.log(`  ...${filled}/${incomplete.length}`);
  }
  console.log(`✅ Filled ${filled} grade(s).`);

  // ── 1b. Create a Grade row for any enrollment that's missing one ─────
  const enrollments = await Enrollment.findAll({ attributes: ['class_id', 'student_id'] });
  const existingGrades = await Grade.findAll({ attributes: ['class_id', 'student_id'] });
  const existingKeys = new Set(existingGrades.map((g) => `${g.class_id}|${g.student_id}`));
  const missing = enrollments.filter((e) => !existingKeys.has(`${e.class_id}|${e.student_id}`));
  console.log(`Creating ${missing.length} missing grade record(s)...`);
  let created = 0;
  for (const e of missing) {
    const g = await Grade.create({
      class_id: e.class_id,
      student_id: e.student_id,
      midterm: randomScore(),
      finals: randomScore(),
      status: 'Pending',
      submitted: true,
      submitted_date: new Date(),
    });
    // beforeSave already ran on create; nothing else needed.
    created++;
    if (created % 200 === 0) console.log(`  ...${created}/${missing.length}`);
    void g;
  }
  console.log(`✅ Created ${created} grade record(s).`);

  // ── 2. Reset the whole verification/approval/release pipeline ────────
  console.log('Resetting Class verification flags...');
  const [classCount] = await Class.update(
    {
      chairperson_verified: false,
      chairperson_verified_at: null,
      class_record_verified: false,
      class_record_verified_at: null,
      grade_sheet_verified: false,
      grade_sheet_verified_at: null,
    },
    { where: {} }
  );
  console.log(`✅ Reset ${classCount} class(es).`);

  console.log('Resetting Grade approval/release flags...');
  const [gradeCount] = await Grade.update(
    { admin_approved: false, admin_approved_date: null, released: false, released_date: null },
    { where: {} }
  );
  console.log(`✅ Reset ${gradeCount} grade(s).`);

  const totalGrades = await Grade.count();
  const withMidterm = await Grade.count({ where: { midterm: { [Op.ne]: null } } });
  const withFinals = await Grade.count({ where: { finals: { [Op.ne]: null } } });
  const verifiedClasses = await Class.count({ where: { chairperson_verified: true } });
  console.log(`\nFinal check: ${withMidterm}/${totalGrades} have midterm, ${withFinals}/${totalGrades} have finals, ${verifiedClasses} classes still verified (should be 0).`);

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
