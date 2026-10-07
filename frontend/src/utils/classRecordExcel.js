// ── SSU Class Record — single source of truth for the grading formula, the
// shared color palette, and the Excel export ────────────────────────────────
// Used by pages/instructor/GradeEncoding.js (the live editable grid + its own
// Export button) AND pages/common/ClassRecordView.js (the read-only Class
// Record Admin/Chairperson open from Grade Approval/Grading Sheets, which
// also auto-prints itself). Both need the exact same formula, the exact same
// colors, and the exact same Excel file — pulling them from one module is
// what keeps them from silently drifting apart.
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { programShortLabel, comparePeopleNames, formatPersonNameFirstLast, formatPersonNameCapsSurname } from '../components/common';
import { getSemesterFor, yearAbbrOf } from './semesterLabels';

// ── Grading formula (mirrors backend/controllers/gradeComponentController.js
// exactly) ───────────────────────────────────────────────────────────────────
// Which score→Rate transmutation a class uses is a per-Class choice
// (Class.rate_formula, set from Grade Component Setup) — '50_45' is the SSU
// default (Rate = (score/max)*45 + 50, range 50-95), '60_35' is the
// alternate (Rate = (score/max)*35 + 60, range 60-95). Both top out at 95
// for a perfect score; only the floor for a 0 score differs. Keep this in
// sync with backend/controllers/gradeComponentController.js's own copy.
export const RATE_FORMULAS = {
  '50_45': { base: 50, range: 45 },
  '60_35': { base: 60, range: 35 },
};
export const getRateFormula = (classData) => RATE_FORMULAS[classData?.rate_formula] || RATE_FORMULAS['50_45'];

// Rate/Average/Weighted/Composite are all kept at FULL PRECISION here —
// nothing in this computation chain rounds or truncates. Rounding is purely
// a display concern, applied by each cell that renders one of these numbers,
// never fed back into further math — so Composite/GWA are computed from the
// exact values, not from compounded intermediate roundings. Mirrors the
// backend's own copy in gradeComponentController.js — keep both in sync.
// `isRateDirect` (item.is_rate_direct) skips the transmutation entirely —
// the value typed in for an item like this already IS the Rate (a Faculty
// member with no raw score to compute one from), just clamped to the same
// range the formula below would otherwise produce.
// `zeroFillMissing` — opt-in, used ONLY for an already-INC-flagged period's
// own PREVIEW figures (Composite/Half/GWA), never for a normal ungraded
// row and never fed back into anything that gets saved. A student still
// missing this item's score reads as a literal 0 instead of null, so the
// preview shows a real (if provisional) number — Rate then floors at
// formula.base (50 for the default 50_45 formula) exactly like a genuine 0
// score would, instead of leaving the whole period blank until every item
// is in.
export const itemRate = (score, maxScore, isRateDirect, formula = RATE_FORMULAS['50_45'], zeroFillMissing = false) => {
  if (score === null || score === undefined || score === '') {
    if (!zeroFillMissing) return null;
    score = 0;
  }
  const s = parseFloat(score);
  if (isNaN(s)) return null;
  if (isRateDirect) return Math.min(formula.base + formula.range, Math.max(formula.base, s));
  const m = parseFloat(maxScore) || 100;
  return (s / m) * formula.range + formula.base;
};

export const componentAverage = (comp, studentId, componentScores, formula = RATE_FORMULAS['50_45'], zeroFillMissing = false) => {
  const items = comp.items || [];
  if (items.length === 0) return null;
  const rates = items.map((item) => itemRate(componentScores[studentId]?.[item.id], item.max_score, item.is_rate_direct, formula, zeroFillMissing));
  if (rates.some((r) => r === null)) return null;
  // Exact average — no rounding.
  return rates.reduce((s, r) => s + r, 0) / rates.length;
};

// Grade equivalent of a WHOLE-NUMBER term/overall grade: 95+ → 1.0,
// 94 → 1.1, … 75 → 3.0, 74 → 3.1, … 55 and below → 5.0. Written as
// (105 − grade) / 10 rather than 10.5 − 0.1 × grade so a whole grade gives
// an exact one-decimal equivalent (79 → 2.6, not 2.5999999999999996).
const compositeToGWA = (grade) => {
  const gwa = (105 - grade) / 10;
  return Math.min(5.0, Math.max(1.0, gwa));
};

// Raw weighted composite for a period (0–100ish scale) — the real SSU Class
// Record's own "MIDTERM GRADE" / "FINAL TERM GRADE" figure, before it's
// converted to the 1.0–5.0 GWA scale.
export const periodComposite = (comps, studentId, componentScores, formula = RATE_FORMULAS['50_45'], zeroFillMissing = false) => {
  let composite = 0;
  for (const comp of comps) {
    const avg = componentAverage(comp, studentId, componentScores, formula, zeroFillMissing);
    if (avg === null) return null;
    // Exact weighted contribution — no rounding.
    composite += avg * (parseFloat(comp.weight) / 100);
  }
  return composite;
};

export const periodGWA = (comps, studentId, componentScores, formula = RATE_FORMULAS['50_45']) => {
  return gwaFromComposite(periodComposite(comps, studentId, componentScores, formula));
};

// A composite rounded off to a WHOLE number (half up: 79.5 → 80) — the
// Midterm/Final Term Grade and Overall Grade exactly as the Class Record
// shows them. The composite itself is computed at full precision; this is
// the one place it gets rounded, and every grade equivalent is looked up
// from this whole number, so the equivalent always matches the grade shown
// right beside it. Epsilon only cleans up floating-point noise (a true
// 79.5 stored as 79.49999999999999).
export const roundedComposite = (composite) => Math.round(composite + 1e-9);

// Grade equivalent (1.0–5.0) of a composite — looked up from its
// whole-number rounded value (see roundedComposite above).
export const gwaFromComposite = (composite) => {
  if (composite === null || composite === undefined) return null;
  return compositeToGWA(roundedComposite(composite));
};

// Whole-number display of a Term/Overall Grade ("80", never "79.5").
export const formatComposite = (composite) => {
  const n = parseFloat(composite);
  if (composite === null || composite === undefined || composite === '' || Number.isNaN(n)) return '';
  return String(roundedComposite(n));
};

// "Overall 1/2" — half of the TRUE (unrounded) Term Grade, e.g. 79.26 →
// 39.63. Kept exact so Midterm's half + Finals' half is the true Overall
// Grade; only its display is rounded, to a whole number (40).
export const halfComposite = (composite) => {
  if (composite === null || composite === undefined) return null;
  return composite / 2;
};

// Overall Grade — Midterm's Overall 1/2 + Finals' Overall 1/2, i.e. the
// TRUE average of both periods' exact composites. Rounded only once, at the
// very end (formatComposite/gwaFromComposite → a whole Overall Grade), so
// it isn't thrown off by first rounding each Term Grade and then rounding
// again (79.5 and 79.4 → 79.45 → 79, not 80 + 79 → 79.5 → 80).
export const overallComposite = (midComposite, finComposite) => {
  if (midComposite === null || midComposite === undefined || finComposite === null || finComposite === undefined) return null;
  return (midComposite + finComposite) / 2;
};

// The course's Final Grade = the simple average of the Midterm Grade and the
// Finals Grade (each already a 1-decimal period GWA) — the exact figure the
// Grade Sheet's "Final Grade" column shows (Grade.average, backend Grade
// model's beforeSave hook), so the Class Record's own Final Grade and
// Remarks read the same number instead of a Finals-only GWA. Used only as a
// fallback when there's no live composite to combine (see its callers).
export const finalGradeAverage = (midtermGwa, finalsGwa) => {
  if (midtermGwa === null || midtermGwa === undefined || finalsGwa === null || finalsGwa === undefined) return null;
  // Epsilon-corrected, same reason as gwaFromComposite/periodGWA above.
  return Math.round(((midtermGwa + finalsGwa) / 2) * 10 + 1e-9) / 10;
};

// One-decimal display for a grade, rounding half UP (1.45 → 1.5). Plain
// toFixed(1) rounds off the float's binary error instead (1.45 → "1.4"),
// which is what made the Grade Sheet and the Class Record disagree by 0.1
// on exactly those boundary averages. Matches the real official spreadsheet
// exactly — its own GWA cells are all formatted "0.0" — so every surface
// here (Class Record grid, Excel export, Grade Sheet screen and .docx) uses
// this for Midterm/Final Grade. (Term/Overall Grade composites use
// formatComposite instead, which rounds to a whole number.)
export const formatGrade = (value) => {
  const n = parseFloat(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(n)) return '';
  return (Math.round(n * 10 + 1e-9) / 10).toFixed(1);
};

// Same epsilon-corrected rounding as formatGrade, but for a value that
// ISN'T always a grade (the Weighted/Ave×weight% column, or Overall 1/2) —
// shows a decimal only when there actually is one; a whole number (e.g.
// 20.0) shows as plain "20", the same trailing-.0 trim weight% already gets
// (parseFloat(c.weight) — a real 25% never showed as "25.0%"). `maxDecimals`
// defaults to 1 (Weighted's own precision); Overall 1/2 passes 2, since
// halving a 1-decimal composite (e.g. 83.3 ÷ 2 = 41.65) can genuinely need
// a second decimal place to stay exact — JS's own number→string conversion
// already drops any trailing zero on top (41.50 prints as "41.5"), so no
// extra trimming logic is needed for the 2-decimal case either.
export const fmtTrimmed = (value, maxDecimals = 1) => {
  const n = parseFloat(value);
  if (value === null || value === undefined || value === '' || Number.isNaN(n)) return '';
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(n * factor + 1e-9) / factor;
  return String(rounded);
};

// ── Remarks (mirrors pages/common/GradingSheet.js exactly) ─────────────────
// INC intentionally has NO Remarks verdict — there's nothing to judge
// Passed/Failed on while a period is still incomplete, and every consumer
// already marks the row INC its own way (a dedicated badge, dimmed styling,
// a blank Final Grade cell) — repeating "INC" here read as a verdict the
// row doesn't actually have yet. Falls through to the same blank '' every
// other not-yet-decided status gets.
// A student whose INC wasn't completed by its deadline (grade.inc_lapsed_at,
// now 5.0 / Failed): the Remarks show the reason the faculty typed when
// marking the INC instead of "FAILED".
export const isLapsedInc = (grade) => !!(grade && grade.inc_lapsed_at && String(grade.status || '').toLowerCase() === 'failed');
// Remarks for a student marked INC — still INC, or lapsed to 5.0 — are the
// reason the faculty typed when marking them (Reason / Remarks), not "INC".
export const remarksText = (status, grade) => {
  const s = String(status || '').trim().toLowerCase();
  const isInc = s === 'inc' || s === 'incomplete';
  if (grade && grade.inc_remarks && String(grade.inc_remarks).trim() && (isInc || isLapsedInc(grade))) return String(grade.inc_remarks).trim();
  return remarksFor(status);
};

