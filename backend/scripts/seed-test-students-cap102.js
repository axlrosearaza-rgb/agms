// TEMPORARY TEST DATA — fills CAP102 BSIT 4-E (class 1707) up to 50 students
// with realistic scores, for testing long rosters (Grade Sheet page spill,
// Class Record export, etc.). Every account made here is tagged with an
// @agms.test email; remove them all with scripts/remove-test-students.js.
//
// Run: node scripts/seed-test-students-cap102.js
const { sequelize } = require('../config/database');
const { Class, User, Enrollment, Grade, GradeComponent, ComponentItem, ComponentScore } = require('../models');
const bcrypt = require('../utils/bcrypt');
const { itemRate, toGWA, combinedGWA } = require('../controllers/gradeComponentController');

const CLASS_ID = 1707;
const TARGET_TOTAL = 50;
const TEST_EMAIL_DOMAIN = 'agms.test';
const PASSWORD = 'Test@1234';

const FIRST = ['Angelo', 'Bea', 'Carlo', 'Danica', 'Elijah', 'Faith', 'Gabriel', 'Hannah', 'Ivan', 'Jasmine', 'Kyle', 'Lorraine', 'Mark', 'Nicole', 'Oliver', 'Patricia', 'Rafael', 'Samantha', 'Troy', 'Ursula', 'Vince', 'Wendy', 'Xavier', 'Yvonne', 'Zandro', 'Althea', 'Bryan', 'Clarisse', 'Dominic', 'Erika', 'Francis', 'Gwen', 'Harold', 'Isabel', 'Joshua', 'Kristine', 'Lance', 'Mikaela', 'Nathan', 'Princess', 'Renz', 'Shaira', 'Tristan', 'Venice', 'Wilbert', 'Ysabel', 'Zyrus'];
const MIDDLE = 'ABCDEFGHIJLMNOPRSTV';
const LAST = ['Abalos', 'Bacani', 'Cabrera', 'Dacanay', 'Enriquez', 'Fajardo', 'Garcia', 'Hernandez', 'Ilagan', 'Jimenez', 'Lacson', 'Macaraeg', 'Navarro', 'Ocampo', 'Pascual', 'Quiambao', 'Ramos', 'Santos', 'Tolentino', 'Umali', 'Valdez', 'Yap', 'Zamora', 'Aquino', 'Bautista', 'Castillo', 'Delos Reyes', 'Espiritu', 'Flores', 'Gonzales', 'Ignacio', 'Javier', 'Lopez', 'Mendoza', 'Nepomuceno', 'Osorio', 'Perez', 'Rivera', 'Salazar', 'Torres', 'Uy', 'Villanueva', 'Yulo', 'Zuniga', 'Agustin', 'Bernardo', 'Cruz'];

// Deterministic pseudo-random so a re-seed gives the same data.
let seed = 42;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

(async () => {
  const cls = await Class.findByPk(CLASS_ID);
  if (!cls) throw new Error(`Class ${CLASS_ID} not found.`);
  const already = await Enrollment.count({ where: { class_id: CLASS_ID } });
  const toAdd = TARGET_TOTAL - already;
  if (toAdd <= 0) { console.log(`Class already has ${already} students — nothing to add.`); return sequelize.close(); }

  const components = await GradeComponent.findAll({
    where: { class_id: CLASS_ID },
    include: [{ model: ComponentItem, as: 'items' }],
  });
  const formula = cls.rate_formula === '60_35' ? { base: 60, range: 35 } : { base: 50, range: 45 };
  const hash = await bcrypt.hash(PASSWORD, await bcrypt.genSalt(10));

  await sequelize.transaction(async (transaction) => {
    const users = await User.bulkCreate(Array.from({ length: toAdd }, (_, i) => {
      const n = i + 1;
      const first = FIRST[i % FIRST.length];
      return {
        name: `${first} ${MIDDLE[i % MIDDLE.length]}. ${LAST[i % LAST.length]}`,
        email: `test.student.${String(n).padStart(2, '0')}@${TEST_EMAIL_DOMAIN}`,
        password: hash,
        role: 'Student',
        student_no: String(900000 + n),
        program: 'Bachelor of Science in Information Technology',
        year_level: 4,
        // No section on purpose — enrolled directly in this one class only, so
        // no other BSIT 4-E class ever auto-enrolls them.
        section: null,
        student_status: 'Regular',
        status: 'Active',
        email_verified: true,
        privacy_accepted: true,
        privacy_accepted_at: new Date(),
        privacy_policy_version: '1.0',
        avatar: first[0],
      };
    }), { hooks: false, returning: true, transaction });

    await Enrollment.bulkCreate(users.map((u) => ({ class_id: CLASS_ID, student_id: u.id })), { transaction });

    // Realistic scores: each student has an ability level, each item varies around it.
    const scoreRows = [];
    const grades = [];
    for (const u of users) {
      const ability = 0.45 + rand() * 0.5; // 45%–95% of max
      const scores = {};
      for (const comp of components) {
        for (const item of comp.items) {
          const max = parseFloat(item.max_score) || 100;
          const pct = Math.min(1, Math.max(0, ability + (rand() - 0.5) * 0.2));
          const score = item.is_rate_direct
            ? Math.round(formula.base + pct * formula.range)
            : Math.round(pct * max);
          scores[item.id] = score;
          scoreRows.push({ item_id: item.id, student_id: u.id, score });
        }
      }
      // Same math as gradeComponentController.saveScores.
      const composite = (period) => components.filter((c) => c.period === period).reduce((sum, comp) => {
        const rates = comp.items.map((i) => itemRate(scores[i.id], i.max_score, i.is_rate_direct, formula));
        return sum + (rates.reduce((s, r) => s + r, 0) / rates.length) * (parseFloat(comp.weight) / 100);
      }, 0);
      const mid = composite('Midterm');
      const fin = composite('Finals');
      const average = combinedGWA(mid, fin);
      grades.push({
        class_id: CLASS_ID, student_id: u.id,
        midterm: toGWA(mid), finals: toGWA(fin), average,
        status: average >= 1.0 && average <= 3.01 ? 'Passed' : 'Failed',
        is_draft: true,
      });
    }
    await ComponentScore.bulkCreate(scoreRows, { transaction });
    await Grade.bulkCreate(grades, { hooks: false, transaction });
    console.log(`Added ${users.length} test students (student no. 900001–${900000 + users.length}), ${scoreRows.length} scores, ${grades.length} grades.`);
  });

  console.log(`Class ${CLASS_ID} now has ${await Enrollment.count({ where: { class_id: CLASS_ID } })} students.`);
  await sequelize.close();
})().catch((e) => { console.error('Failed — nothing was added:', e.message); process.exit(1); });
