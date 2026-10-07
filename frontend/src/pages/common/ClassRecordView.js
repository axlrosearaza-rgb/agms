import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { gradeService } from '../../services';
import API from '../../services/api';
import { LoadingSpinner, programShortLabel, comparePeopleNames, formatPersonName, formatPersonNameFirstLast } from '../../components/common';
import {
  itemRate,
  componentAverage,
  periodComposite,
  periodGWA,
  gwaFromComposite,
  formatComposite,
  halfComposite,
  overallComposite,
  formatGrade,
  fmtTrimmed,
  stripYearFromSemester,
  GROUP_COLORS,
  componentColorIndex,
  GWA_HEADER_COLOR,
  GWA_DATA_COLOR,
  remarksFor,
  remarksText,
  isLapsedInc,
  remarksStyle,
  dropSequence,
  dropCellStyle,
  RATE_FORMULAS,
  getRateFormula,
} from '../../utils/classRecordExcel';
import toast from 'react-hot-toast';
import { useSemesterLabels } from '../../utils/semesterLabels';

// GROUP_COLORS/GWA_HEADER_COLOR/GWA_DATA_COLOR/FINAL_GWA_HEADER_COLOR come
// from utils/classRecordExcel.js — the same palette drives the live editable
// Class Record grid (GradeEncoding.js), this standalone view, and the Excel
// exports, so none of them can visually drift apart. Only the tail-column
// colors below are specific to this two-period-block layout and have nothing
// to share with the live grid.
const NO_COLOR = '#757070';
const NAME_COLOR = '#AEABAB';
const COMPOSITE_COLOR = '#7B7B7B';   // "Midterm/Final Term Grade" (raw 0-100 composite)
const HALF_COLOR = '#ADB9CA';        // "Overall 1/2" (composite * 50%)
const OVERALL_COLOR = '#00B0F0';     // "Overall Grade" (combined composite, both periods)
const REMARKS_COLOR = '#548235';

// A direct-rate item (item.is_rate_direct) has no raw score at all — just
// the one Rate column, not the usual Score+Rate pair — so every column
// count/colSpan that used to assume a flat "2 per item" has to sum this
// instead. Shared with GradeEncoding.js's own PeriodTable (same concept,
// same name, kept in sync manually like the rest of this formula engine).
// show_score/show_rate do NOT change this column layout at all — the
// SCORE/RATE header words and their columns always stay put; those flags
// only blank the NUMBER shown in the data cell below them (see
// PeriodDataCells), so a viewer still sees which items exist and what
// they're called, just not every number if the Faculty chose to withhold
// it.
const itemColSpan = (item) => (item.is_rate_direct ? (item.show_rate !== false ? 1 : 0) : (item.show_rate !== false ? 2 : 1));
// show_ave freely shows/hides a component's own Ave column — fully
// user-controlled (Grade Component Setup's own "Show Ave" checkbox), no
// automatic override tied to how many items the component has. A
// component that becomes a single Rate-only item defaults to false there
// at that moment, but can be freely turned back on afterward.
const showAveCol = (c) => c.show_ave !== false;
const compColSpan = (c) => (c.items || []).reduce((s, item) => s + itemColSpan(item), 0) + (showAveCol(c) ? 2 : 1);

