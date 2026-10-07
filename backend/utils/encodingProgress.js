// Class Record encoding progress, shared by My Classes, Grade Approval and the
// Chairperson / Admin dashboards. Updates every time the Class Record is
// saved. Each period is half: a student's Midterm counts 50%, their Finals the
// other 50%; a student marked INC or Dropped counts as fully done.
const { fn, col, literal } = require('sequelize');
const { Grade } = require('../models');

// classIds → Map(class_id → { midterm, finals, done, last })
async function encodingCounts(classIds) {
  const out = new Map();
  if (!classIds.length) return out;
  const rows = await Grade.findAll({
    where: { class_id: classIds },
    attributes: [
      'class_id',
      [literal("COUNT(*) FILTER (WHERE midterm IS NOT NULL AND status NOT IN ('INC', 'DRP'))"), 'midterm'],
      [literal("COUNT(*) FILTER (WHERE finals IS NOT NULL AND status NOT IN ('INC', 'DRP'))"), 'finals'],
      [literal("COUNT(*) FILTER (WHERE status IN ('INC', 'DRP'))"), 'done'],
      [fn('MAX', col('updated_at')), 'last'],
    ],
    group: ['class_id'],
    raw: true,
  });
  rows.forEach((r) => out.set(r.class_id, {
    midterm: parseInt(r.midterm, 10) || 0,
    finals: parseInt(r.finals, 10) || 0,
    done: parseInt(r.done, 10) || 0,
    last: r.last || null,
  }));
  return out;
}

// The fields every class row carries: midterm/finals counts, %, last save.
function encodingFields(counts, studentCount) {
  const c = counts || { midterm: 0, finals: 0, done: 0, last: null };
  const midterm = Math.min(c.midterm + c.done, studentCount);
  const finals = Math.min(c.finals + c.done, studentCount);
  return {
    midterm_encoded: midterm,
    finals_encoded: finals,
    // Fully encoded = both periods (or INC/Dropped).
    graded_count: Math.min(Math.min(midterm, finals), studentCount),
    encoding_progress: studentCount > 0 ? Math.round(((midterm + finals) / (2 * studentCount)) * 100) : 0,
    last_saved_at: c.last,
  };
}

module.exports = { encodingCounts, encodingFields };
