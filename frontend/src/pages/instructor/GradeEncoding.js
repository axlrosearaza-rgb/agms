import { useState, useEffect, useRef } from 'react';
import { useDraftState } from '../../hooks/useDraftState';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Icons, Badge, LoadingSpinner, Modal, ConfirmDialog, programHeaderClass, programCascadeGradient, ProgramDot, ProgramBadge, formatPersonName, comparePeopleNames } from '../../components/common';
import StudentGradeRecordModal from '../../components/common/StudentGradeRecordModal';
import { gradeService } from '../../services';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';
import {
  itemRate,
  componentAverage,
  periodComposite,
  periodGWA,
  remarksFor,
  remarksStyle,
  RATE_FORMULAS,
  getRateFormula,
  GROUP_COLORS,
  componentColorIndex,
  GWA_HEADER_COLOR,
  GWA_DATA_COLOR,
  SSU_TEMPLATE,
  buildComponentsFromScheme,
  exportClassRecordToExcel,
  dropSequence,
  dropCellStyle,
} from '../../utils/classRecordExcel';
import { exportGradingSheetDocx } from '../../utils/gradingSheetDocx';

// Rejects a keystroke that would push a bounded numeric input above its
// ceiling — e.g. typing "101" into an item worth /100 stops at "10" instead
// of silently accepting a score/grade that's impossible on its own scale.
// Empty string always passes through (clearing the field).
const withinMax = (value, max) => {
  if (value === '') return true;
  if (!/^\d*\.?\d*$/.test(value)) return false;
  const n = parseFloat(value);
  return isNaN(n) || n <= max;
};