// Score/rate/ave/weighted data cells for one student, one period — shared by
// both the Midterm and Finals blocks so the two halves can never visually
// drift apart. Weighted (Ave × weight%) is its own visible column, matching
// the real spreadsheet, which shows that figure explicitly rather than
// folding the multiplication invisibly into the period total.
// isDropped spells "DROPPED" across every item/Ave/Weighted cell instead of
// showing real (or blank-formula) numbers — one continuous red band across
// the whole row, same treatment as the Excel export and the live
// GradeEncoding grid, so a dropped student never reads as "graded normally"
// in any of the three places this data gets shown. `dropSeq` is the parent's
// precomputed sequence for the WHOLE row (items/Ave/Weighted here, plus the
// tail cells the parent renders after this) — passed in rather than built
// here so a repetition of the word only ever starts if there's room across
// the entire row (components + tail) to finish it, not just this component's
// own slice of it.
// `zeroFillMissing` — opt-in, passed true ONLY for an already-INC-flagged
// period (see periodComposite's own comment on why) — a still-missing
// item's Rate cell then shows the floor value (50 for the default formula)
// instead of blank, letting Ave/Weighted/Composite/GWA all show a real
// preview number instead of the whole period going blank until every last
// item is in. The SCORE cell shows 0 for an incomplete period.
const PeriodDataCells = ({ comps, studentId, componentScores, isDropped, dropSeq, formula = RATE_FORMULAS['50_45'], zeroFillMissing = false }) => {
  const compNames = comps.map((c) => c.name);
  let dropIdx = 0;
  const dropTd = (key, letter) => (
    <td key={key} style={{ ...dropCellStyle(letter), textAlign: 'center', fontWeight: 700 }}>{letter}</td>
  );
  return (
    <>
      {comps.flatMap((c, ci) => {
        const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].data;
        const avg = componentAverage(c, studentId, componentScores, formula, zeroFillMissing);
        // Exact (unrounded) — only the displayed cell below rounds it.
        const weighted = avg !== null ? avg * (parseFloat(c.weight) / 100) : null;
        return [
          ...(c.items || []).flatMap((item) => {
            const hasRateCol = item.show_rate !== false;
            if (isDropped) {
              if (item.is_rate_direct) {
                if (!hasRateCol) return [];
                return [dropTd(`${item.id}-r`, dropSeq[dropIdx++])];
              }
              const cells = [dropTd(`${item.id}-s`, dropSeq[dropIdx++])];
              if (hasRateCol) cells.push(dropTd(`${item.id}-r`, dropSeq[dropIdx++]));
              return cells;
            }
            const rawScore = componentScores[studentId]?.[item.id];
            const hasScore = rawScore !== undefined && rawScore !== null && rawScore !== '';
            const score = hasScore ? rawScore : (zeroFillMissing ? 0 : null);
            const rate = itemRate(hasScore ? rawScore : (zeroFillMissing ? 0 : null), item.max_score, item.is_rate_direct, formula, zeroFillMissing);
            if (item.is_rate_direct) {
              if (!hasRateCol) return [];
              return [<td key={`${item.id}-r`} style={{ background: color, textAlign: 'center', fontWeight: 600, width: 56, minWidth: 56 }}>{rate !== null ? fmtTrimmed(rate, 0) : ''}</td>];
            }
            const cells = [
              <td key={`${item.id}-s`} style={{ background: color, textAlign: 'center', width: 50, minWidth: 50 }}>{score !== null ? score : ''}</td>,
            ];
            if (hasRateCol) {
              cells.push(
                <td key={`${item.id}-r`} style={{ background: color, textAlign: 'center', color: '#FF0000', fontWeight: 600, width: 45, minWidth: 45 }}>{rate !== null ? fmtTrimmed(rate, 0) : ''}</td>
              );
            }
            return cells;
          }),
          ...(showAveCol(c) ? [isDropped ? (
            dropTd(`${c.id}-ave`, dropSeq[dropIdx++])
          ) : (
            <td key={`${c.id}-ave`} style={{ background: color, textAlign: 'center', fontWeight: 600, width: 50, minWidth: 50 }}>{fmtTrimmed(avg, 0)}</td>
          )] : []),
          isDropped ? (
            dropTd(`${c.id}-w`, dropSeq[dropIdx++])
          ) : (
            <td key={`${c.id}-w`} style={{ background: color, textAlign: 'center', fontWeight: 600, width: 50, minWidth: 50 }}>{fmtTrimmed(weighted, 0)}</td>
          ),
        ];
      })}
    </>
  );
};

