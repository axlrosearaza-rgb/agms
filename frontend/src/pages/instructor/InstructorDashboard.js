import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Icons, Badge, StatCard, LoadingSpinner } from '../../components/common';
import { classService } from '../../services';

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun' };

const TIME_SLOTS = [];
for (let h = 7; h <= 21; h++) {
  TIME_SLOTS.push(`${h}:00`);
  TIME_SLOTS.push(`${h}:30`);
}

const SUBJECT_COLORS = [
  { bg: 'bg-blue-100',   border: 'border-blue-300',   text: 'text-blue-800',   dot: 'bg-blue-500'   },
  { bg: 'bg-green-100',  border: 'border-green-300',  text: 'text-green-800',  dot: 'bg-green-500'  },
  { bg: 'bg-purple-100', border: 'border-purple-300', text: 'text-purple-800', dot: 'bg-purple-500' },
  { bg: 'bg-amber-100',  border: 'border-amber-300',  text: 'text-amber-800',  dot: 'bg-amber-500'  },
  { bg: 'bg-pink-100',   border: 'border-pink-300',   text: 'text-pink-800',   dot: 'bg-pink-500'   },
  { bg: 'bg-teal-100',   border: 'border-teal-300',   text: 'text-teal-800',   dot: 'bg-teal-500'   },
  { bg: 'bg-orange-100', border: 'border-orange-300', text: 'text-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-800', dot: 'bg-indigo-500' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return 0;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3]?.toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function formatTimeDisplay(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

function parseDayCodes(code) {
  const upper = code.toUpperCase();
  const checks = [
    { key: 'SUN', day: 'Sunday' },
    { key: 'SAT', day: 'Saturday' },
    { key: 'TH',  day: 'Thursday' },
    { key: 'M',   day: 'Monday' },
    { key: 'T',   day: 'Tuesday' },
    { key: 'W',   day: 'Wednesday' },
    { key: 'F',   day: 'Friday' },
  ];
  const found = [];
  let remaining = upper;
  for (const { key, day } of checks) {
    if (remaining.includes(key)) {
      found.push(day);
      remaining = remaining.replace(key, '');
    }
  }
  return found;
}

function parseScheduleBlocks(scheduleStr) {
  if (!scheduleStr) return [];
  const blocks = [];
  for (const part of scheduleStr.split('/').map(s => s.trim())) {
    const match = part.match(/^([A-Za-z]+)\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)$/i);
    if (!match) continue;
    const startMins = timeToMinutes(match[2].trim());
    const endMins   = timeToMinutes(match[3].trim());
    for (const day of parseDayCodes(match[1])) {
      blocks.push({ day, startMins, endMins });
    }
  }
  return blocks;
}

// ─── Schedule Grid ─────────────────────────────────────────────────────────────
function ScheduleGrid({ classes, colorMap }) {
  const SLOT_HEIGHT = 28;
  const START_HOUR  = 7;

  const allBlocks = [];
  for (const cls of classes) {
    const code  = cls.subject?.code || `cls-${cls.id}`;
    const color = colorMap[code] || SUBJECT_COLORS[0];
    for (const block of parseScheduleBlocks(cls.schedule || '')) {
      allBlocks.push({ ...block, cls, color });
    }
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: 860 }}>
        {/* Day headers */}
        <div className="flex border-b border-gray-200 bg-gray-50">
          <div className="w-14 flex-shrink-0 border-r border-gray-200 py-2 text-[10px] text-gray-400 text-center">Time</div>
          {DAYS.map(day => (
            <div key={day} className="flex-1 text-center py-2 text-[11px] font-semibold text-navy border-r border-gray-100 last:border-r-0">
              {DAY_SHORT[day]}
            </div>
          ))}
        </div>

        {/* Grid body */}
        <div className="flex" style={{ height: TIME_SLOTS.length * SLOT_HEIGHT }}>
          {/* Time labels */}
          <div className="w-14 flex-shrink-0 border-r border-gray-200 relative bg-gray-50/50">
            {TIME_SLOTS.map((slot, i) => {
              const [h, m] = slot.split(':').map(Number);
              return (
                <div key={slot} style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                  className="absolute left-0 right-0 flex items-start justify-end pr-1.5">
                  {m === 0 && (
                    <span className="text-[9px] text-gray-400 mt-0.5">
                      {h <= 12 ? h : h - 12}{h < 12 ? 'am' : 'pm'}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Day columns */}
          {DAYS.map(day => {
            const dayBlocks = allBlocks.filter(b => b.day === day);
            return (
              <div key={day} className="flex-1 border-r border-gray-100 last:border-r-0 relative">
                {TIME_SLOTS.map((slot, i) => {
                  const [, m] = slot.split(':').map(Number);
                  return (
                    <div key={slot} style={{ top: i * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                      className={`absolute left-0 right-0 border-b ${m === 0 ? 'border-gray-200' : 'border-gray-100/50'}`}
                    />
                  );
                })}
                {dayBlocks.map((block, bi) => {
                  const topPx    = ((block.startMins - START_HOUR * 60) / 30) * SLOT_HEIGHT;
                  const heightPx = Math.max(((block.endMins - block.startMins) / 30) * SLOT_HEIGHT, SLOT_HEIGHT);
                  const { color, cls } = block;
                  return (
                    <div
                      key={`${cls.id}-${day}-${bi}`}
                      style={{ top: topPx, height: heightPx, left: 2, right: 2 }}
                      className={`absolute rounded-md border ${color.bg} ${color.border} ${color.text} overflow-hidden px-1.5 py-1 z-10`}
                      title={`${cls.subject?.code}${cls.section ? ` Sec ${cls.section}` : ''}\n${formatTimeDisplay(block.startMins)} – ${formatTimeDisplay(block.endMins)}`}
                    >
                      <p className="text-[10px] font-bold leading-tight truncate">{cls.subject?.code}</p>
                      {heightPx > 40 && <p className="text-[9px] leading-tight truncate opacity-80">{cls.subject?.name}</p>}
                      {heightPx > 56 && cls.section && <p className="text-[9px] opacity-70">Sec {cls.section}</p>}
                      {heightPx > 70 && (
                        <p className="text-[9px] opacity-60">
                          {formatTimeDisplay(block.startMins)}–{formatTimeDisplay(block.endMins)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InstructorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await classService.getInstructorClasses(user.id);
        setClasses(data.classes || []);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user.id]);

  if (loading) return <LoadingSpinner />;

  const totalStudents = classes.reduce((s, c) => s + (c.student_count || 0), 0);
  const pending       = classes.reduce((s, c) => s + ((c.student_count || 0) - (c.submitted_count || 0)), 0);
  const submitted     = classes.reduce((s, c) => s + (c.submitted_count || 0), 0);

  // Build shared color map
  const colorMap = {};
  let ci = 0;
  classes.forEach(cls => {
    const code = cls.subject?.code || `cls-${cls.id}`;
    if (!colorMap[code]) { colorMap[code] = SUBJECT_COLORS[ci % SUBJECT_COLORS.length]; ci++; }
  });

  // Active days summary
  const activeDays = new Set();
  classes.forEach(cls => parseScheduleBlocks(cls.schedule || '').forEach(b => activeDays.add(b.day)));

  return (
    <>
      <div className="mb-6">
        <h2 className="font-display text-2xl font-bold text-navy">Welcome back, {user?.name}!</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage your classes and student grades efficiently.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="My Classes"     value={classes.length} icon={<Icons.Book />}  iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Total Students" value={totalStudents}  icon={<Icons.Users />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Pending Grades" value={pending} valueClass="text-red-500"     icon={<Icons.Clock />} iconBg="bg-red-50 text-red-500" />
        <StatCard label="Submitted"      value={submitted}      icon={<Icons.Check />} iconBg="bg-amber-50 text-amber-500" />
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b-2 border-gray-200 mb-5">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-5 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all
            ${activeTab === 'overview' ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <Icons.Book className="w-3.5 h-3.5 inline mr-1.5" />My Classes
        </button>
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-5 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all
            ${activeTab === 'schedule' ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <Icons.Clock className="w-3.5 h-3.5 inline mr-1.5" />My Schedule
        </button>
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-navy">Assigned Classes</h3>
            <button
              className="text-sm text-gold font-medium cursor-pointer bg-transparent border-none"
              onClick={() => navigate('/instructor/classes')}
            >
              View All →
            </button>
          </div>

          {classes.length === 0 ? (
            <div className="card p-12 text-center text-gray-400">
              <Icons.Book className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No classes assigned yet</p>
              <p className="text-sm mt-1">Contact the Admin to get classes assigned to you.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {classes.map((c) => {
                const code  = c.subject?.code || `cls-${c.id}`;
                const color = colorMap[code] || SUBJECT_COLORS[0];
                return (
                  <div key={c.id} className={`card p-5 hover:shadow-md transition-shadow border-l-4 ${color.border}`}>
                    <div className="flex items-start justify-between mb-3">
                      <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${color.bg} ${color.text}`}>
                        {c.subject?.code}
                      </span>
                      <span className="text-xs text-gray-400">{c.subject?.units} Units</span>
                    </div>
                    <h4 className="text-[14px] font-semibold mb-1 text-navy">{c.subject?.name}</h4>
                    {c.section && <p className="text-xs text-gray-500 mb-1">Section {c.section}</p>}
                    <p className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <Icons.Clock className="w-3 h-3" /> {c.schedule || '—'}
                    </p>
                    <p className="text-xs text-gray-500 flex items-center gap-1 mb-4">
                      <Icons.Users className="w-3 h-3" /> {c.student_count} Students
                    </p>
                    <button
                      className="btn btn-navy btn-sm w-full justify-center"
                      onClick={() => navigate(`/instructor/encode/${c.id}`)}
                    >
                      Encode Grades
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── SCHEDULE TAB ── */}
      {activeTab === 'schedule' && (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-semibold text-navy">My Weekly Schedule</h3>
              <p className="text-[12px] text-gray-400 mt-0.5">All your assigned subjects plotted on a weekly timetable</p>
            </div>
            {activeDays.size > 0 && (
              <div className="flex gap-1">
                {DAYS.map(day => (
                  <span key={day} className={`text-[9px] font-bold px-1.5 py-0.5 rounded
                    ${activeDays.has(day) ? 'bg-navy text-white' : 'bg-gray-100 text-gray-300'}`}>
                    {DAY_SHORT[day]}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Color legend */}
          {classes.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {classes.map((cls) => {
                const code  = cls.subject?.code || `cls-${cls.id}`;
                const color = colorMap[code] || SUBJECT_COLORS[0];
                return (
                  <div key={cls.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${color.bg} ${color.text}`}>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                    <span className="text-[11px] font-semibold">{cls.subject?.code}</span>
                    {cls.section && <span className="text-[10px] opacity-70">Sec {cls.section}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Timetable */}
          <div className="card overflow-hidden">
            <div className="bg-navy text-white px-4 py-2.5 flex items-center gap-2">
              <Icons.Clock className="w-4 h-4 opacity-70" />
              <span className="text-sm font-semibold">Weekly Timetable</span>
              <span className="ml-auto text-[11px] opacity-60">
                {classes.length} class{classes.length !== 1 ? 'es' : ''} · 7:00 AM – 9:00 PM
              </span>
            </div>
            {classes.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Icons.Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No classes assigned yet</p>
              </div>
            ) : (
              <ScheduleGrid classes={classes} colorMap={colorMap} />
            )}
          </div>

          {/* Detail list */}
          {classes.length > 0 && (
            <div className="mt-5">
              <h4 className="text-sm font-semibold text-navy mb-3">Schedule Details</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {classes.map((cls) => {
                  const code  = cls.subject?.code || `cls-${cls.id}`;
                  const color = colorMap[code] || SUBJECT_COLORS[0];
                  return (
                    <div key={cls.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${color.bg} ${color.border}`}>
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${color.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-bold ${color.text}`}>{cls.subject?.code}</p>
                        <p className="text-[11px] text-gray-600 truncate">{cls.subject?.name}</p>
                        {cls.schedule && (
                          <p className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                            <Icons.Clock className="w-2.5 h-2.5" /> {cls.schedule}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        {cls.section && <p className="text-[11px] text-gray-500">Sec {cls.section}</p>}
                        <p className="text-[11px] text-gray-400">{cls.student_count || 0} students</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}