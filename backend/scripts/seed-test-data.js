/**
 * TEST DATA SEEDER — disposable, easy to fully remove later.
 *
 * Creates ~50 Active students per (program, year level), spread round-robin
 * across Sections A–G, then enrolls each section into a Class for every
 * current-semester (1st Semester) subject their program/year requires, with
 * varied Grade states (Passed/Failed/INC/ungraded) and varied
 * chairperson_verified / admin_approved / released sign-off combinations so
 * Grade Approval, Grading Sheets, Promotion, and Messages all have realistic
 * data to click through.
 *
 * Every record this script creates is tagged so it can be found and deleted
 * again in one shot:
 *   - Users:    student_no BETWEEN '900001' AND '909999' (real student_no's
 *               in this DB all start with '2', so this range never collides)
 *   - Classes:  schedule = '[TEST DATA]'
 *   - Enrollments/Grades: cascade-deleted by removing the Classes/Users above
 *
 * Run:   node scripts/seed-test-data.js
 * Undo:  node scripts/remove-test-data.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { User, Subject, Class, Enrollment, Grade, Semester } = require('../models');

const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const STUDENTS_PER_PROGRAM_YEAR = 50;
const TEST_STUDENT_NO_START = 900001;
const TEST_SCHEDULE_TAG = '[TEST DATA]';

const FIRST_NAMES = [
  'Miguel', 'Sofia', 'Gabriel', 'Isabella', 'Rafael', 'Andrea', 'Diego', 'Camille',
  'Joaquin', 'Marielle', 'Nathaniel', 'Kristine', 'Xavier', 'Angelica', 'Emmanuel',
  'Danica', 'Vincent', 'Patricia', 'Adrian', 'Cassandra', 'Julian', 'Rhea',
  'Sebastian', 'Nicole', 'Lorenzo', 'Bianca', 'Matthias', 'Erika', 'Francis', 'Jamie',
  'Renzo', 'Alyssa', 'Marco', 'Kimberly', 'Enrique', 'Gwyneth', 'Leandro', 'Reign',
  'Carlos', 'Denise',
];
const LAST_NAMES = [
  'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres',
  'Flores', 'Ramos', 'Villanueva', 'Castillo', 'Rivera', 'Aquino', 'Salazar',
  'Del Rosario', 'Fernandez', 'Gonzales', 'Pascual', 'Navarro', 'Domingo', 'Manalo',
  'Tolentino', 'Bernardo', 'Marquez', 'Valdez', 'Ignacio', 'Padilla', 'Rosales', 'Uy',
];
const MIDDLE_INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function pick(arr, i) { return arr[i % arr.length]; }

function programShort(program) {
  if (program.includes('Information Technology')) return 'IT';
  if (program.includes('Information Systems')) return 'IS';
  if (program.includes('Psychology')) return 'PSY';
  if (program.includes('Statistics')) return 'STAT';
  return 'GEN';
}

async function main() {
  console.log('🔎 Checking for a previous run...');
  const already = await User.count({ where: { student_no: { [Op.gte]: String(TEST_STUDENT_NO_START) } } });
  if (already > 0) {
    console.log(`⏭️  Found ${already} existing test student(s) (student_no >= 900001). Aborting so nothing is duplicated.`);
    console.log('   Run "node scripts/remove-test-data.js" first if you want to regenerate.');
    process.exit(0);
  }

  const currentSemester = await Semester.findOne({ where: { is_current: true } });
  if (!currentSemester) {
    console.log('❌ No current semester is set. Set one in Semester Management first.');
    process.exit(1);
  }
  console.log(`📅 Using current semester: ${currentSemester.name} (${currentSemester.academic_year})`);

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
  PROGRAMS.forEach((p) => {
    facultyByProgram[p] = faculty.filter((f) => (f.programs || []).includes(p)).map((f) => f.id);
  });

  console.log('🔑 Hashing shared test password once...');
  const passwordHash = await bcrypt.hash('Test@12345', 12);

  // ── Build all student rows in memory first ──────────────────────────────
  const studentRows = [];
  let studentNoCounter = TEST_STUDENT_NO_START;
  let nameCounter = 0;

  for (const program of PROGRAMS) {
    for (let year = 1; year <= 4; year++) {
      for (let i = 0; i < STUDENTS_PER_PROGRAM_YEAR; i++) {
        const section = pick(SECTIONS, i);
        const first = pick(FIRST_NAMES, nameCounter);
        const last = pick(LAST_NAMES, Math.floor(nameCounter / FIRST_NAMES.length) + nameCounter);
        const mi = pick(MIDDLE_INITIALS, nameCounter);
        const name = `${first} ${mi}. ${last}`;
        const student_no = String(studentNoCounter);
        studentRows.push({
          name,
          email: `test.${programShort(program).toLowerCase()}${year}${section.toLowerCase()}.${student_no}@agmstest.local`,
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
  }

  console.log(`👤 Creating ${studentRows.length} test students...`);
  const createdStudents = await User.bulkCreate(studentRows, { validate: true });
  console.log(`✅ Created ${createdStudents.length} students.`);

  // Group created students back by program|year|section for enrollment
  const studentsByProgramYearSection = {};
  createdStudents.forEach((s) => {
    const key = `${s.program}|${s.year_level}|${s.section}`;
    if (!studentsByProgramYearSection[key]) studentsByProgramYearSection[key] = [];
    studentsByProgramYearSection[key].push(s);
  });

  // ── Build Classes: one per (subject, section) actually in use ───────────
  const classRows = [];
  let facultyCursor = {};
  for (const program of PROGRAMS) {
    for (let year = 1; year <= 4; year++) {
      const subjects = subjectsByProgramYear[`${program}|${year}`] || [];
      if (subjects.length === 0) continue;
      for (const subject of subjects) {
        for (const section of SECTIONS) {
          const pool = facultyByProgram[program];
          if (!pool || pool.length === 0) continue; // no faculty for this program — skip
          facultyCursor[program] = (facultyCursor[program] || 0) + 1;
          const instructor_id = pool[facultyCursor[program] % pool.length];
          // Vary sign-off state per class so Grade Approval/Promotion have a
          // realistic mix: ~60% already Chairperson-verified, rest not yet.
          const chairperson_verified = Math.random() < 0.6;
          classRows.push({
            subject_id: subject.id,
            instructor_id,
            section,
            year_level: year,
            semester: currentSemester.name,
            academic_year: currentSemester.academic_year,
            status: 'Active',
            encoding_open: true,
            chairperson_verified,
            chairperson_verified_at: chairperson_verified ? new Date() : null,
            schedule: TEST_SCHEDULE_TAG,
            // stashed for the grade-building pass below (stripped before insert)
            __program: program,
            __year: year,
            __section: section,
          });
        }
      }
    }
  }

  const classMeta = classRows.map(({ __program, __year, __section, ...row }) => row);
  console.log(`🏫 Creating ${classMeta.length} test classes...`);
  const createdClasses = await Class.bulkCreate(classMeta, { validate: true });
  createdClasses.forEach((c, i) => { classRows[i].__id = c.id; });
  console.log(`✅ Created ${createdClasses.length} classes.`);

  // ── Enrollments + Grades ─────────────────────────────────────────────────
  const enrollmentRows = [];
  const gradeRows = [];

  for (const cls of classRows) {
    const key = `${cls.__program}|${cls.__year}|${cls.__section}`;
    const sectionStudents = studentsByProgramYearSection[key] || [];
    for (const student of sectionStudents) {
      enrollmentRows.push({ class_id: cls.__id, student_id: student.id });

      // Grade-state mix per enrollment:
      //   70% Passed, 15% Failed, 8% INC, 7% not yet submitted (still encoding)
      const roll = Math.random();
      let status, midterm, finals, average, submitted, submitted_date;
      if (roll < 0.07) {
        status = 'Pending'; midterm = null; finals = null; average = null; submitted = false; submitted_date = null;
      } else if (roll < 0.15) {
        status = 'INC'; midterm = (Math.random() * 2 + 1).toFixed(2); finals = null; average = null; submitted = true; submitted_date = new Date();
      } else if (roll < 0.30) {
        // Failed: average between 3.01 and 5.00
        const avg = (Math.random() * 1.99 + 3.01).toFixed(2);
        midterm = avg; finals = avg; average = avg; status = 'Failed'; submitted = true; submitted_date = new Date();
      } else {
        // Passed: average between 1.00 and 3.00
        const avg = (Math.random() * 2 + 1).toFixed(2);
        midterm = avg; finals = avg; average = avg; status = 'Passed'; submitted = true; submitted_date = new Date();
      }

      // Admin approval only ever applies to Passed grades, and only once the
      // class itself has been Chairperson-verified — same gate the real app enforces.
      const admin_approved = status === 'Passed' && cls.chairperson_verified && Math.random() < 0.7;
      const admin_approved_date = admin_approved ? new Date() : null;

      // Released mirrors isFullyVerified(): class verified AND (not-Passed OR admin-approved).
      const fullyVerified = submitted && cls.chairperson_verified && (status !== 'Passed' || admin_approved);
      const released = fullyVerified && Math.random() < 0.5;

      gradeRows.push({
        class_id: cls.__id,
        student_id: student.id,
        midterm,
        finals,
        average,
        status,
        submitted,
        submitted_date,
        is_draft: !submitted,
        released,
        released_date: released ? new Date() : null,
        admin_approved,
        admin_approved_date,
      });
    }
  }

  console.log(`📝 Creating ${enrollmentRows.length} enrollments...`);
  await Enrollment.bulkCreate(enrollmentRows, { validate: true });
  console.log(`✅ Created ${enrollmentRows.length} enrollments.`);

  console.log(`📊 Creating ${gradeRows.length} grades...`);
  // Grade.beforeSave recomputes average/status from midterm+finals for
  // non-INC/DRP rows, which matches what we already computed — but bulkCreate
  // skips hooks by default, so our precomputed values are used as-is (faster,
  // and avoids 5,000+ individual hook calls for what's disposable test data).
  await Grade.bulkCreate(gradeRows, { validate: true });
  console.log(`✅ Created ${gradeRows.length} grades.`);

  console.log('\n🎉 Done. Summary:');
  console.log(`   Students:    ${createdStudents.length}`);
  console.log(`   Classes:     ${createdClasses.length}`);
  console.log(`   Enrollments: ${enrollmentRows.length}`);
  console.log(`   Grades:      ${gradeRows.length}`);
  console.log(`\n   Test login: any test student_no (${TEST_STUDENT_NO_START}-${studentNoCounter - 1}) / password "Test@12345"`);
  console.log('   To remove everything this script created: node scripts/remove-test-data.js');
}

main()
  .then(() => sequelize.close())
  .catch(async (err) => {
    console.error('❌ Seeding failed:', err);
    await sequelize.close();
    process.exit(1);
  });
