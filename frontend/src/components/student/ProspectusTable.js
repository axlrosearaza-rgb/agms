import { useState } from 'react';
import { Icons } from '../common';

// Exported so StudentGrades.js's Word export builds from the exact same
// labels/grouping/derivations shown on screen — one source of truth, no risk
// of the download ever disagreeing with what the student sees in the app.
export const YEAR_LABEL = { 1: 'FIRST YEAR', 2: 'SECOND YEAR', 3: 'THIRD YEAR', 4: 'FOURTH YEAR' };
export const SEM_LABEL = { '1st Semester': 'FIRST SEMESTER', '2nd Semester': 'SECOND SEMESTER', 'Summer': 'SUMMER' };
export const SEMESTER_ORDER = { '1st Semester': 0, '2nd Semester': 1, 'Summer': 2 };

// Same abbreviations used to resolve "INC"/"DRP" — blank is deliberate for
// Not Taken/In Progress, matching how the paper form just leaves the Grade
// column's underline empty until a subject is actually finished.
export const gradeCellText = (r) => {
  if (r.status === 'INC') return 'INC';
  if (r.status === 'DRP') return 'DROP';
  // One decimal place — matching the Grade Sheet and Class Record exactly
  // (both use .toFixed(1), per the Registrar's own 1-decimal GWA convention)
  // so the same underlying value never displays as two different-looking
  // numbers across documents.
  if (r.grade?.average) return parseFloat(r.grade.average).toFixed(1);
  return '';
};

// Same status this cell's own text already encodes (Passed/Failed/INC/DRP) —
// just also carried as color, so a Failed grade reads red and a Passed one
// green at a glance instead of requiring the number to be read first.
export const gradeCellColor = (r) => {
  if (r.status === 'Passed') return '#15803d';
  if (r.status === 'Failed') return '#dc2626';
  return undefined;
};

export const hrsOrDash = (v) => (v === null || v === undefined ? '—' : v);

export const requisiteText = (subject, kind) => {
  const rel = kind === 'pre' ? subject.prerequisites : subject.co_requisites;
  const codes = (rel || []).map((s) => s.code);
  const parts = [...codes];
  if (kind === 'pre' && subject.prerequisite_note) parts.push(subject.prerequisite_note);
  return parts.join(', ');
};

// Same per-semester Totals-row math the on-screen table computes — exported
// so the Word export sums identically instead of re-deriving it separately.
export const semesterSums = (rows) => rows.reduce((acc, r) => {
  const s = r.subject;
  acc.lecHrs += s.lecture_hours || 0;
  acc.lecUnits += s.lecture_units || 0;
  acc.labHrs += s.lab_hours || 0;
  acc.labUnits += s.lab_units || 0;
  acc.totalHrs += (s.total_hours ?? ((s.lecture_hours || 0) + (s.lab_hours || 0))) || 0;
  acc.totalUnits += s.units || 0;
  return acc;
}, { lecHrs: 0, lecUnits: 0, labHrs: 0, labUnits: 0, totalHrs: 0, totalUnits: 0 });

// A semester's own GWA — same eligibility rule getStudentProspectus applies
// server-side for the overall figure (a final grade exists, status isn't
// INC/DRP), just scoped to one semester's rows instead of the whole
// curriculum, so it can sit right under that semester's own grades.
export const semesterGWA = (rows) => {
  const eligible = rows.filter((r) => r.grade?.average != null && r.status !== 'INC' && r.status !== 'DRP');
  if (eligible.length === 0) return null;
  return (eligible.reduce((sum, r) => sum + parseFloat(r.grade.average), 0) / eligible.length).toFixed(1);
};