export const remarksFor = (status) => {
  if (!status) return '';
  const s = String(status).trim().toLowerCase();
  if (s === 'inc' || s === 'incomplete') return 'INC';
  if (s === 'passed' || s === 'pass') return 'PASSED';
  if (s === 'failed' || s === 'fail') return 'FAILED';
  if (s === 'drp' || s === 'drop' || s === 'dropped') return 'DROP';
  return '';
};

// Spells "DROPPED" across a row's own item/component/tail cells for a
// student who officially dropped the class — one letter per cell, repeated
// for however many cells this class's own components happen to need, so the
// WHOLE row reads as unmistakably out of the running at a glance instead of
// just its final-grade column.
//
// This is precomputed for the row's exact total cell count up front, NOT
// generated one cell at a time from a running index — a plain `index % 8`
// cycle has no idea how many cells are actually left in the row, so it can
// (and did) start spelling "DROPPED" right before the row runs out of
// cells and get cut off mid-word ("...DROPP" then straight into the next
// column). Precomputing means a repetition only ever STARTS if there's
// room for all 7 letters before the row ends; anything left over after the
// last complete word just stays a blank (still red) cell instead of a
// truncated fragment — so every "DROPPED" that appears is always the whole
// word, never a partial one.
const DROP_WORD = 'DROPPED';
export const dropSequence = (totalCells) => {
  const seq = new Array(Math.max(0, totalCells)).fill('');
  let pos = 0;
  while (pos + DROP_WORD.length <= seq.length) {
    for (let i = 0; i < DROP_WORD.length; i++) seq[pos + i] = DROP_WORD[i];
    pos += DROP_WORD.length + 1; // +1 reserves a blank gap before the next repeat
  }
  return seq;
};

// The gap cell dropSequence reserves between repeats stays the same solid
// red as every letter cell — just with no letter drawn in it — so the whole
// row reads as one unbroken red band (the individual cell borders already
// separate each repeat of the word visually; the fill doesn't need to).
export const dropCellStyle = () => ({ background: '#D64545', color: '#FFFFFF' });

// CSS-hex version, for the on-screen Class Record view — green for Passed,
// pink for Failed, pale yellow for INC (matches the real spreadsheet's own
// conditional formatting). DRP isn't one of the real file's own rules; this
// app tracks DRP as its own status, styled red so a dropped student reads
// as unmistakably different from everyone else at a glance.
export const remarksStyle = (status) => {
  if (!status) return { bg: '#FFFFFF', color: '#999' };
  const s = String(status).trim().toLowerCase();
  if (s === 'passed' || s === 'pass') return { bg: '#C6EFCE', color: '#006100' };
  if (s === 'failed' || s === 'fail') return { bg: '#FFC7CE', color: '#9C0006' };
  if (s === 'drp' || s === 'drop' || s === 'dropped') return { bg: '#D64545', color: '#FFFFFF' };
  if (s === 'inc' || s === 'incomplete') return { bg: '#FFF2CC', color: '#B25900' };
  return { bg: '#FFFFFF', color: '#999' };
};

// CSS-hex palette — shared by the live editable Class Record grid
// (GradeEncoding.js's PeriodTable), the standalone Class Record view
// (ClassRecordView.js), and the Excel export, cycling by component position
// so it stays correct no matter how a class's components are set up
// (renamed, reweighted, more/fewer than the standard 5). Class Participation
// is a deliberately different light blue from Summative Test's (not the same
// hue at a different tint) so the two are never confusable even side by
// side. Practical Exercises/Performance Task — a genuinely recurring custom
// category across the proposed-grading-system documents, not covered by the
// original 5 official slots — gets its own dedicated purple instead of
// falling back onto whatever position it happened to land on, which used to
// coincidentally collide with Class Participation's old grey.
export const GROUP_COLORS = [
  { header: '#9CC2E5', data: '#DEEAF6' }, // Summative Test
  { header: '#6FA8DC', data: '#D3E2F3' }, // Class Participation
  { header: '#A5A5A5', data: '#D8D8D8' }, // Course Exercises/Laboratory
  { header: '#A8D08D', data: '#E2EFD9' }, // Project/Term Requirement
  { header: '#F4B083', data: '#F7CAAC' }, // Major/Final Exam
  { header: '#B4A7D6', data: '#E6E0F2' }, // Practical Exercises/Performance Task
];

// Matches a component's own NAME against what the official SSU Class Record
// actually calls that slot, so e.g. "Class Participation" always gets its
// real light blue (GROUP_COLORS[1]) no matter which position it happens to
// sit in on a custom-ordered/custom-scheme class — instead of just
// inheriting whatever color its position lands on, which is what a plain
// `ci % GROUP_COLORS.length` does and is wrong the moment a class's
// components aren't in the exact official order.
const NAME_COLOR_KEYWORDS = [
  { index: 0, keywords: ['summative'] },
  { index: 1, keywords: ['class participation', 'participation'] },
  { index: 2, keywords: ['laboratory', 'course exercise'] },
  { index: 3, keywords: ['project', 'term requirement'] },
  { index: 4, keywords: ['major exam', 'final exam', 'midterm exam'] },
  { index: 5, keywords: ['practical exercise', 'performance task'] },
];
// Resolves every component in one period block to a color index in a single
// pass so two components never end up sharing a fill by coincidence — e.g.
// an unrecognized name that happens to sit at the same position a *later*
// component's keyword claims would, under pure per-item position-cycling,
// have silently duplicated that later component's color. Keyword matches
// are honored first-come-first-served; anything left over (no keyword, or
// its keyword's slot was already claimed by an earlier component of the
// same kind) gets the next color nobody else in this block is using yet.
const resolveComponentColors = (names) => {
  const used = new Set();
  const result = new Array(names.length).fill(null);
  names.forEach((name, i) => {
    const lower = (name || '').toLowerCase();
    const match = NAME_COLOR_KEYWORDS.find(({ keywords }) => keywords.some((k) => lower.includes(k)));
    if (match && !used.has(match.index)) {
      result[i] = match.index;
      used.add(match.index);
    }
  });
  names.forEach((_, i) => {
    if (result[i] !== null) return;
    let idx = i % GROUP_COLORS.length;
    let tries = 0;
    while (used.has(idx) && tries < GROUP_COLORS.length) {
      idx = (idx + 1) % GROUP_COLORS.length;
      tries++;
    }
    result[i] = idx; // palette exhausted (more components than colors) — a repeat is unavoidable here
    used.add(idx);
  });
  return result;
};
// `allNames` (every component's name in this same period block, in order) is
// optional so old call sites still work standalone, but every real call site
// in this file/ClassRecordView.js/GradeEncoding.js passes it — without it,
// two differently-named-but-both-unmatched components could still collide.
export const componentColorIndex = (name, position, allNames = null) => {
  if (allNames) return resolveComponentColors(allNames)[position];
  const lower = (name || '').toLowerCase();
  const match = NAME_COLOR_KEYWORDS.find(({ keywords }) => keywords.some((k) => lower.includes(k)));
  return match ? match.index : position % GROUP_COLORS.length;
};
// Verified against the real official SSU Class Record spreadsheet: the
// Midterm block's own informational GWA header is a darker gold (#DEA900),
// but every actual GWA/Final Grade DATA cell — Midterm's informational one
// AND the Finals block's real "FINAL GRADE" — is filled with the brighter
// #FFC000, and the Finals header itself uses that same brighter shade rather
// than reusing the Midterm header's darker one. Matched exactly rather than
// approximated, since this is the column that carries the actual final say.
export const GWA_HEADER_COLOR = '#DEA900';
export const GWA_DATA_COLOR = '#FFC000';
export const FINAL_GWA_HEADER_COLOR = '#FFC000';

// SSU Class Record standard breakdown (matches the official Class Record
// exactly, including each component's sub-items) — used to auto-init a
// fresh class's components (see buildComponentsFromScheme below). Export
// itself never assumes this shape — every class's Excel export is always
// built from its own actual components, since real subjects' schemes differ
// from each other and a fixed-shape file can't adapt to that. This constant
// only supplies the visual STYLE (colors, fonts, layout), not the structure.
export const SSU_TEMPLATE = [
  { name: 'Summative Test', weight: 25, items: [{ name: 'Test 1', max_score: 30 }, { name: 'Test 2', max_score: 30 }] },
  { name: 'Class Participation', weight: 5, items: [{ name: 'Quiz 1', max_score: 10 }, { name: 'Quiz 2', max_score: 10 }, { name: 'Ass. 1', max_score: 10 }, { name: 'Recit.', max_score: 100 }] },
  { name: 'Course Exercises/Laboratory', weight: 10, items: [{ name: 'Lab.1', max_score: 10 }, { name: 'Lab.2', max_score: 10 }, { name: 'Lab.3', max_score: 30 }] },
  { name: 'Project/Term Requirement', weight: 20, items: [{ name: 'Rate', max_score: 100 }] },
  { name: 'Major Exam', weight: 40, items: [{ name: '100 items', max_score: 100 }] },
];

// Turns a subject's own grading_scheme ([{ name, weight }], set when the
// subject was created) into full Midterm + Finals GradeComponent payloads. If
// the scheme's weights happen to be exactly the standard SSU breakdown
// (25/5/10/20/40, same order), auto-init with the REAL item structure (Test
// 1/Test 2, Quiz 1-4, Lab.1-3, etc.) instead of one bare starter item — so a
// fresh class already matches the official Class Record exactly (same items,
// same max scores), not just the same weights. Component NAMES still come
// from the subject's own scheme (Faculty/Admin can rename them there), only
// the item breakdown borrows from SSU_TEMPLATE. Any other weight arrangement
// (a genuinely custom scheme, e.g. 20/60/20) still gets the simple one-item
// starter, since there's no known standard item breakdown to apply to it.
export const buildComponentsFromScheme = (scheme) => {
  const matchesSSUWeights = scheme.length === SSU_TEMPLATE.length &&
    scheme.every((c, i) => Math.abs((parseFloat(c.weight) || 0) - SSU_TEMPLATE[i].weight) < 0.01);

  const build = (period) => scheme.map((c, i) => ({
    name: c.name,
    period,
    weight: parseFloat(c.weight) || 0,
    order_index: i,
    items: matchesSSUWeights
      ? SSU_TEMPLATE[i].items.map((it, j) => ({ ...it, order_index: j }))
      : [{ name: 'Score', max_score: 100, order_index: 0 }],
  }));
  return [...build('Midterm'), ...build('Finals')];
};