// Seal + university name block, repeated identically on both the Midterm and
// Finals halves — matches the real spreadsheet, which duplicates the whole
// letterhead + info lines per half so each side prints as its own document.
// Row order verified cell-by-cell against the real spreadsheet: seal/
// university text → blank → the period TITLE (above the info lines, not
// below them — there is no separate "CLASS RECORD" line at all) → blank →
// Name of Faculty / Course, Year and Section / AY → Subject / Schedule /
// Semester → blank → table headers.
function PeriodHeader({ title, classData, subject }) {
  const courseYearParts = [programShortLabel(subject.program), classData.year_level ? String(classData.year_level) : null].filter(Boolean);
  let courseYearSection = courseYearParts.join(' ');
  if (classData.section) courseYearSection += (courseYearSection ? '-' : '') + classData.section;
  const academicYear = classData.academic_year || (classData.semester || '').match(/\d{4}-\d{4}/)?.[0] || '';
  const { shortFor } = useSemesterLabels();

  return (
    <div style={{ width: '100%', marginBottom: 6 }}>
      {/* Seals sit at left and right with university info centered */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: 4 }}>
        <img src="/assets/logos/ssu-seal-real.jpg" alt="SSU" style={{ width: 44, height: 44, flexShrink: 0, objectFit: 'contain' }} />
        <div style={{ textAlign: 'center', flex: 1, padding: '0 12px' }}>
          <p style={{ fontWeight: 700, fontSize: 11, margin: 0, lineHeight: 1.3 }}>Republic of the Philippines</p>
          <p style={{ fontWeight: 700, fontSize: 14, margin: 0, lineHeight: 1.3 }}>SAMAR STATE UNIVERSITY</p>
          <p style={{ fontWeight: 700, fontSize: 12, margin: 0, lineHeight: 1.3 }}>COLLEGE OF ARTS AND SCIENCES</p>
        </div>
        <img src="/assets/logos/cas-seal-real.png" alt="CAS" style={{ width: 44, height: 44, flexShrink: 0, objectFit: 'contain' }} />
      </div>
      <h3 style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, margin: '3px 0 5px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</h3>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 10.5, fontWeight: 700, padding: '0 4px', whiteSpace: 'nowrap', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div>Name of Faculty: <span style={{ fontWeight: 700 }}>{formatPersonNameFirstLast(classData.instructor?.name).toUpperCase()}</span></div>
          <div>Subject: <span style={{ fontWeight: 700 }}>{subject.code} ({subject.name})</span></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div>Course, Year and Section: <span style={{ fontWeight: 700 }}>{courseYearSection || '—'}</span></div>
          {classData.schedule ? <div>Schedule: <span style={{ fontWeight: 700 }}>{classData.schedule}</span></div> : <div style={{ height: 16 }} />}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'right' }}>
          <div>{shortFor(classData.semester)} {academicYear}</div>
          <div>{stripYearFromSemester(classData.semester, academicYear)}</div>
        </div>
      </div>
    </div>
  );
}

// The real spreadsheet keeps its tail columns (Grade/Half/GWA/Overall/Remarks)
// narrow by rotating their header text vertically instead of wrapping it
// horizontally — this is what actually makes that block of columns read as a
// compact strip instead of ballooning the table's width.
function RotatedTh({ background, color = '#1a1a1a', children, width = 34, height = 115 }) {
  return (
    <th
      rowSpan={4}
      style={{
        background,
        color,
        width,
        minWidth: width,
        maxWidth: width,
        height,
        padding: '4px 2px',
        verticalAlign: 'middle',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
        }}
      >
        <span
          style={{
            transform: 'rotate(-90deg)',
            whiteSpace: 'nowrap',
            display: 'inline-block',
            lineHeight: 1,
            fontSize: '10px',
            fontWeight: 700,
          }}
        >
          {children}
        </span>
      </div>
    </th>
  );
}