// Shared curriculum-checklist ("prospectus") view — every subject in the
// student's program, Year 1 through 4, with their actual outcome overlaid —
// laid out the same way as the University Registrar's own "Evaluation of
// Grades" paper form (Grade / Code / Description / Lecture / Laboratory /
// Total Hrs-Units / Pre-Requisite / Co-Requisite, with a Totals row per
// semester), not just an app-style summary list. Used both on the Student
// Dashboard (compact, collapsible) and the full My Grades page (always
// expanded, with search). Students only ever see the Final Grade here — no
// item-level Class Record breakdown (that stays Faculty/Chairperson/Admin-only).
export default function ProspectusTable({ years, search = '', collapsible = false, defaultExpandedYear = null }) {
  const [expandedYears, setExpandedYears] = useState(() =>
    defaultExpandedYear ? { [defaultExpandedYear]: true } : {}
  );

  const toggleYear = (yr) => setExpandedYears((prev) => ({ ...prev, [yr]: !prev[yr] }));

  const yearNums = Object.keys(years || {}).map(Number).sort((a, b) => a - b);
  const q = search.trim().toLowerCase();

  if (yearNums.length === 0) {
    return (
      <div className="card p-10 text-center text-gray-400">
        <Icons.FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
        <p className="text-sm">No curriculum found for your program yet. Ask your Chairperson to check the Subjects list.</p>
      </div>
    );
  }

  return (
    <>
      {yearNums.map((yr) => {
        const semesters = Object.keys(years[yr]).sort((a, b) => (SEMESTER_ORDER[a] ?? 9) - (SEMESTER_ORDER[b] ?? 9));
        // With an active search, force this year open so matches are actually visible.
        const isOpen = !collapsible || !!q || !!expandedYears[yr];
        const yearRows = semesters.flatMap((sem) => years[yr][sem]);
        const yearMatchCount = q
          ? yearRows.filter((r) => r.subject.code?.toLowerCase().includes(q) || r.subject.name?.toLowerCase().includes(q)).length
          : yearRows.length;
        if (q && yearMatchCount === 0) return null;

        return (
          <div key={yr} className="card overflow-hidden mb-4">
            <button
              onClick={() => collapsible && toggleYear(yr)}
              className={`w-full px-5 py-3 bg-navy text-white flex items-center justify-between border-none font-sans ${collapsible ? 'cursor-pointer' : ''}`}
            >
              <h3 className="text-sm font-bold tracking-wide">{YEAR_LABEL[yr] || `YEAR ${yr}`}</h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] opacity-70">{yearMatchCount} subject{yearMatchCount !== 1 ? 's' : ''}</span>
                {collapsible && (isOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />)}
              </div>
            </button>
            {isOpen && (
              <div className="card-body">
                {semesters.map((sem) => {
                  const rows = years[yr][sem].filter((r) =>
                    !q || r.subject.code?.toLowerCase().includes(q) || r.subject.name?.toLowerCase().includes(q)
                  );
                  if (rows.length === 0) return null;

                  const sums = semesterSums(rows);
                  const gwa = semesterGWA(rows);

                  return (
                    <div key={sem} className="mb-5 last:mb-0">
                      {/* Full-width ruled bar, not just an underlined word — matches
                          the section-header style of the Registrar's own form
                          (and the Word export's identical border). */}
                      <h4 className="text-[13px] font-bold text-gray-700 px-1 mb-2 pb-1" style={{ borderBottom: '2px solid #000' }}>{SEM_LABEL[sem] || sem.toUpperCase()}</h4>
                      <div className="overflow-x-auto">
                        <table className="eval-table" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#F3F4F6' }}>
                              <Th rowSpan={2}>Grade</Th>
                              <Th rowSpan={2} align="left">Subject Code</Th>
                              <Th rowSpan={2} align="left">Subject Description</Th>
                              <Th colSpan={2}>Lecture</Th>
                              <Th colSpan={2}>Laboratory</Th>
                              <Th colSpan={2}>Total</Th>
                              <Th rowSpan={2}>Pre-Requisite</Th>
                              <Th rowSpan={2}>Co-Requisite</Th>
                            </tr>
                            <tr style={{ background: '#F3F4F6' }}>
                              <Th>Hrs.</Th><Th>Units</Th>
                              <Th>Hrs.</Th><Th>Units</Th>
                              <Th>Hrs.</Th><Th>Units</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const s = r.subject;
                              return (
                                <tr key={s.id}>
                                  <Td align="center" bold color={gradeCellColor(r)}>{gradeCellText(r)}</Td>
                                  <Td bold color="#1a3a5c">{s.code}</Td>
                                  <Td>{s.name}</Td>
                                  <Td align="center">{hrsOrDash(s.lecture_hours)}</Td>
                                  <Td align="center">{hrsOrDash(s.lecture_units)}</Td>
                                  <Td align="center">{hrsOrDash(s.lab_hours)}</Td>
                                  <Td align="center">{hrsOrDash(s.lab_units)}</Td>
                                  <Td align="center">{hrsOrDash((s.total_hours ?? ((s.lecture_hours || 0) + (s.lab_hours || 0))) || null)}</Td>
                                  <Td align="center">{s.units}</Td>
                                  <Td align="center" small>{requisiteText(s, 'pre') || '—'}</Td>
                                  <Td align="center" small>{requisiteText(s, 'co') || '—'}</Td>
                                </tr>
                              );
                            })}
                            <tr style={{ borderTop: '2px solid #333' }}>
                              {/* The semester's own GWA sits right in the Grade
                                  column's Total-row cell — same column every
                                  individual subject's grade already lives in,
                                  instead of a separate line floating below
                                  the table. */}
                              <Td align="center" bold color="#c9a84c">{gwa || ''}</Td>
                              <Td colSpan={2} bold>Total:</Td>
                              <Td align="center" bold>{sums.lecHrs || ''}</Td>
                              <Td align="center" bold>{sums.lecUnits || ''}</Td>
                              <Td align="center" bold>{sums.labHrs || ''}</Td>
                              <Td align="center" bold>{sums.labUnits || ''}</Td>
                              <Td align="center" bold>{sums.totalHrs || ''}</Td>
                              <Td align="center" bold>{sums.totalUnits || ''}</Td>
                              <Td /><Td />
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// Small table-cell helpers — plain inline-styled, matching how the app's
// other official-document reproductions (GradingSheet.js, ClassRecordView.js)
// are built, since Tailwind utility classes fight the exact border/merge
// control a registrar-form table needs.
function Th({ children, rowSpan, colSpan, align = 'center' }) {
  return (
    <th
      rowSpan={rowSpan}
      colSpan={colSpan}
      style={{
        border: '1px solid #9CA3AF',
        padding: '5px 6px',
        fontSize: 11,
        fontWeight: 700,
        textTransform: 'uppercase',
        color: '#374151',
        textAlign: align,
        verticalAlign: 'middle',
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left', bold = false, small = false, color, colSpan }) {
  return (
    <td
      colSpan={colSpan}
      style={{
        border: '1px solid #E5E7EB',
        padding: '5px 6px',
        textAlign: align,
        fontWeight: bold ? 700 : 400,
        fontSize: small ? 11 : 12,
        color: color || '#111827',
        whiteSpace: small ? 'normal' : 'nowrap',
      }}
    >
      {children}
    </td>
  );
}
