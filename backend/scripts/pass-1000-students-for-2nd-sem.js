/**
 * Clears ~1,000 of the bulk-seeded students (see seed-large-bulk-dataset.js)
 * for 2nd Semester — picks whole (program, year, section) cohorts (not
 * scattered individuals, since verification/approval happen at the class
 * level) until the running total hits ~1,000, then for every class those
 * cohorts are enrolled in this semester:
 *   - Every student's Grade is set/created to Passed (submitted, Admin-
 *     approved) — this is what Promotion Management's "missing required
 *     subject" check needs satisfied for every subject, not just some.
 *   - The Class itself is fully verified + approved + forwarded
 *     (chairperson_verified, class_record_verified, grade_sheet_verified,
 *     admin_class_record_approved, admin_grade_sheet_approved,
 *     sent_to_chairperson) — promotionController.isFullyVerified needs this,
 *     same two-sign-off gate the real release pipeline enforces.
 *
 * After this, running Promote on the current semester in Admin's Promotion
 * Management (Program/Year filters optional) will actually advance these
 * students — semOrder '1st' just clears them for 2nd Semester (no year_level
 * change), matching how promoteStudents itself works.
 *
 * Run: node scripts/pass-1000-students-for-2nd-sem.js
 */
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { User, Class, Subject, Enrollment, Grade, Semester } = require('../models');

const TARGET_STUDENTS = 1000;

async function main() {
  const currentSemester = await Semester.findOne({ where: { is_current: true } });
  if (!currentSemester) { console.log('❌ No current semester set.'); process.exit(1); }
  console.log(`📅 Current semester: ${currentSemester.name}`);

  // ── Pick whole (program, year, section) cohorts until we hit ~1,000 ──────
  const combos = await User.findAll({
    where: { role: 'Student', student_no: { [Op.gte]: '900001' } },
    attributes: ['program', 'year_level', 'section', [sequelize.fn('COUNT', 'id'), 'c']],
    group: ['program', 'year_level', 'section'],
    order: [['program', 'ASC'], ['year_level', 'ASC'], ['section', 'ASC']],
    raw: true,
  });

  const selected = [];
  let running = 0;
  for (const combo of combos) {
    if (running >= TARGET_STUDENTS) break;
    selected.push(combo);
    running += parseInt(combo.c, 10);
  }
  console.log(`🎯 Selected ${selected.length} (program, year, section) cohort(s), ${running} students total:`);
  selected.forEach((c) => console.log(`   ${c.program} · Year ${c.year_level} · Section ${c.section} (${c.c})`));

  const selectedStudents = await User.findAll({
    where: {
      role: 'Student',
      [Op.or]: selected.map((c) => ({ program: c.program, year_level: c.year_level, section: c.section })),
    },
    attributes: ['id', 'program', 'year_level', 'section'],
  });
  const studentIds = selectedStudents.map((s) => s.id);

  // ── Every class those students are enrolled in this semester ────────────
  const enrollments = await Enrollment.findAll({
    where: { student_id: { [Op.in]: studentIds } },
    include: [{
      model: Class,
      as: 'class',
      where: { semester: currentSemester.name },
      required: true,
      include: [{ model: Subject, as: 'subject', attributes: ['id'] }],
    }],
  });
  const classIds = [...new Set(enrollments.map((e) => e.class.id))];
  console.log(`🏫 Covers ${classIds.length} classes this semester.`);

  const now = new Date();

  // ── Fully verify + approve + forward every one of those classes ─────────
  await Class.update({
    chairperson_verified: true, chairperson_verified_at: now,
    class_record_verified: true, class_record_verified_at: now,
    grade_sheet_verified: true, grade_sheet_verified_at: now,
    admin_class_record_approved: true, admin_class_record_approved_at: now,
    admin_grade_sheet_approved: true, admin_grade_sheet_approved_at: now,
    sent_to_chairperson: true,
  }, { where: { id: { [Op.in]: classIds } } });
  console.log(`✅ Verified/approved/forwarded ${classIds.length} classes.`);

  // ── Passed grade for every (student, class) pair — update existing, create missing ──
  const existingGrades = await Grade.findAll({
    where: { student_id: { [Op.in]: studentIds }, class_id: { [Op.in]: classIds } },
  });
  const existingByKey = new Map(existingGrades.map((g) => [`${g.student_id}|${g.class_id}`, g]));

  const toUpdateIds = [];
  const toCreate = [];
  for (const e of enrollments) {
    const key = `${e.student_id}|${e.class.id}`;
    const existing = existingByKey.get(key);
    if (existing) toUpdateIds.push(existing.id);
    else {
      const avg = (Math.random() * 2 + 1).toFixed(2); // 1.00-3.00
      toCreate.push({
        class_id: e.class.id, student_id: e.student_id,
        midterm: avg, finals: avg, average: avg, status: 'Passed',
        submitted: true, submitted_date: now, is_draft: false,
        admin_approved: true, admin_approved_date: now,
      });
    }
  }

  if (toUpdateIds.length > 0) {
    // Bulk .update() bypasses Grade's beforeSave hook — set every field it
    // would have computed (average/status) explicitly, same values the hook
    // itself would derive from the passing midterm/finals here.
    await Grade.update({
      midterm: 2.0, finals: 2.0, average: 2.0, status: 'Passed',
      submitted: true, submitted_date: now, is_draft: false,
      admin_approved: true, admin_approved_date: now,
    }, { where: { id: { [Op.in]: toUpdateIds } } });
  }
  if (toCreate.length > 0) {
    await Grade.bulkCreate(toCreate, { validate: true });
  }
  console.log(`✅ Updated ${toUpdateIds.length} existing grade(s), created ${toCreate.length} new one(s) — all Passed.`);

  console.log(`\n🎉 Done. ${studentIds.length} students are now fully Passed and verified for ${currentSemester.name}.`);
  console.log('   Run Promote in Admin > Promotion Management (Evaluate this semester first) to clear them for 2nd Semester.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