// One full half of the Class Record — its own letterhead, its own No./Name +
// component table, its own tail columns (period grade → GWA for Midterm;
// period grade → combined Overall Grade → final GWA → Remarks for Finals),
// and its own "Prepared by" signature — exactly mirroring how the real
// spreadsheet lays out MIDTERM GRADE and FINALS GRADE as two parallel halves.
function PeriodBlock({ variant, title, comps, otherComps, classData, subject, studentGrades, componentScores }) {
  const isFinals = variant === 'finals';
  const compNames = comps.map((c) => c.name);
  const formula = getRateFormula(classData);
  return (
    <div style={{ flex: '0 0 auto', width: 'max-content' }}>
      <PeriodHeader title={title} classData={classData} subject={subject} />
      <div style={{ overflowX: 'auto' }}>
        <table className="cr-table">
          <thead>
            {/* Four header rows, matching the real spreadsheet's own band
                structure exactly: component name → item name + Ave + weight%
                → item max score → SCORE/RATE column labels. */}
            <tr>
              <th rowSpan={4} style={{ background: NO_COLOR, color: '#fff', minWidth: 26 }}>No.</th>
              <th rowSpan={4} style={{ background: NO_COLOR, color: '#fff', minWidth: 70 }}>Student No.</th>
              <th rowSpan={4} style={{ background: NAME_COLOR, minWidth: 150, textAlign: 'left' }}>Name</th>
              {comps.map((c, ci) => (
                <th key={c.id} colSpan={compColSpan(c)} style={{ background: GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header, padding: '3px 4px', fontSize: 10 }}>
                  {c.name}
                </th>
              ))}
              {!isFinals ? (
                <>
                  <RotatedTh background={COMPOSITE_COLOR} color="#fff" width={34}>Midterm Term Grade</RotatedTh>
                  <RotatedTh background={HALF_COLOR} color="#1a1a1a" width={34}>Overall 1/2</RotatedTh>
                  <RotatedTh background={GWA_HEADER_COLOR} color="#fff" width={34}>Midterm Grade</RotatedTh>
                </>
              ) : (
                <>
                  <RotatedTh background={COMPOSITE_COLOR} color="#fff" width={34}>Final Term Grade</RotatedTh>
                  <RotatedTh background={HALF_COLOR} color="#1a1a1a" width={34}>Overall 1/2</RotatedTh>
                  <RotatedTh background={OVERALL_COLOR} color="#fff" width={34}>Overall Grade</RotatedTh>
                  <RotatedTh background={GWA_HEADER_COLOR} color="#fff" width={34}>Final Grade</RotatedTh>
                  <th
                    rowSpan={4}
                    style={{
                      background: REMARKS_COLOR,
                      color: '#fff',
                      width: 75,
                      minWidth: 75,
                      maxWidth: 75,
                      verticalAlign: 'middle',
                      textAlign: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      padding: '4px',
                      boxSizing: 'border-box',
                    }}
                  >
                    Remarks
                  </th>
                </>
              )}
            </tr>
            <tr>
              {comps.flatMap((c, ci) => {
                const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
                return [
                  ...(c.items || []).flatMap((item) => {
                    // Rows 3-4 are otherwise entirely blank for a rate-only
                    // item — folded into this one cell (rowSpan 3) with the
                    // name rotated vertical instead of wasting that space,
                    // matching the real official Class Record's own
                    // rate-only columns ("Unit Activity", "Attendance", ...).
                    // Same rotation technique as RotatedTh above (the tail
                    // columns) — text-align/vertical-align already come from
                    // .cr-table's own CSS, so just the width + padding need
                    // matching here for the two to read as one consistent
                    // style, not two different ones.
                    const span = itemColSpan(item);
                    if (span === 0) return [];
                    if (item.is_rate_direct) {
                      const isShort = (item.name || '').length <= 5;
                      return [
                        <th key={`${item.id}-s`} rowSpan={3} style={{ background: color, fontSize: 10, width: 56, minWidth: 56, padding: '2px', verticalAlign: 'middle', textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
                            {isShort ? (
                              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{item.name}</span>
                            ) : (
                              <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1, fontWeight: 700 }}>{item.name}</span>
                            )}
                          </div>
                        </th>,
                      ];
                    }
                    // Max hidden (show_score === false) — row 3 would
                    // otherwise be a blank gap under this item's name, so
                    // the name cell grows down to fill that space instead
                    // (rowSpan 2, covering rows 2+3) rather than leaving it
                    // empty. Row 4 (SCORE/RATE) still sits below normally.
                    if (item.show_score === false) {
                      return [
                        <th key={`${item.id}-s`} colSpan={span} rowSpan={2} style={{ background: color, fontSize: 9 }}>{item.name}</th>,
                      ];
                    }
                    return [
                      <th key={`${item.id}-s`} colSpan={span} style={{ background: color, fontSize: 9 }}>{item.name}</th>,
                    ];
                  }),
                  ...(showAveCol(c) ? [<th key={`${c.id}-ave`} rowSpan={3} style={{ background: color, fontSize: 9, width: 50, minWidth: 50, textAlign: 'center', verticalAlign: 'middle', fontWeight: 700 }}>Ave</th>] : []),
                  <th key={`${c.id}-w`} rowSpan={3} style={{ background: color, fontSize: 9, width: 50, minWidth: 50, textAlign: 'center', verticalAlign: 'middle', fontWeight: 700 }}>{parseFloat(c.weight)}%</th>,
                ];
              })}
            </tr>
            <tr>
              {comps.flatMap((c, ci) => {
                const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
                // A rate-only item's own header cell already rowSpans over
                // this row (folded into the name cell above), so it emits
                // nothing here at all — not even a blank cell. Same when
                // Max is hidden (show_score === false) or item has 0 columns.
                return (c.items || []).flatMap((item) => (item.is_rate_direct || item.show_score === false || itemColSpan(item) === 0 ? [] : [
                  <th key={`${item.id}-max`} colSpan={itemColSpan(item)} style={{ background: color, fontSize: 10 }}>{parseFloat(item.max_score)}</th>,
                ]));
              })}
            </tr>
            <tr>
              {comps.flatMap((c, ci) => {
                const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
                // Same as row 3 above — a rate-only item's header is already
                // fully covered by its rowSpan-3 name cell.
                // When show_rate is false, only SCORE is emitted and RATE is omitted.
                return (c.items || []).flatMap((item) => {
                  if (item.is_rate_direct || itemColSpan(item) === 0) return [];
                  const cells = [
                    <th key={`${item.id}-score`} style={{ background: color, fontSize: 9, fontWeight: 600, padding: '2px', height: 36, width: 50, minWidth: 50, verticalAlign: 'middle', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
                        <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>SCORE</span>
                      </div>
                    </th>,
                  ];
                  if (item.show_rate !== false) {
                    cells.push(
                      <th key={`${item.id}-rate`} style={{ background: color, fontSize: 9, fontWeight: 600, padding: '2px', height: 36, width: 45, minWidth: 45, verticalAlign: 'middle', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%' }}>
                          <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>RATE</span>
                        </div>
                      </th>
                    );
                  }
                  return cells;
                });
              })}
            </tr>
          </thead>
          <tbody>
            {studentGrades.map((g, idx) => {
              const sid = g.student.id;
              const composite = periodComposite(comps, sid, componentScores, formula);
              // INC is per period — a student marked INC whose scores for
              // THIS period are all in still shows their real figures here;
              // only the period that's actually missing scores reads INC.
              // Which period(s) are INC comes from the per-period flags
              // (marked/resolved independently — INC in the Midterm never
              // makes the Finals INC, and vice versa); a row from before the
              // flags existed falls back to "INC where scores are incomplete".
              const hasIncFlags = !!(g.grade?.inc_midterm || g.grade?.inc_finals || g.inc_midterm || g.inc_finals);
              const isIncStatus = g.status === 'INC' || g.status === 'Incomplete';
              // (No flags = older data: INC in the earliest period still
              // missing scores, same as the server settles it.)
              const isIncomplete = isIncStatus && (hasIncFlags
                ? !!(isFinals ? (g.grade?.inc_finals ?? g.inc_finals) : (g.grade?.inc_midterm ?? g.inc_midterm))
                : (isFinals ? (composite === null && periodComposite(otherComps, sid, componentScores, formula) !== null) : composite === null));
              // An INC student's stored grade.midterm/finals is null, so a
              // completed period's GWA is recomputed from its own scores.
              const incPeriodGwa = g.status === 'INC' ? periodGWA(comps, sid, componentScores, formula) : null;
              // A still-missing item counts as a literal 0 for this
              // period's own preview figures ONLY (never saved, never fed
              // into anything but this row's own display) — so an INC
              // student's Composite/Half/GWA show a real, if provisional,
              // number instead of sitting blank until every last item is
              // in. Same composite when NOT incomplete — this is purely
              // the INC case's own preview path.
              const previewComposite = isIncomplete ? periodComposite(comps, sid, componentScores, formula, true) : composite;
              // A Dropped student's cells read 'DROP' in red — rather than
              // falling through to whatever raw composite/midterm/finals
              // numbers happen to still be sitting in componentScores/
              // grade, which would misleadingly show a graded-looking
              // figure for someone who was actually dropped from the
              // class. INC no longer blanks this way — see
              // previewComposite above — so this is DROP-only now.
              const isDropped = g.status === 'DRP';
              const blankStatus = isDropped ? 'DROP' : null;
              const blankColor = isDropped ? '#9C0006' : (isIncomplete ? '#D97706' : undefined);
              // Half of the TRUE (unrounded) Term Grade (79.26 → 39.6), so
              // Midterm's half + Finals' half is the true Overall Grade.
              const half = halfComposite(previewComposite);
              // Continues the exact same left-to-right "DROPPED" band
              // PeriodDataCells already spelled across every item/Ave/
              // Weighted cell — 2 cells per item plus 2 (Ave, Weighted) per
              // component — so the tail (Composite/Half/GWA/Overall) reads
              // as part of the same band instead of switching back to plain
              // red text on the section's normal colors. INC is unaffected.
              const dropCellCount = comps.reduce((sum, c) => sum + compColSpan(c), 0);
              // Composite/Half/GWA for Midterm (3), or Composite/Half/
              // Overall/GWA for Finals (4) — Remarks isn't counted, it keeps
              // its own real word. Precomputed for the row's exact total (see
              // dropSequence's own comment) so the band never gets cut off
              // mid-word right as it reaches these tail cells.
              const dropTailCellCount = isFinals ? 4 : 3;
              const dropSeq = isDropped ? dropSequence(dropCellCount + dropTailCellCount) : null;
              // Reads dropSeq at a fixed (non-incrementing) offset from
              // dropCellCount — safe to call more than once per cell, unlike
              // PeriodDataCells' own dropIdx++ counter — and falls back to
              // `fallback` untouched when this isn't a dropped row at all.
              const dropOr = (offset, fallback) => (isDropped ? dropSeq[dropCellCount + offset] : fallback);
              const dropTailSx = (offset, base) => (isDropped ? { ...base, ...dropCellStyle(dropSeq[dropCellCount + offset]) } : base);

              return (
                <tr key={sid}>
                  <td style={{ background: '#f2f2f2', textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ textAlign: 'center' }}>{g.student.student_no}</td>
                  <td>{formatPersonName(g.student.name)}</td>
                  <PeriodDataCells comps={comps} studentId={sid} componentScores={componentScores} isDropped={isDropped} dropSeq={dropSeq} formula={formula} zeroFillMissing={isIncomplete} />
                  {!isFinals ? (
                    (() => {
                      // Live-recomputed from the CURRENT composite (same as
                      // Finals' own Final Grade below), not the stored
                      // Grade.midterm — that DB value only reflects whatever
                      // was last actually saved, so it can silently disagree
                      // with the "Midterm Term Grade" composite shown right
                      // next to it the moment scores are edited without
                      // saving first. The equivalent of the whole-number
                      // Midterm Term Grade shown beside it (previewComposite
                      // is zero-filled for an INC period).
                      const midtermGrade = previewComposite !== null
                        ? gwaFromComposite(previewComposite)
                        : (g.grade?.midterm ? parseFloat(g.grade.midterm) : incPeriodGwa);
                      return (
                        <>
                          <td style={dropTailSx(0, { background: '#EFEFEF', textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(0, blankStatus || formatComposite(previewComposite))}</td>
                          <td style={dropTailSx(1, { background: '#EEF1F5', textAlign: 'center', color: blankColor })}>{dropOr(1, blankStatus ? '' : fmtTrimmed(half, 0))}</td>
                          <td style={dropTailSx(2, { background: GWA_DATA_COLOR, textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(2, blankStatus || formatGrade(midtermGrade))}</td>
                        </>
                      );
                    })()
                  ) : (
                    (() => {
                      // Zero-filled too when the student is INC at all (in
                      // either period) — so the Overall Grade/Final Grade
                      // preview below can combine both periods even when
                      // the OTHER one (Midterm) is the side still missing
                      // work, not just this one.
                      const midComposite = periodComposite(otherComps, sid, componentScores, formula, g.status === 'INC');
                      // TRUE average of both periods' exact composites
                      // (Midterm's Overall 1/2 + Finals' Overall 1/2) — shown
                      // rounded once to a whole Overall Grade via formatComposite,
                      // the same figure the Final Grade's equivalent is
                      // looked up from.
                      const overall = overallComposite(midComposite, previewComposite);
                      const finGwa = g.grade?.finals ? parseFloat(g.grade.finals) : incPeriodGwa;
                      // Final Grade = the equivalent of the whole Overall
                      // Grade — not the Finals GWA on its own. Falls back to
                      // the Finals-only GWA only when there's no Midterm
                      // block to combine with (otherComps empty).
                      // INC not completed by its deadline → the recorded 5.0.
                      const lapsed = isLapsedInc(g.grade);
                      const finalGrade = lapsed ? 5.0 : (otherComps.length === 0 ? finGwa : gwaFromComposite(overall));
                      // Only DROP blanks these tail cells now — an INC
                      // student's own preview (zero-filled) shows here
                      // instead of blank, same as previewComposite above.
                      // Remarks is different: the student is still INC
                      // overall, so it never gets a Passed/Failed verdict
                      // either way — remarksFor('INC') already renders that
                      // as blank, same as every other INC row, rather than
                      // judging Passed/Failed off a Final Grade that's
                      // still provisional.
                      // Final Grade reads INC while the student is INC in either period.
                      const finalBlank = lapsed ? '' : (isIncStatus ? 'INC' : blankStatus);
                      const finalRemarksKey = isDropped ? 'DRP' : isIncStatus ? 'INC' : (finalGrade !== null ? (finalGrade >= 1.0 && finalGrade <= 3.01 ? 'Passed' : 'Failed') : '');
                      const rStyle = remarksStyle(finalRemarksKey);
                      return (
                        <>
                          <td style={dropTailSx(0, { background: '#EFEFEF', textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(0, blankStatus || formatComposite(previewComposite))}</td>
                          <td style={dropTailSx(1, { background: '#EEF1F5', textAlign: 'center', color: blankColor })}>{dropOr(1, blankStatus ? '' : fmtTrimmed(half, 0))}</td>
                          <td style={dropTailSx(2, { background: '#DCF1FB', textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(2, blankStatus || formatComposite(overall))}</td>
                          <td style={dropTailSx(3, { background: GWA_DATA_COLOR, textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(3, finalBlank || formatGrade(finalGrade))}</td>
                          <td style={{ background: rStyle.bg, color: rStyle.color, textAlign: 'center', fontWeight: 700, width: 75, minWidth: 75, maxWidth: 75, padding: '2px 6px' }}>{finalRemarksKey ? ((lapsed || finalRemarksKey === 'INC') && g.grade?.inc_remarks ? <span title={remarksText(finalRemarksKey, g.grade)} style={{ fontSize: 9, lineHeight: 1.15, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{remarksText(finalRemarksKey, g.grade)}</span> : remarksFor(finalRemarksKey)) : ''}</td>
                        </>
                      );
                    })()
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Signature block aligned under the Name column */}
      <div style={{ fontSize: 11, marginTop: 16, paddingLeft: 100, maxWidth: 280 }}>
        <p style={{ margin: '0 0 16px', fontWeight: 600 }}>Prepared by:</p>
        <p style={{ margin: 0, fontWeight: 700 }}>{formatPersonNameFirstLast(classData.instructor?.name).toUpperCase()}</p>
        <p style={{ fontSize: 10, margin: 0, fontWeight: 600, color: '#444' }}>Faculty</p>
      </div>
    </div>
  );
}

const ZOOM_MIN = 30;
const ZOOM_MAX = 200;

// Floating − / % / + / Fit controls for the preview. Sits outside the zoomed
// record so it stays the same size.
function ZoomControls({ pct, isFit, onOut, onIn, onFit }) {
  const btn = { width: 30, height: 30, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 18, fontWeight: 700, color: '#1a3a5c', borderRadius: 6, lineHeight: 1 };
  return (
    <div className="no-print" style={{ position: 'fixed', top: 10, right: 14, zIndex: 50, display: 'flex', alignItems: 'center', gap: 2, background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, padding: 3, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontFamily: 'sans-serif' }}>
      <button type="button" style={{ ...btn, opacity: pct <= ZOOM_MIN ? 0.35 : 1 }} disabled={pct <= ZOOM_MIN} onClick={onOut} title="Zoom out" aria-label="Zoom out">−</button>
      <span style={{ minWidth: 46, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#374151' }}>{pct}%</span>
      <button type="button" style={{ ...btn, opacity: pct >= ZOOM_MAX ? 0.35 : 1 }} disabled={pct >= ZOOM_MAX} onClick={onIn} title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" style={{ ...btn, width: 'auto', padding: '0 10px', fontSize: 12, fontWeight: 600, background: isFit ? '#e8eef5' : 'transparent' }} onClick={onFit} title="Fit the whole width">Fit</button>
    </div>
  );
}

export default function ClassRecordView() {
  const { classId } = useParams();
  // Embedded as an iframe preview (Admin's Grade Approval list, e.g.
  // /class-record/123?preview=1) instead of opened as its own tab — the
  // auto-print below would otherwise pop a print dialog *inside* that
  // preview, which makes no sense there.
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';
  const [classData, setClassData] = useState(null);
  const [studentGrades, setStudentGrades] = useState([]);
  const [components, setComponents] = useState([]);
  const [componentScores, setComponentScores] = useState({});
  const [loading, setLoading] = useState(true);
  const hasAutoPrinted = useRef(false);
  const rootRef = useRef(null);
  // Preview zoom: null = fit to width (default), else a percentage.
  const [zoomPct, setZoomPct] = useState(null);
  const [fitScale, setFitScale] = useState(1);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await gradeService.getByClass(classId);
        setClassData(data.class);
        setStudentGrades((data.student_grades || [])
          .slice()
          .sort((a, b) => comparePeopleNames(a.student, b.student))
          .map((sg) => ({ student: sg.student, grade: sg.grade, status: sg.grade?.status || 'Pending' })));

        const compRes = await API.get(`/grade-components/${classId}/components`);
        setComponents(compRes.data.components || []);
        const scoreRes = await API.get(`/grade-components/${classId}/scores`);
        setComponentScores(scoreRes.data.scores || {});
      } catch (err) {
        toast.error('Failed to load class record');
      } finally {
        setLoading(false);
      }
    })();
  }, [classId]);

  const subject = classData?.subject || {};
  const midtermCompsForPrint = components.filter((c) => c.period === 'Midterm');
  const finalsCompsForPrint = components.filter((c) => c.period === 'Finals');
  const readyToPrint = !loading && !!classData && (midtermCompsForPrint.length > 0 || finalsCompsForPrint.length > 0);

  // This page prints itself automatically once the data (and the logos it
  // references) has actually rendered, so opening it is enough on its own —
  // no button needed for that part. The short delay gives the browser a
  // moment to lay out the seals/table before the print dialog captures the
  // page. Guarded to fire only once per visit.
  useEffect(() => {
    if (isPreview || !readyToPrint || hasAutoPrinted.current) return;
    hasAutoPrinted.current = true;
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, [isPreview, readyToPrint]);

  // Preview (inside a pop-up): the Midterm + Finals halves side by side are
  // far wider than the pop-up, so by default the whole record is shrunk to
  // fit its width — everything visible at once, scrolling only downward.
  // Re-fitted whenever the pop-up is resized. The zoom buttons override it
  // (zoomPct); "Fit" goes back. Printing is unaffected.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!isPreview || !el) return undefined;
    const apply = () => {
      el.style.zoom = '1';
      const natural = el.scrollWidth;
      const available = document.documentElement.clientWidth;
      // A few px of slack so rounding never leaves a sliver of sideways scroll.
      const fit = natural > available ? (available - 4) / natural : 1;
      setFitScale(fit);
      el.style.zoom = String(zoomPct ? zoomPct / 100 : fit);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [isPreview, loading, classData, components, studentGrades, zoomPct]);
  const currentPct = Math.round((zoomPct ? zoomPct / 100 : fitScale) * 100);
  // Steps of 10% from wherever it is now (fit can be any value, e.g. 66%).
  const zoomBy = (dir) => setZoomPct(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, (dir > 0 ? Math.floor(currentPct / 10) + 1 : Math.ceil(currentPct / 10) - 1) * 10)));

  if (loading) return <LoadingSpinner />;
  if (!classData) return <p className="p-10 text-center text-gray-400">Class not found.</p>;
  const midtermComps = midtermCompsForPrint.slice().sort((a, b) => a.order_index - b.order_index);
  const finalsComps = finalsCompsForPrint.slice().sort((a, b) => a.order_index - b.order_index);
  const hasComponents = midtermComps.length > 0 || finalsComps.length > 0;

  return (
    <>
    {isPreview && hasComponents && (
      <ZoomControls
        pct={currentPct}
        isFit={!zoomPct}
        onOut={() => zoomBy(-1)}
        onIn={() => zoomBy(1)}
        onFit={() => setZoomPct(null)}
      />
    )}
    <div ref={rootRef} style={{ fontFamily: 'Arial, sans-serif', color: '#111', maxWidth: '100%', margin: '0 auto', padding: '12px 14px', ...(isPreview ? { width: 'max-content', minWidth: '100%' } : {}) }}>
      <style>{`
        @page { size: landscape; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          .cr-blocks { gap: 12px !important; }
        }
        .cr-table { border-collapse: collapse; font-size: 10px; white-space: nowrap; }
        .cr-table th, .cr-table td { border: 1px solid #777; padding: 2px 4px; box-sizing: border-box; }
        .cr-table th { font-weight: 700; text-align: center; vertical-align: middle; color: #1a1a1a; }
        .cr-table td { height: 20px; vertical-align: middle; }
      `}</style>

      {/* Hidden entirely in preview mode (embedded read-only inside Admin's
          Grade Approval modal) — nothing here applies there: there's no
          auto-print to explain, and Export/Print open a print dialog or file
          download from inside an iframe preview, which isn't what that
          modal's "just let me look at it" purpose calls for. */}
      {!isPreview && (
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Print dialog opens automatically — use this if it didn't, or to print again.</p>
          <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#c9a84c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            Print
          </button>
        </div>
      )}

      {!hasComponents ? (
        <p className="p-10 text-center text-gray-400">This class has no Class Record components set up yet.</p>
      ) : (
        // In preview the whole record is shrunk to fit instead (see the
        // fit-to-width effect above), so it mustn't scroll on its own.
        <div style={{ overflowX: isPreview ? 'visible' : 'auto' }}>
          <div className="cr-blocks" style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <PeriodBlock
              variant="midterm"
              title="MIDTERM GRADE"
              comps={midtermComps}
              otherComps={finalsComps}
              classData={classData}
              subject={subject}
              studentGrades={studentGrades}
              componentScores={componentScores}
            />
            <PeriodBlock
              variant="finals"
              title="FINALS GRADE"
              comps={finalsComps}
              otherComps={midtermComps}
              classData={classData}
              subject={subject}
              studentGrades={studentGrades}
              componentScores={componentScores}
            />
          </div>
        </div>
      )}
    </div>
    </>
  );
}
