// One-off script: creates 10 test BSIT student accounts with status 'Pending',
// for exercising the Chairperson Approve/Reject flow end-to-end. Mirrors what
// authController.register() would produce for a self-registered student
// (privacy_accepted set immediately, same as real registrants), except the
// password is a fixed test value and email uniqueness isn't re-validated
// against Gmail-specific formatting (this bypasses the public /register route
// entirely — it writes straight to the DB).
require('dotenv').config();
const { sequelize } = require('../config/database');
const { User } = require('../models');
const { PRIVACY_POLICY_VERSION } = require('../config/privacy');

const PROGRAM = 'Bachelor of Science in Information Technology';
const PASSWORD = '123456';

const STUDENTS = [
  { student_no: '2025-10001', name: 'Angela Marie Santos',     email: 'angela.santos10001@gmail.com',     year_level: 1, section: 'A', student_status: 'Regular' },
  { student_no: '2025-10002', name: 'Rafael John Cruz',        email: 'rafael.cruz10002@gmail.com',       year_level: 1, section: 'B', student_status: 'Regular' },
  { student_no: '2025-10003', name: 'Bea Nicole Reyes',        email: 'bea.reyes10003@gmail.com',         year_level: 2, section: 'A', student_status: 'Regular' },
  { student_no: '2025-10004', name: 'Miguel Antonio Ramos',    email: 'miguel.ramos10004@gmail.com',      year_level: 2, section: 'C', student_status: 'Regular' },
  { student_no: '2025-10005', name: 'Kyla Faith Mercado',      email: 'kyla.mercado10005@gmail.com',      year_level: 3, section: 'A', student_status: 'Regular' },
  {
    student_no: '2025-10006', name: 'Joshua Dave Torres', email: 'joshua.torres10006@gmail.com',
    year_level: 3, section: 'B', student_status: 'Irregular',
    irregular_sections: [
      { year_level: 3, section: 'B', semester: '1st Semester' },
      { year_level: 2, section: 'A', semester: '1st Semester' },
    ],
  },
  { student_no: '2025-10007', name: 'Samantha Grace Villanueva', email: 'samantha.villanueva10007@gmail.com', year_level: 4, section: 'A', student_status: 'Regular' },
  { student_no: '2025-10008', name: 'Christian Paul Fernandez', email: 'christian.fernandez10008@gmail.com', year_level: 4, section: 'B', student_status: 'Regular' },
  {
    student_no: '2025-10009', name: 'Danica Rose Aquino', email: 'danica.aquino10009@gmail.com',
    year_level: 1, section: 'C', student_status: 'Irregular',
    irregular_sections: [
      { year_level: 1, section: 'C', semester: '1st Semester' },
    ],
  },
  { student_no: '2025-10010', name: 'Mark Lester Bautista',    email: 'mark.bautista10010@gmail.com',     year_level: 2, section: 'B', student_status: 'Regular' },
];

const buildPayload = (s) => ({
  name: s.name,
  email: s.email,
  password: PASSWORD,
  role: 'Student',
  status: 'Pending',
  program: PROGRAM,
  student_no: s.student_no,
  year_level: s.year_level,
  section: s.section,
  student_status: s.student_status,
  irregular_sections: s.irregular_sections || null,
  privacy_accepted: true,
  privacy_accepted_at: new Date(),
  privacy_policy_version: PRIVACY_POLICY_VERSION,
});

const run = async () => {
  // Dry run first, inside a rolled-back transaction, to catch any validation/
  // uniqueness problems (duplicate student_no/email) before writing for real.
  const dry = await sequelize.transaction();
  try {
    for (const s of STUDENTS) {
      await User.create(buildPayload(s), { transaction: dry });
    }
    await dry.rollback();
    console.log('✅ Dry run passed — all 10 accounts would be created without error.\n');
  } catch (err) {
    await dry.rollback();
    console.error('❌ Dry run failed, nothing was written:', err.message);
    process.exit(1);
  }

  // Real commit.
  const t = await sequelize.transaction();
  try {
    for (const s of STUDENTS) {
      await User.create(buildPayload(s), { transaction: t });
    }
    await t.commit();

    console.log('🎉 Created 10 pending BSIT student accounts:\n');
    console.log('Student ID    | Password | Name                        | Year | Section | Type');
    console.log('--------------|----------|-----------------------------|------|---------|----------');
    STUDENTS.forEach((s) => {
      console.log(
        `${s.student_no}  | ${PASSWORD}   | ${s.name.padEnd(27)} | ${String(s.year_level).padEnd(4)} | ${s.section.padEnd(7)} | ${s.student_status}`
      );
    });
    process.exit(0);
  } catch (err) {
    await t.rollback();
    console.error('❌ Real commit failed, rolled back:', err.message);
    process.exit(1);
  }
};

run();
