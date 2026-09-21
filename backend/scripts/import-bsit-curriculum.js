require('dotenv').config();
const { sequelize } = require('../config/database');
const { Subject, Prerequisite } = require('../models');

const PROGRAM = 'Bachelor of Science in Information Technology';
const DEPARTMENT = 'Information Technology';

// Prerequisite column shorthand -> actual Course Code used elsewhere in this sheet.
const ALIAS = {
  PE1: 'PE 1 (PATH Fit 1)',
  PE2: 'PE 2 (PATH Fit 2)',
  PE3: 'PE 3 (PATH Fit 3)',
  PE4: 'PE 4 (PATH Fit 4)',
  NSTP1: 'NSTP - CWTS 1/LTS 1 NSTP-NROTC 1',
  NSTP2: 'NSTP - CWTS 2/LTS 2 NSTP-NROTC 2',
};

// [code, name, year, semester, lecHrs, lecUnits, labHrs, labUnits, totalHrs, totalUnits, prereqTokensOrNote]
const ROWS = [
  // ── FIRST YEAR ─ First Semester ── (Total: 378 21 108 2 486 23)
  ['GE 1', 'Understanding the Self', 1, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE 3', 'Mathematics in the Modern World', 1, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE 7', 'Science, Technology and Society', 1, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE E5', 'Kontekstwalisadong Komunikasyon sa Filipino (KOMFIL)', 1, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['CC101', 'Introduction to Computing', 1, '1st Semester', 36, 2, 54, 1, 90, 3, []],
  ['CC102', 'Computer Programming 1 (Procedural)', 1, '1st Semester', 36, 2, 54, 1, 90, 3, []],
  ['NSTP - CWTS 1/LTS 1 NSTP-NROTC 1', 'Social Preparation 1 / Military/Naval Science 1', 1, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['PE 1 (PATH Fit 1)', 'Movement Competency Training (MCT)', 1, '1st Semester', 36, 2, 0, 0, 36, 2, []],

  // ── FIRST YEAR ─ Second Semester ── (Total: 432 24 108 2 540 26)
  ['GE 4', 'Purposive Communication', 1, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE 2', 'Readings in Philippine History', 1, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE 5', 'Art Appreciation', 1, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE E2', 'Entrepreneurial Mind', 1, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['MS101', 'Discrete Mathematics', 1, '2nd Semester', 54, 3, 0, 0, 54, 3, ['CC101']],
  ['CC103', 'Computer Programming 2 (Object-oriented)', 1, '2nd Semester', 36, 2, 54, 1, 90, 3, ['CC102']],
  ['HCI101', 'Human Computer Interaction', 1, '2nd Semester', 36, 2, 54, 1, 90, 3, ['CC102']],
  ['NSTP - CWTS 2/LTS 2 NSTP-NROTC 2', 'Community Immersion / Military/Naval Science 2', 1, '2nd Semester', 54, 3, 0, 0, 54, 3, ['NSTP1']],
  ['PE 2 (PATH Fit 2)', 'Exercise-based Fitness Activities', 1, '2nd Semester', 36, 2, 0, 0, 36, 2, ['PE1']],

  // ── SECOND YEAR ─ First Semester ── (Total: 306 17 162 3 468 20)
  ['GE 8', 'Ethics', 2, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE6', 'The Contemporary World w/ Peace Education', 2, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE E6', 'Disaster Readiness and Mental Health', 2, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['CC104', 'Data Structures & Algorithm', 2, '1st Semester', 36, 2, 54, 1, 90, 3, ['CC103']],
  ['WD101', 'Web Development & Application', 2, '1st Semester', 36, 2, 54, 1, 90, 3, ['CC103']],
  ['EDC101', 'Electronics Devices and Circuits', 2, '1st Semester', 36, 2, 54, 1, 90, 3, ['CC101']],
  ['PE 3 (PATH Fit 3)', 'Dance', 2, '1st Semester', 36, 2, 0, 0, 36, 2, ['PE2']],

  // ── SECOND YEAR ─ Second Semester ── (Total: 360 20 162 3 522 23)
  ['CE E1', "Environmental Science/People and the Earth's Ecosystem", 2, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE E1', 'Philippines Indigenous Communities', 2, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE E7', 'Foreign Language', 2, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['MS102', 'Quantitative Methods (Including Modeling & Simulation)', 2, '2nd Semester', 54, 3, 0, 0, 54, 3, ['MS101']],
  ['CC105', 'Information Management', 2, '2nd Semester', 36, 2, 54, 1, 90, 3, ['CC103']],
  ['NET101', 'Networking', 2, '2nd Semester', 36, 2, 54, 1, 90, 3, ['PT101']],
  ['IPT101', 'Integrative Programming & Technologies', 2, '2nd Semester', 36, 2, 54, 1, 90, 3, ['PT101', 'PF101']],
  ['PE 4 (PATH Fit 4)', 'Martial Arts', 2, '2nd Semester', 36, 2, 0, 0, 36, 2, ['PE3']],

  // ── THIRD YEAR ─ First Semester ── (Total: 324 18 324 6 648 24)
  ['GE E3', 'Gender and Society', 3, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['GE E4', 'Scientific & Technical Writing', 3, '1st Semester', 54, 3, 0, 0, 54, 3, []],
  ['DA101', 'Data Analytics', 3, '1st Semester', 36, 2, 54, 1, 90, 3, ['CC105']],
  ['SAD101', 'System Analysis and Design', 3, '1st Semester', 36, 2, 54, 1, 90, 3, ['CC105']],
  ['CDC101', 'Cloud Computing', 3, '1st Semester', 36, 2, 54, 1, 90, 3, ['NET101', 'IPT101']],
  ['SIA101', 'System Integration and Architecture', 3, '1st Semester', 36, 2, 54, 1, 90, 3, ['IPT101']],
  ['WS101', 'Web Systems & Technologies', 3, '1st Semester', 36, 2, 54, 1, 90, 3, ['WD101', 'IPT101']],
  ['MAD101', 'Mobile Applications Design & Development', 3, '1st Semester', 36, 2, 54, 1, 90, 3, ['WD101', 'CC105']],

  // ── THIRD YEAR ─ Second Semester ── (Total: 288 16 162 3 486 21)
  ['GE 9', 'Life and Works of Rizal', 3, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['SP101', 'Social & Professional Issues 1', 3, '2nd Semester', 54, 3, 0, 0, 54, 3, []],
  ['CC106', 'Application Development & Emerging Technologies', 3, '2nd Semester', 36, 2, 0, 0, 54, 3, ['IM101']],
  ['IAS101', 'Information Assurance and Security', 3, '2nd Semester', 36, 2, 0, 0, 54, 3, ['NET101']],
  ['GIS101', 'Geographic Information System', 3, '2nd Semester', 36, 2, 54, 1, 90, 3, ['MAD101']],
  ['IOT101', 'Internet of Things', 3, '2nd Semester', 36, 2, 54, 1, 90, 3, ['EDC101', 'CDC101']],
  ['CAP101', 'Capstone Project and Research 1 (Methods of Research)', 3, '2nd Semester', 36, 2, 54, 1, 90, 3, ['MS102', 'DA101']],

  // ── FOURTH YEAR ─ First Semester ── (Total: 180 10 324 6 504 16)
  ['SA101', 'System Administration and Maintenance', 4, '1st Semester', 36, 2, 54, 1, 90, 3, ['CC106']],
  ['MM101', 'Multimedia', 4, '1st Semester', 36, 2, 54, 1, 90, 3, ['WS101']],
  ['CBR101', 'Cybersecurity', 4, '1st Semester', 36, 2, 54, 1, 90, 3, ['IAS101']],
  ['PT101', 'Platform Technologies', 4, '1st Semester', 36, 2, 54, 1, 90, 3, ['SIA101']],
  ['CAP102', 'Capstone Project and Research 2 (Project Implementation)', 4, '1st Semester', 36, 2, 54, 1, 90, 3, ['CAP101']],
  ['FTS101', 'Seminars and Field Trip', 4, '1st Semester', 0, 0, 54, 1, 54, 1, ['4th Year Standing']],

  // ── FOURTH YEAR ─ Second Semester ── (Total: - - - - 486 6)
  ['PRAC 101', 'Practicum', 4, '2nd Semester', 0, 0, 0, 0, 486, 6, ['4th Year Standing']],
];

const run = async () => {
  const t = await sequelize.transaction();
  try {
    const existing = await Subject.count({ where: { program: PROGRAM }, transaction: t });
    if (existing > 0) {
      console.log(`⚠️  ${existing} subject(s) already exist for ${PROGRAM}. Aborting to avoid duplicates — delete them first if you want a clean re-import.`);
      await t.rollback();
      process.exit(1);
    }

    // Pass 1: create every subject.
    const byCode = {};
    for (const row of ROWS) {
      const [code, name, year_level, semester, lecture_hours, lecture_units, lab_hours, lab_units, total_hours, units, prereqTokens] = row;
      const subject = await Subject.create({
        code, name, department: DEPARTMENT, program: PROGRAM, year_level, semester,
        lecture_hours: lecture_hours || null, lecture_units: lecture_units || null,
        lab_hours: lab_hours || null, lab_units: lab_units || null,
        total_hours, units,
      }, { transaction: t });
      byCode[code] = { subject, prereqTokens };
      console.log(`✅ Created ${code} — ${name}`);
    }

    // Pass 2: wire prerequisites now that every subject exists (some references are
    // forward-references, e.g. NET101 -> PT101 which is a later-year subject).
    let linked = 0, noted = 0;
    for (const code of Object.keys(byCode)) {
      const { subject, prereqTokens } = byCode[code];
      if (!prereqTokens || prereqTokens.length === 0) continue;

      // "4th Year Standing" isn't a subject reference at all — goes straight to the note.
      if (prereqTokens.length === 1 && prereqTokens[0] === '4th Year Standing') {
        await subject.update({ prerequisite_note: '4th Year Standing' }, { transaction: t });
        noted++;
        continue;
      }

      const unresolved = [];
      for (const token of prereqTokens) {
        const targetCode = ALIAS[token] || token;
        const target = byCode[targetCode];
        if (target) {
          await Prerequisite.create({ subject_id: subject.id, prerequisite_subject_id: target.subject.id }, { transaction: t });
          linked++;
        } else {
          unresolved.push(token);
        }
      }
      if (unresolved.length > 0) {
        await subject.update({ prerequisite_note: unresolved.join(', ') }, { transaction: t });
        noted++;
      }
    }
    console.log(`\n✅ Linked ${linked} prerequisite relationship(s), ${noted} subject(s) got a text note for unresolved/non-subject prerequisites.`);

    // Integrity check: recompute each semester's totals from what was just inserted
    // and compare against the printed Total row from the curriculum sheet.
    const EXPECTED_TOTALS = {
      '1-1st Semester': [378, 21, 108, 2, 486, 23],
      '1-2nd Semester': [432, 24, 108, 2, 540, 26],
      '2-1st Semester': [306, 17, 162, 3, 468, 20],
      '2-2nd Semester': [360, 20, 162, 3, 522, 23],
      '3-1st Semester': [324, 18, 324, 6, 648, 24],
      '3-2nd Semester': [288, 16, 162, 3, 486, 21],
      '4-1st Semester': [180, 10, 324, 6, 504, 16],
      '4-2nd Semester': [0, 0, 0, 0, 486, 6],
    };
    let allMatch = true;
    for (const [key, expected] of Object.entries(EXPECTED_TOTALS)) {
      const [yr, sem] = [parseInt(key.split('-')[0]), key.split('-')[1]];
      const rows = ROWS.filter((r) => r[2] === yr && r[3] === sem);
      const sums = rows.reduce((acc, r) => [
        acc[0] + (r[4] || 0), acc[1] + (r[5] || 0), acc[2] + (r[6] || 0),
        acc[3] + (r[7] || 0), acc[4] + (r[8] || 0), acc[5] + (r[9] || 0),
      ], [0, 0, 0, 0, 0, 0]);
      const match = JSON.stringify(sums) === JSON.stringify(expected);
      if (!match) allMatch = false;
      console.log(`${match ? '✅' : '❌'} Year ${yr} ${sem}: computed [${sums}] vs printed [${expected}]`);
    }

    if (!allMatch) {
      console.log('\n❌ Totals do not match the curriculum sheet — rolling back, nothing was saved.');
      await t.rollback();
      process.exit(1);
    }

    await t.commit();
    console.log(`\n🎉 Committed ${ROWS.length} subjects for ${PROGRAM}. All semester totals verified against the curriculum sheet.`);
    process.exit(0);
  } catch (err) {
    await t.rollback();
    console.error('❌ Import failed, rolled back:', err.message);
    process.exit(1);
  }
};

run();