// `classData.semester` bakes its own academic year into the string ("First
// Semester 2026-2027"), but the export already shows the year on its own
// separate line ("SY 2026-2027") right next to it — writing the raw
// semester string as-is prints the year TWICE ("SY 2026-2027 ... First
// Semester 2026-2027"), which the real official spreadsheet never does (its
// own semester line reads just "First Semester", no year). Strips the same
// year substring the "SY ..." line already displays, so the two lines stay
// complementary instead of redundant.
export const stripYearFromSemester = (semester, academicYear) => {
  const raw = semester || '';
  const withoutYear = academicYear ? raw.replace(academicYear, '') : raw.replace(/\d{4}-\d{4}/, '');
  return withoutYear.replace(/,?\s*$/, '').trim();
};

// ── Excel export helpers ────────────────────────────────────────────────────
// 1-based column index -> letter ("A", "Z", "AA", …) — used to build actual
// Excel formula references (not exposed by ExcelJS as a plain utility function).
const colLetter = (n) => {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

// Score+Rate per item, then Ave, then the component's own Weighted
// contribution (Ave × weight%) — matches the real spreadsheet, which shows
// that weighted figure as its own column per component rather than folding
// it invisibly into a single composite formula.
const buildPeriodColumns = (comps) => {
  const cols = [];
  comps.forEach((c) => {
    (c.items || []).forEach((item) => {
      // A direct-rate item has no raw score at all — just the one Rate
      // column. When show_rate is false, Rate is omitted.
      if (!item.is_rate_direct) cols.push({ kind: 'score', comp: c, item });
      if (item.show_rate !== false) cols.push({ kind: 'rate', comp: c, item });
    });
    if (c.show_ave !== false) cols.push({ kind: 'ave', comp: c });
    cols.push({ kind: 'weighted', comp: c });
  });
  return cols;
};

const THIN_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }, bottom: { style: 'thin' } };
const DATA_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }, bottom: { style: 'thin' } };

// Exact palette from the real official SSU Class Record spreadsheet — cycles
// by component position (1st component gets the Summative Test blue, 2nd
// gets Class Participation grey, and so on) so ANY class gets the authentic
// look regardless of how many components it has or what they're named.
// Mirrors GROUP_COLORS above exactly (ARGB instead of CSS hex) — same 6
// slots, same indices, so componentColorIndex()'s result means the same
// color whichever palette it's used to look up.
const EXPORT_GROUP_COLORS = [
  { header: 'FF9CC2E5', data: 'FFDEEAF6' }, // Summative Test
  { header: 'FF6FA8DC', data: 'FFD3E2F3' }, // Class Participation
  { header: 'FFA5A5A5', data: 'FFD8D8D8' }, // Course Exercises/Laboratory
  { header: 'FFA8D08D', data: 'FFE2EFD9' }, // Project/Term Requirement
  { header: 'FFF4B083', data: 'FFF7CAAC' }, // Major/Final Exam
  { header: 'FFB4A7D6', data: 'FFE6E0F2' }, // Practical Exercises/Performance Task
];
const COMPOSITE_HEADER = 'FF7B7B7B';   // "Midterm/Final Term Grade" (raw 0-100 composite)
const COMPOSITE_DATA = 'FFEFEFEF';
const HALF_HEADER = 'FFADB9CA';        // "Overall 1/2" (composite * 50%)
const HALF_DATA = 'FFEEF1F5';
const OVERALL_HEADER = 'FF00B0F0';     // "Overall Grade" (combined composite, both periods)
const OVERALL_DATA = 'FFDCF1FB';
const GWA_HEADER = 'FFDEA900';         // Midterm's own informational GWA header only
const GWA_DATA = 'FFFFC000';
const FINAL_GWA_HEADER = 'FFFFC000';
// A proper solid green, not the pale FFCCFFCC this used to be — every tail
// header (including this one) gets bold WHITE text, and white-on-pale-green
// was nearly unreadable. Matches the visual weight of the other tail headers
// (the bright blue Overall Grade, the gold GWA/Final Grade) instead of
// looking washed out next to them.
const REMARKS_HEADER = 'FF548235';
const remarksExcelStyle = (status) => {
  if (!status) return { bg: 'FFFFFFFF', font: 'FF000000' };
  const s = String(status).trim().toLowerCase();
  if (s === 'passed' || s === 'pass') return { bg: 'FFC6EFCE', font: 'FF006100' };
  if (s === 'failed' || s === 'fail') return { bg: 'FFFFC7CE', font: 'FF9C0006' };
  if (s === 'drp' || s === 'drop' || s === 'dropped') return { bg: 'FFD64545', font: 'FFFFFFFF' };
  if (s === 'inc' || s === 'incomplete') return { bg: 'FFFFF2CC', font: 'FFB25900' };
  return { bg: 'FFFFFFFF', font: 'FF000000' };
};

