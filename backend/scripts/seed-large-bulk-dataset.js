/**
 * BULK DEMO DATASET — 3,000 students across all 4 programs, enrolled into
 * this semester's classes, with REAL Class Record input (GradeComponents +
 * ComponentItems + per-student ComponentScores, not just directly-set
 * midterm/finals numbers) that Faculty has encoded, submitted, and — for a
 * majority of classes — already sent to their program's Chairperson
 * (sent_to_chairperson = true). Chairperson/Admin verification flags are
 * deliberately left false throughout — forwarding is Faculty's action; the
 * Chairperson hasn't reviewed any of it yet, so Grade Approval/Grading
 * Sheets have real, unworked queues to click through.
 *
 * Tagged for easy removal:
 *   - Users:   student_no >= '900001'
 *   - Classes: schedule = '[BULK SEED]'
 *   - Enrollments/Grades/GradeComponents/ComponentItems/ComponentScores:
 *     cascade-deleted by removing the Classes/Users above.
 *
 * Run: node scripts/seed-large-bulk-dataset.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  User, Subject, Class, Enrollment, Grade, Semester,
  GradeComponent, ComponentItem, ComponentScore,
} = require('../models');

const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];
const TARGET_PER_PROGRAM = 750; // 3,000 total
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];
const STUDENT_NO_START = 900001;
const SCHEDULE_TAG = '[BULK SEED]';
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
const programShort = (program) => {
  if (program.includes('Information Technology')) return 'IT';
  if (program.includes('Information Systems')) return 'IS';
  if (program.includes('Psychology')) return 'PSY';
  if (program.includes('Statistics')) return 'STAT';
  return 'GEN';
};

// ── Same Class Record formulas the live app uses (gradeComponentController) ──
const itemRate = (score, maxScore) => (parseFloat(score) / parseFloat(maxScore)) * 45 + 50;
const compositeToGWA = (composite) => {
  const floored = Math.floor(composite * 10) / 10;
  return Math.min(5.0, Math.max(1.0, 10.5 - 0.1 * floored));
};

// One fixed, realistic 2-component-per-period shape (Quizzes 30% / Major Exam
// 70%) — real classes vary, but every class here uses the same shape so the
// generation logic stays simple; still genuine per-item input, not a shortcut
// straight to a midterm/finals number.
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
    console.log('   Delete them first (and their student_no >= 900001 students) if you want to regenerate.');
    process.exit(0);
  }

  const currentSemester = await Semester.findOne({ where: { is_current: true } });
  if (!currentSemester) { console.log('❌ No current semester set.'); process.exit(1); }
  console.log(`📅 Using current semester: ${currentSemester.name} (${currentSemester.academic_year})`);

  // ── 1. Students — top up each program to TARGET_PER_PROGRAM ────────────
  const maxRow = await User.findOne({
    where: { student_no: { [Op.ne]: null } },
    order: [[sequelize.literal('CAST(student_no AS BIGINT)'), 'DESC']],
    attributes: ['student_no'],
  });
  let studentNoCounter = maxRow ? Math.max(parseInt(maxRow.student_no, 10) + 1, STUDENT_NO_START) : STUDENT_NO_START;
  console.log(`🔑 Hashing shared password once...`);
  const passwordHash = await bcrypt.hash('Test@12345', 12);

  const studentRows = [];
  let nameCounter = 0;
  for (const program of PROGRAMS) {
    const current = await User.count({ where: { role: 'Student', program } });
    const needed = TARGET_PER_PROGRAM - current;
    if (needed <= 0) { console.log(`⏭️  ${program}: already at ${current}.`); continue; }
    console.log(`👤 ${program}: ${current} -> ${TARGET_PER_PROGRAM} (+${needed})`);
    for (let i = 0; i < needed; i++) {
      const year = (i % 4) + 1;
      const section = pick(SECTIONS, i);
      const first = pick(FIRST_NAMES, nameCounter);
      const last = pick(LAST_NAMES, Math.floor(nameCounter / FIRST_NAMES.length) + nameCounter);
      const mi = pick(MIDDLE_INITIALS, nameCounter);
      const student_no = String(studentNoCounter);
      studentRows.push({
        name: `${first} ${mi}. ${last}`,
        email: `bulk.${programShort(program).toLowerCase()}${year}${section.toLowerCase()}.${student_no}@agmstest.local`,
        password: passwordHash,
        role: 'Student',
        student_no,
        program,
        year_level: year,
        section,
        student_status: 'Regular',
        status: 'Active',
        email_verified: true,
        privacy_accepted: true,
        privacy_accepted_at: new Date(),
        avatar: first.charAt(0).toUpperCase(),
      });
      studentNoCounter++;
      nameCounter++;
    }
  }
  console.log(`👤 Creating ${studentRows.length} students...`);
  const createdStudents = await bulkInsert(User, studentRows, 'students');
  console.log(`✅ ${createdStudents.length} students created.`);

  // Every student now in scope (existing + newly created), grouped for enrollment.
  const allStudents = await User.findAll({ where: { role: 'Student', program: { [Op.in]: PROGRAMS } }, attributes: ['id', 'program', 'year_level', 'section'] });
  const studentsByProgramYearSection = {};
  allStudents.forEach((s) => {
    const key = `${s.program}|${s.year_level}|${s.section}`;
    if (!studentsByProgramYearSection[key]) studentsByProgramYearSection[key] = [];
    studentsByProgramYearSection[key].push(s);
  });

  // ── 2. Classes — one per (1st-Semester subject, section actually in use) ──
  const allSubjects = await Subject.findAll({
    where: { program: { [Op.in]: PROGRAMS }, semester: '1st Semester' },
    attributes: ['id', 'code', 'name', 'program', 'year_level'],
  });
  const subjectsByProgramYear = {};
  allSubjects.forEach((s) => {
    const key = `${s.program}|${s.year_level}`;
    if (!subjectsByProgramYear[key]) subjectsByProgramYear[key] = [];
    subjectsByProgramYear[key].push(s);
  });

  const faculty = await User.findAll({ where: { role: 'Faculty', status: 'Active' }, attributes: ['id', 'programs'] });
  const facultyByProgram = {};
  PROGRAMS.forEach((p) => { facultyByProgram[p] = faculty.filter((f) => (f.programs || []).includes(p)).map((f) => f.id); });
  const facultyCursor = {};

  const classRows = [];
  for (const program of PROGRAMS) {
    for (let year = 1; year <= 4; year++) {
      const subjects = subjectsByProgramYear[`${program}|${year}`] || [];
      for (const subject of subjects) {
        for (const section of SECTIONS) {
          const key = `${program}|${year}|${section}`;
          if (!(studentsByProgramYearSection[key] || []).length) continue; // no one to enroll — skip
          const pool = facultyByProgram[program];
          if (!pool || pool.length === 0) continue;
          facultyCursor[program] = (facultyCursor[program] || 0) + 1;
          const instructor_id = pool[facultyCursor[program] % pool.length];
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
            __program: program, __year: year, __section: section,
          });
        }
      }
    }
  }
  const classMeta = classRows.map(({ __program, __year, __section, ...row }) => row);
  console.log(`🏫 Creating ${classMeta.length} classes...`);
  const createdClasses = await bulkInsert(Class, classMeta, 'classes');
  createdClasses.forEach((c, i) => { classRows[i].__id = c.id; });
  console.log(`✅ ${createdClasses.length} classes created.`);

  // ── 3. Grade Components + Items — one fixed shape per class ─────────────
  const componentRows = [];
  const classComponentIndex = []; // parallel to componentRows, remembers which class + period+item shape
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
  const itemIndex = []; // parallel: { classId, period, componentId, maxScore }
  createdComponents.forEach((comp, i) => {
    const { items } = classComponentIndex[i];
    items.forEach((it, ii) => {
      itemRows.push({ component_id: comp.id, name: it.name, max_score: it.max, order_index: ii });
      itemIndex.push({ classId: classComponentIndex[i].classId, period: classComponentIndex[i].period, componentId: comp.id, weight: parseFloat(comp.weight), maxScore: it.max });
    });
  });
  console.log(`🧩 Creating ${itemRows.length} component items...`);
  const createdItems = await bulkInsert(ComponentItem, itemRows, 'items');

  // Group created items by class+period, each carrying its component's weight
  // — everything computeClassGrade needs to reproduce the app's own composite/GWA math.
  const itemsByClassPeriod = {};
  createdItems.forEach((item, i) => {
    const meta = itemIndex[i];
    const key = `${meta.classId}|${meta.period}`;
    if (!itemsByClassPeriod[key]) itemsByClassPeriod[key] = [];
    itemsByClassPeriod[key].push({ id: item.id, componentId: meta.componentId, weight: meta.weight, maxScore: meta.maxScore });
  });
  // Component weight applies once per component, not per item — items within
  // the same component split that weight's rate average between them.
  Object.values(itemsByClassPeriod).forEach((items) => {
    const byComp = {};
    items.forEach((it) => { (byComp[it.componentId] = byComp[it.componentId] || []).push(it); });
    Object.values(byComp).forEach((compItems) => { compItems.forEach((it) => { it.siblingCount = compItems.length; }); });
  });

  // ── 4. Component Scores + Grades — realistic performance mix ─────────────
  // 68% clearly passing, 17% clearly failing, 15% not yet submitted (class
  // still mid-encoding) — enough variety for Grade Approval/Promotion to
  // have something real to click through, without every class looking identical.
  const scoreRows = [];
  const gradeRows = [];

  for (const cls of classRows) {
    const key = `${cls.__program}|${cls.__year}|${cls.__section}`;
    const sectionStudents = studentsByProgramYearSection[key] || [];
    const midItems = itemsByClassPeriod[`${cls.__id}|Midterm`] || [];
    const finItems = itemsByClassPeriod[`${cls.__id}|Finals`] || [];

    for (const student of sectionStudents) {
      const roll = Math.random();
      if (roll < 0.15) {
        // Not yet submitted — enrolled, no scores, no grade row at all (matches
        // "still encoding" elsewhere in the app: no Grade row = Pending).
        continue;
      }
      const passing = roll >= 0.32; // of the 85% submitted, ~68/85 pass, ~17/85 fail

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

      gradeRows.push({
        class_id: cls.__id,
        student_id: student.id,
        midterm, finals, average, status,
        submitted: average !== null,
        submitted_date: average !== null ? new Date() : null,
        is_draft: average === null,
      });
    }
  }

  console.log(`✍️  Creating ${scoreRows.length} component scores...`);
  await bulkInsert(ComponentScore, scoreRows, 'scores');

  console.log(`📊 Creating ${gradeRows.length} grades...`);
  await bulkInsert(Grade, gradeRows, 'grades');

  // ── 5. Enrollments — every student who has (or was rolled to skip) a grade
  // in that class still needs to be enrolled; re-derive from sectionStudents
  // directly rather than gradeRows so the 15% "not yet submitted" students
  // are enrolled too. ──────────────────────────────────────────────────────
  const enrollmentRows = [];
  for (const cls of classRows) {
    const key = `${cls.__program}|${cls.__year}|${cls.__section}`;
    (studentsByProgramYearSection[key] || []).forEach((s) => {
      enrollmentRows.push({ class_id: cls.__id, student_id: s.id });
    });
  }
  console.log(`📝 Creating ${enrollmentRows.length} enrollments...`);
  await bulkInsert(Enrollment, enrollmentRows, 'enrollments');

  // ── 6. Forward ~65% of classes to their program's Chairperson ───────────
  // sent_to_chairperson only — chairperson_verified/class_record_verified/
  // grade_sheet_verified all stay false, since the Chairperson hasn't
  // actually reviewed anything yet. The other ~35% stay un-sent so Faculty's
  // own "Send to Chairperson" queue has real pending work too.
  const toForward = createdClasses.filter(() => Math.random() < 0.65).map((c) => c.id);
  console.log(`📤 Forwarding ${toForward.length}/${createdClasses.length} classes to their Chairperson...`);
  await Class.update({ sent_to_chairperson: true }, { where: { id: { [Op.in]: toForward } } });

  console.log('\n🎉 Done. Summary:');
  console.log(`   Students:         ${createdStudents.length} created (${allStudents.length} total in scope)`);
  console.log(`   Classes:          ${createdClasses.length}`);
  console.log(`   Grade components: ${createdComponents.length}`);
  console.log(`   Component items:  ${createdItems.length}`);
  console.log(`   Component scores: ${scoreRows.length}`);
  console.log(`   Grades:           ${gradeRows.length}`);
  console.log(`   Enrollments:      ${enrollmentRows.length}`);
  console.log(`   Forwarded to Chairperson: ${toForward.length}`);
  console.log(`\n   Test login: any bulk student_no (>= ${STUDENT_NO_START}) / password "Test@12345"`);
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('❌ Failed:', err);
    await sequelize.close();
    process.exit(1);
  });
