/**
 * Tops up each program's Active student count to 600 (2400 total across the
 * 4 programs), on top of whatever already exists — unlike seed-test-data.js
 * this doesn't create classes/enrollments/grades, just accounts, since the
 * ask here is specifically the "Total Students Verified" headcount.
 *
 * Continues the student_no sequence used by seed-test-data.js (900001+) so
 * these stay identifiable/removable the same way (student_no >= 900001).
 *
 * Run: node scripts/top-up-students-to-600-per-program.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const { User } = require('../models');

const TARGET_PER_PROGRAM = 600;
const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

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

function pick(arr, i) { return arr[i % arr.length]; }

function programShort(program) {
  if (program.includes('Information Technology')) return 'IT';
  if (program.includes('Information Systems')) return 'IS';
  if (program.includes('Psychology')) return 'PSY';
  if (program.includes('Statistics')) return 'STAT';
  return 'GEN';
}

async function main() {
  const maxRow = await User.findOne({
    where: { student_no: { [Op.ne]: null } },
    order: [[require('sequelize').literal('CAST(student_no AS BIGINT)'), 'DESC']],
    attributes: ['student_no'],
  });
  let studentNoCounter = maxRow ? parseInt(maxRow.student_no, 10) + 1 : 900001;
  console.log(`Continuing student_no from ${studentNoCounter}`);

  console.log('Hashing shared password once...');
  const passwordHash = await bcrypt.hash('Test@12345', 12);

  const rows = [];
  let nameCounter = 0;

  for (const program of PROGRAMS) {
    const current = await User.count({ where: { role: 'Student', status: 'Active', program } });
    const needed = TARGET_PER_PROGRAM - current;
    if (needed <= 0) {
      console.log(`⏭️  ${program}: already at ${current}, skipping.`);
      continue;
    }
    console.log(`👤 ${program}: ${current} -> ${TARGET_PER_PROGRAM} (+${needed})`);
    for (let i = 0; i < needed; i++) {
      const year = (i % 4) + 1;
      const section = pick(SECTIONS, i);
      const first = pick(FIRST_NAMES, nameCounter);
      const last = pick(LAST_NAMES, Math.floor(nameCounter / FIRST_NAMES.length) + nameCounter);
      const mi = pick(MIDDLE_INITIALS, nameCounter);
      const name = `${first} ${mi}. ${last}`;
      const student_no = String(studentNoCounter);
      rows.push({
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

  if (rows.length === 0) {
    console.log('Nothing to do — every program is already at target.');
    process.exit(0);
  }

  console.log(`Creating ${rows.length} students...`);
  await User.bulkCreate(rows, { validate: true });
  console.log(`✅ Created ${rows.length} students.`);

  const finalCounts = await User.findAll({
    where: { role: 'Student', status: 'Active' },
    attributes: ['program', [require('sequelize').fn('COUNT', 'id'), 'count']],
    group: ['program'],
    raw: true,
  });
  console.log('Final counts:', finalCounts);
  const total = await User.count({ where: { role: 'Student', status: 'Active' } });
  console.log('Total Active students:', total);

  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