// Writes one full period block (Midterm or Finals) — component groups in
// their real colors, plus the tail columns the real spreadsheet ends each
// half with: Midterm ends in Grade → Overall 1/2 → GWA; Finals ends in Grade
// → Overall 1/2 → the combined Overall Grade → Final Grade (GWA) → Remarks
// (needs the OTHER period's components too, to compute that combined figure).
//
// Every computed cell (Rate/Ave/Weighted/Grade/Half/GWA) is a LIVE Excel
// formula, not a pre-computed number — same as the real official spreadsheet,
// generalized to whatever this class's own components happen to be.
const writePeriodSection = (ws, tableStartRow, comps, studentGrades, componentScores, variant, otherComps = [], midtermRef = null, startCol = 1, formula = RATE_FORMULAS['50_45']) => {
  const isFinals = variant === 'finals';
  const cols = buildPeriodColumns(comps);
  const tailCount = isFinals ? 5 : 3;
  const totalCols = 3 + cols.length + tailCount;
  const colOffset = startCol - 1;

  const headerRow1 = tableStartRow;     // component group name
  const headerRow2 = tableStartRow + 1; // item name / Ave / weight%
  const headerRow3 = tableStartRow + 2; // item max score
  const headerRow4 = tableStartRow + 3; // SCORE / RATE labels
  const headerLastRow = headerRow4;

  ws.mergeCells(headerRow1, startCol, headerLastRow, startCol);
  const noHeaderCell = ws.getCell(headerRow1, startCol);
  noHeaderCell.value = 'No.';
  noHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF757070' } };
  ws.mergeCells(headerRow1, startCol + 1, headerLastRow, startCol + 1);
  const studentNoHeaderCell = ws.getCell(headerRow1, startCol + 1);
  studentNoHeaderCell.value = 'Student No.';
  studentNoHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF757070' } };
  ws.mergeCells(headerRow1, startCol + 2, headerLastRow, startCol + 2);
  const nameHeaderCell = ws.getCell(headerRow1, startCol + 2);
  nameHeaderCell.value = 'Name';
  nameHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFAEABAB' } };

  let colIdx = startCol + 3;
  const scoreRateCols = [];
  const rotatedNameCols = [];
  const compNames = comps.map((c) => c.name);
  comps.forEach((c, ci) => {
    const color = EXPORT_GROUP_COLORS[componentColorIndex(c.name, ci, compNames)];
    // A direct-rate item has no raw score at all — just the one Rate
    // column, not the usual Score+Rate pair. When show_rate is false, Rate is hidden.
    const span = (c.items || []).reduce((s, item) => s + (item.is_rate_direct ? (item.show_rate !== false ? 1 : 0) : (item.show_rate !== false ? 2 : 1)), 0) + (c.show_ave === false ? 1 : 2);
    const groupFirstCol = colIdx;
    ws.mergeCells(headerRow1, colIdx, headerRow1, colIdx + span - 1);
    const cCell = ws.getCell(headerRow1, colIdx);
    cCell.value = c.name;
    cCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.header } };

    (c.items || []).forEach((item) => {
      const itemSpan = item.is_rate_direct ? (item.show_rate !== false ? 1 : 0) : (item.show_rate !== false ? 2 : 1);
      if (itemSpan === 0) return;
      if (item.is_rate_direct) {
        // Rows 3-4 are otherwise entirely blank for a rate-only item (no max
        // score, no SCORE/RATE sub-labels) — merged (rowSpan) into this one
        // cell with the name rotated vertical instead of wasting that space,
        // matching the real official Class Record's own rate-only columns
        // ("Unit Activity", "Attendance", "Recitation", ...).
        ws.mergeCells(headerRow2, colIdx, headerRow4, colIdx);
        ws.getCell(headerRow2, colIdx).value = item.name;
        if ((item.name || '').length > 5) rotatedNameCols.push(colIdx);
      } else if (item.show_rate === false) {
        // Rate hidden — only 1 column (Score).
        if (item.show_score === false) {
          ws.mergeCells(headerRow2, colIdx, headerRow3, colIdx);
          ws.getCell(headerRow2, colIdx).value = item.name;
        } else {
          ws.getCell(headerRow2, colIdx).value = item.name;
          ws.getCell(headerRow3, colIdx).value = parseFloat(item.max_score);
        }
        ws.getCell(headerRow4, colIdx).value = 'SCORE';
        scoreRateCols.push(colIdx);
      } else if (item.show_score === false) {
        // Max hidden — row 3 would otherwise be a blank gap under this
        // item's name, so the name cell grows down to fill that space
        // instead (merged across rows 2+3) rather than leaving it empty.
        // Row 4 (SCORE/RATE) still sits below normally — the actual SCORE
        // a student earned always shows there regardless; show_score only
        // affects this Max header.
        ws.mergeCells(headerRow2, colIdx, headerRow3, colIdx + 1);
        ws.getCell(headerRow2, colIdx).value = item.name;
        ws.getCell(headerRow4, colIdx).value = 'SCORE';
        ws.getCell(headerRow4, colIdx + 1).value = 'RATE';
        scoreRateCols.push(colIdx, colIdx + 1);
      } else {
        ws.mergeCells(headerRow2, colIdx, headerRow2, colIdx + 1);
        ws.mergeCells(headerRow3, colIdx, headerRow3, colIdx + 1);
        ws.getCell(headerRow2, colIdx).value = item.name;
        ws.getCell(headerRow3, colIdx).value = parseFloat(item.max_score);
        ws.getCell(headerRow4, colIdx).value = 'SCORE';
        ws.getCell(headerRow4, colIdx + 1).value = 'RATE';
        scoreRateCols.push(colIdx, colIdx + 1);
      }
      for (let r = headerRow2; r <= headerRow4; r++) {
        for (let cc = colIdx; cc <= colIdx + itemSpan - 1; cc++) {
          ws.getCell(r, cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.header } };
        }
      }
      // A rate-only item's column is a touch wider than a normal Score/Rate
      // half-column (3.5) — it's the item's ONLY column now, holding the
      // full rotated name, so it needs a little more breathing room to not
      // look cramped against its neighbors — same width as Ave/weight% below.
      ws.getColumn(colIdx).width = item.is_rate_direct ? 5.5 : 4.0;
      if (itemSpan === 2) ws.getColumn(colIdx + 1).width = 4.0;
      colIdx += itemSpan;
    });

    let aveCol = null;
    if (c.show_ave !== false) {
      ws.mergeCells(headerRow2, colIdx, headerLastRow, colIdx);
      ws.getCell(headerRow2, colIdx).value = 'Ave';
      ws.getColumn(colIdx).width = 5.0;
      aveCol = colIdx;
      colIdx += 1;
    }

    ws.mergeCells(headerRow2, colIdx, headerLastRow, colIdx);
    ws.getCell(headerRow2, colIdx).value = parseFloat(c.weight) / 100;
    // Whole percent, never a decimal — component weights are always whole
    // numbers in practice (SSU's own 25/5/10/20/40 breakdown), and some
    // spreadsheet viewers (Google Sheets, some LibreOffice builds) don't
    // reliably drop the optional digits a '0.##%'-style format asks for,
    // showing "20.0%" instead of "20%" even when the value has no real
    // fractional part.
    ws.getCell(headerRow2, colIdx).numFmt = '0%';
    ws.getColumn(colIdx).width = 5.0;
    const weightCol = colIdx;
    colIdx += 1;

    // Ensure the merged component header has enough width so words in c.name
    // (e.g. "CLASS PARTICIPATION", "Project/Term Requirement") never break mid-word.
    let currentGroupWidth = 0;
    for (let cc = groupFirstCol; cc <= weightCol; cc++) {
      currentGroupWidth += (ws.getColumn(cc).width || 8.43);
    }
    const compWords = (c.name || '').trim().split(/[\s/]+/).filter(Boolean);
    const longestWordLen = compWords.reduce((max, w) => Math.max(max, w.length), 0);
    const minWordWidth = longestWordLen * 0.9 + 2.5;
    const targetGroupWidth = Math.max(15.5, minWordWidth);

    if (currentGroupWidth < targetGroupWidth) {
      const neededExtra = targetGroupWidth - currentGroupWidth;
      const numCols = weightCol - groupFirstCol + 1;
      const addPerCol = neededExtra / numCols;
      for (let cc = groupFirstCol; cc <= weightCol; cc++) {
        ws.getColumn(cc).width = +(ws.getColumn(cc).width + addPerCol).toFixed(1);
      }
    }

    for (let r = headerRow1; r <= headerLastRow; r++) {
      for (let cc = groupFirstCol; cc <= weightCol; cc++) {
        if (cc === aveCol || cc === weightCol) {
          ws.getCell(r, cc).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color.header } };
        }
      }
    }
  });

  const tailHeaders = isFinals
    ? [
      { label: 'Final Term Grade', color: COMPOSITE_HEADER },
      { label: 'Overall 1/2', color: HALF_HEADER },
      { label: 'Overall Grade', color: OVERALL_HEADER },
      { label: 'Final Grade', color: FINAL_GWA_HEADER },
      { label: 'Remarks', color: REMARKS_HEADER },
    ]
    : [
      { label: 'Midterm Term Grade', color: COMPOSITE_HEADER },
      { label: 'Overall 1/2', color: HALF_HEADER },
      { label: 'Midterm Grade', color: GWA_HEADER },
    ];
  const tailColStart = colIdx;
  tailHeaders.forEach(({ label, color }) => {
    ws.mergeCells(headerRow1, colIdx, headerLastRow, colIdx);
    const cell = ws.getCell(headerRow1, colIdx);
    cell.value = label;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    cell.font = { bold: true, size: 9, name: 'Arial', color: { argb: 'FFFFFFFF' } };
    // Remarks holds actual WORDS ("FAILED", "PASSED") — the other tail
    // columns only ever hold a short number, so the shared 5.5 width was too
    // narrow for this one specifically and the text spilled out over its
    // neighbors instead of wrapping inside its own column. NOT literally 9 —
    // ExcelJS's own DEFAULT_COLUMN_WIDTH constant is exactly 9, and its
    // isCustomWidth check is `width !== DEFAULT_COLUMN_WIDTH`, so setting
    // this to precisely 9 makes ExcelJS think it was NEVER customized and
    // silently drops it from the file, leaving the real default in effect
    // instead of the wider column this needs.
    ws.getColumn(colIdx).width = label === 'Remarks' ? 9.5 : 6.0;
    colIdx += 1;
  });
  const tailColEnd = colIdx - 1;

  for (let r = headerRow1; r <= headerLastRow; r++) {
    for (let c = startCol; c <= colOffset + totalCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = cell.font || { bold: true, size: 9, name: 'Arial' };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = THIN_BORDER;
    }
  }
  for (let c = tailColStart; c <= tailColEnd; c++) {
    ws.getCell(headerRow1, c).alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
  }
  scoreRateCols.forEach((c) => {
    ws.getCell(headerRow4, c).alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
  });
  rotatedNameCols.forEach((c) => {
    ws.getCell(headerRow2, c).alignment = { horizontal: 'center', vertical: 'middle', textRotation: 90 };
  });

  const wrappedLineCount = (text, charsPerLine) => {
    const words = (text || '').split(' ').filter(Boolean);
    if (words.length === 0) return 1;
    let lines = 1;
    let lineLen = 0;
    words.forEach((word) => {
      if (lineLen === 0) {
        lineLen = word.length;
      } else if (lineLen + 1 + word.length <= charsPerLine) {
        lineLen += 1 + word.length;
      } else {
        lines += 1;
        lineLen = word.length;
      }
    });
    return lines;
  };
  const headerRow1Height = comps.reduce((tallest, c) => {
    const itemColUnits = (c.items || []).reduce((s, item) => {
      const span = item.is_rate_direct ? (item.show_rate !== false ? 1 : 0) : (item.show_rate !== false ? 2 : 1);
      return s + span;
    }, 0);
    const approxWidthUnits = itemColUnits * 4.0 + (c.show_ave === false ? 0 : 5.0) + 5.0;
    const approxWidthPx = approxWidthUnits * 7 + 5;
    const charsPerLine = Math.max(6, Math.floor(approxWidthPx / 6));
    const linesNeeded = wrappedLineCount(c.name, charsPerLine);
    return Math.max(tallest, Math.min(linesNeeded * 16 + 12, 90));
  }, 48);
  ws.getRow(headerRow1).height = headerRow1Height;
  ws.getRow(headerRow2).height = 22;
  ws.getRow(headerRow3).height = 18;
  ws.getRow(headerRow4).height = 48;

  let row = headerLastRow + 1;
  const dataStartRow = row;
  let halfColIdx = null;
  // This section's own per-row TRUE (unrounded) composite formula fragment
  // — returned below so the Finals section, when combining both periods
  // into Final Grade, can reach back and use the Midterm's own EXACT
  // composite instead of its rounded Overall/Half display cells. Indexed by
  // `gi` (studentGrades' own row order), which both sections share.
  const exactComposites = [];

  studentGrades.forEach((g, gi) => {
    const noCell = ws.getCell(row, startCol);
    noCell.value = gi + 1;
    noCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF757070' } };
    ws.getCell(row, startCol + 1).value = g.student.student_no;
    // Surname first (e.g. "CERBITO, M. Karl Renzo") — same formatter the
    // Grade Sheet's roster uses, so the alphabetical-by-surname row order
    // (see exportClassRecordToExcel) is actually visible in the file.
    ws.getCell(row, startCol + 2).value = formatPersonNameCapsSurname(g.student.name);
    let c = startCol + 3;
    // INC is per period, not per student — a student marked INC whose scores
    // for THIS period are all in (e.g. complete in Midterm, missing in
    // Finals) still shows their real Midterm figures; only the period that's
    // actually missing scores reads INC.
    // Which period(s) are INC comes from the per-period flags
    // (inc_midterm / inc_finals — marked and resolved independently, so INC in
    // one never makes the other INC). A row from before the flags existed
    // (INC, neither set) falls back to "INC where this period's scores are
    // still incomplete".
    const hasIncFlags = !!(g.inc_midterm || g.inc_finals);
    const midRowComps = isFinals ? otherComps : comps;
    const finRowComps = isFinals ? comps : otherComps;
    const midRowDone = midRowComps.length === 0 || periodComposite(midRowComps, g.student.id, componentScores, formula) !== null;
    const finRowDone = finRowComps.length === 0 || periodComposite(finRowComps, g.student.id, componentScores, formula) !== null;
    // No flags = older data: INC in the earliest period still missing scores.
    const incMidRow = g.status === 'INC' && (hasIncFlags ? !!g.inc_midterm : !midRowDone);
    const incFinRow = g.status === 'INC' && (hasIncFlags ? !!g.inc_finals : (midRowDone && !finRowDone));
    // ONLY the period that was marked INC reads INC — the Finals block never
    // shows INC for a Midterm-only INC, and vice versa. An INC period no
    // longer blanks its own tail cells (Composite/Half/GWA/Overall) — they
    // show a zero-filled preview instead (see the item Rate/Ave/Weighted
    // formulas below), colored amber to flag it as provisional. Only a
    // DROPPED student's cells still blank out (spelling "DROPPED" across
    // the row) — a leftover computed figure there would read as "this
    // student was graded normally", which is exactly wrong.
    const isIncomplete = isFinals ? incFinRow : incMidRow;
    const isDropped = g.status === 'DRP';
    const blankFontColor = isDropped ? { argb: 'FF9C0006' } : undefined;
    const weightedRefs = [];
    // Precomputed for this row's EXACT total cell count (every component's
    // items + its own Ave/Weighted, plus the tail: Composite/Half/GWA for
    // Midterm, or Composite/Half/Overall/GWA for Finals — Remarks excluded,
    // it keeps its own real word) — see dropSequence's own comment for why
    // this can't just be a running `index % 8` counter.
    let dropIdx = 0;
    const dropTailCellCount = isFinals ? 4 : 3;
    // A direct-rate item only ever consumes ONE cell (just Rate, no Score),
    // not the usual Score+Rate pair — same as everywhere else in this row. When show_rate is false, Rate is hidden.
    const dropTotalCells = comps.reduce((sum, cp) => sum + (cp.items || []).reduce((s, item) => s + (item.is_rate_direct ? (item.show_rate !== false ? 1 : 0) : (item.show_rate !== false ? 2 : 1)), 0) + (cp.show_ave === false ? 1 : 2), 0) + dropTailCellCount;
    const dropSeq = isDropped ? dropSequence(dropTotalCells) : null;
    const DROP_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD64545' } };
    const DROP_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
    // The gap dropSequence reserves between repeats stays the same solid
    // red as every letter cell, just with no letter drawn in it — the real
    // cell borders already separate each repeat of the word visually.
    const setDropCell = (cell, letter) => {
      cell.value = letter;
      cell.fill = DROP_FILL;
      cell.font = DROP_FONT;
    };

    // exactWeightedExprs mirrors weightedRefs, but holds each component's
    // TRUE unrounded weighted contribution (an inline formula fragment, not
    // a cell reference) — Composite sums THESE, not the visible (rounded)
    // Weighted cells, so it isn't thrown off by that display rounding.
    // Same reasoning within each component: exactRateExprs holds each
    // item's unrounded Rate (never the visible, rounded Rate cell), so
    // Ave/Weighted are always computed from the real number, not the one
    // that's rounded off for display.
    const exactWeightedExprs = [];
    comps.forEach((comp, ci) => {
      const color = EXPORT_GROUP_COLORS[componentColorIndex(comp.name, ci, compNames)].data;
      const rateAddrs = [];
      const exactRateExprs = [];
      (comp.items || []).forEach((item) => {
        const score = componentScores[g.student.id]?.[item.id];

        // A direct-rate item has just the one Rate column — no Score
        // column at all — so it only ever consumes ONE cell (and one
        // DROPPED letter), not the usual Score+Rate pair. When show_rate is false, Rate is hidden.
        if (item.is_rate_direct) {
          const rawScore = score !== null && score !== undefined && score !== '' ? parseFloat(score) : (isIncomplete ? 0 : null);
          const exactVal = rawScore !== null ? Math.min(formula.base + formula.range, Math.max(formula.base, rawScore)) : null;
          if (item.show_rate !== false) {
            const rateAddr = `${colLetter(c)}${row}`;
            const rateCell = ws.getCell(row, c);
            if (isDropped) {
              setDropCell(rateCell, dropSeq[dropIdx++]);
            } else {
              // Rounded (whole-number display) — matches itemRate() in this
              // file. The item has no other cell to read from, so its own
              // exact (unrounded) clamp is embedded as a literal below.
              // Zero-filled when this period is INC and still missing this
              // score (matches itemRate's own zeroFillMissing) — a genuine 0
              // clamps to the same formula.base (50 for the default formula)
              // a real 0 score would.
              rateCell.value = exactVal !== null ? Math.round(exactVal) : null;
              rateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
              rateCell.font = { color: { argb: 'FFFF0000' } };
            }
            rateAddrs.push(rateAddr);
            c += 1;
            // When show_rate is true, exactRateExprs references the rateAddr cell so that
            // edits made directly in Excel recalculate the component average live!
            const clampedRateRef = isIncomplete
              ? `IF(ISNUMBER(${rateAddr}),MIN(${formula.base + formula.range},MAX(${formula.base},${rateAddr})),${formula.base})`
              : `MIN(${formula.base + formula.range},MAX(${formula.base},${rateAddr}))`;
            exactRateExprs.push(clampedRateRef);
          } else {
            // When Rate is hidden, fallback to exact value or '0'
            exactRateExprs.push(exactVal !== null ? String(exactVal) : (isIncomplete ? String(formula.base) : '0'));
          }
          return;
        }

        const maxScore = parseFloat(item.max_score) || 100;
        const scoreAddr = `${colLetter(c)}${row}`;
        const scoreCell = ws.getCell(row, c);
        const hasRate = item.show_rate !== false;

        const effectiveScore = (score !== null && score !== undefined && score !== '') ? parseFloat(score) : (isIncomplete ? 0 : null);
        const exactItemRate = effectiveScore !== null ? Math.round(((effectiveScore * formula.range) / maxScore) + formula.base) : null;

        if (isDropped) {
          // A dropped student has no real scores to show — replacing them
          // with real-looking numbers (or even a blank formula) would read
          // as "this student was graded normally", which is exactly wrong.
          setDropCell(scoreCell, dropSeq[dropIdx++]);
          if (hasRate) {
            const rateCell = ws.getCell(row, c + 1);
            setDropCell(rateCell, dropSeq[dropIdx++]);
          }
        } else {
          // The actual SCORE a student earned always shows regardless —
          // show_score only affects the Max header above, not this number.
          // Zero-filled for an incomplete period.
          scoreCell.value = effectiveScore;
          scoreCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };

          if (hasRate) {
            const rateAddr = `${colLetter(c + 1)}${row}`;
            const rateCell = ws.getCell(row, c + 1);
            // ROUND (whole-number display), matching itemRate() in this same
            // file. Ave/Weighted below read the exact expression (next
            // line), not this rounded cell. For an INC period still missing
            // this score, no ISBLANK guard at all — Excel treats a blank
            // cell as 0 in arithmetic, so this naturally computes to
            // formula.base (50) exactly like a genuine 0 score would,
            // matching itemRate's own zeroFillMissing.
            const rateFormulaStr = isIncomplete
              ? `ROUND((${scoreAddr}*${formula.range})/${maxScore}+${formula.base},0)`
              : `IF(ISBLANK(${scoreAddr}),"",ROUND((${scoreAddr}*${formula.range})/${maxScore}+${formula.base},0))`;
            rateCell.value = effectiveScore !== null
              ? { formula: rateFormulaStr, result: exactItemRate ?? formula.base }
              : { formula: rateFormulaStr, result: '' };
            rateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
            rateCell.font = { color: { argb: 'FFFF0000' } };
            rateAddrs.push(rateAddr);
          } else {
            rateAddrs.push(scoreAddr);
          }
        }

        exactRateExprs.push(`((${scoreAddr}*${formula.range})/${maxScore}+${formula.base})`);
        c += hasRate ? 2 : 1;
      });

      const allNumeric = rateAddrs.map((a) => `ISNUMBER(${a})`).join(',');
      const exactAveExpr = `AVERAGE(${exactRateExprs.join(',')})`;

      const compAvg = componentAverage(comp, g.student.id, componentScores, formula, isIncomplete);
      const aveResult = compAvg !== null ? Math.round(compAvg) : '';

      // comp.show_ave === false hides this column — Weighted below still
      // reads exactAveExpr (computed above regardless), just without a
      // visible Ave cell to show it in first.
      if (comp.show_ave !== false) {
        const aveCell = ws.getCell(row, c);
        if (isDropped) {
          setDropCell(aveCell, dropSeq[dropIdx++]);
        } else {
          if (rateAddrs.length > 0) {
            // ROUND — matches componentAverage() in this file, computed
            // from the exact (unrounded) rates above, not from the
            // rounded Rate cells. INC drops the AND(allNumeric) gate — the
            // exact expression above already reads its own still-blank
            // Rate cells (now unguarded too) as 0-filled, matching
            // componentAverage's own zeroFillMissing.
            aveCell.value = {
              formula: isIncomplete ? `ROUND(${exactAveExpr},0)` : `IF(AND(${allNumeric}),ROUND(${exactAveExpr},0),"")`,
              result: aveResult,
            };
          }
          aveCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
          aveCell.font = { bold: true };
          aveCell.numFmt = '0';
        }
        c += 1;
      }

      const weight = parseFloat(comp.weight) / 100;
      const weightedAddr = `${colLetter(c)}${row}`;
      const weightedCell = ws.getCell(row, c);
      const weightedVal = compAvg !== null ? Math.round(compAvg * weight + 1e-9) : null;
      const weightedResult = weightedVal !== null ? weightedVal : '';
      if (isDropped) {
        setDropCell(weightedCell, dropSeq[dropIdx++]);
      } else {
        if (rateAddrs.length > 0) {
          // Weighted = exact Ave × weight%, rounded to a whole number —
          // reads the exact average expression directly, not the (rounded)
          // Ave cell above, matching the live Class Record grid's own
          // Weighted column. INC drops the gate, same reason as the Ave
          // cell above.
          weightedCell.value = {
            formula: isIncomplete ? `ROUND(${exactAveExpr}*${weight},0)` : `IF(AND(${allNumeric}),ROUND(${exactAveExpr}*${weight},0),"")`,
            result: weightedResult,
          };
        }
        weightedCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        weightedCell.font = { bold: true };
        weightedCell.numFmt = '0';
      }
      weightedRefs.push(weightedAddr);
      // Feeds Composite's own exact sum below — INC drops the gate here
      // too, otherwise Composite would still fall back to 0 for this whole
      // component (not the zero-filled exactAveExpr) the moment any one
      // item in it is still blank.
      exactWeightedExprs.push(rateAddrs.length > 0
        ? (isIncomplete ? `${exactAveExpr}*${weight}` : `IF(AND(${allNumeric}),${exactAveExpr}*${weight},0)`)
        : '0');
      c += 1;
    });

    // A dropped student's tail cells (Composite → Half → GWA/Overall) keep
    // spelling "DROPPED" — same solid red band, same running dropIdx counter
    // continuing straight on from the last component cell above — instead of
    // switching to a plain grey/gold/blue cell with just red TEXT reading
    // "DROP". That mismatch (solid red band through the components, then a
    // color change right at the tail) was the "not aligned" problem: the
    // Midterm side's tail and the Finals side's Overall/GWA should look like
    // the exact same band the row started with, not a different treatment
    // tacked on at the end. INC is unaffected — it still shows plain 'INC'
    // text on the normal cell colors, since an Incomplete student is still
    // actively being graded, just not finished yet.
    const dropTail = (cell) => setDropCell(cell, dropSeq[dropIdx++]);

    // The real exact composite — rounded ONCE, to a whole number, by the
    // Term Grade cell below (compositeAddr). Half and the grade equivalent
    // then read that whole-number cell, so every figure in the tail agrees
    // with the Term Grade shown. Also kept for the Finals side's Overall
    // Grade (midtermRef.exactComposites).
    const exactCompositeExpr = `SUM(${exactWeightedExprs.join(',')})`;
    exactComposites.push(exactCompositeExpr);

    const compComposite = periodComposite(comps, g.student.id, componentScores, formula, isIncomplete);
    const compositeResult = compComposite !== null ? roundedComposite(compComposite) : '';

    const compositeAddr = `${colLetter(c)}${row}`;
    const compositeCell = ws.getCell(row, c);
    if (isDropped) {
      dropTail(compositeCell);
    } else {
      if (weightedRefs.length > 0) {
        // Gated on the visible Weighted cells being filled, but SUMS the
        // exact (unrounded) per-component contributions, not those
        // (whole-number) Weighted cells, so Composite isn't thrown off by
        // that display rounding. ROUNDED to a whole number — the exact
        // figure the GWA cell's own lookup reads, so the term grade shown
        // always matches its equivalent. For an INC row, every Weighted
        // cell above is already unconditionally numeric (no more
        // blank-guard on them either), so this gate passes through
        // naturally and Composite shows the zero-filled preview — no
        // separate isIncomplete branch needed here.
        const allNumeric = weightedRefs.map((a) => `ISNUMBER(${a})`).join(',');
        compositeCell.value = {
          formula: `IF(AND(${allNumeric}),ROUND((${exactCompositeExpr}),0),"")`,
          result: compositeResult,
        };
      }
      compositeCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COMPOSITE_DATA } };
      // Amber for an INC row — visually flags this as a zero-filled
      // preview, not a finalized figure, same treatment the on-screen
      // Class Record grid gives it.
      compositeCell.font = { bold: true, color: isIncomplete ? { argb: 'FFD97706' } : blankFontColor };
      compositeCell.numFmt = '0';
    }
    c += 1;

    halfColIdx = c;
    const halfAddr = `${colLetter(c)}${row}`;
    const halfCell = ws.getCell(row, c);
    const halfVal = compComposite !== null ? Math.round(halfComposite(compComposite) + 1e-9) : null;
    const halfResult = halfVal !== null ? halfVal : '';
    if (isDropped) {
      dropTail(halfCell);
    } else {
      // Half of the TRUE (unrounded) composite, rounded to a whole number
      // (79.26 → 39.63 → 40) — the Overall Grade itself reads the exact
      // expressions, not this rounded cell.
      halfCell.value = {
        formula: `IF(ISNUMBER(${compositeAddr}),ROUND((${exactCompositeExpr})*0.5,0),"")`,
        result: halfResult,
      };
      halfCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HALF_DATA } };
      if (isIncomplete) halfCell.font = { color: { argb: 'FFD97706' } };
      halfCell.numFmt = '0';
    }
    c += 1;

    if (!isFinals) {
      const gwaCell = ws.getCell(row, c);
      const midGwaVal = compComposite !== null ? gwaFromComposite(compComposite) : null;
      const midGwaResult = midGwaVal !== null ? midGwaVal : '';
      if (isDropped) {
        dropTail(gwaCell);
      } else {
        // Midterm Grade = the equivalent of the whole-number Midterm Term
        // Grade cell right beside it (compositeAddr): (105 − grade) / 10,
        // kept within 1.0–5.0 — e.g. 79 → 2.6, 75 → 3.0.
        gwaCell.value = {
          formula: `IF(ISNUMBER(${compositeAddr}),MIN(5,MAX(1,(105-${compositeAddr})/10)),"")`,
          result: midGwaResult,
        };
        gwaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GWA_DATA } };
        gwaCell.font = { bold: true, color: isIncomplete ? { argb: 'FFD97706' } : blankFontColor };
        // Always 1 decimal — a whole grade reads "3.0", never bare "3".
        gwaCell.numFmt = '0.0';
      }
      c += 1;
    } else {
      const overallAddr = `${colLetter(c)}${row}`;
      const overallCell = ws.getCell(row, c);

      const midCompForOverall = periodComposite(otherComps, g.student.id, componentScores, formula, incMidRow);
      const finCompForOverall = periodComposite(comps, g.student.id, componentScores, formula, incFinRow);
      const overallCompVal = overallComposite(midCompForOverall, finCompForOverall);
      const overallResult = overallCompVal !== null ? roundedComposite(overallCompVal) : '';

      if (isDropped) {
        dropTail(overallCell);
      } else {
        // The Midterm side's own exact composite already zero-fills itself
        // when IT was the INC period (midtermRef.exactComposites[gi] was
        // built by that section's own pass, with the same treatment) — so
        // this combines correctly either way, no separate isIncomplete
        // branch needed here anymore.
        if (midtermRef?.exactComposites?.[gi]) {
          // Overall Grade = the TRUE average of both periods' EXACT
          // composites (Midterm's Overall 1/2 + Finals' Overall 1/2 before
          // any rounding), rounded once to a whole number — the figure the
          // Final Grade's own lookup reads.
          const midExactExpr = midtermRef.exactComposites[gi];
          const midHalfAddr = midtermRef.halfCol ? `${colLetter(midtermRef.halfCol)}${row}` : null;
          const overallGuard = midHalfAddr
            ? `AND(ISNUMBER(${midHalfAddr}),ISNUMBER(${halfAddr}))`
            : `ISNUMBER(${halfAddr})`;
          overallCell.value = {
            formula: `IF(${overallGuard},ROUND(((${midExactExpr})+(${exactCompositeExpr}))/2,0),"")`,
            result: overallResult,
          };
        } else {
          // No Midterm block loaded to pull an exact composite from —
          // falls back to the raw (unrounded) composite periodComposite()
          // itself returns for this specific row. Zero-filled when the
          // student is INC at all (not just this Finals period) — the
          // Midterm side might be the one still missing work.
          const midComposite = periodComposite(otherComps, g.student.id, componentScores, formula, g.status === 'INC');
          overallCell.value = midComposite !== null
            ? {
                formula: `IF(ISNUMBER(${halfAddr}),ROUND((${midComposite}+(${exactCompositeExpr}))/2,0),"")`,
                result: overallResult,
              }
            : null;
        }
        overallCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OVERALL_DATA } };
        overallCell.font = { bold: true, color: isIncomplete ? { argb: 'FFD97706' } : blankFontColor };
        overallCell.numFmt = '0';
      }
      const hasOverall = otherComps.length > 0;
      c += 1;

      // Final Grade — the GWA of the Overall Grade cell right above (BOTH
      // periods' composites combined), not the Finals composite in
      // isolation — otherwise this can read worse than Overall Grade right
      // next to it whenever a strong Midterm carried a weak Finals. Falls
      // back to this period's own GWA only when there's no Midterm block to
      // combine with at all (otherComps empty). INC only when the Finals
      // itself is the marked period.
      const gwaCell = ws.getCell(row, c);
      const finalGwaVal = hasOverall
        ? (overallCompVal !== null ? gwaFromComposite(overallCompVal) : null)
        : (finCompForOverall !== null ? gwaFromComposite(finCompForOverall) : null);
      const finalGwaResult = finalGwaVal !== null ? finalGwaVal : '';

      if (isDropped) {
        dropTail(gwaCell);
      } else {
        if (hasOverall) {
          // Final Grade = the equivalent of the whole-number Overall Grade
          // cell right beside it: (105 − grade) / 10, kept within 1.0–5.0.
          gwaCell.value = {
            formula: `IF(ISNUMBER(${overallAddr}),MIN(5,MAX(1,(105-${overallAddr})/10)),"")`,
            result: finalGwaResult,
          };
        } else {
          gwaCell.value = {
            formula: `IF(ISNUMBER(${compositeAddr}),MIN(5,MAX(1,(105-${compositeAddr})/10)),"")`,
            result: finalGwaResult,
          };
        }
        // INC not completed by its deadline → the recorded 5.0, not a figure
        // recomputed from the (incomplete) scores.
        if (isLapsedInc(g)) gwaCell.value = 5;
        // Final Grade reads INC while the student is INC in either period.
        if (g.status === 'INC') gwaCell.value = 'INC';
        gwaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GWA_DATA } };
        gwaCell.font = { bold: true, color: isIncomplete ? { argb: 'FFD97706' } : blankFontColor };
        // Always 1 decimal — a whole grade reads "3.0", never bare "3".
        gwaCell.numFmt = '0.0';
      }
      c += 1;

      // Checked live off the same composite/GWA the Final Grade cell above
      // just computed (periodComposite/gwaFromComposite against the CURRENT
      // componentScores) instead of the stored Grade.status — Grade.status
      // only reflects whatever was last actually saved, so exporting right
      // after changing scores (without saving first) was showing a
      // Passed/Failed left over from before the edit instead of matching the
      // fresh Final Grade already printed in the same row. DRP/INC aren't
      // derived from a grade at all, so those two stay off Grade.status —
      // and INC never gets a Passed/Failed verdict regardless of whether the
      // Finals itself is the flagged period (a Midterm-only INC still leaves
      // the student INC overall even once Finals is done), same as the Class
      // Record and Grade Sheet.
      const remarksGrade = isLapsedInc(g) ? 5 : finalGwaVal;
      const remarksStatus = (isDropped || g.status === 'DRP')
        ? 'DRP'
        : (g.status === 'INC' || g.inc_midterm || g.inc_finals)
          ? 'INC'
          : (remarksGrade !== null
            ? (remarksGrade >= 1.0 && remarksGrade <= 3.01 ? 'Passed' : 'Failed')
            : '');
      const rStyle = remarksExcelStyle(remarksStatus);
      const remarksCell = ws.getCell(row, c);
      const finalGwaAddr = `${colLetter(c - 1)}${row}`;
      if (isDropped || g.status === 'DRP') {
        remarksCell.value = 'DROP';
      } else if (g.status === 'INC' || g.inc_midterm || g.inc_finals) {
        // The faculty's own INC reason, when one was given.
        remarksCell.value = remarksText('INC', g);
      } else if (isLapsedInc(g)) {
        // INC lapsed to 5.0 — the faculty's own INC reason.
        remarksCell.value = remarksText('Failed', g);
      } else {
        remarksCell.value = {
          formula: `IF(ISNUMBER(${finalGwaAddr}),IF(${finalGwaAddr}<=3.01,"PASSED","FAILED"),"")`,
          result: remarksStatus ? remarksFor(remarksStatus) : '',
        };
      }
      remarksCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rStyle.bg } };
      // No explicit size before — it fell back to Excel's default (11pt),
      // wider than the column, so "FAILED"/"PASSED" spilled out over the
      // neighboring cells instead of staying inside their own. (Alignment,
      // including a shrinkToFit safety net, gets set uniformly for every
      // data cell in the loop just below this one.)
      remarksCell.font = { bold: true, size: 9, name: 'Arial', color: { argb: rStyle.font } };
      c += 1;
    }

    for (let cc = startCol; cc <= colOffset + totalCols; cc++) {
      const cell = ws.getCell(row, cc);
      cell.border = DATA_BORDER;
      // shrinkToFit as a blanket safety net — this loop runs AFTER the
      // remarks cell above sets its own alignment, and unconditionally
      // replacing `alignment` here was wiping that back out; harmless for
      // every other (numeric) data cell since it only kicks in when content
      // actually overflows its own column.
      cell.alignment = { horizontal: cc === startCol + 2 ? 'left' : 'center', vertical: 'middle', shrinkToFit: true };
      if (cc === startCol + 2) {
        cell.font = { size: 10, ...cell.font, name: 'Arial Narrow' };
      } else if (cc === startCol) {
        cell.font = { bold: true, size: 9, ...cell.font, name: 'Arial' };
      } else if (isFinals && cc === colOffset + totalCols) {
        // Remarks cell in Finals already has its bold font, color and fill set above; leave untouched.
      } else {
        cell.font = { size: 9, ...cell.font, name: 'Arial' };
      }
    }
    row++;
  });

  // Dynamic Excel Conditional Formatting for Remarks:
  // Automatically renders "PASSED" as Green (light green fill + dark green text)
  // and "FAILED" as Red (light red fill + dark red text) in Excel.
  if (isFinals && studentGrades.length > 0) {
    try {
      const remarksCol = colOffset + totalCols;
      const remarksColLtr = colLetter(remarksCol);
      const dataEndRow = dataStartRow + studentGrades.length - 1;
      ws.addConditionalFormatting({
        ref: `${remarksColLtr}${dataStartRow}:${remarksColLtr}${dataEndRow}`,
        rules: [
          {
            type: 'cellIs',
            operator: 'equal',
            formulae: ['"PASSED"'],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFC6EFCE' }, fgColor: { argb: 'FFC6EFCE' } },
              font: { color: { argb: 'FF006100' }, bold: true }
            }
          },
          {
            type: 'cellIs',
            operator: 'equal',
            formulae: ['"FAILED"'],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFFC7CE' }, fgColor: { argb: 'FFFFC7CE' } },
              font: { color: { argb: 'FF9C0006' }, bold: true }
            }
          }
        ]
      });
    } catch (cfErr) {
      console.warn('Conditional formatting could not be attached, falling back to static styling:', cfErr);
    }
  }

  return { nextRow: row + 1, startDataRow: dataStartRow, halfCol: halfColIdx, endCol: colOffset + totalCols, tailColStart, exactComposites };
};

