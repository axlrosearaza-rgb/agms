import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Icons, Badge, SearchBar, StatCard, LoadingSpinner, Modal } from '../../components/common';
import { classService, subjectService, semesterService, userService } from '../../services';
import toast from 'react-hot-toast';

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
        <div className="flex border-b border-gray-200 bg-gray-50">
          <div className="w-14 flex-shrink-0 border-r border-gray-200 py-2 text-[10px] text-gray-400 text-center">Time</div>
          {DAYS.map(day => (
            <div key={day} className="flex-1 text-center py-2 text-[11px] font-semibold text-navy border-r border-gray-100 last:border-r-0">
              {DAY_SHORT[day]}
            </div>
          ))}
        </div>

        <div className="flex" style={{ height: TIME_SLOTS.length * SLOT_HEIGHT }}>
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
export default function InstructorClasses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [semFilter, setSemFilter] = useState('');
  const [semesters, setSemesters] = useState([]);
  const [activeTab, setActiveTab] = useState('list');

  const [subjects, setSubjects] = useState([]);
  const [semesterOptions, setSemesterOptions] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ subject_id: '', section: '', schedule: '', semester: '', academic_year: '' });
  const [saving, setSaving] = useState(false);

  const [enrollClass, setEnrollClass] = useState(null);
  const [eligibleStudents, setEligibleStudents] = useState([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [enrolling, setEnrolling] = useState(false);

  const loadClasses = async () => {
    try {
      const params = {};
      if (semFilter) params.semester = semFilter;
      const { data } = await classService.getInstructorClasses(user.id, params);
      const classList = data.classes || [];
      setClasses(classList);
      const uniqueSems = [...new Set(classList.map(c => c.semester).filter(Boolean))];
      setSemesters(uniqueSems);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadClasses(); }, [user.id, semFilter]);

  const openCreateModal = async () => {
    setCreateForm({ subject_id: '', section: '', schedule: '', semester: '', academic_year: '' });
    setShowCreateModal(true);
    try {
      const [{ data: subjData }, { data: semData }] = await Promise.all([
        subjectService.getAll(),
        semesterService.getAll(),
      ]);
      setSubjects(subjData.subjects || []);
      setSemesterOptions(semData.semesters || []);
    } catch (err) {
      toast.error('Failed to load subjects/semesters');
    }
  };

  const handleCreateClass = async () => {
    if (!createForm.subject_id || !createForm.semester) {
      toast.error('Subject and semester are required');
      return;
    }
    try {
      setSaving(true);
      await classService.create(createForm);
      toast.success('Class created successfully');
      setShowCreateModal(false);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create class');
    } finally {
      setSaving(false);
    }
  };

  const openEnrollModal = async (cls) => {
    setEnrollClass(cls);
    setSelectedStudentIds([]);
    try {
      const { data } = await userService.getAll({ role: 'Student', status: 'Active', all: true });
      setEligibleStudents(data.users || []);
    } catch (err) {
      toast.error('Failed to load students');
    }
  };

  const toggleStudent = (id) =>
    setSelectedStudentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleEnroll = async () => {
    if (selectedStudentIds.length === 0) {
      toast.error('Select at least one student');
      return;
    }
    try {
      setEnrolling(true);
      await classService.enroll(enrollClass.id, selectedStudentIds);
      toast.success('Students enrolled successfully');
      setEnrollClass(null);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to enroll students');
    } finally {
      setEnrolling(false);
    }
  };

  const filtered = classes.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.subject?.name?.toLowerCase().includes(q) ||
      c.subject?.code?.toLowerCase().includes(q) ||
      c.section?.toLowerCase().includes(q)
    );
  });

  // Shared color map — stable across both tabs
  const colorMap = {};
  let ci = 0;
  classes.forEach(cls => {
    const code = cls.subject?.code || `cls-${cls.id}`;
    if (!colorMap[code]) { colorMap[code] = SUBJECT_COLORS[ci % SUBJECT_COLORS.length]; ci++; }
  });

  const activeDays = new Set();
  classes.forEach(cls => parseScheduleBlocks(cls.schedule || '').forEach(b => activeDays.add(b.day)));

  const total     = classes.reduce((s, c) => s + (c.student_count || 0), 0);
  const pending   = classes.reduce((s, c) => s + ((c.student_count || 0) - (c.submitted_count || 0)), 0);
  const submitted = classes.reduce((s, c) => s + (c.submitted_count || 0), 0);

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">My Classes</h2>
          <p className="text-[13px] text-gray-500">Manage all your classes and student grades in one place.</p>
        </div>
        <button className="btn btn-gold" onClick={openCreateModal}>
          <Icons.Plus /> Create Class
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Classes"  value={classes.length} icon={<Icons.Book />}  iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Total Students" value={total}          icon={<Icons.Users />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Pending Grades" value={pending} valueClass="text-red-500"     icon={<Icons.Clock />} iconBg="bg-red-50 text-red-500" />
        <StatCard label="Submitted"      value={submitted}      icon={<Icons.Check />} iconBg="bg-amber-50 text-amber-500" />
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b-2 border-gray-200 mb-5">
        <button
          onClick={() => setActiveTab('list')}
          className={`px-5 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all
            ${activeTab === 'list' ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <Icons.Book className="w-3.5 h-3.5 inline mr-1.5" />Class List
        </button>
        <button
          onClick={() => setActiveTab('schedule')}
          className={`px-5 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all
            ${activeTab === 'schedule' ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <Icons.Clock className="w-3.5 h-3.5 inline mr-1.5" />My Schedule
        </button>
      </div>

      {/* ── LIST TAB ── */}
      {activeTab === 'list' && (
        <>
          <div className="flex flex-wrap gap-3 mb-5">
            <SearchBar value={search} onChange={setSearch} placeholder="Search by subject code, name, or section..." />
            <select
              className="form-select w-auto text-sm py-2.5"
              value={semFilter}
              onChange={(e) => setSemFilter(e.target.value)}
            >
              <option value="">All Semesters</option>
              {semesters.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="text-base font-semibold text-navy">Class List ({filtered.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-navy text-white">
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Subject</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Section</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Schedule</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Semester</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Students</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Progress</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Status</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center py-12 text-gray-400 text-sm">No classes found.</td>
                    </tr>
                  ) : (
                    filtered.map((c) => {
                      const code  = c.subject?.code || `cls-${c.id}`;
                      const color = colorMap[code] || SUBJECT_COLORS[0];
                      return (
                        <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                              <div>
                                <p className="text-[13px] font-semibold">{c.subject?.name}</p>
                                <p className="text-[11px] text-gray-500">{c.subject?.code} · {c.subject?.units} Units</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {c.section
                              ? <Badge variant="purple">Section {c.section}</Badge>
                              : <span className="text-gray-400 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3.5 text-[13px]">
                            <div className="flex items-center gap-1">
                              <Icons.Clock className="w-3.5 h-3.5 text-gray-400" />
                              {c.schedule || '—'}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <Badge variant="blue">{c.semester?.split(' ').slice(0, 2).join(' ')}</Badge>
                          </td>
                          <td className="px-4 py-3.5">
                            <Badge variant="blue">{c.student_count} students</Badge>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${c.progress === 100 ? 'bg-green-500' : 'bg-amber-500'}`}
                                  style={{ width: `${c.progress || 0}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{c.progress || 0}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {c.progress === 100
                              ? <Badge variant="green"><Icons.Check /> Complete</Badge>
                              : c.encoding_open
                                ? <Badge variant="yellow">Open</Badge>
                                : <Badge variant="red">Closed</Badge>}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex gap-1.5">
                              <button
                                className="btn-icon"
                                onClick={() => navigate(`/instructor/encode/${c.id}`)}
                                title="Encode Grades"
                                disabled={!c.encoding_open && c.progress < 100}
                              >
                                <Icons.Edit />
                              </button>
                              <button className="btn-icon" title="View"><Icons.Eye /></button>
                              <button className="btn-icon" onClick={() => openEnrollModal(c)} title="Enroll Students">
                                <Icons.Users />
                              </button>
                              <a href={`/grading-sheet/${c.id}`} target="_blank" rel="noreferrer" className="btn-icon inline-flex" title="Official Grading Sheet">
                                <Icons.FileText />
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
            <div className="flex items-center gap-3">
              <select
                className="form-select w-auto text-sm py-2"
                value={semFilter}
                onChange={(e) => setSemFilter(e.target.value)}
              >
                <option value="">All Semesters</option>
                {semesters.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
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

      {/* CREATE CLASS MODAL */}
      {showCreateModal && (
        <Modal
          title="Create Class"
          onClose={() => setShowCreateModal(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleCreateClass} disabled={saving}>
                {saving ? 'Creating...' : 'Create Class'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="form-label">Subject <span className="text-red-500">*</span></label>
              <select className="form-select" value={createForm.subject_id} onChange={(e) => setCreateForm({ ...createForm, subject_id: e.target.value })}>
                <option value="">Select Subject</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Semester <span className="text-red-500">*</span></label>
              <select className="form-select" value={createForm.semester} onChange={(e) => setCreateForm({ ...createForm, semester: e.target.value })}>
                <option value="">Select Semester</option>
                {semesterOptions.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Section</label>
              <input className="form-input" value={createForm.section} onChange={(e) => setCreateForm({ ...createForm, section: e.target.value })} placeholder="e.g. A" />
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Schedule</label>
              <input className="form-input" value={createForm.schedule} onChange={(e) => setCreateForm({ ...createForm, schedule: e.target.value })} placeholder="e.g. MWF 9:00-10:00" />
            </div>
            <div>
              <label className="form-label">Academic Year</label>
              <input className="form-input" value={createForm.academic_year} onChange={(e) => setCreateForm({ ...createForm, academic_year: e.target.value })} placeholder="e.g. 2025-2026" />
            </div>
          </div>
        </Modal>
      )}

      {/* ENROLL STUDENTS MODAL */}
      {enrollClass && (
        <Modal
          title={`Enroll Students — ${enrollClass.subject?.code}`}
          onClose={() => setEnrollClass(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setEnrollClass(null)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleEnroll} disabled={enrolling}>
                {enrolling ? 'Enrolling...' : `Enroll ${selectedStudentIds.length} Student(s)`}
              </button>
            </>
          }
        >
          {eligibleStudents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No active students found in your program.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-1.5">
              {eligibleStudents.map((s) => (
                <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-gold"
                    checked={selectedStudentIds.includes(s.id)}
                    onChange={() => toggleStudent(s.id)}
                  />
                  <div>
                    <p className="text-[13px] font-semibold">{s.name}</p>
                    <p className="text-[11px] text-gray-500">{s.student_no} · Year {s.year_level}{s.section ? ` · Section ${s.section}` : ''}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}