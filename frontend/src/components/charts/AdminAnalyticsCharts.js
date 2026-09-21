import { useState } from 'react';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Filler,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { EmptyState, Icons, programColorVariant, programShortLabel, programCascadeGradient, ProgramDot } from '../common';
import { snapTicksToValues } from './chartPlugins';

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement,
  Filler, Title, Tooltip, Legend
);

// Same hue each entity carries everywhere else in the app (role badges, program
// chips) — charts reuse it rather than inventing a second palette, so "Faculty"
// means the same color on this page as it does on every table/badge already.
const ROLE_COLOR = { Student: '#3b82f6', Faculty: '#a855f7', Chairperson: '#f97316', Admin: '#22c55e' };
const STATUS_COLOR = { Passed: '#22c55e', Failed: '#ef4444', INC: '#f59e0b', DRP: '#6b7280', Pending: '#94a3b8' };
const CLASS_STATUS_COLOR = { Active: '#22c55e', Completed: '#3b82f6', Cancelled: '#ef4444' };
// Same palette as the Chairperson's own "BS X" identity label (AppLayout.js's
// PROGRAM_TEXT_COLOR) — Blue / Violet / Dark Yellow / Red — rather than the
// paler badge-pill colors used for section chips elsewhere.
const PROGRAM_HEX = { it: '#2563EB', lavender: '#7C3AED', 'is-red': '#DC2626', 'golden-yellow': '#B45309', gray: '#9ca3af' };

const FONT = { family: "'Inter', system-ui, sans-serif" };

// Chart.js draws to <canvas>, so it needs its own explicit colors rather than
// relying on CSS — every chart below pulls its tick/grid/legend/border colors
// from here.
function useChartColors() {
  return {
    text: '#6b7280',
    grid: '#f1f5f9',
    // Segment/point borders are drawn to visually separate against the white
    // card behind them.
    border: '#ffffff',
    // Stronger than `text` on purpose — value labels printed on/above bars
    // need to read clearly, not blend in the way a muted axis tick can.
    label: '#1f2937',
  };
}

function EmptyChart({ label }) {
  return (
    <div className="flex items-center justify-center h-full">
      <EmptyState icon={<Icons.BarChart className="w-8 h-8" />} title={`No ${label} data yet`} />
    </div>
  );
}