// ====== Excel Export — generated from this class's own actual components ======
// Same colored, per-component-group look and Grade/Overall-1-2/GWA/Remarks
// breakdown as the real SSU Class Record spreadsheet — built fresh every
// time from whatever this class's own components actually are, since every
// subject's own grading scheme is different (see the comment on SSU_TEMPLATE
// above) and a fixed-shape template file can't adapt to that.
async function exportUsingGeneratedLayout(classData, components, studentGrades, componentScores) {
  const midComps = [...components.filter((c) => c.period === 'Midterm')].sort((a, b) => a.order_index - b.order_index);
  const finComps = [...components.filter((c) => c.period === 'Finals')].sort((a, b) => a.order_index - b.order_index);

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AGMS';
    workbook.calcProperties.fullCalcOnLoad = true;
    const ws = workbook.addWorksheet('Class Record');
    ws.properties.pageSetUpPr = { fitToPage: true };
    ws.pageSetup = {
      orientation: 'landscape',
      paperSize: 5, // Legal (8.5 x 14 in) - official SSU landscape format
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.3, header: 0, footer: 0 },
    };
    ws.views = [{ showGridLines: false }];

    const sideBySide = midComps.length > 0 && finComps.length > 0;

    // Row order verified cell-by-cell against the real spreadsheet: seal/
    // university text (1-3) → blank (4) → the period TITLE (5) → blank (6) →
    // faculty/course info (7) → subject/schedule info (8) → blank (9) →
    // table headers (10+).
    const writeLetterhead = async (startCol, endCol, title, tailColStart) => {
      // +3, not +2 — skips past all three leading columns (No./Student No./
      // Name) now, same intent as before: center the letterhead text over
      // the components area, not the whole No./Student No./Name block.
      const textStartCol = startCol + 3;
      const textEndCol = Math.max(textStartCol, endCol - 3);
      try {
        // The real small seals actually embedded in the official Class
        // Record spreadsheet — not the app's own generic full-size
        // ssu-logo.png/cas-logo.png (a different, much larger asset used
        // elsewhere in the app, e.g. the login page).
        const [ssuRes, casRes] = await Promise.all([
          fetch('/assets/logos/ssu-seal-real.jpg').then((r) => r.arrayBuffer()),
          fetch('/assets/logos/cas-seal-real.png').then((r) => r.arrayBuffer()),
        ]);
        const ssuImg = workbook.addImage({ buffer: ssuRes, extension: 'jpeg' });
        const casImg = workbook.addImage({ buffer: casRes, extension: 'png' });
        // Rows 1-3 hold the "Republic of the Philippines / SAMAR STATE
        // UNIVERSITY / COLLEGE OF ARTS AND SCIENCES" text block — set their
        // heights explicitly (rather than leaving them at Excel's implicit
        // default) so the seal's vertical centering math below is exact
        // instead of guessing at whatever auto-fit height Excel picks for
        // the bold 15pt "SAMAR STATE UNIVERSITY" line.
        ws.getRow(1).height = 14;
        ws.getRow(2).height = 20;
        ws.getRow(3).height = 16;
        const ROW_BAND_PX = (14 + 20 + 16) * (96 / 72); // points → px at 96dpi

        // Anchored relative to where the header TEXT itself actually
        // renders, not the table's structural column boundaries — the
        // "1-2-3" header lines are centered specifically within
        // textStartCol..textEndCol (NOT the whole startCol..endCol block,
        // which also includes the No./Name columns and the tail Grade
        // columns, both of which skew a full-block center away from the
        // text's own true center). A prior attempt estimated the header
        // text's half-width with a rough characters × pt-size formula and
        // measured against the wrong (full-block) center, which undershot
        // badly enough for the CAS seal to land ON TOP of "SAMAR STATE
        // UNIVERSITY" instead of beside it. This version measures the real
        // rendered width with Canvas (this module only ever runs in the
        // browser) instead of guessing, and centers against the text
        // merge's own pixel span. Falls back to a rough estimate only if
        // canvas measurement is unavailable (e.g. a non-browser test
        // harness). Clamped so a seal can never drift left of the data
        // table's own start or right into the tail Grade/Overall-1-2/GWA
        // columns. ExcelJS's col/row are 0-indexed; `ws`'s own column
        // numbers are 1-indexed, hence the -1s. A raw nativeColOff is
        // written straight through as EMU, giving an exact,
        // column-width-independent inset — unlike a fractional `col`/`row`,
        // whose setter scales the offset by the COLUMN'S OWN width units
        // instead of real pixels (verified this drifts to a near-invisible
        // ~1px on a narrow column).
        const EMU_PER_PX = 9525;
        const MAX_SEAL_SIZE = 58;
        const GAP_PX = 18;
        // Guards every number below against ever reaching the `ws.addImage`
        // call as NaN/Infinity — ExcelJS writes whatever it's given straight
        // into the XML with no validation, and a NaN width/height there
        // makes some viewers fall back to the SOURCE IMAGE's own native
        // pixel size (174x176 / 136x132, much bigger than intended) instead
        // of erroring, which is what one seal rendering as a giant gray
        // stretched-out box turned out to be.
        const finite = (n, fallback) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
        // A fixed, precomputed half-width for "COLLEGE OF ARTS AND SCIENCES"
        // (the widest of the three header lines) at 12pt bold Arial — NOT a
        // live `canvas.measureText()` call. That call is the one piece of
        // this whole calculation that runs a real browser API this code
        // can't verify or reproduce outside the user's own browser, and it's
        // the most likely source of the seal rendering as a giant stretched
        // box (a canvas quirk returning something odd enough to poison the
        // rest of the pixel math down the line despite the finite() guards).
        // Everything else here is plain arithmetic on numbers this module
        // already controls, which prior verification confirmed never
        // produces anything invalid.
        const TEXT_HALF_WIDTH_PX = 150;
        // Excel's actual column-width-to-pixel formula (Calibri 11 default,
        // Maximum Digit Width = 7px) — NOT a rough `width*7+5` estimate. That
        // rough version overestimates every narrow column (the ones this
        // header row is full of, width 3.5-4.5) by ~5-6px each; with ~20 of
        // them between the No./Name columns and the tail Grade columns, the
        // error compounded into 100+ px, which is what put the seals on top
        // of the header text instead of beside it.
        const widthToPx = (units) => Math.floor(((256 * units + Math.floor(128 / 7)) / 256) * 7);
        const colWidthUnitsForSeal = (c) => ws.getColumn(c).width || 8.43;
        // Cumulative pixel width from the block's own left edge up to (but
        // not including) column `col`.
        const pxAtColStart = (col) => {
          let sum = 0;
          for (let c = startCol; c < col; c++) sum += widthToPx(colWidthUnitsForSeal(c));
          return sum;
        };
        const blockWidthPx = finite(pxAtColStart(endCol + 1), 600);
        const textCenterPx = finite((pxAtColStart(textStartCol) + pxAtColStart(textEndCol + 1)) / 2, blockWidthPx / 2);
        // A prior version also clamped each seal so it could never drift
        // into the tail Grade/Overall-1-2/GWA columns — on a NARROW table
        // (few components, e.g. a 3-component subject like CAP102), the
        // tail columns start too close to the text for that clamp and "stay
        // outside the header text" to both hold, and the tail-column clamp
        // was winning, pulling the seal back on top of the text itself.
        // Never overlapping the header TEXT is the one hard rule — instead
        // of ever violating it, shrink the seal (down to a sane floor) so it
        // always fits in whatever space is actually available on each side.
        const availLeftPx = finite(textCenterPx - TEXT_HALF_WIDTH_PX - GAP_PX, MAX_SEAL_SIZE);
        const availRightPx = finite(blockWidthPx - textCenterPx - TEXT_HALF_WIDTH_PX - GAP_PX, MAX_SEAL_SIZE);
        const SEAL_SIZE = finite(Math.max(24, Math.min(MAX_SEAL_SIZE, availLeftPx, availRightPx)), MAX_SEAL_SIZE);
        // Converts a pixel distance from the block's own left edge into a
        // (nativeCol, nativeColOff) pair by walking the real column widths.
        const pxToAnchor = (targetPx) => {
          const clamped = Math.max(0, targetPx);
          let acc = 0;
          let c = startCol;
          while (c <= endCol) {
            const w = widthToPx(colWidthUnitsForSeal(c));
            if (acc + w > clamped) break;
            acc += w;
            c++;
          }
          const col = Math.min(c, endCol);
          return { nativeCol: col - 1, nativeColOff: Math.round((clamped - acc) * EMU_PER_PX) };
        };
        const ssuTarget = pxToAnchor(textCenterPx - TEXT_HALF_WIDTH_PX - GAP_PX - SEAL_SIZE);
        const casTarget = pxToAnchor(textCenterPx + TEXT_HALF_WIDTH_PX + GAP_PX);
        // Only clamped to the block's own PHYSICAL bounds now (never past
        // the sheet's own first/last column) — not to a table-semantic
        // boundary, which is what caused the overlap above.
        const ssuNativeCol = finite(Math.max(startCol - 1, ssuTarget.nativeCol), startCol - 1);
        const casNativeCol = finite(Math.min(endCol - 1, Math.max(ssuNativeCol + 1, casTarget.nativeCol)), endCol - 1);
        const ssuColOff = finite(ssuNativeCol === ssuTarget.nativeCol ? Math.max(0, ssuTarget.nativeColOff) : 4 * EMU_PER_PX, 4 * EMU_PER_PX);
        const casColOff = finite(casNativeCol === casTarget.nativeCol ? Math.max(0, casTarget.nativeColOff) : 4 * EMU_PER_PX, 4 * EMU_PER_PX);
        const rowInset = finite(Math.round(((ROW_BAND_PX - SEAL_SIZE) / 2) * EMU_PER_PX), 0);
        // Last line of defense right at the call site, whatever the cause.
        const sealExt = { width: finite(SEAL_SIZE, MAX_SEAL_SIZE), height: finite(SEAL_SIZE, MAX_SEAL_SIZE) };
        ws.addImage(ssuImg, {
          tl: { nativeCol: ssuNativeCol, nativeColOff: ssuColOff, nativeRow: 0, nativeRowOff: rowInset },
          ext: sealExt,
        });
        ws.addImage(casImg, {
          tl: { nativeCol: casNativeCol, nativeColOff: casColOff, nativeRow: 0, nativeRowOff: rowInset },
          ext: sealExt,
        });
      } catch (imgErr) {
        console.error('Letterhead seals failed to load — continuing without them:', imgErr);
      }

      const centeredRow = (r, value, font) => {
        ws.mergeCells(r, textStartCol, r, textEndCol);
        const cell = ws.getCell(r, textStartCol);
        cell.value = value;
        cell.font = { name: 'Arial', ...font };
        cell.alignment = { horizontal: 'center' };
      };
      centeredRow(1, 'Republic of the Philippines', { bold: true, size: 11 });
      centeredRow(2, 'SAMAR STATE UNIVERSITY', { bold: true, size: 15 });
      centeredRow(3, 'COLLEGE OF ARTS AND SCIENCES', { bold: true, size: 12 });
      centeredRow(5, title, { bold: true, size: 12 });

      const infoField = (r, col, endC, value, align = 'left') => {
        if (endC > col) ws.mergeCells(r, col, r, endC);
        const cell = ws.getCell(r, col);
        cell.value = value;
        cell.font = { size: 9, name: 'Arial', bold: true };
        cell.alignment = { horizontal: align, vertical: 'middle', wrapText: false, shrinkToFit: false };
      };
      // The official Class Record writes the year level in Roman numerals
      // ("BSIT I-Z"), not the plain digit this system stores (1-4).
      const ROMAN_YEARS = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V' };
      const yearLabel = classData?.year_level ? (ROMAN_YEARS[parseInt(classData.year_level, 10)] || String(classData.year_level)) : null;
      const courseYearParts = [programShortLabel(classData?.subject?.program), yearLabel].filter(Boolean);
      let courseYearSection = courseYearParts.join(' ');
      if (classData?.section) courseYearSection += (courseYearSection ? '-' : '') + classData.section;
      const academicYear = classData?.academic_year || (classData?.semester || '').match(/\d{4}-\d{4}/)?.[0] || '';
      const row7Fields = [
        `Name of Faculty: ${formatPersonNameFirstLast(classData?.instructor?.name).toUpperCase()}`,
        `Course, Year and Section: ${courseYearSection || '—'}`,
      ];
      const row8Fields = [
        `Subject: ${classData?.subject?.code || ''} (${classData?.subject?.name || ''})`,
        classData?.schedule ? `Schedule: ${classData.schedule}` : 'Schedule: —',
      ];
      const colWidthUnits = (c) => ws.getColumn(c).width || 8.43;

      // In the Finals section (when side-by-side with Midterm, startCol > 1),
      // Name of Faculty and Subject start at the "Student No." column (startCol + 1),
      // leaving the "No." column (startCol) blank as a clean spacer after Midterm's tail.
      const infoStartCol = startCol > 1 ? startCol + 1 : startCol;

      // Column 3 (A.Y. / Semester) needs ~12-14 width units; allocate at least 12 width units and 2 columns
      let col3W = 0;
      let c3 = endCol;
      while (c3 > infoStartCol + 6 && (col3W < 12 || (endCol - c3 + 1) < 2)) {
        col3W += colWidthUnits(c3);
        c3--;
      }
      const col3StartCol = Math.max(infoStartCol + 4, c3 + 1);
      const infoEndCol = col3StartCol - 1;

      let totalW = 0;
      for (let i = infoStartCol; i <= infoEndCol; i++) totalW += colWidthUnits(i);

      // Target Column 1 (Faculty / Subject) with ~58-60 width units (or ~58% of available width)
      // so long subject descriptions fit cleanly without truncation
      const targetCol1W = Math.max(58, 0.58 * totalW);
      let acc = 0;
      let sc = startCol;
      while (sc < infoEndCol && acc < targetCol1W) {
        acc += colWidthUnits(sc);
        sc++;
      }
      const midSplitCol = Math.min(infoEndCol - 3, Math.max(infoStartCol + 3, sc - 1));

      infoField(7, infoStartCol, midSplitCol, row7Fields[0]);
      infoField(7, midSplitCol + 1, infoEndCol, row7Fields[1]);
      infoField(7, col3StartCol, endCol, `${classData?.yearAbbr || 'A.Y.'} ${academicYear}`);

      infoField(8, infoStartCol, midSplitCol, row8Fields[0]);
      infoField(8, midSplitCol + 1, infoEndCol, row8Fields[1]);
      infoField(8, col3StartCol, endCol, stripYearFromSemester(classData?.semester, academicYear));

      ws.getRow(7).height = 18;
      ws.getRow(8).height = 18;
      // Row 9 is the spacer between the info lines and the table header —
      // kept thin so the table sits right under Subject/Schedule.
      ws.getRow(9).height = 5;
    };

    // "Prepared by:" signature block, directly under a period block's own
    // data rows — same as the real spreadsheet, which signs off Midterm and
    // Finals independently. Column/row spacing verified cell-by-cell against
    // the real spreadsheet's own signature block (label sits under the NAME
    // column, not the No. column; two blank rows between the label and the
    // typed name, not one).
    const writeSignature = (startCol, endCol, afterRow) => {
      // +2, not +1 — Name now sits at startCol+2 (No./Student No./Name), so
      // this still lands the label under the NAME column specifically.
      const sigCol = startCol + 2;
      // "***Nothing Follows***" is the table's own last row — bordered across
      // the full block like every student row, with only the Name cell filled
      // in — rather than a loose line hanging under the table.
      const nothingRow = afterRow - 1;
      for (let cc = startCol; cc <= endCol; cc++) {
        ws.getCell(nothingRow, cc).border = DATA_BORDER;
      }
      const nothingCell = ws.getCell(nothingRow, sigCol);
      nothingCell.value = '***Nothing Follows***';
      nothingCell.font = { italic: true, size: 9, name: 'Arial' };
      nothingCell.alignment = { horizontal: 'left', vertical: 'middle', shrinkToFit: true };

      const row = afterRow + 1;
      ws.getCell(row, sigCol).value = 'Prepared by:';
      ws.getCell(row, sigCol).font = { size: 10, name: 'Arial' };

      const nameRow = row + 3;
      const sigEndCol = sigCol + 5;
      ws.mergeCells(nameRow, sigCol, nameRow, sigEndCol);
      const nameCell = ws.getCell(nameRow, sigCol);
      nameCell.value = formatPersonNameFirstLast(classData?.instructor?.name).toUpperCase();
      nameCell.font = { bold: true, size: 10, name: 'Arial' };

      ws.mergeCells(nameRow + 1, sigCol, nameRow + 1, sigEndCol);
      const titleCell = ws.getCell(nameRow + 1, sigCol);
      titleCell.value = 'Faculty';
      titleCell.font = { bold: true, size: 9, name: 'Arial' };
    };

    const startRow = 10;
    const formula = getRateFormula(classData);
    let midtermRef = null;
    let midResult = null;
    if (midComps.length > 0) {
      ws.getColumn(1).width = 4;
      ws.getColumn(2).width = 13;
      ws.getColumn(3).width = 25;
      midResult = writePeriodSection(ws, startRow, midComps, studentGrades, componentScores, 'midterm', finComps, null, 1, formula);
      // Midterm's own GWA cell sits right after its Overall 1/2 column —
      // Finals' Final Grade reads it to average the two periods.
      midtermRef = { startDataRow: midResult.startDataRow, halfCol: midResult.halfCol, gwaCol: midResult.halfCol + 1, exactComposites: midResult.exactComposites };
      await writeLetterhead(1, midResult.endCol, 'MIDTERM GRADE', midResult.tailColStart);
      writeSignature(1, midResult.endCol, midResult.nextRow);
    }
    if (finComps.length > 0) {
      const actualFinStartCol = sideBySide ? midResult.endCol + 1 : 1;
      if (sideBySide) {
        ws.getColumn(actualFinStartCol).width = 4;
        ws.getColumn(actualFinStartCol + 1).width = 13;
        ws.getColumn(actualFinStartCol + 2).width = 25;
      }
      const finResult = writePeriodSection(ws, startRow, finComps, studentGrades, componentScores, 'finals', midComps, midtermRef, actualFinStartCol, formula);
      await writeLetterhead(actualFinStartCol, finResult.endCol, 'FINALS GRADE', finResult.tailColStart);
      writeSignature(actualFinStartCol, finResult.endCol, finResult.nextRow);

      if (sideBySide && midResult) {
        // +1 covers the bordered "Nothing Follows" row under the last student.
        const lastDataRow = midResult.startDataRow + studentGrades.length;
        for (let r = startRow; r <= lastDataRow; r++) {
          const midEdgeCell = ws.getCell(r, midResult.endCol);
          midEdgeCell.border = { top: midEdgeCell.border?.top, bottom: midEdgeCell.border?.bottom, left: midEdgeCell.border?.left };
          const finEdgeCell = ws.getCell(r, actualFinStartCol);
          finEdgeCell.border = { top: finEdgeCell.border?.top, bottom: finEdgeCell.border?.bottom, right: finEdgeCell.border?.right };
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `${classData?.subject?.code || 'class'}_ClassRecord.xlsx`);
    toast.success('Exported to Excel!');
  } catch (err) {
    console.error(err);
    toast.error('Failed to export to Excel');
  }
}

// ====== Excel Export — entry point ======
// Always builds fresh via the generated layout — same real letterhead
// images, colors, fonts and formulas regardless of a class's own component
// shape (2, 5, 7, or a genuinely custom scheme like CAP102's). There is no
// literal official template file in this system; every export is built
// from this class's own actual components — the ones its own subject has
// been set up with.
export async function exportClassRecordToExcel({ classData, components, studentGrades, componentScores }) {
  const hasAnyComponents = components.some((c) => c.period === 'Midterm') || components.some((c) => c.period === 'Finals');
  if (!hasAnyComponents) {
    toast.error('This class has no Class Record components set up yet.');
    return;
  }
  // Alphabetical by surname — same order the on-screen Class Record
  // (ClassRecordView.js) and the Grade Sheet export already use, so the
  // exported file never lists students in whatever order they were enrolled.
  const sortedGrades = studentGrades.slice().sort((a, b) => comparePeopleNames(a.student, b.student));
  // "A.Y." or "S.Y." — this class's own semester label (Semester Management).
  const yearAbbr = yearAbbrOf(await getSemesterFor(classData?.semester));
  await exportUsingGeneratedLayout({ ...classData, yearAbbr }, components, sortedGrades, componentScores);
}

