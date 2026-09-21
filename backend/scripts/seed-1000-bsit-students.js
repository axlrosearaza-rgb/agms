/**
 * 1,000 BSIT-only demo students, spread evenly across every Year (1-4) and
 * Section (A-H), each enrolled into this semester's real classes with actual
 * Class Record input (GradeComponents + ComponentItems + per-student
 * ComponentScores) that's gone all the way through the pipeline — submitted,
 * Chairperson-verified, Admin-approved, and released to students.
 *
 * The point of this dataset specifically: a realistic mix of outcomes.
 * ~65% pass everything, ~20% fail at least one subject, ~15% still mid-
 * encoding (no grade yet). Whoever ends up with a real Failed grade this run
 * is marked Irregular — NOT blocked from continuing (this app's promotion
 * pipeline already treats "failed something" and "can't advance" as two
 * separate questions; failing a subject flags Irregular alongside normal
 * progress, it doesn't halt it) — and is left exactly where the real
 * self-service flow expects them: `regularization_subjects` is NOT
 * pre-filled here. They (or anyone reading their own dashboard) use the
 * actual "Path to Regular Status" panel to pick their own failed subject(s)
 * to clear, same as any genuine Irregular student would. Passing that
 * subject later and having the grade released flips them back to Regular
 * automatically (gradeController.checkAndRegularizeStudent) — nothing here
 * short-circuits that real mechanism, this just seeds realistic starting data
 * for it to operate on.
 *
 * Tagged for easy removal, same idiom as seed-large-bulk-dataset.js:
 *   - Users:   student_no >= '940001'
 *   - Classes: schedule = '[BSIT 1000 SEED]'
 *   - Enrollments/Grades/GradeComponents/ComponentItems/ComponentScores:
 *     cascade-deleted by removing the Classes/Users above.
 *
 * Run: node scripts/seed-1000-bsit-students.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  User, Subject, Class, Enrollment, Grade, Semester,
  GradeComponent, ComponentItem, ComponentScore,
} = require('../models');

const PROGRAM = 'Bachelor of Science in Information Technology';
const TARGET_TOTAL = 1000;
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const STUDENT_NO_START = 940001;
const SCHEDULE_TAG = '[BSIT 1000 SEED]';
const CHUNK = 5000; // rows per bulkCreate call — stays well under Postgres' param limit

const FIRST_NAMES = [
  'Miguel', 'Sofia', 'Gabriel', 'Isabella', 'Rafael', 'Andrea', 'Diego', 'Camille',
  'Joaquin', 'Marielle', 'Nathaniel', 'Kristine', 'Xavier', 'Angelica', 'Emmanuel',
  'Danica', 'Vincent', 'Patricia', 'Adrian', 'Cassandra', 'Julian', 'Rhea',
  'Sebastian', 'Nicole', 'Lorenzo', 'Bianca', 'Matthias', 'Erika', 'Francis', 'Jamie',
  'Renzo', 'Alyssa', 'Marco', 'Kimberly', 'Enrique', 'Gwyneth', 'Leandro', 'Reign',
  'Carlos', 'Denise', 'Josef', 'Aliyah', 'Timothy', 'Precious', 'Aaron', 'Faith',
  'Christian', 'Hannah', 'Justin', 'Mikaela',
];
const LAST_NAMES = [
  'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres',
  'Flores', 'Ramos', 'Villanueva', 'Castillo', 'Rivera', 'Aquino', 'Salazar',
  'Del Rosario', 'Fernandez', 'Gonzales', 'Pascual', 'Navarro', 'Domingo', 'Manalo',
  'Tolentino', 'Bernardo', 'Marquez', 'Valdez', 'Ignacio', 'Padilla', 'Rosales', 'Uy',
  'Lim', 'Chua', 'Tan', 'Aguilar', 'Alvarez', 'Diaz', 'Espino', 'Gutierrez',
];
const MIDDLE_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const pick = (arr, i) => arr[i % arr.length];

// ── Same Class Record formulas the live app uses (gradeComponentController) ──
const itemRate = (score, maxScore) => (parseFloat(score) / parseFloat(maxScore)) * 45 + 50;
const compositeToGWA = (composite) => {
  const floored = Math.floor(composite * 10) / 10;
  return Math.min(5.0, Math.max(1.0, 10.5 - 0.1 * floored));
};

const COMPONENT_SHAPE = {
  Midterm: [
    { name: 'Quizzes', weight: 30, items: [{ name: 'Quiz 1', max: 20 }, { name: 'Quiz 2', max: 20 }] },
    { name: 'Major Exam', weight: 70, items: [{ name: 'Midterm Exam', max: 100 }] },
  ],
  Finals: [
    { name: 'Quizzes', weight: 30, items: [{ name: 'Quiz 3', max: 20 }, { name: 'Quiz 4', max: 20 }] },
    { name: 'Major Exam', weight: 70, items: [{ name: 'Final Exam', max: 100 }] },
  ],
};

async function bulkInsert(model, rows, label) {
  if (rows.length === 0) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const created = await model.bulkCreate(slice, { validate: true });
    out.push(...created);
    console.log(`  ...${label}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
  }
  return out;
}

async function main() {
  const already = await Class.count({ where: { schedule: SCHEDULE_TAG } });
  if (already > 0) {
    console.log(`⏭️  Found ${already} class(es) already tagged "${SCHEDULE_TAG}". Aborting so nothing is duplicated.`);
    console.log('   Delete them first (and their student_no >= 940001 students) if you want to regenerate.');
    process.exit(0);
  }

  const currentSemester = await Semester.findOne({ where: { is_current: true } });
  if (!currentSemester) { console.log('❌ No current semester set.'); process.exit(1); }
  const subjectSemesterLabel = currentSemester.term === 'Second Semester' ? '2nd Semester' : '1st Semester';
  console.log(`📅 Using current semester: ${currentSemester.name} (curriculum label: ${subjectSemesterLabel})`);

  // ── 1. Students — exactly TARGET_TOTAL, evenly across Year 1-4 x Section A-H ──
  const maxRow = await User.findOne({
    where: { student_no: { [Op.ne]: null } },
    order: [[sequelize.literal('CAST(student_no AS BIGINT)'), 'DESC']],
    attributes: ['student_no'],
  });
  let studentNoCounter = maxRow ? Math.max(parseInt(maxRow.student_no, 10) + 1, STUDENT_NO_START) : STUDENT_NO_START;
  console.log('🔑 Hashing shared password once...');
  const passwordHash = await bcrypt.hash('Test@12345', 12);

  const studentRows = [];
  for (let i = 0; i < TARGET_TOTAL; i++) {
    const year = Math.floor(i / (TARGET_TOTAL / 4)) + 1; // 250 per year, in order
    const section = pick(SECTIONS, i);
    const first = pick(FIRST_NAMES, i);
    const last = pick(LAST_NAMES, Math.floor(i / FIRST_NAMES.length) + i);
    const mi = pick(MIDDLE_INITIALS, i);
    const student_no = String(studentNoCounter);
    studentRows.push({
      name: `${first} ${mi}. ${last}`,
      email: `bsit1000.${year}${section.toLowerCase()}.${student_no}@agmstest.local`,
      password: passwordHash,
      role: 'Student',
      student_no,
      program: PROGRAM,
      year_level: year,
      section,
      student_status: 'Regular', // resolved to Irregular below once grades exist
      status: 'Active',
      email_verified: true,
      privacy_accepted: true,
      privacy_accepted_at: new Date(),
      avatar: first.charAt(0).toUpperCase(),
    });
    studentNoCounter++;
  }
  console.log(`👤 Creating ${studentRows.length} BSIT students...`);
  const createdStudents = await bulkInsert(User, studentRows, 'students');
  console.log(`✅ ${createdStudents.length} students created.`);

  const studentsByYearSection = {};
  createdStudents.forEach((s) => {
    const key = `${s.year_level}|${s.section}`;
    if (!studentsByYearSection[key]) studentsByYearSection[key] = [];
    studentsByYearSection[key].push(s);
  });

  // ── 2. Classes — one per (this-semester BSIT subject, section actually in use) ──
  const subjects = await Subject.findAll({
    where: { program: PROGRAM, semester: subjectSemesterLabel },
    attributes: ['id', 'code', 'name', 'year_level'],
  });
  const subjectsByYear = {};
  subjects.forEach((s) => {
    if (!subjectsByYear[s.year_level]) subjectsByYear[s.year_level] = [];
    subjectsByYear[s.year_level].push(s);
  });

  const faculty = await User.findAll({
    where: { role: 'Faculty', status: 'Active', programs: { [Op.contains]: [PROGRAM] } },
    attributes: ['id'],
  });
  if (faculty.length === 0) { console.log('❌ No BSIT-tagged Faculty found — nobody to assign as instructor.'); process.exit(1); }
  let facultyCursor = 0;

  const classRows = [];
  for (let year = 1; year <= 4; year++) {
    const yearSubjects = subjectsByYear[year] || [];
    for (const subject of yearSubjects) {
      for (const section of SECTIONS) {
        const key = `${year}|${section}`;
        if (!(studentsByYearSection[key] || []).length) continue; // no one to enroll — skip
        const instructor_id = faculty[facultyCursor % faculty.length].id;
        facultyCursor++;
        classRows.push({
          subject_id: subject.id,
          instructor_id,
          section,
          year_level: year,
          semester: currentSemester.name,
          academic_year: currentSemester.academic_year,
          status: 'Active',
          encoding_open: true,
          schedule: SCHEDULE_TAG,
          __year: year, __section: section,
        });
      }
    }
  }
  const classMeta = classRows.map(({ __year, __section, ...row }) => row);
  console.log(`🏫 Creating ${classMeta.length} classes...`);
  const createdClasses = await bulkInsert(Class, classMeta, 'classes');
  createdClasses.forEach((c, i) => { classRows[i].__id = c.id; });
  console.log(`✅ ${createdClasses.length} classes created.`);

  // ── 3. Grade Components + Items — one fixed shape per class ─────────────
  const componentRows = [];
  const classComponentIndex = [];
  for (const cls of classRows) {
    for (const period of ['Midterm', 'Finals']) {
      COMPONENT_SHAPE[period].forEach((comp, ci) => {
        componentRows.push({ class_id: cls.__id, name: comp.name, period, weight: comp.weight, order_index: ci });
        classComponentIndex.push({ classId: cls.__id, period, items: comp.items });
      });
    }
  }
  console.log(`🧩 Creating ${componentRows.length} grade components...`);
  const createdComponents = await bulkInsert(GradeComponent, componentRows, 'components');

  const itemRows = [];
  const itemIndex = [];
  createdComponents.forEach((comp, i) => {
    const { items } = classComponentIndex[i];
    items.forEach((it, ii) => {
      itemRows.push({ component_id: comp.id, name: it.name, max_score: it.max, order_index: ii });
      itemIndex.push({ classId: classComponentIndex[i].classId, period: classComponentIndex[i].period, componentId: comp.id, weight: parseFloat(comp.weight), maxScore: it.max });
    });
  });
  console.log(`🧩 Creating ${itemRows.length} component items...`);
  const createdItems = await bulkInsert(ComponentItem, itemRows, 'items');

  const itemsByClassPeriod = {};
  createdItems.forEach((item, i) => {
    const meta = itemIndex[i];
    const key = `${meta.classId}|${meta.period}`;
    if (!itemsByClassPeriod[key]) itemsByClassPeriod[key] = [];
    itemsByClassPeriod[key].push({ id: item.id, componentId: meta.componentId, weight: meta.weight, maxScore: meta.maxScore });
  });

  // ── 4. Component Scores + Grades — realistic performance mix ─────────────
  // Failure risk is assigned PER STUDENT, not per class — rolling an
  // independent "did they fail?" chance separately for every one of a
  // student's ~6 classes this semester compounds fast (a 20% per-class fail
  // rate means a ~74% chance of failing AT LEAST ONE class, which is not
  // "some students failed", it's "most students failed"). Instead: ~20% of
  // students are "at risk" up front, and each of THOSE fails exactly one of
  // their own classes (their real academic trouble spot) while passing the
  // rest — everyone else passes everything. That's what actually produces a
  // realistic ~80/20 Regular/Irregular split. Independent of that, any
  // individual class still has a 15% chance of "not yet submitted" (no Grade
  // row at all) for realism — except a student's own assigned-fail class,
  // which always goes through, so an at-risk student is guaranteed to
  // actually end up Irregular rather than possibly landing on "still
  // encoding" for the one class that was supposed to fail.
  const classesByYearSection = {};
  classRows.forEach((c) => {
    const key = `${c.__year}|${c.__section}`;
    (classesByYearSection[key] = classesByYearSection[key] || []).push(c);
  });
  const AT_RISK_RATE = 0.20;
  const failClassIdByStudent = {}; // studentId -> class __id they're assigned to fail
  createdStudents.forEach((s) => {
    if (Math.random() >= AT_RISK_RATE) return;
    const myClasses = classesByYearSection[`${s.year_level}|${s.section}`] || [];
    if (myClasses.length === 0) return;
    failClassIdByStudent[s.id] = myClasses[Math.floor(Math.random() * myClasses.length)].__id;
  });

  const scoreRows = [];
  const gradeRows = [];
  const failedSubjectByStudent = {}; // studentId -> [{code, name}] — for the summary printout only

  for (const cls of classRows) {
    const key = `${cls.__year}|${cls.__section}`;
    const sectionStudents = studentsByYearSection[key] || [];
    const midItems = itemsByClassPeriod[`${cls.__id}|Midterm`] || [];
    const finItems = itemsByClassPeriod[`${cls.__id}|Finals`] || [];
    const subject = subjects.find((s) => s.id === cls.subject_id);

    for (const student of sectionStudents) {
      const isAssignedFailHere = failClassIdByStudent[student.id] === cls.__id;
      if (!isAssignedFailHere && Math.random() < 0.15) continue; // still encoding — no Grade row at all
      const passing = !isAssignedFailHere;

      const scoreFor = (max) => {
        const pct = passing ? (0.75 + Math.random() * 0.23) : (0.30 + Math.random() * 0.25);
        return Math.round(max * pct * 100) / 100;
      };

      const periodGWA = (items) => {
        if (items.length === 0) return null;
        const byComp = {};
        items.forEach((it) => {
          const score = scoreFor(it.maxScore);
          scoreRows.push({ item_id: it.id, student_id: student.id, score });
          (byComp[it.componentId] = byComp[it.componentId] || { weight: it.weight, rates: [] }).rates.push(itemRate(score, it.maxScore));
        });
        let composite = 0;
        Object.values(byComp).forEach(({ weight, rates }) => {
          const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
          composite += avg * (weight / 100);
        });
        return Math.round(compositeToGWA(composite) * 100) / 100;
      };

      const midterm = periodGWA(midItems);
      const finals = periodGWA(finItems);
      if (midterm === null && finals === null) continue;
      const average = (midterm !== null && finals !== null) ? Math.round(((midterm + finals) / 2) * 100) / 100 : null;
      const status = average !== null ? (average <= 3.0 ? 'Passed' : 'Failed') : 'Pending';
      const now = new Date();

      gradeRows.push({
        class_id: cls.__id,
        student_id: student.id,
        midterm, finals, average, status,
        submitted: average !== null,
        submitted_date: average !== null ? now : null,
        is_draft: average === null,
        // Full pipeline completion — verified/approved/released, not a
        // still-in-review draft (matches the classes being marked fully
        // verified/approved below).
        admin_approved: status === 'Passed',
        admin_approved_date: status === 'Passed' ? now : null,
        released: average !== null,
        released_date: average !== null ? now : null,
      });

      if (status === 'Failed' && subject) {
        (failedSubjectByStudent[student.id] = failedSubjectByStudent[student.id] || []).push(subject.code);
      }
    }
  }

  console.log(`✍️  Creating ${scoreRows.length} component scores...`);
  await bulkInsert(ComponentScore, scoreRows, 'scores');

  console.log(`📊 Creating ${gradeRows.length} grades...`);
  await bulkInsert(Grade, gradeRows, 'grades');

  // ── 5. Enrollments ────────────────────────────────────────────────────────
  const enrollmentRows = [];
  for (const cls of classRows) {
    const key = `${cls.__year}|${cls.__section}`;
    (studentsByYearSection[key] || []).forEach((s) => {
      enrollmentRows.push({ class_id: cls.__id, student_id: s.id });
    });
  }
  console.log(`📝 Creating ${enrollmentRows.length} enrollments...`);
  await bulkInsert(Enrollment, enrollmentRows, 'enrollments');

  // ── 6. Every seeded class is fully verified/approved/forwarded — this
  // dataset represents an already-finished semester, not one still in
  // review, matching the "students can already see their released grades
  // and their Irregular status right now" narrative. ─────────────────────
  const allClassIds = createdClasses.map((c) => c.id);
  const now = new Date();
  await Class.update({
    chairperson_verified: true, chairperson_verified_at: now,
    class_record_verified: true, class_record_verified_at: now,
    grade_sheet_verified: true, grade_sheet_verified_at: now,
    admin_class_record_approved: true, admin_class_record_approved_at: now,
    admin_grade_sheet_approved: true, admin_grade_sheet_approved_at: now,
    sent_to_chairperson: true,
  }, { where: { id: { [Op.in]: allClassIds } } });
  console.log(`✅ Verified/approved/forwarded all ${allClassIds.length} classes.`);

  // ── 7. Resolve final student_status — Irregular for anyone with a real
  // Failed grade this run, Regular otherwise. Irregular here means "flagged,
  // not blocked" — they're exactly as promoted/placed as everyone else
  // (same Year+Section as seeded), just carrying the flag until they clear
  // it themselves via the real "Path to Regular Status" self-service flow
  // (regularization_subjects is deliberately left null here, not pre-filled). ──
  // validate:false on every one of these — Sequelize's bulk .update() re-runs
  // custom validators (User's own hasLoginCredential) against ONLY the
  // updated fields, not the full row, so `role`/`student_no` read as
  // undefined and it fails a validation that has nothing to do with what's
  // actually being changed here. Safe to skip: every row being touched is
  // one we just created ourselves with a valid role+student_no already.
  const irregularIds = Object.keys(failedSubjectByStudent).map(Number);
  if (irregularIds.length > 0) {
    await User.update(
      { student_status: 'Irregular', last_promoted_semester: currentSemester.name },
      { where: { id: { [Op.in]: irregularIds } }, validate: false },
    );
    // irregular_sections needs each student's own year_level/section, which
    // varies per row — bulk .update() can't express that, so this is set
    // per-student. Cheap at this scale (a few hundred rows) and only runs once.
    await Promise.all(createdStudents
      .filter((s) => irregularIds.includes(s.id))
      .map((s) => User.update(
        { irregular_sections: [{ year_level: s.year_level, section: s.section, is_current: true }] },
        { where: { id: s.id }, validate: false },
      )));
  }
  const regularIds = createdStudents.map((s) => s.id).filter((id) => !irregularIds.includes(id));
  if (regularIds.length > 0) {
    await User.update(
      { last_promoted_semester: currentSemester.name },
      { where: { id: { [Op.in]: regularIds } }, validate: false },
    );
  }

  console.log('\n🎉 Done. Summary:');
  console.log(`   Students:         ${createdStudents.length} (Year 1-4 × Section A-H, program: ${PROGRAM})`);
  console.log(`   Classes:          ${createdClasses.length}`);
  console.log(`   Grades:           ${gradeRows.length} (${gradeRows.filter(g => g.status === 'Passed').length} Passed, ${gradeRows.filter(g => g.status === 'Failed').length} Failed, ${gradeRows.filter(g => g.status === 'Pending').length} Pending)`);
  console.log(`   Irregular (has a Failed grade): ${irregularIds.length}`);
  console.log(`   Regular:                        ${regularIds.length}`);
  console.log(`\n   Test login: any student_no >= ${STUDENT_NO_START} / password "Test@12345"`);
  console.log(`   Cleanup later: delete Classes where schedule = "${SCHEDULE_TAG}" and Users where student_no >= '${STUDENT_NO_START}' (cascades the rest).`);
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('❌ Failed:', err);
    await sequelize.close();
    process.exit(1);
  });