// ============ DOUGHNUT: role / status / class-status breakdowns ============
function BreakdownDoughnut({ rows, keyField, colorMap, emptyLabel, height = 260 }) {
  const c = useChartColors();
  const filtered = (rows || []).filter((r) => Number(r.count) > 0);
  if (filtered.length === 0) return <EmptyChart label={emptyLabel} />;

  const labels = filtered.map((r) => r[keyField]);
  const values = filtered.map((r) => Number(r.count));
  const colors = labels.map((l) => colorMap[l] || '#9ca3af');
  const total = values.reduce((a, b) => a + b, 0);

  const data = {
    labels,
    datasets: [{ data: values, backgroundColor: colors, borderColor: c.border, borderWidth: 2, hoverOffset: 4 }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: {
      legend: { position: 'bottom', labels: { color: c.text, font: { ...FONT, size: 12 }, boxWidth: 10, padding: 14 } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const pct = total > 0 ? Math.round((ctx.raw / total) * 100) : 0;
            return `${ctx.label}: ${ctx.raw} (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div style={{ height: `${height}px` }}>
      <Doughnut data={data} options={options} />
    </div>
  );
}

export function RoleDistributionChart({ rows }) {
  return <BreakdownDoughnut rows={rows} keyField="role" colorMap={ROLE_COLOR} emptyLabel="user" />;
}

export function GradeStatusChart({ rows, height }) {
  return <BreakdownDoughnut rows={rows} keyField="status" colorMap={STATUS_COLOR} emptyLabel="grade" height={height} />;
}

export function ClassStatusChart({ rows }) {
  return <BreakdownDoughnut rows={rows} keyField="status" colorMap={CLASS_STATUS_COLOR} emptyLabel="class" />;
}

// ============ BAR: active students per program ============
export function ProgramEnrollmentChart({ rows }) {
  const c = useChartColors();
  const filtered = (rows || []).filter((r) => Number(r.count) > 0);
  if (filtered.length === 0) return <EmptyChart label="program" />;

  const labels = filtered.map((r) => programShortLabel(r.program) || r.program);
  const values = filtered.map((r) => Number(r.count));
  const colors = filtered.map((r) => PROGRAM_HEX[programColorVariant(r.program)]);

  const data = {
    labels,
    datasets: [{ label: 'Active Students', data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 56 }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw} student${ctx.raw !== 1 ? 's' : ''}` } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 12 } } },
      y: { beginAtZero: true, ticks: { color: c.text, font: FONT }, grid: { color: c.grid }, ...snapTicksToValues(values) },
    },
  };

  return (
    <div style={{ height: '260px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

// ============ LINE: pass-rate trend across semesters ============
export function PassRateTrendChart({ trend }) {
  const c = useChartColors();
  if (!trend || trend.length === 0) return <EmptyChart label="pass-rate" />;

  const data = {
    labels: trend.map((t) => t.semester),
    datasets: [{
      label: 'Pass Rate',
      data: trend.map((t) => t.pass_rate),
      borderColor: '#16a34a',
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
      borderWidth: 2,
      pointRadius: 4,
      pointBackgroundColor: '#16a34a',
      pointBorderColor: c.border,
      pointBorderWidth: 1.5,
      tension: 0.3,
      fill: true,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.raw}% pass rate (${trend[ctx.dataIndex].total} grades)`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 11 } } },
      y: { min: 0, max: 100, ticks: { color: c.text, callback: (v) => `${v}%`, font: FONT }, grid: { color: c.grid } },
    },
  };

  return (
    <div style={{ height: '260px' }}>
      <Line data={data} options={options} />
    </div>
  );
}

// ============ LINE: new-registration trend, last 6 months ============
export function UserGrowthChart({ growth }) {
  const c = useChartColors();
  const months = growth?.months || [];
  const rows = growth?.data || [];
  const hasData = rows.some((r) => r.students + r.faculty + r.others > 0);
  if (!hasData) return <EmptyChart label="registration" />;

  const series = [
    { key: 'students', label: 'Students', color: ROLE_COLOR.Student },
    { key: 'faculty', label: 'Faculty', color: ROLE_COLOR.Faculty },
    { key: 'others', label: 'Chairperson/Admin', color: ROLE_COLOR.Chairperson },
  ];

  const data = {
    labels: months,
    datasets: series.map((s) => ({
      label: s.label,
      data: rows.map((r) => r[s.key]),
      borderColor: s.color,
      backgroundColor: s.color,
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.3,
    })),
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: c.text, font: { ...FONT, size: 12 }, boxWidth: 10, padding: 14 } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 11 } } },
      y: { beginAtZero: true, ticks: { color: c.text, stepSize: 1, font: FONT }, grid: { color: c.grid } },
    },
  };

  return (
    <div style={{ height: '260px' }}>
      <Line data={data} options={options} />
    </div>
  );
}

// ============ BAR: one metric (students / faculty / active classes) per
// program, each bar in that program's own color ============
// A grouped multi-metric version of this (3 series, each a fixed metric
// color) meant "color = metric", which only reads correctly once every
// metric actually has data — with just one populated (e.g. Faculty), every
// visible bar came out the same fixed color regardless of program. Splitting
// into one small chart per metric — colored by program, like ProgramPassRateChart
// and ProgramGWAChart below — keeps "color = program" consistent everywhere
// in this card.
function ProgramFieldChart({ rows, field, label, thickness = 48 }) {
  const c = useChartColors();
  const filtered = (rows || []).filter((r) => r[field] !== undefined && r[field] !== null);
  if (filtered.length === 0) return <EmptyChart label="program" />;

  const labels = filtered.map((r) => programShortLabel(r.program) || r.program);
  const values = filtered.map((r) => Number(r[field]) || 0);
  const colors = filtered.map((r) => PROGRAM_HEX[programColorVariant(r.program)]);

  const data = {
    labels,
    datasets: [{ label, data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: thickness }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw} ${label.toLowerCase()}` } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 12 } } },
      y: { beginAtZero: true, ticks: { color: c.text, font: FONT }, grid: { color: c.grid }, ...snapTicksToValues(values) },
    },
  };

  return (
    <div style={{ height: '220px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

export function ProgramStudentsChart({ rows }) {
  return <ProgramFieldChart rows={rows} field="students" label="Students" />;
}
// Part-Time faculty aren't tied to any one program (see User Management's
// dedicated "Part-Time Faculty" container) — folding their real count into
// every one of the four program bars, the way ProgramFieldChart's per-program
// `faculty` field already does for Full Time, would just re-inflate all four
// bars again. Their true total gets its own fifth bar instead, distinctly
// colored so it doesn't read as a fifth program.
const PART_TIME_COLOR = '#f59e0b';
export function ProgramFacultyChart({ rows, partTimeTotal = 0 }) {
  const c = useChartColors();
  const filtered = (rows || []).filter((r) => r.faculty !== undefined && r.faculty !== null);
  if (filtered.length === 0 && !partTimeTotal) return <EmptyChart label="program" />;

  const labels = filtered.map((r) => programShortLabel(r.program) || r.program);
  const values = filtered.map((r) => Number(r.faculty) || 0);
  const colors = filtered.map((r) => PROGRAM_HEX[programColorVariant(r.program)]);
  if (partTimeTotal > 0) {
    labels.push('Part-Time');
    values.push(partTimeTotal);
    colors.push(PART_TIME_COLOR);
  }

  const data = {
    labels,
    datasets: [{ label: 'Faculty', data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 48 }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ctx.label === 'Part-Time'
            ? `${ctx.raw} part-time faculty (shared across programs, not tied to one)`
            : `${ctx.raw} full-time faculty`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 12 } } },
      y: { beginAtZero: true, ticks: { color: c.text, font: FONT }, grid: { color: c.grid }, ...snapTicksToValues(values) },
    },
  };

  return (
    <div style={{ height: '220px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}
export function ProgramClassesChart({ rows }) {
  return <ProgramFieldChart rows={rows} field="active_classes" label="Active Classes" />;
}

// ============ BAR: pass rate per program ============
// Bars keep each program's own brand color (same hue "program" carries in
// ProgramEnrollmentChart, ProgramBadge, etc.) since this chart is still about
// the program entity, just a different metric.
export function ProgramPassRateChart({ rows }) {
  const c = useChartColors();
  if (!rows || rows.length === 0) return <EmptyChart label="program" />;

  const labels = rows.map((r) => programShortLabel(r.program) || r.program);
  const values = rows.map((r) => Number(r.pass_rate) || 0);
  const colors = rows.map((r) => PROGRAM_HEX[programColorVariant(r.program)]);

  const data = {
    labels,
    datasets: [{ label: 'Pass Rate', data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 48 }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw}% pass rate` } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 12 } } },
      y: { min: 0, max: 100, ticks: { color: c.text, callback: (v) => `${v}%`, font: FONT }, grid: { color: c.grid }, ...snapTicksToValues(values) },
    },
  };

  return (
    <div style={{ height: '220px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

// ============ BAR: average GWA per program ============
// Colored by the same GWA quality bands as GradeCharts.js's GWA Distribution
// chart (green = excellent → red = failing) rather than the program hue —
// here the "job" is magnitude/quality of a value, not identifying the program
// (the x-axis labels already do that).
export function ProgramGWAChart({ rows }) {
  const c = useChartColors();
  const filtered = (rows || []).filter((r) => r.avg_gwa !== null && r.avg_gwa !== undefined);
  if (filtered.length === 0) return <EmptyChart label="GWA" />;

  const labels = filtered.map((r) => programShortLabel(r.program) || r.program);
  const values = filtered.map((r) => Number(parseFloat(r.avg_gwa).toFixed(1)));
  const colors = values.map((v) => (v <= 1.75 ? '#22c55e' : v <= 2.5 ? '#eab308' : v <= 3.0 ? '#f97316' : '#ef4444'));

  const data = {
    labels,
    datasets: [{ label: 'Avg. GWA', data: values, backgroundColor: colors, borderRadius: 4, maxBarThickness: 48 }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw.toFixed(1)} avg. GWA` } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 12 } } },
      y: { min: 0, max: 5, ticks: { color: c.text, callback: (v) => Number(v).toFixed(1), font: FONT }, grid: { color: c.grid }, ...snapTicksToValues(values) },
    },
  };

  return (
    <div style={{ height: '220px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

// ============ GROUPED TABLE: passed grades per faculty, by Program → Year →
// Section ============
// A flat "one bar per instructor" chart collapsed every class a faculty
// member taught into a single number, hiding which program/year/section it
// actually came from — an instructor teaching both BSIT-2A and BSIS-3B had no
// way to tell those apart. This groups the same passed-grades pool the same
// way the rest of the app already organizes program-scoped data (Promotion,
// Grading Sheets): Program (color-coded header, same palette as ProgramBadge
// everywhere else — Blue/Violet/Dark Yellow/Red) → Year → Section → Faculty.
const PROGRAM_ORDER = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

export function FacultySubmissionBreakdown({ rows }) {
  const filtered = (rows || []).filter((r) => r.classes?.length > 0);
  // Collapsed by default — same reasoning as before: this can be a lot of
  // faculty once every program is staffed, so nothing opens until asked for.
  const [openPrograms, setOpenPrograms] = useState({});

  if (filtered.length === 0) return <EmptyChart label="grades-passed" />;

  const toggleProgram = (program) => setOpenPrograms((prev) => ({ ...prev, [program]: !prev[program] }));

  const byProgram = {};
  filtered.forEach((r) => {
    if (!byProgram[r.program]) byProgram[r.program] = [];
    byProgram[r.program].push(r);
  });

  const programs = Object.keys(byProgram).sort(
    (a, b) => PROGRAM_ORDER.indexOf(a) - PROGRAM_ORDER.indexOf(b)
  );

  return (
    <div className="space-y-3">
      {programs.map((program) => {
        const facultyRows = byProgram[program].slice().sort((a, b) => a.instructor_name.localeCompare(b.instructor_name));
        const fullySentCount = facultyRows.filter((f) => f.classes.every((c) => c.sent)).length;
        const programOpen = !!openPrograms[program];

        return (
          <div key={program} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={() => toggleProgram(program)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-white border-none cursor-pointer font-sans transition-opacity hover:opacity-95"
              style={{ background: programCascadeGradient(program) }}
            >
              <div className="flex items-center gap-2">
                <ProgramDot program={program} />
                <span className="text-sm font-bold">{programShortLabel(program)}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-xs opacity-80">{fullySentCount}/{facultyRows.length} faculty fully submitted</span>
                {programOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {programOpen && (
              <div className="divide-y divide-gray-50">
                {facultyRows.map((f) => {
                  const allSent = f.classes.every((c) => c.sent);
                  const sentCount = f.classes.filter((c) => c.sent).length;
                  return (
                    <div key={f.instructor_id} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className="text-[13px] font-medium text-gray-800">{f.instructor_name}</span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${allSent ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                          {allSent ? 'All Submitted' : `${sentCount}/${f.classes.length} Submitted`}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {f.classes.map((c) => (
                          <span
                            key={c.class_id}
                            title={c.sent ? 'Class Record & Grade Sheet submitted' : `${c.submitted_count}/${c.total_students} grades submitted`}
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${c.sent ? 'border-green-200 bg-green-50/60 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                          >
                            {c.subject_code}{c.section ? ` Sec ${c.section}` : ''} {c.sent ? '✓' : `${c.submitted_count}/${c.total_students}`}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Downstream of FacultySubmissionBreakdown above — that one tracks whether
// Faculty has SENT their documents; this tracks whether Admin has actually
// finished APPROVING them (Grade Approval), broken down per Faculty AND per
// Section rather than just per Faculty, so a Chairperson/Admin can see
// exactly which section is the bottleneck for a Faculty teaching several.
export function FacultyApprovalBySection({ rows }) {
  const filtered = (rows || []).filter((r) => r.classes?.length > 0);
  const [openPrograms, setOpenPrograms] = useState({});

  if (filtered.length === 0) return <EmptyChart label="grades-passed" />;

  const toggleProgram = (program) => setOpenPrograms((prev) => ({ ...prev, [program]: !prev[program] }));

  const byProgram = {};
  filtered.forEach((r) => {
    if (!byProgram[r.program]) byProgram[r.program] = [];
    byProgram[r.program].push(r);
  });

  const programs = Object.keys(byProgram).sort(
    (a, b) => PROGRAM_ORDER.indexOf(a) - PROGRAM_ORDER.indexOf(b)
  );

  return (
    <div className="space-y-3">
      {programs.map((program) => {
        const sectionRows = byProgram[program].slice().sort((a, b) =>
          a.instructor_name.localeCompare(b.instructor_name) ||
          (a.year_level || 0) - (b.year_level || 0) ||
          String(a.section || '').localeCompare(String(b.section || ''))
        );
        const fullyApprovedCount = sectionRows.filter((r) => r.approved_count === r.total_count).length;
        const programOpen = !!openPrograms[program];

        return (
          <div key={program} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <button
              onClick={() => toggleProgram(program)}
              className="w-full px-4 py-2.5 flex items-center justify-between text-white border-none cursor-pointer font-sans transition-opacity hover:opacity-95"
              style={{ background: programCascadeGradient(program) }}
            >
              <div className="flex items-center gap-2">
                <ProgramDot program={program} />
                <span className="text-sm font-bold">{programShortLabel(program)}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-xs opacity-80">{fullyApprovedCount}/{sectionRows.length} sections fully approved</span>
                {programOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
              </div>
            </button>

            {programOpen && (
              <div className="divide-y divide-gray-50">
                {sectionRows.map((r) => {
                  const allApproved = r.approved_count === r.total_count;
                  const pct = r.total_count > 0 ? Math.round((r.approved_count / r.total_count) * 100) : 0;
                  return (
                    <div key={`${r.instructor_id}|${r.year_level}|${r.section}`} className="px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <span className="text-[13px] font-medium text-gray-800">
                          {r.instructor_name}
                          <span className="text-gray-400 font-normal"> · Year {r.year_level ?? '—'}{r.section ? ` Sec ${r.section}` : ''}</span>
                        </span>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${allApproved ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                          {allApproved ? 'Fully Approved' : `${r.approved_count}/${r.total_count} Approved`}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                        <div className={`h-full ${allApproved ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {r.classes.map((c) => (
                          <span
                            key={c.class_id}
                            title={c.approved ? 'Class Record & Grade Sheet both Admin-approved' : 'Still pending Admin approval'}
                            className={`text-[11px] px-2 py-0.5 rounded-full border ${c.approved ? 'border-green-200 bg-green-50/60 text-green-700' : 'border-gray-200 bg-gray-50 text-gray-500'}`}
                          >
                            {c.subject_code} {c.approved ? '✓' : '·'}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============ BAR: subjects with the highest fail rate ============
export function TopFailingSubjectsChart({ subjects }) {
  const c = useChartColors();
  if (!subjects || subjects.length === 0) return <EmptyChart label="fail-rate" />;

  const values = subjects.map((s) => s.fail_rate);
  const data = {
    labels: subjects.map((s) => s.code),
    datasets: [{
      label: 'Fail Rate',
      data: values,
      backgroundColor: '#ef4444',
      borderRadius: 4,
      maxBarThickness: 32,
    }],
  };

  const options = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (ctx) => subjects[ctx[0].dataIndex].name,
          label: (ctx) => `${ctx.raw}% failed (${subjects[ctx.dataIndex].failed}/${subjects[ctx.dataIndex].total} grades)`,
        },
      },
    },
    scales: {
      x: { min: 0, max: 100, ticks: { color: c.text, callback: (v) => `${v}%`, font: FONT }, grid: { color: c.grid }, ...snapTicksToValues(values) },
      y: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 12 } } },
    },
  };

  return (
    <div style={{ height: '260px' }}>
      <Bar data={data} options={options} />
    </div>
  );
}

// ============ BAR: students by year level, within a single program ============
// A Chairperson-scoped chart (unlike the program-colored ones above) — there's
// only one program in view here, so bars are a single flat color rather than
// carrying program identity.
export function StudentsByYearChart({ students, height = 260 }) {
  const c = useChartColors();
  const counts = [1, 2, 3, 4].map((yr) => (students || []).filter((s) => s.year_level === yr).length);
  if (counts.every((n) => n === 0)) return <EmptyChart label="student" />;

  const data = {
    labels: ['Year 1', 'Year 2', 'Year 3', 'Year 4'],
    datasets: [{ label: 'Students', data: counts, backgroundColor: ROLE_COLOR.Student, borderRadius: 4, maxBarThickness: 56 }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.raw} student${ctx.raw !== 1 ? 's' : ''}` } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: c.text, font: { ...FONT, size: 12 } } },
      y: { beginAtZero: true, ticks: { color: c.text, font: FONT }, grid: { color: c.grid }, ...snapTicksToValues(counts) },
    },
  };

  return (
    <div style={{ height: `${height}px` }}>
      <Bar data={data} options={options} />
    </div>
  );
}
