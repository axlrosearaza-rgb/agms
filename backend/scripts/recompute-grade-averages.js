/**
 * Backfill for the composite→GWA formula (gradeComponentController.js's
 * toGWA/combinedGWA): each Term Grade rounded to a whole number before its
 * equivalent is looked up, and the Overall Grade = the true average of both
 * exact composites, rounded once to a whole number. Existing Grade rows still
 * carry whatever Grade.midterm/Grade.finals/Grade.average an OLDER formula
 * produced (e.g. flooring the composite to 0.1). Recomputes and overwrites Grade.midterm,
 * Grade.finals, AND Grade.average/status, via the exact same toGWA()/
 * combinedGWA() formulas the live app now uses, for every class that has
 * Grade Components. Never touches INC/DRP rows (their average is either
 * null or not this formula's business), and never touches manual-entry
 * classes (no components to recompute from).
 *
 * Only reports/updates rows whose value actually changes.
 *
 * Run: node scripts/recompute-grade-averages.js
 *      node scripts/recompute-grade-averages.js --dry-run   (report only, no writes)
 */
require('dotenv').config();
const { sequelize } = require('../config/database');
const { Grade, Class, GradeComponent, ComponentItem, ComponentScore } = require('../models');

const dryRun = process.argv.includes('--dry-run');

// ── Mirrors gradeComponentController.js exactly (kept in sync manually,
// same as every other copy of this formula across the codebase) ──────────
const RATE_FORMULAS = {
  '50_45': { base: 50, range: 45 },
  '60_35': { base: 60, range: 35 },
};
const getRateFormula = (cls) => RATE_FORMULAS[cls?.rate_formula] || RATE_FORMULAS['50_45'];
const itemRate = (score, maxScore, isRateDirect, formula) => {
  const s = parseFloat(score);
  if (isRateDirect) return Math.min(formula.base + formula.range, Math.max(formula.base, s));
  const m = parseFloat(maxScore) || 100;
  return (s / m) * formula.range + formula.base;
};
// Whole-number Term Grade → equivalent; Overall Grade = true average of both
// exact composites, rounded once to a whole number → equivalent. Same
// functions the live app uses.
const { toGWA, combinedGWA } = require('../controllers/gradeComponentController');

// Rounds to a fixed number of decimals for the DIFF COMPARISON only (so a
// float-noise difference like 2.3899999999998 vs 2.39 doesn't get reported
// as a "change" — the actual stored DECIMAL column already rounds on save).
const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100 + 1e-9) / 100);

async function main() {
  const classes = await Class.findAll({
    include: [{ model: GradeComponent, as: 'components', include: [{ model: ComponentItem, as: 'items' }] }],
  });

  let scanned = 0, changed = 0, skippedIncDrp = 0;
  const diffs = [];

  for (const cls of classes) {
    const components = cls.components || [];
    if (components.length === 0) continue; // manual-entry class — nothing to recompute from

    const midtermComps = components.filter((c) => c.period === 'Midterm');
    const finalsComps = components.filter((c) => c.period === 'Finals');
    if (midtermComps.length === 0 && finalsComps.length === 0) continue;

    const rateFormula = getRateFormula(cls);
    const grades = await Grade.findAll({ where: { class_id: cls.id } });
    if (grades.length === 0) continue;

    const itemIds = components.flatMap((c) => c.items.map((i) => i.id));
    const scores = await ComponentScore.findAll({ where: { item_id: itemIds, student_id: grades.map((g) => g.student_id) } });
    const scoreByStudentAndItem = {};
    scores.forEach((s) => {
      if (!scoreByStudentAndItem[s.student_id]) scoreByStudentAndItem[s.student_id] = {};
      scoreByStudentAndItem[s.student_id][s.item_id] = s.score !== null ? parseFloat(s.score) : null;
    });

    const periodComposite = (periodComps, studentId) => {
      const studentScores = scoreByStudentAndItem[studentId] || {};
      let composite = 0;
      for (const comp of periodComps) {
        const items = comp.items || [];
        if (items.length === 0) return null;
        if (!items.every((i) => studentScores[i.id] !== null && studentScores[i.id] !== undefined)) return null;
        const rates = items.map((i) => itemRate(studentScores[i.id], i.max_score, i.is_rate_direct, rateFormula));
        composite += (rates.reduce((s, r) => s + r, 0) / rates.length) * (parseFloat(comp.weight) / 100);
      }
      return composite;
    };

    for (const grade of grades) {
      scanned++;
      if (grade.status === 'INC' || grade.status === 'DRP') { skippedIncDrp++; continue; }

      const midComposite = midtermComps.length > 0 ? periodComposite(midtermComps, grade.student_id) : null;
      const finComposite = finalsComps.length > 0 ? periodComposite(finalsComps, grade.student_id) : null;

      const correctMidterm = midComposite !== null ? toGWA(midComposite) : null;
      const correctFinals = finComposite !== null ? toGWA(finComposite) : null;
      const currentMidterm = grade.midterm !== null ? parseFloat(grade.midterm) : null;
      const currentFinals = grade.finals !== null ? parseFloat(grade.finals) : null;

      let correctAvg = null, correctStatus = grade.status;
      if (midComposite !== null && finComposite !== null) {
        correctAvg = combinedGWA(midComposite, finComposite);
        correctStatus = correctAvg >= 1.0 && correctAvg <= 3.01 ? 'Passed' : 'Failed';
      }
      const currentAvg = grade.average !== null ? parseFloat(grade.average) : null;

      const midtermChanged = correctMidterm !== null && round2(currentMidterm) !== round2(correctMidterm);
      const finalsChanged = correctFinals !== null && round2(currentFinals) !== round2(correctFinals);
      const avgChanged = correctAvg !== null && (round2(currentAvg) !== round2(correctAvg) || grade.status !== correctStatus);

      if (midtermChanged || finalsChanged || avgChanged) {
        diffs.push({
          class_id: cls.id,
          student_id: grade.student_id,
          before: { midterm: currentMidterm, finals: currentFinals, average: currentAvg, status: grade.status },
          after: { midterm: midtermChanged ? correctMidterm : currentMidterm, finals: finalsChanged ? correctFinals : currentFinals, average: avgChanged ? correctAvg : currentAvg, status: avgChanged ? correctStatus : grade.status },
        });
        if (!dryRun) {
          if (midtermChanged) grade.midterm = correctMidterm;
          if (finalsChanged) grade.finals = correctFinals;
          if (avgChanged) {
            grade.average = correctAvg;
            grade.status = correctStatus;
          }
          await grade.save({ skipAutoAverage: true });
        }
        changed++;
      }
    }
  }

  console.log(`Scanned ${scanned} grade(s) across ${classes.length} class(es) (${skippedIncDrp} INC/DRP skipped).`);
  console.log(`${dryRun ? 'Would change' : 'Changed'} ${changed} grade(s):`);
  diffs.forEach((d) => {
    console.log(`  class ${d.class_id} / student ${d.student_id}:`);
    console.log(`    midterm ${d.before.midterm} -> ${d.after.midterm}`);
    console.log(`    finals  ${d.before.finals} -> ${d.after.finals}`);
    console.log(`    average ${d.before.average} -> ${d.after.average}, status ${d.before.status} -> ${d.after.status}`);
  });
  if (dryRun) console.log('\n(--dry-run: no writes made. Re-run without --dry-run to apply.)');
}

main()
  .then(() => sequelize.close())
  .catch((err) => {
    console.error(err);
    return sequelize.close().then(() => process.exit(1));
  });
