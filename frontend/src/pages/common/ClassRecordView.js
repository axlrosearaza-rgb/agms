import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { gradeService } from '../../services';
import API from '../../services/api';
import { LoadingSpinner, programShortLabel, comparePeopleNames, formatPersonName } from '../../components/common';
import {
  itemRate,
  componentAverage,
  periodComposite,
  GROUP_COLORS,
  componentColorIndex,
  GWA_HEADER_COLOR,
  GWA_DATA_COLOR,
  remarksFor,
  remarksStyle,
  dropSequence,
  dropCellStyle,
  RATE_FORMULAS,
  getRateFormula,
} from '../../utils/classRecordExcel';
import toast from 'react-hot-toast';

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
const REMARKS_COLOR = '#CCFFCC';

const fmt = (n, d = 0) => (n === null || n === undefined ? '' : n.toFixed(d));

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
const itemColSpan = (item) => (item.is_rate_direct ? 1 : 2);
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
const PeriodDataCells = ({ comps, studentId, componentScores, isDropped, dropSeq, formula = RATE_FORMULAS['50_45'] }) => {
  const compNames = comps.map((c) => c.name);
  let dropIdx = 0;
  const dropTd = (key, letter) => (
    <td key={key} style={{ ...dropCellStyle(letter), textAlign: 'center', fontWeight: 700 }}>{letter}</td>
  );
  return (
  <>
    {comps.flatMap((c, ci) => {
      const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].data;
      const avg = componentAverage(c, studentId, componentScores, formula);
      // Exact (unrounded) — only the displayed cell below floors it.
      const weighted = avg !== null ? avg * (parseFloat(c.weight) / 100) : null;
      return [
        ...(c.items || []).flatMap((item) => {
          // A direct-rate item has just the one Rate column — no raw score
          // at all — so it only ever consumes ONE cell (and one DROPPED
          // letter), not the usual Score+Rate pair.
          if (isDropped) {
            if (item.is_rate_direct) return [dropTd(`${item.id}-r`, dropSeq[dropIdx++])];
            return [
              dropTd(`${item.id}-s`, dropSeq[dropIdx++]),
              dropTd(`${item.id}-r`, dropSeq[dropIdx++]),
            ];
          }
          const score = componentScores[studentId]?.[item.id];
          const rate = itemRate(score, item.max_score, item.is_rate_direct, formula);
          // The actual SCORE a student earned always shows regardless —
          // show_score only controls the item's MAX (see the header row
          // above), not this number. show_rate still blanks the RATE
          // number, though — the column itself (and its SCORE/RATE header)
          // always stays either way, see itemColSpan's own comment above.
          if (item.is_rate_direct) {
            return [<td key={`${item.id}-r`} style={{ background: color, textAlign: 'center', color: '#FF0000' }}>{item.show_rate !== false && rate !== null ? Math.round(rate) : ''}</td>];
          }
          return [
            <td key={`${item.id}-s`} style={{ background: color, textAlign: 'center' }}>{score ?? ''}</td>,
            <td key={`${item.id}-r`} style={{ background: color, textAlign: 'center', color: '#FF0000' }}>{item.show_rate !== false && rate !== null ? Math.round(rate) : ''}</td>,
          ];
        }),
        ...(showAveCol(c) ? [isDropped ? (
          dropTd(`${c.id}-ave`, dropSeq[dropIdx++])
        ) : (
          <td key={`${c.id}-ave`} style={{ background: color, textAlign: 'center', fontWeight: 600 }}>{avg !== null ? Math.round(avg) : ''}</td>
        )] : []),
        isDropped ? (
          dropTd(`${c.id}-w`, dropSeq[dropIdx++])
        ) : (
          <td key={`${c.id}-w`} style={{ background: color, textAlign: 'center', fontWeight: 600 }}>{weighted !== null ? (Math.round(weighted * 10) / 10).toFixed(1) : ''}</td>
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
  // classData.academic_year is a separate, sometimes-unset column — the
  // Semester record's own name (classData.semester, e.g. "First Semester
  // 2026-2027") already carries the year regardless, so pull it from there
  // rather than ever showing "AY" with nothing after it.
  const academicYear = classData.academic_year || (classData.semester || '').match(/\d{4}-\d{4}/)?.[0] || '';

  return (
    <>
      {/* Seals sit near the block's own left/right edges (space-between),
          not tight against the text, but with real margin from the true
          edge (padding) rather than flush against it — matches both the
          real spreadsheet's own letterhead and the Excel export's own
          inset anchoring (utils/classRecordExcel.js's writeLetterhead).
          Real small seals (the actual ones embedded in the official
          spreadsheet), not the app's own generic full-size
          ssu-logo.png/cas-logo.png used elsewhere (e.g. the login page). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px' }}>
        <img src="/assets/logos/ssu-seal-real.jpg" alt="SSU" style={{ width: 58, height: 58, flexShrink: 0 }} />
        <div style={{ textAlign: 'center', flex: 1 }}>
          <p style={{ fontWeight: 700, fontSize: 11, margin: 0 }}>Republic of the Philippines</p>
          <p style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>SAMAR STATE UNIVERSITY</p>
          <p style={{ fontWeight: 700, fontSize: 12, margin: 0 }}>COLLEGE OF ARTS AND SCIENCES</p>
        </div>
        <img src="/assets/logos/cas-seal-real.png" alt="CAS" style={{ width: 58, height: 58, flexShrink: 0 }} />
      </div>
      <h3 style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, margin: '10px 0' }}>{title}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px 16px', fontSize: 10.5, fontWeight: 700, marginBottom: 8, whiteSpace: 'nowrap' }}>
        <p style={{ margin: 0 }}>Name of Faculty: {(classData.instructor?.name || '').toUpperCase()}</p>
        <p style={{ margin: 0 }}>Course, Year and Section: {courseYearSection || '—'}</p>
        <p style={{ margin: 0 }}>AY {academicYear}</p>
        <p style={{ margin: 0 }}>Subject: {subject.code} ({subject.name})</p>
        {/* Schedule isn't a feature this system tracks — left blank rather
            than removed outright, so Semester stays in its own column
            lined up under AY above it instead of the grid reflowing. */}
        <p style={{ margin: 0 }} />
        <p style={{ margin: 0 }}>{classData.semester}</p>
      </div>
    </>
  );
}

// The real spreadsheet keeps its tail columns (Grade/Half/GWA/Overall/Remarks)
// narrow by rotating their header text vertically instead of wrapping it
// horizontally — this is what actually makes that block of columns read as a
// compact strip instead of ballooning the table's width.
function RotatedTh({ background, color = '#1a1a1a', children }) {
  return (
    <th rowSpan={4} style={{ background, color, width: 30, padding: '4px 2px' }}>
      <div style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block' }}>{children}</div>
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
    <div style={{ flex: '0 0 auto' }}>
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
                <th key={c.id} colSpan={compColSpan(c)} style={{ background: GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header }}>
                  {c.name}
                </th>
              ))}
              {!isFinals ? (
                <>
                  <RotatedTh background={COMPOSITE_COLOR} color="#fff">Midterm Term Grade</RotatedTh>
                  <RotatedTh background={HALF_COLOR}>Overall 1/2</RotatedTh>
                  <RotatedTh background={GWA_HEADER_COLOR} color="#fff">Midterm Grade</RotatedTh>
                </>
              ) : (
                <>
                  <RotatedTh background={COMPOSITE_COLOR} color="#fff">Final Term Grade</RotatedTh>
                  <RotatedTh background={HALF_COLOR}>Overall 1/2</RotatedTh>
                  <RotatedTh background={OVERALL_COLOR} color="#fff">Overall Grade</RotatedTh>
                  {/* The Final Term's own raw grade — same treatment as
                      Midterm's "Midterm Grade" column above, not the combined
                      average of both periods. That combined average
                      (Grade.average) is the Grade Sheet's job to show (see
                      pages/common/GradingSheet.js), not the Class Record's. */}
                  <RotatedTh background={GWA_HEADER_COLOR} color="#fff">Final Grade</RotatedTh>
                  <RotatedTh background={REMARKS_COLOR}>Remarks</RotatedTh>
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
                    if (item.is_rate_direct) {
                      return [
                        <th key={`${item.id}-s`} rowSpan={3} style={{ background: color, fontSize: 9, width: 30, padding: '4px 2px' }}>
                          <div style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block' }}>{item.name}</div>
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
                        <th key={`${item.id}-s`} colSpan={itemColSpan(item)} rowSpan={2} style={{ background: color, fontSize: 9 }}>{item.name}</th>,
                      ];
                    }
                    return [
                      <th key={`${item.id}-s`} colSpan={itemColSpan(item)} style={{ background: color, fontSize: 9 }}>{item.name}</th>,
                    ];
                  }),
                  ...(showAveCol(c) ? [<th key={`${c.id}-ave`} rowSpan={3} style={{ background: color, fontSize: 9 }}>Ave</th>] : []),
                  <th key={`${c.id}-w`} rowSpan={3} style={{ background: color, fontSize: 9 }}>{parseFloat(c.weight)}%</th>,
                ];
              })}
            </tr>
            <tr>
              {comps.flatMap((c, ci) => {
                const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
                // A rate-only item's own header cell already rowSpans over
                // this row (folded into the name cell above), so it emits
                // nothing here at all — not even a blank cell. Same when
                // Max is hidden (show_score === false) — the name cell
                // above already grew a rowSpan to cover this row instead
                // of leaving it as an empty gap.
                return (c.items || []).flatMap((item) => (item.is_rate_direct || item.show_score === false ? [] : [
                  <th key={`${item.id}-max`} colSpan={2} style={{ background: color, fontSize: 10 }}>{parseFloat(item.max_score)}</th>,
                ]));
              })}
            </tr>
            <tr>
              {comps.flatMap((c, ci) => {
                const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
                // Same as row 3 above — a rate-only item's header is already
                // fully covered by its rowSpan-3 name cell.
                // `transform: rotate(...)` is paint-only — it never affects
                // layout/box sizing, so a row holding only rotated text is
                // otherwise sized as if that text were still horizontal (one
                // short line) and the rotated glyphs spill out over whatever
                // sits above/below instead of actually fitting. An explicit
                // height here is what the row itself sizes off of.
                return (c.items || []).flatMap((item) => (item.is_rate_direct ? [] : [
                  <th key={`${item.id}-score`} style={{ background: color, fontSize: 9, fontWeight: 400, padding: '2px', height: 40 }}>
                    <div style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>SCORE</div>
                  </th>,
                  <th key={`${item.id}-rate`} style={{ background: color, fontSize: 9, fontWeight: 400, padding: '2px', height: 40 }}>
                    <div style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>RATE</div>
                  </th>,
                ]));
              })}
            </tr>
          </thead>
          <tbody>
            {studentGrades.map((g, idx) => {
              const sid = g.student.id;
              const isIncomplete = g.status === 'INC';
              // A Dropped student's cells read 'DROP' in red, the same way an
              // Incomplete one already reads 'INC' — rather than falling
              // through to whatever raw composite/midterm/finals numbers
              // happen to still be sitting in componentScores/grade, which
              // would misleadingly show a graded-looking figure for someone
              // who was actually dropped from the class.
              const isDropped = g.status === 'DRP';
              const blankStatus = isIncomplete ? 'INC' : isDropped ? 'DROP' : null;
              const blankColor = isIncomplete ? undefined : isDropped ? '#9C0006' : undefined;
              const composite = periodComposite(comps, sid, componentScores, formula);
              // Half is exactly the DISPLAYED Composite ÷ 2, not the raw
              // unrounded composite — rounding first means Overall 1/2
              // always relates to the "Midterm/Final Term Grade" number a
              // viewer actually sees, instead of silently drifting a few
              // tenths off it (e.g. Composite shown as 68 but Half
              // computed from 67.6).
              const half = composite !== null ? Math.round(composite) * 0.5 : null;
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
                  <PeriodDataCells comps={comps} studentId={sid} componentScores={componentScores} isDropped={isDropped} dropSeq={dropSeq} formula={formula} />
                  {!isFinals ? (
                    <>
                      <td style={dropTailSx(0, { background: '#EFEFEF', textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(0, blankStatus || fmt(composite))}</td>
                      <td style={dropTailSx(1, { background: '#EEF1F5', textAlign: 'center' })}>{dropOr(1, blankStatus ? '' : fmt(half, 1))}</td>
                      <td style={dropTailSx(2, { background: GWA_DATA_COLOR, textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(2, blankStatus || fmt(g.grade?.midterm ? parseFloat(g.grade.midterm) : null, 1))}</td>
                    </>
                  ) : (
                    (() => {
                      const midComposite = periodComposite(otherComps, sid, componentScores, formula);
                      const midHalf = midComposite !== null ? Math.round(midComposite) * 0.5 : null;
                      const overall = (midHalf !== null && half !== null) ? midHalf + half : null;
                      const rStyle = remarksStyle(g.status);
                      return (
                        <>
                          <td style={dropTailSx(0, { background: '#EFEFEF', textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(0, blankStatus || fmt(composite))}</td>
                          <td style={dropTailSx(1, { background: '#EEF1F5', textAlign: 'center' })}>{dropOr(1, blankStatus ? '' : fmt(half, 1))}</td>
                          <td style={dropTailSx(2, { background: '#DCF1FB', textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(2, blankStatus || fmt(overall))}</td>
                          <td style={dropTailSx(3, { background: GWA_DATA_COLOR, textAlign: 'center', fontWeight: 700, color: blankColor })}>{dropOr(3, blankStatus || fmt(g.grade?.finals ? parseFloat(g.grade.finals) : null, 1))}</td>
                          <td style={{ background: rStyle.bg, color: rStyle.color, textAlign: 'center', fontWeight: 700 }}>{g.grade ? remarksFor(g.status) : ''}</td>
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

      <div style={{ fontSize: 11, marginTop: 40, maxWidth: 260 }}>
        <p style={{ margin: '0 0 24px' }}>Prepared by:</p>
        <p style={{ margin: 0, fontWeight: 700 }}>{classData.instructor?.name?.toUpperCase()}</p>
        <p style={{ fontSize: 10, margin: 0, fontWeight: 700 }}>Instructor</p>
      </div>
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

  if (loading) return <LoadingSpinner />;
  if (!classData) return <p className="p-10 text-center text-gray-400">Class not found.</p>;
  const midtermComps = midtermCompsForPrint.slice().sort((a, b) => a.order_index - b.order_index);
  const finalsComps = finalsCompsForPrint.slice().sort((a, b) => a.order_index - b.order_index);
  const hasComponents = midtermComps.length > 0 || finalsComps.length > 0;

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#111', maxWidth: '100%', margin: '0 auto', padding: '24px' }}>
      <style>{`
        @page { size: landscape; margin: 8mm; }
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          .cr-blocks { gap: 12px !important; }
        }
        .cr-table { border-collapse: collapse; font-size: 10px; white-space: nowrap; }
        .cr-table th, .cr-table td { border: 1px solid #999; padding: 3px 5px; }
        .cr-table th { font-weight: 700; text-align: center; vertical-align: middle; color: #1a1a1a; }
        .cr-table td { height: 20px; }
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
        <div style={{ overflowX: 'auto' }}>
          <div className="cr-blocks" style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
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
  );
}