// ── Class Record grid — one table per period (Midterm/Finals), Score+Rate per item,
// live-computed Ave per component and GWA per student, matching the real spreadsheet.
// Same GROUP_COLORS/GWA palette as the standalone Class Record view and the Excel
// exports, cycling by component position so it stays correct no matter how a class's
// components are set up (renamed, reweighted, more/fewer than the standard 5) ──
// Same tail colors as the read-only Class Record view (ClassRecordView.js's own
// COMPOSITE_COLOR/HALF_COLOR/OVERALL_COLOR) — kept as local constants there too,
// not exported, so duplicated here rather than imported.
const COMPOSITE_COLOR = '#7B7B7B';   // "Midterm/Final Term Grade" (raw 0-100 composite)
const HALF_COLOR = '#ADB9CA';        // "Overall 1/2" (composite * 50%)
const OVERALL_COLOR = '#00B0F0';     // "Overall Grade" (combined composite, both periods)
// Same four-row header band as the official SSU Class Record (and the
// read-only printable page / Excel export, which already use it): component
// name → item name + Ave + weight% → item max score → SCORE/RATE labels —
// instead of the old two-row shorthand this grid used to have on its own.
// Still fully editable: every SCORE cell here is a live input, exactly like
// before, just laid out to match the official document this data eventually
// becomes rather than a simplified stand-in for it.
function PeriodTable({ comps, otherComps = [], studentGrades, componentScores, updateScore, locked, onViewStudent, onMarkINC, onResolveINC, onMarkDRP, onUndoDRP, formula = RATE_FORMULAS['50_45'] }) {
  const compNames = comps.map((c) => c.name);
  // comps is already filtered to one period by the caller, so every
  // component in it shares the same period.
  const isFinals = comps[0]?.period === 'Finals';
  // A direct-rate item (item.is_rate_direct) has no raw score at all — just
  // the one Rate column, not the usual Score+Rate pair — so every column
  // count/width/colSpan that used to assume a flat "2 per item" has to sum
  // this instead.
  const itemColSpan = (item) => (item.is_rate_direct ? 1 : 2);
  // Fully user-controlled via the Setup modal's own "Show Ave" checkbox —
  // no automatic override tied to item count (a component that becomes a
  // single Rate-only item defaults to false there at that moment, but can
  // be freely turned back on afterward). Weighted is still computed from
  // the real Ave internally either way, just not shown as its own step.
  const showAveCol = (c) => c.show_ave !== false;
  const compColSpan = (c) => (c.items || []).reduce((s, item) => s + itemColSpan(item), 0) + (showAveCol(c) ? 2 : 1);
  // Explicit column widths, declared once via <colgroup> and paired with
  // table-layout:fixed below — every header/data cell pixel-width tweak
  // this table has gone through (min-w on some cells but not their
  // counterpart, a hidden px-4 baked into .form-input, ...) was really the
  // same root problem: the browser's normal "auto" table layout computes
  // each column's width by independently measuring every cell that touches
  // it, header and body alike, and any tiny mismatch between what a header
  // cell and its data cell each imply nudges the column a few px off from
  // what the OTHER row assumed. Fixed layout removes that measuring step
  // entirely — every column's width comes from exactly one place (here),
  // so header and body cells are structurally incapable of disagreeing.
  const colWidths = [40, 90, 150]; // #, Student No., Student Name
  comps.forEach((c) => {
    (c.items || []).forEach((item) => {
      if (item.is_rate_direct) colWidths.push(46); // just Rate, narrow — no Score column
      else colWidths.push(60, 50); // Score, Rate
    });
    if (showAveCol(c)) colWidths.push(56); // Ave
    colWidths.push(50); // weight%
  });
  colWidths.push(36); // Composite (Midterm/Final Term Grade)
  colWidths.push(36); // Half (Overall 1/2)
  if (isFinals) colWidths.push(36); // Overall Grade (both periods combined) — Finals only
  colWidths.push(70); // GWA
  colWidths.push(90); // Remarks
  colWidths.push(130); // Drop/INC actions
  // Same rotated-text technique as the Score/Rate labels elsewhere in this
  // table — narrow tail columns (Composite/Half/Overall) stay narrow by
  // rotating their header text vertically instead of wrapping it, matching
  // ClassRecordView.js's own RotatedTh. `transform: rotate(...)` is
  // paint-only — it never affects layout/box sizing, so a rowSpan cell
  // holding only rotated text is otherwise sized as if that text were
  // still horizontal (one short line, ~16px), and the longest labels here
  // ("Midterm/Final Term Grade") spill out past whatever's above/below
  // instead of actually fitting. An explicit height is what this cell
  // (and the 4 rows it spans) actually sizes off of.
  const RotatedTailTh = ({ background, color = '#fff', children }) => (
    <th rowSpan={4} className="text-center px-1 py-2.5 text-[10px] font-semibold align-bottom border-b border-l border-gray-200" style={{ background, color, width: 30, height: 190, padding: '4px 2px' }}>
      <div className="flex items-center justify-center h-full">
        <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>{children}</span>
      </div>
    </th>
  );
  // Student No./Student Name stay pinned while the score columns scroll
  // horizontally, same as # already did — each one's sticky offset is just
  // the running total of everything pinned before it, so this can't drift
  // out of sync with colWidths above the way a hardcoded pixel value would.
  const studentNoLeft = colWidths[0];
  const studentNameLeft = colWidths[0] + colWidths[1];
  return (
    <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
      <table className="table-fixed" style={{ width: colWidths.reduce((a, b) => a + b, 0) }}>
        <colgroup>
          {colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
        </colgroup>
        <thead>
          <tr className="bg-gray-50">
            {/* z-10 on every sticky cell here (header AND data, below) is
                load-bearing, not decorative — `transform: rotate(...)` on
                the SCORE/RATE/rate-only-name labels further right
                implicitly creates its own stacking context, which (with
                `position: sticky` left at its default z-index: auto) can
                paint OVER these pinned columns while scrolled instead of
                being hidden behind their own opaque background, i.e.
                exactly the "floating" overlap this fixes. */}
            <th rowSpan={4} className="text-center px-2 py-2.5 text-xs font-semibold uppercase text-gray-600 sticky left-0 z-10 bg-gray-50 w-10 align-bottom border-b border-gray-200">#</th>
            <th rowSpan={4} className="text-left px-3 py-2.5 text-xs font-semibold uppercase text-gray-600 sticky z-10 bg-gray-50 min-w-[90px] align-bottom border-b border-gray-200" style={{ left: studentNoLeft }}>Student No.</th>
            <th rowSpan={4} className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-gray-600 sticky z-10 bg-gray-50 min-w-[150px] align-bottom border-b border-gray-200" style={{ left: studentNameLeft }}>Student Name</th>
            {comps.map((c, ci) => (
              <th key={c.id} colSpan={compColSpan(c)} className="text-center px-3 py-2 text-xs font-semibold border-b border-l border-gray-200" style={{ background: GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header }}>
                {c.name}
              </th>
            ))}
            {/* Composite/Half (Overall 1/2) always shown, same as the
                read-only Class Record — Finals also gets Overall Grade
                (both periods' composites combined) right before its own
                GWA. All live-computed here, not the stored Grade record,
                same as this grid's other figures. */}
            {!isFinals ? (
              <>
                <RotatedTailTh background={COMPOSITE_COLOR}>Midterm Term Grade</RotatedTailTh>
                <RotatedTailTh background={HALF_COLOR} color="#1a1a1a">Overall 1/2</RotatedTailTh>
              </>
            ) : (
              <>
                <RotatedTailTh background={COMPOSITE_COLOR}>Final Term Grade</RotatedTailTh>
                <RotatedTailTh background={HALF_COLOR} color="#1a1a1a">Overall 1/2</RotatedTailTh>
                <RotatedTailTh background={OVERALL_COLOR}>Overall Grade</RotatedTailTh>
              </>
            )}
            <th rowSpan={4} className="text-center px-3 py-2.5 text-xs font-semibold text-white min-w-[70px] align-bottom border-b border-l border-gray-200" style={{ background: GWA_HEADER_COLOR }}>GWA</th>
            {/* Auto-computed straight from this period's own GWA the moment
                it's fully encoded (Passed/Failed), or from the student's
                INC/DRP status — Faculty and a teaching Chairperson both land
                on this same Class Record tab, so neither has to wait for
                submission/verification just to see where a student stands. */}
            <th rowSpan={4} className="text-center px-2 py-2.5 text-xs font-semibold uppercase text-gray-600 min-w-[90px] align-bottom border-b border-l border-gray-200 bg-gray-50">Remarks</th>
            {/* Drop and Mark/Resolve INC both live here, on the Class Record
                itself — not the Grade Sheet, which is the auto-computed
                read-only summary further down (see its own comment there). */}
            <th rowSpan={4} className="text-center px-2 py-2.5 text-xs font-semibold uppercase text-gray-600 min-w-[130px] align-bottom border-b border-l border-gray-200 bg-gray-50">Actions</th>
          </tr>
          <tr className="bg-gray-50">
            {comps.flatMap((c, ci) => {
              const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
              return [
                ...(c.items || []).flatMap(item => {
                  if (item.is_rate_direct) {
                    // Rows 3-4 are otherwise entirely blank for a rate-only
                    // item (no max score, no SCORE/RATE sub-labels) — folded
                    // into this one cell (rowSpan 3) with the name rotated
                    // vertical instead of wasting that space, matching the
                    // real official Class Record's own rate-only columns
                    // ("Unit Activity", "Attendance", "Recitation", ...).
                    return [
                      <th key={`${item.id}-name`} rowSpan={3} className="text-center px-1 py-2.5 text-[10px] font-medium border-l border-gray-100" style={{ background: color }}>
                        <div className="flex items-center justify-center h-full">
                          <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>{item.name}</span>
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
                      <th key={`${item.id}-name`} colSpan={itemColSpan(item)} rowSpan={2} className="text-center px-2 py-1.5 text-[10px] font-medium min-w-[100px] border-l border-gray-100" style={{ background: color }}>
                        {item.name}
                      </th>,
                    ];
                  }
                  return [
                    <th key={`${item.id}-name`} colSpan={itemColSpan(item)} className="text-center px-2 py-1.5 text-[10px] font-medium min-w-[100px] border-l border-gray-100" style={{ background: color }}>
                      {item.name}
                    </th>,
                  ];
                }),
                ...(showAveCol(c) ? [<th key={`${c.id}-ave`} rowSpan={3} className="text-center px-2 py-1.5 text-[10px] font-semibold min-w-[56px] border-l border-gray-200" style={{ background: color }}>Ave</th>] : []),
                <th key={`${c.id}-w`} rowSpan={3} className={`text-center px-2 py-1.5 text-[10px] font-semibold min-w-[50px] ${!showAveCol(c) ? 'border-l border-gray-200' : ''}`} style={{ background: color }}>{parseFloat(c.weight)}%</th>,
              ];
            })}
          </tr>
          <tr className="bg-gray-50">
            {comps.flatMap((c, ci) => {
              const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
              // A rate-only item's own header cell already rowSpans over
              // this row (folded into the name cell above), so it emits
              // nothing here at all — not even a blank cell. Same when Max
              // is hidden (show_score === false) — the name cell above
              // already grew a rowSpan to cover this row instead of
              // leaving it as an empty gap.
              return (c.items || []).flatMap(item => (item.is_rate_direct || item.show_score === false ? [] : [
                <th key={`${item.id}-max`} colSpan={itemColSpan(item)} className="text-center px-2 py-1 text-xs font-bold text-navy border-l border-gray-100" style={{ background: color }}>
                  {parseFloat(item.max_score)}
                </th>,
              ]));
            })}
          </tr>
          <tr className="bg-gray-50">
            {comps.flatMap((c, ci) => {
              const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].header;
              // Same as row 3 above — a rate-only item's header is already
              // fully covered by its rowSpan-3 name cell.
              // `transform: rotate(...)` is paint-only — it never affects
              // layout/box sizing, so a row holding only rotated text is
              // otherwise sized as if that text were still horizontal (one
              // short line, ~16px) and the rotated glyphs spill out over
              // whatever sits above/below instead of actually fitting. An
              // explicit height here is what the row itself sizes off of.
              return (c.items || []).flatMap(item => (item.is_rate_direct ? [] : [
                <th key={`${item.id}-score`} className="text-center px-1 text-[10px] font-medium min-w-[60px] border-l border-gray-100" style={{ background: color, height: 44 }}>
                  <div className="flex items-center justify-center h-full">
                    <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>SCORE</span>
                  </div>
                </th>,
                <th key={`${item.id}-rate`} className="text-center px-1 text-[10px] font-medium min-w-[50px]" style={{ background: color, height: 44 }}>
                  <div className="flex items-center justify-center h-full">
                    <span style={{ transform: 'rotate(-90deg)', whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1 }}>RATE</span>
                  </div>
                </th>,
              ]));
            })}
          </tr>
        </thead>
        <tbody>
          {studentGrades.map((g, idx) => {
            const gwa = periodGWA(comps, g.student.id, componentScores, formula);
            const composite = periodComposite(comps, g.student.id, componentScores, formula);
            // Half is exactly the DISPLAYED Composite ÷ 2, not the raw
            // unrounded composite — rounding first means Overall 1/2 always
            // relates to the "Midterm/Final Term Grade" number a viewer
            // actually sees, instead of silently drifting a few tenths off
            // it (e.g. Composite shown as 68 but Half computed from 67.6).
            const half = composite !== null ? Math.round(composite) * 0.5 : null;
            // Finals' own Overall Grade combines both periods' composites —
            // otherComps is the Midterm side, passed in only for the Finals
            // table below.
            const midComposite = isFinals ? periodComposite(otherComps, g.student.id, componentScores, formula) : null;
            const midHalf = midComposite !== null ? Math.round(midComposite) * 0.5 : null;
            const overall = (isFinals && midHalf !== null && half !== null) ? midHalf + half : null;
            const isINC = g.status === 'INC';
            const isDRP = g.status === 'DRP';
            // Set by the item/Ave/Weighted IIFE just below (it always runs
            // before the tail GWA cell reads them, since it's the earlier
            // sibling) so the tail cell can continue the exact same
            // "DROPPED" sequence instead of computing its own.
            let dropCellCount, dropSeq;
            return (
              /* Dropped rows stay full-opacity — every cell already reads
                 "DROPPED" in solid red, and dimming that with opacity would
                 wash it back toward the very "looks graded" look this is
                 meant to avoid. INC keeps the dim treatment since its cells
                 still show real, legible in-progress scores. */
              <tr key={g.student.id} className={`border-b border-gray-50 ${isINC ? 'opacity-50' : ''}`}>
                <td className="px-2 py-2.5 text-xs text-gray-400 text-center sticky left-0 z-10 bg-white">{idx + 1}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500 sticky z-10 bg-white" style={{ left: studentNoLeft }}>{g.student.student_no}</td>
                <td className="px-4 py-2.5 text-sm sticky z-10 bg-white" style={{ left: studentNameLeft }}>
                  <button
                    type="button"
                    onClick={() => onViewStudent(g.student)}
                    className="text-left bg-transparent border-none p-0 cursor-pointer font-sans hover:underline"
                    title="View this student's full grade record (1st-4th Year + GWA)"
                  >
                    <p className="font-medium text-navy">{formatPersonName(g.student.name)}</p>
                  </button>
                  {isINC && <Badge variant="yellow" className="mt-1">INC</Badge>}
                  {isDRP && <Badge variant="red" className="mt-1">DROP</Badge>}
                </td>
                {(() => {
                  // A dropped student's whole row spells "DROPPED" across
                  // every item/Ave/Weighted cell PLUS the tail GWA cell below
                  // (red, one continuous band left-to-right) instead of
                  // showing real-looking numbers — same treatment as the
                  // Excel export. Precomputed for this row's exact total cell
                  // count (compColSpan per component — 2 per item, 1 for a
                  // direct-rate one, +2 for Ave/Weighted) so a repetition of
                  // the word only ever starts if there's room to finish it —
                  // see dropSequence's own comment for why a plain running
                  // counter cut it off mid-word instead.
                  dropCellCount = comps.reduce((sum, c) => sum + compColSpan(c), 0);
                  // Composite/Half/GWA/Remarks for Midterm (4), or
                  // Composite/Half/Overall/GWA/Remarks for Finals (5) — the
                  // band now runs through every tail cell, not just GWA.
                  dropSeq = isDRP ? dropSequence(dropCellCount + (isFinals ? 5 : 4)) : null;
                  let dropIdx = 0;
                  return comps.flatMap((c, ci) => {
                    const color = GROUP_COLORS[componentColorIndex(c.name, ci, compNames)].data;
                    const avg = componentAverage(c, g.student.id, componentScores, formula);
                    // Exact (unrounded) — only the displayed cell below floors it.
                    const weighted = avg !== null ? avg * (parseFloat(c.weight) / 100) : null;
                    return [
                      ...(c.items || []).flatMap(item => {
                        const score = componentScores[g.student.id]?.[item.id];
                        const rate = itemRate(score, item.max_score, item.is_rate_direct, formula);
                        // A direct-rate item has just the one Rate column —
                        // no Score column at all — so it only ever consumes
                        // ONE cell (and one DROPPED letter), not two.
                        if (isDRP) {
                          if (item.is_rate_direct) {
                            const rateLetter = dropSeq[dropIdx++];
                            return [
                              <td key={`${item.id}-r`} className="px-2 py-2 text-center text-sm font-bold min-w-[60px] border-l border-gray-100" style={dropCellStyle(rateLetter)}>{rateLetter}</td>,
                            ];
                          }
                          const scoreLetter = dropSeq[dropIdx++];
                          const rateLetter = dropSeq[dropIdx++];
                          return [
                            <td key={`${item.id}-s`} className="px-2 py-2 text-center text-sm font-bold min-w-[60px] border-l border-gray-100" style={dropCellStyle(scoreLetter)}>{scoreLetter}</td>,
                            <td key={`${item.id}-r`} className="px-2 py-2 text-center text-sm font-bold min-w-[50px]" style={dropCellStyle(rateLetter)}>{rateLetter}</td>,
                          ];
                        }
                        if (item.is_rate_direct) {
                          return [
                            <td key={`${item.id}-r`} className="px-2 py-2 text-center min-w-[60px] border-l border-gray-100" style={{ background: color }}>
                              <input
                                type="text"
                                inputMode="decimal"
                                className="form-input text-center text-xs py-1.5 px-1 w-full"
                                placeholder="—"
                                value={score ?? ''}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (withinMax(v, formula.base + formula.range)) updateScore(g.student.id, item.id, v);
                                }}
                                disabled={g.submitted || isINC || isDRP || locked}
                              />
                            </td>,
                          ];
                        }
                        return [
                          <td key={`${item.id}-s`} className="px-2 py-2 text-center min-w-[60px] border-l border-gray-100" style={{ background: color }}>
                            <input
                              type="text"
                              inputMode="decimal"
                              className="form-input text-center text-xs py-1.5 px-1 w-full"
                              placeholder="0"
                              value={score ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (withinMax(v, parseFloat(item.max_score))) updateScore(g.student.id, item.id, v);
                              }}
                              disabled={g.submitted || isINC || isDRP || locked}
                            />
                          </td>,
                          <td key={`${item.id}-r`} className="px-2 py-2 text-center text-xs min-w-[50px]" style={{ background: color, color: '#FF0000' }}>{item.show_rate !== false && rate !== null ? Math.round(rate) : '—'}</td>,
                        ];
                      }),
                      ...(!showAveCol(c) ? [] : [(() => {
                        if (!isDRP) {
                          return <td key={`${c.id}-ave`} className="px-2 py-2 text-center text-xs font-semibold min-w-[56px] border-l border-gray-200" style={{ background: color }}>{avg !== null ? Math.round(avg) : '—'}</td>;
                        }
                        const aveLetter = dropSeq[dropIdx++];
                        return <td key={`${c.id}-ave`} className="px-2 py-2 text-center text-sm font-bold min-w-[56px] border-l border-gray-200" style={dropCellStyle(aveLetter)}>{aveLetter}</td>;
                      })()]),
                      (() => {
                        const wBorder = !showAveCol(c) ? ' border-l border-gray-200' : '';
                        if (!isDRP) {
                          return <td key={`${c.id}-w`} className={`px-2 py-2 text-center text-xs font-semibold min-w-[50px]${wBorder}`} style={{ background: color }}>{weighted !== null ? (Math.round(weighted * 10) / 10).toFixed(1) : '—'}</td>;
                        }
                        const weightedLetter = dropSeq[dropIdx++];
                        return <td key={`${c.id}-w`} className={`px-2 py-2 text-center text-sm font-bold min-w-[50px]${wBorder}`} style={dropCellStyle(weightedLetter)}>{weightedLetter}</td>;
                      })(),
                    ];
                  });
                })()}
                {/* Composite/Half (Overall 1/2), Finals' own Overall Grade,
                    then GWA — continues the exact same "DROPPED" band the
                    row's item/Ave/Weighted cells above just built (dropSeq/
                    dropCellCount set by that IIFE, the earlier sibling).
                    Live-computed here (composite/half/overall/gwa above),
                    same as every other figure in this editable grid. */}
                <td className="px-2 py-2.5 text-center text-xs font-semibold border-l border-gray-200" style={isDRP ? dropCellStyle(dropSeq[dropCellCount]) : { background: '#EFEFEF' }}>
                  {isINC ? <span className="text-amber-500">INC</span> : isDRP ? dropSeq[dropCellCount] : (composite !== null ? Math.round(composite) : '—')}
                </td>
                <td className="px-2 py-2.5 text-center text-xs border-l border-gray-200" style={isDRP ? dropCellStyle(dropSeq[dropCellCount + 1]) : { background: '#EEF1F5' }}>
                  {isINC ? '' : isDRP ? dropSeq[dropCellCount + 1] : (half !== null ? half.toFixed(1) : '—')}
                </td>
                {isFinals && (
                  <td className="px-2 py-2.5 text-center text-xs font-semibold border-l border-gray-200" style={isDRP ? dropCellStyle(dropSeq[dropCellCount + 2]) : { background: '#DCF1FB' }}>
                    {isINC ? <span className="text-amber-500">INC</span> : isDRP ? dropSeq[dropCellCount + 2] : (overall !== null ? Math.round(overall) : '—')}
                  </td>
                )}
                <td className="px-3 py-2.5 text-center font-bold border-l border-gray-200" style={isDRP ? dropCellStyle(dropSeq[dropCellCount + (isFinals ? 3 : 2)]) : { background: GWA_DATA_COLOR }}>
                  {isINC ? <span className="text-amber-500">INC</span> : isDRP ? dropSeq[dropCellCount + (isFinals ? 3 : 2)] : (gwa !== null ? gwa.toFixed(1) : '—')}
                </td>
                {(() => {
                  // Automatic — derived straight from this period's own gwa
                  // the instant it's fully encoded, same Passed/Failed cutoff
                  // (1.0–3.0) used everywhere else, so there's nothing to
                  // submit first just to see it. Same remarksStyle solid
                  // green/red (not the faint Badge pill) as the Class
                  // Record's own read-only view, the Grading Sheet, and the
                  // Excel export, so this reads exactly as boldly here as it
                  // does everywhere else Remarks shows up.
                  const remarksStatus = isINC ? 'INC' : (gwa !== null ? (gwa >= 1.0 && gwa <= 3.0 ? 'Passed' : 'Failed') : null);
                  const rStyle = remarksStatus ? remarksStyle(remarksStatus) : null;
                  const remarksOffset = dropCellCount + (isFinals ? 4 : 3);
                  return (
                    <td
                      className="px-2 py-2.5 text-center border-l border-gray-200 font-bold"
                      style={isDRP ? dropCellStyle(dropSeq[remarksOffset]) : (rStyle ? { background: rStyle.bg, color: rStyle.color } : undefined)}
                    >
                      {isDRP ? dropSeq[remarksOffset] : remarksStatus ? remarksFor(remarksStatus) : <span className="text-gray-300 font-normal">—</span>}
                    </td>
                  );
                })()}
                <td className="px-2 py-2.5 text-center border-l border-gray-200 bg-gray-50/40">
                  {/* Every button here shares one fixed width instead of
                      each hugging its own label length — "Mark INC" and
                      "Drop" are different lengths, so left to auto-size
                      they'd never line up or match size. */}
                  <div className="flex flex-col items-center gap-1">
                    {isINC ? (
                      <button
                        className="text-[11px] px-2 py-1 rounded-lg font-semibold text-white border-none cursor-pointer font-sans whitespace-nowrap"
                        style={{ background: 'linear-gradient(135deg, #b45309, #d97706)', width: 96 }}
                        onClick={() => onResolveINC(g, comps)}
                        title="Opens a popup to encode exactly what's incomplete in this period"
                      >
                        Resolve INC
                      </button>
                    ) : isDRP ? (
                      <button
                        className="text-[11px] px-2 py-1 rounded-lg font-semibold border cursor-pointer font-sans text-gray-600 border-gray-300 bg-white hover:bg-gray-50 transition-colors whitespace-nowrap"
                        style={{ width: 96 }}
                        onClick={() => onUndoDRP(g)}
                      >
                        Undo Drop
                      </button>
                    ) : !g.submitted && gwa === null ? (
                      // Mark INC/Drop only offered while THIS period still has
                      // a component genuinely unscored — once every component
                      // is filled in (gwa computed, Remarks already shows
                      // Passed/Failed), there's nothing left to mark incomplete
                      // or drop out of, so neither button is there anymore
                      // instead of sitting disabled next to a grade that's
                      // already effectively final.
                      <>
                        <button
                          className="text-[11px] px-2 py-1 rounded-lg font-semibold border cursor-pointer font-sans text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors whitespace-nowrap"
                          style={{ width: 96 }}
                          onClick={() => onMarkINC(g)}
                        >
                          Mark INC
                        </button>
                        <button
                          className="text-[11px] px-2 py-1 rounded-lg font-semibold border cursor-pointer font-sans text-red-700 border-red-300 bg-red-50 hover:bg-red-100 transition-colors whitespace-nowrap"
                          style={{ width: 96 }}
                          onClick={() => onMarkDRP(g)}
                        >
                          Drop
                        </button>
                      </>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// `classId`/`onBack` are optional — when passed (InstructorDashboard.js embeds
// this inline instead of navigating to /faculty/encode/:classId, so "Encode
// Grades" opens right there on the Dashboard), they win over the URL param
// and the browser-history back button. Without them (the routed page, still
// how My Classes and Chairperson's own teaching flow reach this), it falls
// back to its original standalone behavior unchanged.
export default function GradeEncoding({ classId: classIdProp, onBack } = {}) {
  const { classId: classIdParam } = useParams();
  const classId = classIdProp || classIdParam;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const handleBack = onBack || (() => navigate(-1));
  const { user } = useAuth();
  // Reused as-is for a teaching Chairperson under /chairperson/* — route the
  // "back" button off the account's actual role rather than hardcoding /faculty.
  const base = user?.role === 'Chairperson' ? '/chairperson' : '/faculty';
  const periodHeaderClass = programHeaderClass(user?.program);
  const periodCascade = programCascadeGradient(user?.program);
  const [classData, setClassData] = useState(null);
  const [releaseStatus, setReleaseStatus] = useState(null);
  const [releasing, setReleasing] = useState(false);
  // What the exported .docx/.xlsx file actually looks like (letterhead,
  // roster, signature block — "Verified Correct", "Submitted by", the
  // Registrar/VPAA names, footer) — same on-screen preview Chairperson/Admin
  // already get on their own Grade Approval pages ('sheet' | 'record'),
  // shown here for Faculty too instead of them only finding out what it
  // looks like after actually downloading it.
  const [preview, setPreview] = useState(null);
  const [studentGrades, setStudentGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Which tab/period-accordion was open persists across navigation
  // (usePageState), keyed per class — the actual grade/score data below
  // stays plain useState and always re-fetches fresh from the server, so an
  // unsaved edit never silently reappears after leaving and coming back.
  const [activeTab, setActiveTab] = usePageState(`GradeEncoding.${classId}.activeTab`, 'components');
  // A "Class Record"/"Grade Sheet" link from a returned-for-revision message
  // (Messages.js) carries ?tab=components|grades so landing here opens on
  // the actual tab the reviewer flagged, instead of whatever tab happened to
  // be cached from a previous visit.
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'components' || tab === 'grades') setActiveTab(tab);
  }, [searchParams, setActiveTab]);
  // Midterm/Finals collapsed independently in the Class Record — both start
  // closed, same as every other collapsible group in the system.
  const [periodOpen, setPeriodOpen] = usePageState(`GradeEncoding.${classId}.periodOpen`, { Midterm: false, Finals: false });
  const togglePeriod = (period) => setPeriodOpen((prev) => ({ ...prev, [period]: !prev[period] }));

  // Component state
  const [components, setComponents] = useState([]);
  // Draft-persisted (localStorage, not just in-memory) — a full Class Record's
  // worth of typed scores is real, hard-to-redo work, and there's no autosave
  // here until "Save All Scores" is actually clicked. Restored automatically
  // if the tab gets refreshed, loses connection, or is closed and reopened
  // before that save happens — see loadData() below for how this is kept from
  // being clobbered by the server's own (still-empty, until saved) copy, and
  // saveAllScores() for where it's cleared out again once the real save lands.
  const [componentScores, setComponentScores, clearScoresDraft] = useDraftState(`GradeEncoding.scores.${user?.id}.${classId}`, {}); // { studentId: { itemId: score } }
  // Captured once, synchronously, at the very first render — before loadData()
  // has a chance to run — so the toast below reflects "was there a draft
  // when this page opened", not whatever componentScores has become since.
  const hadRestoredDraft = useRef(Object.keys(componentScores).length > 0);
  // Once componentScores has been synced from the server a single time (on
  // mount), it's the browser's job to stay the source of truth from then on
  // — see loadData() below. Without this, editing components, marking an
  // INC/DRP, or any other action that happens to call loadData() again
  // would silently overwrite every score typed since the last real "Save
  // All Scores", not just the ones that action itself was actually about.
  const scoresSyncedOnce = useRef(false);
  const [showComponentSetup, setShowComponentSetup] = useState(false);
  const [editComponents, setEditComponents] = useState([]);
  // Draft copy of Class.rate_formula for the Component Setup modal — same
  // save-then-commit pattern as editComponents itself, so picking a
  // different Rate scale doesn't take effect until Save Components actually
  // commits it.
  const [editRateFormula, setEditRateFormula] = useState('50_45');
  // One Setup-modal-wide switch (not per-component) — when on, editing any
  // Midterm component (name, weight, Show Ave, its items) also applies
  // that same change to the Finals component sharing its name. Never sent
  // to the backend, purely a session-local editing convenience.
  const [mirrorToFinals, setMirrorToFinals] = useState(true);
  const [savingComponents, setSavingComponents] = useState(false);
  const [savingScores, setSavingScores] = useState(false);

  // A student's full curriculum record (1st-4th Year + overall GWA), pulled
  // up from clicking their name in the score grid above — not just this
  // one class's grade.
  const [gradesTarget, setGradesTarget] = useState(null);

  // ✅ INC modal state — mode is always 'mark' now; resolving an INC opens
  // its own dedicated popup instead (resolveIncTarget below), not this one.
  const [showINCModal, setShowINCModal] = useState(false);
  const [incTarget, setIncTarget] = useState(null); // { student, gradeId, mode: 'mark' }
  const [incRemarks, setIncRemarks] = useState('');
  const [incDeadline, setIncDeadline] = useState('');
  const [savingINC, setSavingINC] = useState(false);

  // ✅ Resolve INC popup — opens the moment "Resolve INC" is clicked, scoped
  // to whichever items are STILL missing a score for this student (checked
  // live off componentScores, not anything picked ahead of time at Mark INC)
  // — so the instructor encodes right there instead of hunting for the
  // student's row in the full Class Record grid.
  const [resolveIncTarget, setResolveIncTarget] = useState(null); // { student, gradeId, components }
  const [resolvingINC, setResolvingINC] = useState(false);

  // Shared confirm-warning for every mutating/action button on this page —
  // { title, message, confirmText, variant, action } — one ConfirmDialog
  // instance instead of a separate confirm-target state per button.
  const [confirmAction, setConfirmAction] = useState(null);
  const requestConfirm = (config) => setConfirmAction(config);
  const runConfirmedAction = async () => {
    const cfg = confirmAction;
    setConfirmAction(null);
    if (cfg?.action) await cfg.action();
  };

  useEffect(() => { loadData(); }, [classId]);

  // Let Faculty know why the grid already has numbers in it on a fresh page
  // load — otherwise a restored draft just looks like unexplained data.
  useEffect(() => {
    if (hadRestoredDraft.current) {
      toast('Restored unsaved scores from your last session.', { icon: '↺' });
    }
  }, []);

  // Class Record is the primary view, but fall back to Grade Sheet if this class has no components set up yet.
  useEffect(() => {
    if (!loading && components.length === 0) setActiveTab('grades');
  }, [loading, components]);

  // Auto-populate this class's Class Record from its subject's own grading
  // scheme (set when the subject was created) the moment it's needed — no
  // button, no manual step. Only fires when there's genuinely nothing to
  // lose (zero existing components); a class whose subject has no grading
  // scheme, or that already has components, is untouched.
  const autoInitAttempted = useRef(false);
  useEffect(() => {
    if (loading || autoInitAttempted.current) return;
    if (components.length > 0) return;
    const scheme = classData?.subject?.grading_scheme;
    if (!scheme || scheme.length === 0) return;

    autoInitAttempted.current = true;
    (async () => {
      try {
        await API.put(`/grade-components/${classId}/components`, { components: buildComponentsFromScheme(scheme) });
        loadData();
      } catch (err) {
        // Silent — Faculty/Chairperson can still set components up manually
        // via "Setup Components" if this ever fails (e.g. weights not
        // actually totaling 100% on the subject's own scheme).
        console.error('Auto-init components from subject grading scheme failed:', err);
      }
    })();
  }, [loading, components, classData, classId]);

  // Same "no button, no manual step" auto-heal, extended to classes that
  // already got the OLD auto-init behavior (one bare generic "Score" item
  // per component, from before item breakdowns were added) — upgrading them
  // to the real SSU item structure automatically too, but ONLY when every one
  // of those bare items still has zero scores entered anywhere, so there is
  // genuinely nothing to lose. Anything with real data stays untouched;
  // "Reset to SSU Template" in Setup Components remains available manually
  // for those, same as always.
  const autoUpgradeAttempted = useRef(false);
  useEffect(() => {
    if (loading || autoUpgradeAttempted.current) return;
    if (components.length === 0) return; // handled by the auto-init effect above instead
    const scheme = classData?.subject?.grading_scheme;
    if (!scheme || scheme.length === 0) return;

    const isBareStub = (comps) => comps.length === scheme.length && comps.every(c =>
      (c.items || []).length === 1 && c.items[0].name === 'Score' && parseFloat(c.items[0].max_score) === 100
    );
    const midComps = components.filter(c => c.period === 'Midterm');
    const finComps = components.filter(c => c.period === 'Finals');
    if (!isBareStub(midComps) || !isBareStub(finComps)) return;

    const hasAnyScore = Object.values(componentScores).some((byItem) =>
      Object.values(byItem || {}).some((v) => v !== null && v !== undefined && v !== '')
    );
    if (hasAnyScore) return; // real data exists — never silently touch it

    autoUpgradeAttempted.current = true;
    (async () => {
      try {
        await API.put(`/grade-components/${classId}/components`, { components: buildComponentsFromScheme(scheme) });
        loadData();
      } catch (err) {
        console.error('Auto-upgrade of bare-stub components to full SSU breakdown failed:', err);
      }
    })();
  }, [loading, components, componentScores, classData, classId]);

  const loadData = async () => {
    try {
      const { data } = await gradeService.getByClass(classId);
      setClassData(data.class);
      setReleaseStatus(data.release_status || null);
      setStudentGrades(data.student_grades
        // Alphabetical by LAST name (comparePeopleNames — Last, First order,
        // same as every other class roster in the app), not the raw "First
        // Last" string — the enrollment order the backend returns otherwise
        // has no particular meaning (whatever order they were enrolled in),
        // and both the Class Record and Grade Sheet need a stable, numbered,
        // A-Z-by-surname roster to match the official Class Record.
        .slice()
        .sort((a, b) => comparePeopleNames(a.student, b.student))
        .map((sg) => ({
          student: sg.student,
          midterm: sg.grade?.midterm ? parseFloat(sg.grade.midterm).toFixed(1) : '',
          finals: sg.grade?.finals ? parseFloat(sg.grade.finals).toFixed(1) : '',
          average: sg.grade?.average ?? null,
          status: sg.grade?.status || 'Pending',
          submitted: sg.grade?.submitted || false,
          gradeId: sg.grade?.id || null,
          inc_remarks: sg.grade?.inc_remarks || '',
          inc_deadline: sg.grade?.inc_deadline || null,
          inc_resolved_date: sg.grade?.inc_resolved_date || null,
        })));

      try {
        const compRes = await API.get(`/grade-components/${classId}/components`);
        setComponents(compRes.data.components || []);
        const scoreRes = await API.get(`/grade-components/${classId}/scores`);
        // Only ever syncs componentScores from the server ONCE, the first
        // time this class's data loads (restoring a local draft over an
        // empty server response if there was one — see useDraftState above).
        // Every later call to loadData() — from editing components, marking
        // an INC/DRP, unlocking, etc. — leaves whatever's already typed in
        // the browser alone, so none of those actions can wipe scores that
        // haven't gone through an explicit "Save All Scores" yet.
        //
        // Whether to trust the server here at all depends on the LOCAL draft,
        // not the server's own content — a class that already had SOME scores
        // saved from before, with newer not-yet-saved edits typed on top
        // (componentScores' own draft, restored by useDraftState above before
        // this even runs), used to get those newer edits silently discarded
        // on every refresh, because "the server has scores" alone was enough
        // to trigger the overwrite regardless of how much newer the draft
        // was. Only seed from the server when there's truly no local draft to
        // protect — Save All Scores clears the draft on success (see
        // clearScoresDraft below), so a genuinely fresh visit after a real
        // save has nothing here to lose either way.
        if (!scoresSyncedOnce.current) {
          scoresSyncedOnce.current = true;
          const hasLocalDraft = Object.keys(componentScores).length > 0;
          const serverScores = scoreRes.data.scores || {};
          if (!hasLocalDraft && Object.keys(serverScores).length > 0) setComponentScores(serverScores);
        }
      } catch (e) {
        setComponents([]);
      }
    } catch (err) {
      toast.error('Failed to load class data');
    } finally {
      setLoading(false);
    }
  };

  // Marking/undoing a single student's INC or DRP only ever changes THAT
  // student's own Grade row on the backend — it never touches ComponentScore
  // rows at all. Refreshing with the full loadData() above anyway used to
  // overwrite the WHOLE componentScores state from the server's last-saved
  // copy, silently discarding any scores every OTHER student's row had typed
  // in but not yet clicked "Save Scores" for — a student's edits could
  // vanish just because a completely unrelated student got marked Dropped.
  // This refetches only what an INC/DRP action can actually change
  // (studentGrades' status/submitted flags, and the release-eligibility
  // rollup that reads them) and leaves components/componentScores — and
  // whatever's currently typed into them — untouched.
  const refreshGradesOnly = async () => {
    try {
      const { data } = await gradeService.getByClass(classId);
      setClassData(data.class);
      setReleaseStatus(data.release_status || null);
      setStudentGrades(data.student_grades
        // Same LAST-name ordering as loadData above (comparePeopleNames) —
        // this refetch must never reshuffle the roster differently from the
        // initial load.
        .slice()
        .sort((a, b) => comparePeopleNames(a.student, b.student))
        .map((sg) => ({
          student: sg.student,
          midterm: sg.grade?.midterm ? parseFloat(sg.grade.midterm).toFixed(1) : '',
          finals: sg.grade?.finals ? parseFloat(sg.grade.finals).toFixed(1) : '',
          average: sg.grade?.average ?? null,
          status: sg.grade?.status || 'Pending',
          submitted: sg.grade?.submitted || false,
          gradeId: sg.grade?.id || null,
          inc_remarks: sg.grade?.inc_remarks || '',
          inc_deadline: sg.grade?.inc_deadline || null,
          inc_resolved_date: sg.grade?.inc_resolved_date || null,
        })));
    } catch (err) {
      toast.error('Failed to refresh grades');
    }
  };

  const updateGrade = (studentId, field, value) => {
    setStudentGrades((prev) =>
      prev.map((g) => g.student.id === studentId ? { ...g, [field]: value } : g)
    );
  };

  const getAverage = (g) => {
    if (g.status === 'INC') return null;
    if (g.midterm === '' || g.finals === '') return null;
    const mid = parseFloat(g.midterm);
    const fin = parseFloat(g.finals);
    if (isNaN(mid) || isNaN(fin)) return null;
    return Math.round(((mid + fin) / 2) * 100) / 100;
  };

  const isPassed = (avg) => avg !== null && avg >= 1.0 && avg <= 3.0;

  // ✅ "allComplete" now considers INC as a valid complete state
  const allComplete = studentGrades.every((g) =>
    g.status === 'INC' ||
    g.status === 'DRP' ||
    (g.midterm !== '' && g.finals !== '')
  );


  // ====== Component Setup ======
  const openComponentSetup = () => {
    setEditComponents(components.length > 0
      ? components.map(c => ({
          ...c,
          weight: parseFloat(c.weight),
          items: (c.items || []).map(i => ({ ...i, max_score: parseFloat(i.max_score) })),
        }))
      : []
    );
    setEditRateFormula(classData?.rate_formula || '50_45');
    setShowComponentSetup(true);
  };

  const loadSSUTemplate = () => {
    const build = (period) => SSU_TEMPLATE.map((c, i) => ({
      name: c.name, period, weight: c.weight, order_index: i,
      items: c.items.map((it, j) => ({ ...it, order_index: j })),
    }));
    setEditComponents([...build('Midterm'), ...build('Finals')]);
  };

  // A new class already gets this automatically at creation (see backend
  // createClass), and one with zero components picks it up on load (see the
  // auto-init effect above) — this manual option exists for a class created
  // before either of those applied, or whose components have since drifted
  // from what the subject is now set to. Just fills the modal, same as
  // loadSSUTemplate — actually persisting it still goes through Save
  // Components' own confirm warning below.
  const subjectGradingScheme = classData?.subject?.grading_scheme;
  const loadFromSubjectScheme = () => {
    if (!subjectGradingScheme || subjectGradingScheme.length === 0) return;
    setEditComponents(buildComponentsFromScheme(subjectGradingScheme));
  };

  // Finds the OTHER period's component in the SAME POSITION within its own
  // period — e.g. the 2nd Midterm component mirrors the 2nd Finals
  // component, regardless of what either is currently named. Position-based
  // rather than name-based on purpose: a name-based lookup breaks the
  // instant you rename a component, since the mirror below applies the
  // rename AFTER computing which component to update — by the time it
  // looks, the Finals side still has the OLD name and no longer matches.
  const findMirrorCompIndex = (components, comp, selfIndex) => {
    const otherPeriod = comp.period === 'Midterm' ? 'Finals' : 'Midterm';
    let posInPeriod = 0;
    for (let i = 0; i < selfIndex; i++) {
      if (components[i].period === comp.period) posInPeriod++;
    }
    let count = 0;
    for (let i = 0; i < components.length; i++) {
      if (components[i].period === otherPeriod) {
        if (count === posInPeriod) return i;
        count++;
      }
    }
    return -1;
  };

  // Full sync, not a per-field patch — whatever the Midterm component at
  // midIndex looks like right now (name, weight, Show Ave, and its full
  // items array with every one of their fields) is cloned onto its Finals
  // mirror wholesale. This is what "mirror everything" actually means:
  // one-off per-field mirroring is easy to leave a field or an add/remove
  // out of sync by accident; rebuilding the mirror from scratch every time
  // can't drift. Each mirrored item keeps ITS OWN id (so the backend still
  // treats it as an update, not a delete+recreate) — only a genuinely NEW
  // item (past the Finals side's current item count) ends up idless,
  // exactly like a freshly added item normally does.
  const syncComponentToMirror = (updated, midIndex) => {
    const midComp = updated[midIndex];
    if (midComp.period !== 'Midterm' || !mirrorToFinals) return;
    const mirrorIdx = findMirrorCompIndex(updated, midComp, midIndex);
    if (mirrorIdx === -1) return;
    const finComp = updated[mirrorIdx];
    const syncedItems = (midComp.items || []).map((midItem, i) => ({
      ...(finComp.items?.[i] || {}),
      name: midItem.name,
      max_score: midItem.max_score,
      is_rate_direct: midItem.is_rate_direct,
      show_score: midItem.show_score,
      show_rate: midItem.show_rate,
      order_index: i,
    }));
    updated[mirrorIdx] = {
      ...finComp,
      name: midComp.name,
      weight: midComp.weight,
      show_ave: midComp.show_ave,
      items: syncedItems,
    };
  };

  const addComponent = (period) => {
    const periodComps = editComponents.filter(c => c.period === period);
    const newComp = { name: '', period, weight: 0, order_index: periodComps.length, items: [], show_ave: true };
    const updated = [...editComponents, newComp];
    // Adding a Midterm component also creates its Finals counterpart —
    // both start blank/empty together, then stay paired by POSITION (see
    // findMirrorCompIndex above), not by name.
    if (period === 'Midterm' && mirrorToFinals) {
      const finalsComps = editComponents.filter(c => c.period === 'Finals');
      updated.push({ name: '', period: 'Finals', weight: 0, order_index: finalsComps.length, items: [], show_ave: true });
    }
    setEditComponents(updated);
  };

  const updateComponent = (index, field, value) => {
    const updated = [...editComponents];
    // A single component can never be worth more than 100% of a period on its
    // own — clamped here rather than relying on the total-must-equal-100%
    // check at Save time, so an impossible value never even sits in the field.
    let parsed = field === 'weight' || field === 'order_index' ? parseFloat(value) || 0 : value;
    if (field === 'weight') parsed = Math.min(100, Math.max(0, parsed));
    updated[index] = { ...updated[index], [field]: parsed };
    syncComponentToMirror(updated, index);
    setEditComponents(updated);
  };

  const removeComponent = (index) => {
    const comp = editComponents[index];
    // Removing a Midterm component also removes its Finals counterpart —
    // the whole point of "mirror everything" is that the two stay in
    // lockstep, deletions included, not just edits.
    if (comp.period === 'Midterm' && mirrorToFinals) {
      const mirrorIdx = findMirrorCompIndex(editComponents, comp, index);
      setEditComponents(editComponents.filter((_, i) => i !== index && i !== mirrorIdx));
      return;
    }
    setEditComponents(editComponents.filter((_, i) => i !== index));
  };

  const addItem = (compIndex) => {
    const updated = [...editComponents];
    const comp = updated[compIndex];
    const items = comp.items || [];
    updated[compIndex] = { ...comp, items: [...items, { name: '', max_score: 100, order_index: items.length, is_rate_direct: false, show_score: true, show_rate: true }] };
    syncComponentToMirror(updated, compIndex);
    setEditComponents(updated);
  };

  // Applies one field edit — plus its two side effects (clearing an auto
  // "Score" name, defaulting Show Ave off for a new single Rate-only item)
  // — to one items array.
  const applyItemEdit = (comp, itemIndex, field, parsed) => {
    const items = [...(comp.items || [])];
    if (!items[itemIndex]) return comp;
    items[itemIndex] = { ...items[itemIndex], [field]: parsed };
    if (field === 'is_rate_direct' && parsed && items[itemIndex].name.trim().toLowerCase() === 'score') {
      items[itemIndex] = { ...items[itemIndex], name: '' };
    }
    let next = { ...comp, items };
    if (field === 'is_rate_direct' && parsed && items.length === 1) {
      next = { ...next, show_ave: false };
    }
    return next;
  };

  const updateItem = (compIndex, itemIndex, field, value) => {
    const updated = [...editComponents];
    let parsed = field === 'max_score' || field === 'order_index' ? parseFloat(value) || 0 : value;
    if (field === 'max_score') parsed = Math.max(0, parsed);
    updated[compIndex] = applyItemEdit(updated[compIndex], itemIndex, field, parsed);
    syncComponentToMirror(updated, compIndex);
    setEditComponents(updated);
  };

  const removeItem = (compIndex, itemIndex) => {
    const updated = [...editComponents];
    const comp = updated[compIndex];
    updated[compIndex] = { ...comp, items: comp.items.filter((_, i) => i !== itemIndex) };
    syncComponentToMirror(updated, compIndex);
    setEditComponents(updated);
  };

  const getTotalWeight = (period) =>
    editComponents.filter(c => c.period === period).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0);

  const saveComponentSetup = async () => {
    const midComps = editComponents.filter(c => c.period === 'Midterm');
    const finComps = editComponents.filter(c => c.period === 'Finals');

    if (midComps.length > 0 && Math.abs(getTotalWeight('Midterm') - 100) > 0.01) {
      toast.error('Midterm weights must total 100%');
      return;
    }
    if (finComps.length > 0 && Math.abs(getTotalWeight('Finals') - 100) > 0.01) {
      toast.error('Finals weights must total 100%');
      return;
    }
    for (const comp of editComponents) {
      if (!comp.name.trim()) { toast.error('All components must have a name'); return; }
      if (!comp.items || comp.items.length === 0) { toast.error(`"${comp.name}" needs at least one item`); return; }
      for (const item of comp.items) {
        if (!item.name.trim()) { toast.error(`All items in "${comp.name}" must have a name`); return; }
      }
    }

    // Any item that isn't carrying its original id over (removed outright,
    // or replaced wholesale by "Use SSU Template"/"Use Subject's Grading
    // Scheme") gets deleted server-side, which cascades to every score
    // already entered against it (see gradeComponentController.saveComponents'
    // own diff-by-id logic — this mirrors it client-side, before it's too
    // late to back out). Only warn when that would actually throw real,
    // already-typed scores away — reordering, renaming, or reweighting an
    // item that keeps its id is completely safe and needs no prompt.
    const keptItemIds = new Set(editComponents.flatMap((c) => (c.items || []).map((i) => i.id)).filter(Boolean));
    const droppedItemIds = components
      .flatMap((c) => (c.items || []).map((i) => i.id))
      .filter((id) => !keptItemIds.has(id));
    const scoresAtRisk = droppedItemIds.some((id) =>
      Object.values(componentScores).some((byItem) => byItem && byItem[id] !== null && byItem[id] !== undefined && byItem[id] !== '')
    );

    if (scoresAtRisk) {
      requestConfirm({
        title: 'Discard entered scores?',
        message: 'This removes one or more items that already have scores entered against them. Those scores will be permanently deleted along with the item. This cannot be undone.',
        confirmText: 'Discard and Save',
        variant: 'red',
        action: () => doSaveComponentSetup(droppedItemIds),
      });
      return;
    }

    await doSaveComponentSetup(droppedItemIds);
  };

  const doSaveComponentSetup = async (droppedItemIds = []) => {
    setSavingComponents(true);
    try {
      await API.put(`/grade-components/${classId}/components`, { components: editComponents, rate_formula: editRateFormula });
      toast.success('Components saved!');
      setShowComponentSetup(false);
      // Prunes any now-deleted item's scores out of componentScores' own
      // localStorage draft — loadData() below won't do this on its own
      // (its own stale-draft guard deliberately keeps a non-empty local
      // draft over a fresh, possibly-leaner server response), so a dropped
      // item's leftover score would otherwise sit there forever, harmless
      // but pointless (the backend already ignores it on save regardless).
      if (droppedItemIds.length > 0) {
        const droppedSet = new Set(droppedItemIds);
        setComponentScores((prev) => {
          const next = {};
          for (const [studentId, byItem] of Object.entries(prev)) {
            next[studentId] = Object.fromEntries(Object.entries(byItem || {}).filter(([itemId]) => !droppedSet.has(parseInt(itemId))));
          }
          return next;
        });
      }
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save components');
    } finally {
      setSavingComponents(false);
    }
  };

  // ====== Component Scores (per item) ======
  const updateScore = (studentId, itemId, value) => {
    setComponentScores(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [itemId]: value === '' ? null : parseFloat(value),
      },
    }));
  };

  const saveAllScores = async () => {
    setSavingScores(true);
    try {
      await API.put(`/grade-components/${classId}/scores`, { scores: componentScores });
      // The server now has this exact data — the local draft has done its
      // job and would only risk resurrecting stale values on a later visit.
      clearScoresDraft();
      toast.success('Scores saved and locked — click "Edit Scores" if you need to change something.');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save scores');
    } finally {
      setSavingScores(false);
    }
  };

  // The deliberate way back in once saveAllScores has locked the grid —
  // reopens it for editing, then saveAllScores locks it again on the next save.
  const unlockScores = async () => {
    setSavingScores(true);
    try {
      await API.post(`/grade-components/${classId}/unlock-scores`);
      toast.success('Class Record unlocked.');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to unlock');
    } finally {
      setSavingScores(false);
    }
  };

  // ====== Save Draft ======
  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      // ✅ Skip INC/DRP students from normal grade encode
      const grades = studentGrades
        .filter((g) => g.status !== 'INC' && g.status !== 'DRP')
        .filter((g) => g.midterm !== '' || g.finals !== '')
        .map((g) => ({
          student_id: g.student.id,
          midterm: g.midterm ? parseFloat(g.midterm) : null,
          finals: g.finals ? parseFloat(g.finals) : null,
        }));

      await API.post('/grades/encode', {
        class_id: parseInt(classId),
        grades,
      });

      toast.success('Grades saved as draft');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ====== Submit Grades ======
  const handleSubmit = async () => {
    if (!allComplete) {
      toast.error('Please complete all grades or mark incomplete students as INC first');
      return;
    }
    setSaving(true);
    try {
      // ✅ Only encode non-INC students that have grades
      const grades = studentGrades
        .filter((g) => g.status !== 'INC' && g.status !== 'DRP')
        .map((g) => ({
          student_id: g.student.id,
          midterm: parseFloat(g.midterm),
          finals: parseFloat(g.finals),
        }));

      if (grades.length > 0) {
        await API.post('/grades/encode', {
          class_id: parseInt(classId),
          grades,
        });
      }

      await API.post('/grades/submit', { class_id: parseInt(classId) });

      toast.success('Grades submitted successfully!');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  // ====== Release Grades to Students ======
  // Separate from "Submit Grades" above on purpose — Submit is what makes a
  // class's grades visible to Chairperson/Admin for review in the first
  // place, so gating it on their sign-off would be circular (they can't
  // review something that was never submitted). This is the actual
  // student-facing release, gated on releaseStatus.can_release (both halves
  // of the sign-off — see gradeController.getGradesByClass).
  const handleReleaseGrades = async () => {
    setReleasing(true);
    try {
      const { data } = await gradeService.releaseClass(classId);
      toast.success(data.message);
      // Releasing is the point this document actually becomes final — export
      // it automatically right here instead of leaving it as a separate
      // manual step Faculty has to remember to come back and do.
      await exportGradingSheet();
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to release grades');
    } finally {
      setReleasing(false);
    }
  };

  // ====== INC Handlers ======
  const openMarkINC = (g) => {
    setIncTarget({ student: g.student, gradeId: g.gradeId, mode: 'mark' });
    setIncRemarks(g.inc_remarks || '');
    setIncDeadline(g.inc_deadline ? new Date(g.inc_deadline).toISOString().split('T')[0] : '');
    setShowINCModal(true);
  };

  const handleSaveINC = async () => {
    if (!incTarget) return;
    setSavingINC(true);

    try {
      await API.post('/grades/inc', {
        class_id: parseInt(classId),
        student_id: incTarget.student.id,
        inc_remarks: incRemarks,
        inc_deadline: incDeadline || null,
      });
      toast.success(`${incTarget.student.name} marked as INC`);

      setShowINCModal(false);
      setIncTarget(null);
      refreshGradesOnly();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to process INC');
    } finally {
      setSavingINC(false);
    }
  };

  // The only way out of INC — opens a popup scoped to whatever's ACTUALLY
  // still missing a score for this student right now (checked live off
  // componentScores, not anything picked ahead of time at Mark INC), right
  // where the instructor clicked, instead of sending them to find the
  // student's row in the full Class Record grid. Still real per-item
  // encoding, not a shortcut to type a final Midterm/Finals GWA by hand.
  // `periodComps` is whichever PeriodTable's own `comps` the button was
  // clicked from (Midterm's or Finals') — scopes the popup to just that
  // period instead of dumping both periods' missing items on the instructor
  // regardless of which one they were actually looking at.
  const openResolveINC = (g, periodComps) => {
    const incomplete = periodComps
      .map((c) => ({
        ...c,
        items: (c.items || []).filter((item) => {
          const v = componentScores[g.student.id]?.[item.id];
          return v === undefined || v === null || v === '';
        }),
      }))
      .filter((c) => c.items.length > 0);
    setResolveIncTarget({ student: g.student, gradeId: g.gradeId, components: incomplete });
  };

  const handleResolveINCSave = async () => {
    if (!resolveIncTarget) return;
    const { student, gradeId, components: flagged } = resolveIncTarget;
    const allItems = flagged.flatMap((c) => c.items || []);
    const missing = allItems.some((item) => {
      const v = componentScores[student.id]?.[item.id];
      return v === undefined || v === null || v === '';
    });
    if (missing) {
      toast.error('Enter a score for every item before resolving.');
      return;
    }

    setResolvingINC(true);
    try {
      // Undo first (status -> Pending, wipes stale midterm/finals) so the
      // score save right after this recomputes them fresh with the hook's
      // normal auto-average/status logic — it only ever runs off a non-INC
      // status. Order matters: saving scores while still INC would leave
      // the new midterm/finals sitting there uncomputed into an average.
      await API.post('/grades/inc/undo', { grade_id: gradeId });
      // Scoped to ONLY this student, and lock:false — this is a targeted
      // single-student fix, not "Save All Scores": it must never write
      // (or lock the grid on top of) whatever every OTHER student's row
      // currently has typed but not yet saved.
      await API.put(`/grade-components/${classId}/scores`, {
        scores: { [student.id]: componentScores[student.id] || {} },
        lock: false,
      });
      toast.success(`${student.name}'s INC resolved.`);
      setResolveIncTarget(null);
      // refreshGradesOnly, not loadData — same reasoning as Mark/Undo
      // INC/DRP below: a full reload would overwrite componentScores for
      // EVERY student from the server's last-saved copy, silently
      // discarding whatever any other student's row currently has typed
      // but not yet saved. This only needs the just-resolved student's new
      // status/midterm/finals, which refreshGradesOnly already refetches —
      // the score we just saved is already correct in local state.
      refreshGradesOnly();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to resolve INC');
    } finally {
      setResolvingINC(false);
    }
  };

  // ====== DRP Handlers — simpler than INC (no remarks/deadline to collect,
  // no midterm/finals to resolve back to), so a confirm dialog is enough;
  // no dedicated modal needed. ======
  const handleMarkDRP = (g) => requestConfirm({
    title: 'Mark as Dropped',
    message: `Mark ${g.student.name} as Dropped for this class? This replaces any entered scores with DROP — the student won't be graded normally, and this can be undone later if it was a mistake.`,
    confirmText: 'Mark Dropped',
    variant: 'red',
    action: async () => {
      try {
        await API.post('/grades/drp', { class_id: parseInt(classId), student_id: g.student.id });
        toast.success(`${g.student.name} marked as Dropped`);
        refreshGradesOnly();
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to mark as Dropped');
      }
    },
  });

  const handleUndoDRP = (g) => requestConfirm({
    title: 'Undo Drop',
    message: `Undo the Dropped status for ${g.student.name}? Their grade goes back to blank and unsubmitted, ready to encode normally.`,
    confirmText: 'Undo Drop',
    variant: 'gold',
    action: async () => {
      try {
        await API.post('/grades/drp/undo', { grade_id: g.gradeId });
        toast.success(`Drop undone for ${g.student.name}`);
        refreshGradesOnly();
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to undo Drop');
      }
    },
  });

  // ====== Export — official Grading Sheet (SSU-UNREG-FR-017, Rev. 8), the summary
  // passed to the Chairperson. Built to match the real registrar form's layout
  // (letterhead, AY/Semester + Curriculum fields, Subject/Instructor row, the
  // No/Student ID/Name/Midterm/Finals/Remarks table, the 4-signatory block).
  // The physical form only has 25 numbered rows, so a class with more students
  // gets another same-shaped column block added beside the first instead of
  // truncating the roster. Generation itself lives in utils/gradingSheetDocx.js
  // — shared with My Classes' own inline Export buttons, so both places
  // produce the exact same file. ======
  const exportGradingSheet = () => exportGradingSheetDocx({ classData, studentGrades });

  // ====== Excel Export — entry point (shared with pages/common/ClassRecordView.js
  // via utils/classRecordExcel.js, so both places export the exact same file) ======
  const exportToExcel = () => exportClassRecordToExcel({ classData, components, studentGrades, componentScores });

  if (loading) return <LoadingSpinner />;

  const midtermComps = components.filter(c => c.period === 'Midterm');
  const finalsComps = components.filter(c => c.period === 'Finals');
  const hasComponents = components.length > 0;
  // Which score→Rate scale this class uses (Class.rate_formula) — the same
  // value drives every Rate/Ave/Weighted/Composite/GWA figure in the Class
  // Record grid below, the Resolve INC popup, and the Excel export.
  const rateFormula = getRateFormula(classData);
  const incCount = studentGrades.filter(g => g.status === 'INC').length;

  return (
    <>
      {/* Goes back to wherever this was actually opened from — usually My
          Classes (clicking "Encode Grades" there), sometimes a notification
          link, or back to the Dashboard's own view when embedded there
          (onBack) — instead of always landing on the Dashboard regardless. */}
      <button className="btn btn-outline mb-4" onClick={handleBack}>
        <Icons.ArrowLeft /> Back
      </button>

      <div className="flex items-center gap-3 mb-1">
        <Badge variant="blue">{classData?.subject?.code}</Badge>
        {/* Cross-program teaching means this class's subject isn't
            necessarily from your own program(s) anymore — always show which
            one it actually belongs to instead of assuming. */}
        {classData?.subject?.program && <ProgramBadge program={classData.subject.program} short />}
        <span className="text-[13px] text-gray-400">{classData?.subject?.units} Units</span>
        <span className="ml-auto text-[13px] text-gray-500">{studentGrades.length} Students</span>
        {/* ✅ Show INC count badge if any */}
        {incCount > 0 && (
          <Badge variant="yellow">{incCount} INC</Badge>
        )}
      </div>
      <h2 className="text-xl font-bold mb-4">{classData?.subject?.name}</h2>

      {/* Tab switcher + actions */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-0 border-b-2 border-gray-200">
          {[...(hasComponents ? ['components'] : []), 'grades'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all capitalize
                ${activeTab === tab ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
            >
              {tab === 'grades' ? 'Grade Sheet' : 'Class Record'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          {/* Hidden while viewing the Grade Sheet tab — editing the
              components belongs to the Class Record side, reachable via its
              own tab. Still shown here when there's no Class Record tab to
              switch to at all yet (a brand-new class, before any components
              exist), since that'd otherwise be a dead end. */}
          {(activeTab !== 'grades' || !hasComponents) && (
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white"
              style={{ background: 'linear-gradient(135deg, #0f2a4a, #1b3a5c)' }}
              onClick={openComponentSetup}
            >
              <Icons.Settings className="w-4 h-4" />
              {hasComponents ? 'Edit Components' : 'Setup Components'}
            </button>
          )}
          {/* What the file actually looks like — letterhead, roster, and the
              full signature block (Verified Correct / Submitted by /
              Received by / Approved, Registrar & VPAA names, footer) —
              before committing to a download. Available any time (not
              gated on release, unlike the export buttons below it), same
              iframe-embedded preview Chairperson/Admin already see on their
              own Grade Approval pages. */}
          <button
            className="btn btn-outline btn-sm whitespace-nowrap"
            onClick={() => setPreview(activeTab === 'grades' ? 'sheet' : 'record')}
            title={`Preview the ${activeTab === 'grades' ? 'Grading Sheet' : 'Class Record'}`}
          >
            <Icons.Eye className="w-4 h-4" /> Preview
          </button>
          {/* Both exports only APPEAR once grades are actually released to
              students (releaseStatus.already_released) — not just shown-but-
              disabled beforehand. Releasing already auto-generates and
              downloads the Grading Sheet once (see handleReleaseGrades), so
              these are for re-downloading afterward, never a still-
              changeable pre-release draft. */}
          {releaseStatus?.already_released && activeTab === 'grades' && (
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white"
              style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
              onClick={() => requestConfirm({
                title: 'Export Grading Sheet',
                message: 'Download the official SSU Grading Sheet for this class as a .docx file?',
                confirmText: 'Export',
                variant: 'green',
                action: exportGradingSheet,
              })}
              title="Export the Grading Sheet"
            >
              <Icons.FileText className="w-4 h-4" /> Export Grading Sheet
            </button>
          )}
          {releaseStatus?.already_released && activeTab !== 'grades' && (
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white"
              style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
              onClick={() => requestConfirm({
                title: 'Export Excel',
                message: 'Download this class\'s Class Record as an Excel (.xlsx) file?',
                confirmText: 'Export',
                variant: 'green',
                action: exportToExcel,
              })}
              title="Export the Class Record"
            >
              <Icons.FileText className="w-4 h-4" /> Export Excel
            </button>
          )}
          {/* No more manual "Send to Chairperson" click — Submit Grades now
              sends it automatically the moment every enrolled student has a
              submitted grade (see submitGrades/notifyGradingSheetSent on the
              backend). This is just a passive status readout so Faculty can
              still see whether it's gone out, without an action to take. */}
          {activeTab === 'grades' && classData?.sent_to_chairperson && (
            <span
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg text-green-700 bg-green-50 border border-green-200"
              title="Automatically sent once every student's grade was submitted"
            >
              <Icons.Check className="w-4 h-4" /> Sent to Chairperson
            </span>
          )}
        </div>
      </div>

      {/* ====== GRADES TAB ====== */}
      {activeTab === 'grades' && (
        <>
        <div className="card">
          <div className="card-header">
            <h3 className="text-base font-semibold text-navy">Grade Sheet</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {hasComponents
                ? 'Auto-computed from the Class Record — Midterm and Finals here always match it exactly, not editable on this tab.'
                : 'SSU GWA Scale: 1.0 (Excellent) — 3.0 (Passing) — 5.0 (Failed)'}
            </p>
          </div>
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-center px-3 py-3 text-xs font-semibold uppercase rounded-tl-lg w-10">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Student No.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Student Name</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Midterm</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Finals</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Average</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Remarks</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Status</th>
                </tr>
              </thead>
              <tbody>
                {studentGrades.map((g, idx) => {
                  const isINC = g.status === 'INC';
                  // Mark INC/Resolve INC/Drop/Undo Drop all live on the Class
                  // Record tab now (see PeriodTable) — this Grade Sheet stays
                  // read-only, same as it's always been for everything else
                  // (it's the auto-computed summary, not where you edit).
                  const isDRP = g.status === 'DRP';
                  const avg = (isINC || isDRP) ? null : getAverage(g);
                  const passed = isPassed(avg);

                  return (
                    <tr
                      key={g.student.id}
                      className={`border-b border-gray-50 ${isINC ? 'bg-amber-50/60' : ''} ${isDRP ? 'bg-red-50/60' : ''}`}
                    >
                      <td className="px-3 py-3.5 text-xs text-gray-400 text-center">{idx + 1}</td>
                      <td className="px-4 py-3.5 font-medium text-sm">{g.student.student_no}</td>
                      <td className="px-4 py-3.5 text-sm">
                        <div>
                          {g.student.name}
                          {/* ✅ Show INC remarks and deadline inline */}
                          {isINC && g.inc_remarks && (
                            <p className="text-[11px] text-amber-600 mt-0.5">{g.inc_remarks}</p>
                          )}
                          {isINC && g.inc_deadline && (
                            <p className="text-[11px] text-gray-400">
                              Deadline: {new Date(g.inc_deadline).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC ? (
                          <span className="text-amber-400 font-semibold text-sm">INC</span>
                        ) : isDRP ? (
                          <span className="text-red-500 font-semibold text-sm">DROP</span>
                        ) : hasComponents ? (
                          // Read-only once there's a Class Record driving this —
                          // Grade.midterm is computed straight from its component
                          // scores server-side (gradeComponentController.saveScores).
                          // Letting this field be typed into too meant a manual
                          // edit here could silently disagree with, and overwrite,
                          // what the Class Record actually says.
                          <span className="text-sm font-semibold text-gray-700">{g.midterm || '—'}</span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            className="grade-input text-center w-20 mx-auto"
                            placeholder="1.0–5.0"
                            value={g.midterm}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (withinMax(v, 5.0)) updateGrade(g.student.id, 'midterm', v);
                            }}
                            disabled={g.submitted && !isINC}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC ? (
                          <span className="text-amber-400 font-semibold text-sm">INC</span>
                        ) : isDRP ? (
                          <span className="text-red-500 font-semibold text-sm">DROP</span>
                        ) : hasComponents ? (
                          <span className="text-sm font-semibold text-gray-700">{g.finals || '—'}</span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            className="grade-input text-center w-20 mx-auto"
                            placeholder="1.0–5.0"
                            value={g.finals}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (withinMax(v, 5.0)) updateGrade(g.student.id, 'finals', v);
                            }}
                            disabled={g.submitted && !isINC}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC ? (
                          <span className="text-amber-500 font-bold">INC</span>
                        ) : isDRP ? (
                          <span className="text-red-500 font-bold">DROP</span>
                        ) : (
                          <span className={`text-base font-bold ${avg !== null ? (passed ? 'text-green-500' : 'text-red-500') : 'text-gray-300'}`}>
                            {avg !== null ? avg.toFixed(1) : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC
                          ? <Badge variant="yellow">INC</Badge>
                          : isDRP
                            ? <Badge variant="red">DROP</Badge>
                            : avg !== null
                              ? <Badge variant={passed ? 'green' : 'red'}>{passed ? 'Passed' : 'Failed'}</Badge>
                              : '—'
                        }
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC
                          ? <Badge variant="yellow">INC</Badge>
                          : isDRP
                            ? <Badge variant="red">DROP</Badge>
                            : g.submitted
                              ? <Badge variant="green"><Icons.Check /> Submitted</Badge>
                              : <Badge variant="yellow">Pending</Badge>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className={`text-[13px] flex items-center gap-1.5 ${allComplete ? 'text-green-500' : 'text-amber-500'}`}>
              {allComplete
                ? <><Icons.Check /> All grades are complete {incCount > 0 && `(${incCount} INC)`}</>
                : 'Some grades are incomplete — complete or mark as INC to submit'}
            </p>
            <div className="flex gap-2">
              {/* Nothing left to draft-save here once the Class Record is
                  driving Midterm/Finals — "Save All Scores" over there is
                  the actual save point now. Only meaningful in the simple,
                  no-components mode, where these fields are the sole way
                  grades get entered at all. */}
              {!hasComponents && (
                <button
                  className="btn btn-outline"
                  onClick={() => requestConfirm({
                    title: 'Save Draft',
                    message: 'Save these grades as a draft? They won\'t be submitted to your Chairperson yet, but entered values will be stored.',
                    confirmText: 'Save Draft',
                    variant: 'green',
                    action: handleSaveDraft,
                  })}
                  disabled={saving}
                >
                  <Icons.Save /> Save Draft
                </button>
              )}
              <button
                className="btn btn-gold"
                onClick={() => requestConfirm({
                  title: 'Submit Grades',
                  message: 'Submit final grades for this class? This finalizes every student\'s Midterm/Finals GWA for the semester — make sure everything is correct first.',
                  confirmText: 'Submit',
                  variant: 'green',
                  action: handleSubmit,
                })}
                disabled={!allComplete || saving}
              >
                <Icons.Send /> Submit Grades
              </button>
            </div>
          </div>
        </div>

        {/* Release to Students — the actual student-facing step, gated on
            both halves of the sign-off (Chairperson verification + Admin
            approval). Only appears once there's something submitted at all. */}
        {releaseStatus && releaseStatus.submitted_count > 0 && (
          <div className="card mt-6">
            <div className="card-header">
              <h3 className="text-base font-semibold text-navy">Release to Students</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Makes this class's grades visible to students — only possible once both sign-offs below are done.
              </p>
            </div>
            <div className="card-body flex items-center justify-between flex-wrap gap-4">
              <div className="space-y-1.5">
                <p className={`text-[13px] flex items-center gap-1.5 ${releaseStatus.chairperson_verified ? 'text-green-500' : 'text-amber-500'}`}>
                  {releaseStatus.chairperson_verified ? <Icons.Check className="w-4 h-4" /> : <Icons.Clock className="w-4 h-4" />}
                  {releaseStatus.chairperson_verified
                    ? 'Verified by your Chairperson'
                    : 'Awaiting Chairperson verification (they forward this to Admin from Grade Sheet and Class Records)'}
                </p>
                <p className={`text-[13px] flex items-center gap-1.5 ${releaseStatus.admin_finalized ? 'text-green-500' : 'text-amber-500'}`}>
                  {releaseStatus.admin_finalized ? <Icons.Check className="w-4 h-4" /> : <Icons.Clock className="w-4 h-4" />}
                  {releaseStatus.admin_finalized
                    ? 'Finalized by Admin'
                    : `Awaiting Admin approval (${releaseStatus.pending_admin_approval} passed grade${releaseStatus.pending_admin_approval !== 1 ? 's' : ''} pending)`}
                </p>
                {releaseStatus.already_released && (
                  <p className="text-[13px] text-green-500 flex items-center gap-1.5">
                    <Icons.Check className="w-4 h-4" /> Already released to students
                  </p>
                )}
              </div>
              <button
                className="btn btn-gold"
                disabled={!releaseStatus.can_release || releasing}
                onClick={() => requestConfirm({
                  title: 'Release Grades to Students',
                  message: 'Release this class\'s grades to students now? They\'ll be notified and able to see their Midterm/Finals GWA immediately.',
                  confirmText: 'Release',
                  variant: 'green',
                  action: handleReleaseGrades,
                })}
              >
                <Icons.Send className="w-4 h-4" /> {releasing ? 'Releasing...' : 'Release to Students'}
              </button>
            </div>
          </div>
        )}
        </>
      )}

      {/* ====== CLASS RECORD TAB ====== */}
      {activeTab === 'components' && hasComponents && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-navy">Class Record</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {classData?.class_record_locked
                  ? 'Scores are locked — click "Edit Scores" to make changes.'
                  : "Enter each student's raw score per item (test, quiz, lab, etc.) — Rate, component Average, and the period GWA update live as you type, matching the official SSU Class Record."}
              </p>
            </div>
            {classData?.class_record_locked ? (
              <button
                className="btn btn-outline text-sm"
                onClick={() => requestConfirm({
                  title: 'Edit Scores',
                  message: 'Unlock this Class Record\'s score grid to make changes? It locks again the next time you click "Save All Scores".',
                  confirmText: 'Unlock',
                  variant: 'gold',
                  action: unlockScores,
                })}
                disabled={savingScores}
              >
                <Icons.Edit className="w-4 h-4" /> {savingScores ? 'Unlocking...' : 'Edit Scores'}
              </button>
            ) : (
              <button
                className="btn btn-gold text-sm"
                onClick={() => requestConfirm({
                  title: 'Save All Scores',
                  message: 'Save every entered score for this Class Record? Midterm and Finals GWA will be recomputed for all students immediately, and the score grid locks until you click "Edit Scores".',
                  confirmText: 'Save',
                  variant: 'green',
                  action: saveAllScores,
                })}
                disabled={savingScores}
              >
                {savingScores ? 'Saving...' : 'Save All Scores'}
              </button>
            )}
          </div>

          {midtermComps.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => togglePeriod('Midterm')}
                className="w-full flex items-center justify-between px-6 py-3 border-b border-transparent border-none cursor-pointer font-sans"
                style={{ background: periodCascade }}
              >
                <h4 className={`text-sm font-semibold ${periodHeaderClass.text}`}>Midterm</h4>
                {periodOpen.Midterm ? <Icons.ChevronUp className={periodHeaderClass.text} /> : <Icons.ChevronDown className={periodHeaderClass.text} />}
              </button>
              {periodOpen.Midterm && (
                <PeriodTable comps={midtermComps} studentGrades={studentGrades} componentScores={componentScores} updateScore={updateScore} locked={classData?.class_record_locked} onViewStudent={setGradesTarget} onMarkINC={openMarkINC} onResolveINC={openResolveINC} onMarkDRP={handleMarkDRP} onUndoDRP={handleUndoDRP} formula={rateFormula} />
              )}
            </>
          )}

          {finalsComps.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => togglePeriod('Finals')}
                className="w-full flex items-center justify-between px-6 py-3 border-b border-t border-transparent border-none cursor-pointer font-sans"
                style={{ background: periodCascade }}
              >
                <h4 className={`text-sm font-semibold ${periodHeaderClass.text}`}>Finals</h4>
                {periodOpen.Finals ? <Icons.ChevronUp className={periodHeaderClass.text} /> : <Icons.ChevronDown className={periodHeaderClass.text} />}
              </button>
              {periodOpen.Finals && (
                <PeriodTable comps={finalsComps} otherComps={midtermComps} studentGrades={studentGrades} componentScores={componentScores} updateScore={updateScore} locked={classData?.class_record_locked} onViewStudent={setGradesTarget} onMarkINC={openMarkINC} onResolveINC={openResolveINC} onMarkDRP={handleMarkDRP} onUndoDRP={handleUndoDRP} formula={rateFormula} />
              )}
            </>
          )}
        </div>
      )}

      {/* ====== COMPONENT SETUP MODAL ====== */}
      {showComponentSetup && (
        <Modal
          title="Grade Component Setup"
          onClose={() => setShowComponentSetup(false)}
          size="max-w-2xl"
          // A stray click outside the modal (easy to do by accident on a form
          // this long) must never silently discard an in-progress edit here —
          // only the X button and an explicit Cancel/Save actually close it.
          closeOnBackdropClick={false}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setShowComponentSetup(false)}>Cancel</button>
              <button
                className="btn btn-gold"
                onClick={() => requestConfirm({
                  title: 'Save Components',
                  message: 'Save these grade components? This updates the rubric used to compute every student\'s Class Record — removed components/items and their entered scores will be lost.',
                  confirmText: 'Save',
                  variant: 'green',
                  action: saveComponentSetup,
                })}
                disabled={savingComponents}
              >
                {savingComponents ? 'Saving...' : 'Save Components'}
              </button>
            </>
          }
        >
          {/* Which score→Rate scale this class's Class Record uses — applies
              to every item, every component, every period. Doesn't take
              effect until Save Components below actually commits it, same
              as every other change in this modal. */}
          <div className="mb-5 p-3 bg-gray-50 border border-gray-200 rounded-xl">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide block mb-1.5">Rate Formula</label>
            <select
              className="form-select text-sm w-full"
              value={editRateFormula}
              onChange={(e) => setEditRateFormula(e.target.value)}
            >
              <option value="50_45">Rate = (score/max) × 45 + 50 — Rate range 50–95</option>
              <option value="60_35">Rate = (score/max) × 35 + 60 — Rate range 60–95</option>
            </select>
          </div>

          {/* Should be rare now — a new class picks this up automatically at
              creation, and a pre-existing class with zero components picks
              it up on load. This only shows if that somehow didn't happen. */}
          {editComponents.length === 0 && subjectGradingScheme?.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icons.Book className="w-5 h-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-green-900 mb-1">{classData?.subject?.code}'s Grading Scheme</h4>
                  <p className="text-xs text-green-700 leading-relaxed mb-3">
                    {subjectGradingScheme.map((c) => `${c.name} (${parseFloat(c.weight)}%)`).join(', ')} — applied to both Midterm and Finals.
                  </p>
                  <button
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg border-none cursor-pointer font-sans hover:bg-green-700 transition-colors"
                    onClick={loadFromSubjectScheme}
                  >
                    <Icons.Check className="w-4 h-4" /> Use {classData?.subject?.code}'s Grading Scheme
                  </button>
                </div>
              </div>
            </div>
          )}

          {editComponents.length === 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icons.Award className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-blue-900 mb-1">
                    {subjectGradingScheme?.length > 0 ? 'Or use the generic SSU Class Record Standard' : 'SSU Class Record Standard'}
                  </h4>
                  <p className="text-xs text-blue-700 leading-relaxed mb-3">
                    Matches the official SSU Class Record: Summative Test (25%), Class Participation (5%),
                    Course Exercises/Laboratory (10%), Project/Term Requirement (20%), and Major Exam (40%)
                    for both Midterm and Finals — each with its own sub-items (tests, quizzes, labs, etc.).
                  </p>
                  <button
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg border-none cursor-pointer font-sans hover:bg-blue-700 transition-colors"
                    onClick={loadSSUTemplate}
                  >
                    <Icons.Check className="w-4 h-4" /> Use SSU Template
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* No manual "sync with the subject's scheme" action once
              components already exist — every class's components are
              expected to already match its own subject's grading scheme
              (auto-filled at creation and whenever a class first loads with
              zero components, see the effects above), not something Faculty
              re-syncs by hand after the fact. */}
          {editComponents.length > 0 && (
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <p className="text-[13px] text-gray-500">
                Weights per period must total <strong>100%</strong>. Final Grade = average of Midterm + Finals.
              </p>
            </div>
          )}

          {/* Midterm Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-navy flex items-center gap-2">
                <ProgramDot program={user?.program} /> Midterm Components
              </h4>
              <div className="flex items-center gap-3">
                {/* One switch for the whole modal, not per-component —
                    session-only, never saved server-side. When on, editing
                    any Midterm component below (name, weight, Show Ave, its
                    items) also applies that same change to the Finals
                    component sharing its name; only meaningful once such a
                    Finals counterpart actually exists. */}
                <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap" title="When on, editing a Midterm component also applies the same edit to its same-named Finals component.">
                  <input type="checkbox" checked={mirrorToFinals} onChange={(e) => setMirrorToFinals(e.target.checked)} />
                  Mirror to Finals
                </label>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Math.abs(getTotalWeight('Midterm') - 100) < 0.01 ? 'bg-green-100 text-green-700' : getTotalWeight('Midterm') > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                  {getTotalWeight('Midterm')}% / 100%
                </span>
                <button className="text-xs text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addComponent('Midterm')}>
                  + Add Component
                </button>
              </div>
            </div>
            {editComponents.filter(c => c.period === 'Midterm').length === 0 && (
              <p className="text-xs text-gray-400 italic py-3 text-center">No midterm components yet.</p>
            )}
            {editComponents.map((comp, idx) => comp.period === 'Midterm' && (
              <div key={idx} className="mb-3 bg-gray-50 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <input className="form-input text-sm flex-1 bg-white" placeholder="Component name" value={comp.name} onChange={(e) => updateComponent(idx, 'name', e.target.value)} />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input className="form-input text-sm w-20 text-center bg-white font-semibold" type="number" min="0" max="100" value={comp.weight || ''} onChange={(e) => updateComponent(idx, 'weight', e.target.value)} onWheel={(e) => e.target.blur()} />
                    <span className="text-xs text-gray-500 font-semibold">%</span>
                  </div>
                  <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0" onClick={() => removeComponent(idx)}><Icons.X /></button>
                </div>
                <div className="pl-3 border-l-2 border-gray-200 space-y-1.5">
                  {(comp.items || []).map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center gap-2">
                      <input className="form-input text-xs flex-1 bg-white py-1.5" placeholder="Item name (e.g. Test 1)" value={item.name} onChange={(e) => updateItem(idx, itemIdx, 'name', e.target.value)} />
                      {/* Skips the raw-score-to-Rate transmutation entirely for
                          this one item — for a Faculty member who already has
                          a final Rate for a student on it (no raw score to
                          compute one from), typed in directly instead. Max
                          is meaningless for an item like this, so it's swapped
                          out for a plain "Rate 50-95" label. */}
                      <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap" title="Type the final Rate (50-95) directly for this item instead of a raw score">
                        <input type="checkbox" checked={!!item.is_rate_direct} onChange={(e) => updateItem(idx, itemIdx, 'is_rate_direct', e.target.checked)} />
                        Rate only
                      </label>
                      {/* Meaningless for a Rate-only item (it already has no
                          Max at all) — only shown for a normal item. The
                          actual SCORE a student earned always shows in the
                          Chairperson/Admin Class Record, Grade Approval, and
                          Excel export regardless — this only controls
                          whether the item's Max is shown there too. */}
                      {!item.is_rate_direct && (
                        <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap" title="Uncheck to hide this item's Max from the Chairperson/Admin Class Record view and Excel export — the student's actual Score and the Rate are always shown either way.">
                          <input type="checkbox" checked={item.show_score !== false} onChange={(e) => updateItem(idx, itemIdx, 'show_score', e.target.checked)} />
                          Show Max
                        </label>
                      )}
                      {/* Unlike Show Max, this one also applies to a
                          Rate-only item — its Rate is its ONLY column, so
                          unchecking this leaves nothing displayed for it at
                          all (still folded into the component's Ave/
                          Weighted regardless). */}
                      <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap" title="Uncheck to hide this item's Rate column from the Chairperson/Admin Class Record view and Excel export. Faculty still sees and enters this item here either way.">
                        <input type="checkbox" checked={item.show_rate !== false} onChange={(e) => updateItem(idx, itemIdx, 'show_rate', e.target.checked)} />
                        Show Rate
                      </label>
                      {item.is_rate_direct ? (
                        <span className="text-[10px] text-purple-600 font-semibold uppercase flex-shrink-0 px-2 py-1.5 bg-purple-50 rounded whitespace-nowrap">Rate 50-95</span>
                      ) : (
                        // Still fully editable when Show Max is off — Max
                        // is needed either way to compute Rate from the raw
                        // score internally — just greyed out to signal it
                        // isn't shown to viewers right now.
                        <div className={`flex items-center gap-1 flex-shrink-0 ${item.show_score === false ? 'opacity-40' : ''}`}>
                          <span className="text-[10px] text-gray-400 uppercase">Max</span>
                          <input className="form-input text-xs w-16 text-center bg-white py-1.5" type="number" min="0" value={item.max_score || ''} onChange={(e) => updateItem(idx, itemIdx, 'max_score', e.target.value)} onWheel={(e) => e.target.blur()} />
                        </div>
                      )}
                      <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0 !w-7 !h-7" onClick={() => removeItem(idx, itemIdx)}><Icons.X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <button className="text-[11px] text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addItem(idx)}>
                      + Add Item
                    </button>
                    {/* Weighted is always shown regardless — this only
                        controls the component's own Ave column, in the
                        Chairperson/Admin Class Record view and Excel export
                        (never the Faculty's own editable grid). Freely
                        selectable regardless of item count — no automatic
                        override. */}
                    <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap ml-auto" title="Uncheck to hide this component's Ave column from the Chairperson/Admin Class Record view and Excel export — Weighted is always shown. Faculty still sees Ave here either way.">
                      <input type="checkbox" checked={comp.show_ave !== false} onChange={(e) => updateComponent(idx, 'show_ave', e.target.checked)} />
                      Show Ave
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-gray-200 my-4" />

          {/* Finals Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-navy flex items-center gap-2">
                <ProgramDot program={user?.program} /> Finals Components
              </h4>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Math.abs(getTotalWeight('Finals') - 100) < 0.01 ? 'bg-green-100 text-green-700' : getTotalWeight('Finals') > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                  {getTotalWeight('Finals')}% / 100%
                </span>
                <button className="text-xs text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addComponent('Finals')}>
                  + Add Component
                </button>
              </div>
            </div>
            {editComponents.filter(c => c.period === 'Finals').length === 0 && (
              <p className="text-xs text-gray-400 italic py-3 text-center">No finals components yet.</p>
            )}
            {editComponents.map((comp, idx) => comp.period === 'Finals' && (
              <div key={idx} className="mb-3 bg-gray-50 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <input className="form-input text-sm flex-1 bg-white" placeholder="Component name" value={comp.name} onChange={(e) => updateComponent(idx, 'name', e.target.value)} />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input className="form-input text-sm w-20 text-center bg-white font-semibold" type="number" min="0" max="100" value={comp.weight || ''} onChange={(e) => updateComponent(idx, 'weight', e.target.value)} onWheel={(e) => e.target.blur()} />
                    <span className="text-xs text-gray-500 font-semibold">%</span>
                  </div>
                  <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0" onClick={() => removeComponent(idx)}><Icons.X /></button>
                </div>
                <div className="pl-3 border-l-2 border-gray-200 space-y-1.5">
                  {(comp.items || []).map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center gap-2">
                      <input className="form-input text-xs flex-1 bg-white py-1.5" placeholder="Item name (e.g. Test 1)" value={item.name} onChange={(e) => updateItem(idx, itemIdx, 'name', e.target.value)} />
                      {/* Skips the raw-score-to-Rate transmutation entirely for
                          this one item — for a Faculty member who already has
                          a final Rate for a student on it (no raw score to
                          compute one from), typed in directly instead. Max
                          is meaningless for an item like this, so it's swapped
                          out for a plain "Rate 50-95" label. */}
                      <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap" title="Type the final Rate (50-95) directly for this item instead of a raw score">
                        <input type="checkbox" checked={!!item.is_rate_direct} onChange={(e) => updateItem(idx, itemIdx, 'is_rate_direct', e.target.checked)} />
                        Rate only
                      </label>
                      {/* Meaningless for a Rate-only item (it already has no
                          Max at all) — only shown for a normal item. The
                          actual SCORE a student earned always shows in the
                          Chairperson/Admin Class Record, Grade Approval, and
                          Excel export regardless — this only controls
                          whether the item's Max is shown there too. */}
                      {!item.is_rate_direct && (
                        <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap" title="Uncheck to hide this item's Max from the Chairperson/Admin Class Record view and Excel export — the student's actual Score and the Rate are always shown either way.">
                          <input type="checkbox" checked={item.show_score !== false} onChange={(e) => updateItem(idx, itemIdx, 'show_score', e.target.checked)} />
                          Show Max
                        </label>
                      )}
                      {/* Unlike Show Max, this one also applies to a
                          Rate-only item — its Rate is its ONLY column, so
                          unchecking this leaves nothing displayed for it at
                          all (still folded into the component's Ave/
                          Weighted regardless). */}
                      <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap" title="Uncheck to hide this item's Rate column from the Chairperson/Admin Class Record view and Excel export. Faculty still sees and enters this item here either way.">
                        <input type="checkbox" checked={item.show_rate !== false} onChange={(e) => updateItem(idx, itemIdx, 'show_rate', e.target.checked)} />
                        Show Rate
                      </label>
                      {item.is_rate_direct ? (
                        <span className="text-[10px] text-purple-600 font-semibold uppercase flex-shrink-0 px-2 py-1.5 bg-purple-50 rounded whitespace-nowrap">Rate 50-95</span>
                      ) : (
                        // Still fully editable when Show Max is off — Max
                        // is needed either way to compute Rate from the raw
                        // score internally — just greyed out to signal it
                        // isn't shown to viewers right now.
                        <div className={`flex items-center gap-1 flex-shrink-0 ${item.show_score === false ? 'opacity-40' : ''}`}>
                          <span className="text-[10px] text-gray-400 uppercase">Max</span>
                          <input className="form-input text-xs w-16 text-center bg-white py-1.5" type="number" min="0" value={item.max_score || ''} onChange={(e) => updateItem(idx, itemIdx, 'max_score', e.target.value)} onWheel={(e) => e.target.blur()} />
                        </div>
                      )}
                      <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0 !w-7 !h-7" onClick={() => removeItem(idx, itemIdx)}><Icons.X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2">
                    <button className="text-[11px] text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addItem(idx)}>
                      + Add Item
                    </button>
                    {/* Weighted is always shown regardless — this only
                        controls the component's own Ave column, in the
                        Chairperson/Admin Class Record view and Excel export
                        (never the Faculty's own editable grid). Freely
                        selectable regardless of item count — no automatic
                        override. */}
                    <label className="flex items-center gap-1 flex-shrink-0 text-[10px] text-gray-500 cursor-pointer whitespace-nowrap ml-auto" title="Uncheck to hide this component's Ave column from the Chairperson/Admin Class Record view and Excel export — Weighted is always shown. Faculty still sees Ave here either way.">
                      <input type="checkbox" checked={comp.show_ave !== false} onChange={(e) => updateComponent(idx, 'show_ave', e.target.checked)} />
                      Show Ave
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <strong>How it works:</strong> Enter raw scores per item in the Component Scores tab.
              Each item score is transmuted to a rate, averaged per component, then weighted and
              summed into the period's GWA (1.0–5.0). Final Grade = average of Midterm Grade + Finals Grade.
            </p>
          </div>
        </Modal>
      )}

      {/* ====== MARK INC MODAL ====== — the only way OUT of INC now is
          onResolveINC below, which unlocks the row for normal per-item
          encoding on the Class Record grid (no more typing a final
          Midterm/Finals GWA by hand), so this modal only ever handles
          marking a student INC in the first place. */}
      {showINCModal && incTarget && (
        <Modal
          title="Mark Student as INC"
          onClose={() => { setShowINCModal(false); setIncTarget(null); }}
          size="max-w-md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setShowINCModal(false); setIncTarget(null); }}>
                Cancel
              </button>
              <button
                className="btn btn-gold"
                onClick={() => {
                  if (!incRemarks.trim()) {
                    toast.error('State what the student is missing before marking them INC.');
                    return;
                  }
                  requestConfirm({
                    title: 'Mark as INC',
                    message: `Mark ${incTarget.student.name} as INC (Incomplete)? Their grade encoding will be paused until this is resolved.`,
                    confirmText: 'Mark as INC',
                    variant: 'red',
                    action: handleSaveINC,
                  });
                }}
                disabled={savingINC || !incRemarks.trim()}
              >
                {savingINC ? 'Saving...' : 'Confirm INC'}
              </button>
            </>
          }
        >
          <div className="flex items-center gap-3 mb-5 p-3 bg-amber-50 rounded-xl border border-amber-200">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-700 font-bold text-sm">!</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-900">{incTarget.student.name}</p>
              <p className="text-xs text-amber-600">{incTarget.student.student_no}</p>
            </div>
          </div>

          <p className="text-[13px] text-gray-500 mb-4">
            Marking this student as <strong>INC</strong> means they have not completed the
            requirements. They will appear as INC in grade sheets and will not affect GWA
            until resolved.
          </p>
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Reason / Remarks <span className="text-red-500">*</span>
            </label>
            <textarea
              className="form-input w-full text-sm resize-none"
              rows={3}
              placeholder="e.g. Failed to submit final project, missed the final exam, medical leave..."
              value={incRemarks}
              onChange={(e) => setIncRemarks(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Compliance Deadline <span className="text-gray-400">(optional)</span>
            </label>
            <input
              type="date"
              className="form-input w-full text-sm"
              value={incDeadline}
              onChange={(e) => setIncDeadline(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
        </Modal>
      )}

      {/* ====== RESOLVE INC POPUP ====== — opens the instant "Resolve INC" is
          clicked (see openResolveINC), scoped to whatever items are STILL
          missing a score for this student right now — auto-detected off
          componentScores, not anything picked ahead of time. Real per-item
          score inputs, same as the Class Record grid, just surfaced right
          here instead of making the instructor go find the row —
          everything else on the class stays untouched. */}
      {resolveIncTarget && (
        <Modal
          title={`Resolve INC — ${resolveIncTarget.student.name}`}
          onClose={() => setResolveIncTarget(null)}
          size="max-w-md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setResolveIncTarget(null)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleResolveINCSave} disabled={resolvingINC}>
                {resolvingINC ? 'Resolving...' : 'Resolve'}
              </button>
            </>
          }
        >
          <div className="flex items-center gap-3 mb-5 p-3 bg-amber-50 rounded-xl border border-amber-200">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-700 font-bold text-sm">!</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-900">{resolveIncTarget.student.name}</p>
              <p className="text-xs text-amber-600">{resolveIncTarget.student.student_no}</p>
            </div>
          </div>

          {resolveIncTarget.components.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              Nothing is actually missing a score for this student — resolving will just clear
              the INC status.
            </p>
          ) : (
            resolveIncTarget.components.map((c) => (
              <div key={c.id} className="mb-4">
                <p className="text-xs font-semibold text-gray-600 mb-1.5">
                  {c.name} <span className="text-gray-400 font-normal">({c.period})</span>
                </p>
                <div className="space-y-1.5">
                  {(c.items || []).map((item) => {
                    const score = componentScores[resolveIncTarget.student.id]?.[item.id];
                    return (
                      <div key={item.id} className="flex items-center gap-2.5">
                        <span className="text-[13px] text-gray-600 flex-1">{item.name}</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="form-input text-center text-sm py-1.5 w-20"
                          placeholder={item.is_rate_direct ? `${rateFormula.base}-${rateFormula.base + rateFormula.range}` : '0'}
                          value={score ?? ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (withinMax(v, item.is_rate_direct ? rateFormula.base + rateFormula.range : parseFloat(item.max_score))) updateScore(resolveIncTarget.student.id, item.id, v);
                          }}
                        />
                        <span className="text-[11px] text-gray-400 w-14 flex-shrink-0">{item.is_rate_direct ? 'Rate' : `/ ${parseFloat(item.max_score)}`}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </Modal>
      )}

      {gradesTarget && (
        <StudentGradeRecordModal studentId={gradesTarget.id} onClose={() => setGradesTarget(null)} />
      )}

      {preview && (
        <Modal
          title={preview === 'sheet' ? 'Grading Sheet Preview' : 'Class Record Preview'}
          onClose={() => setPreview(null)}
          size="max-w-5xl"
        >
          <iframe
            key={preview}
            src={`${preview === 'sheet' ? '/grading-sheet' : '/class-record'}/${classId}?preview=1`}
            title="Document preview"
            style={{ width: '100%', height: '65vh', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
          />
        </Modal>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmText={confirmAction.confirmText}
          variant={confirmAction.variant}
          onConfirm={runConfirmedAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}
