import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Icons, Badge, SearchBar, StatCard, LoadingSpinner, Modal, ProgramBadge, ConfirmDialog, StudentTypeBadge, RegularityBadge, ProgramDot, programCascadeGradient, programShortLabel, comparePeopleNames, formatPersonName } from '../../components/common';
import { classService, subjectService, semesterService, gradeService } from '../../services';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';
import { useDraftState } from '../../hooks/useDraftState';
import { exportGradingSheetDocx, normalizeStudentGrades } from '../../utils/gradingSheetDocx';
import { exportClassRecordToExcel } from '../../utils/classRecordExcel';
import API from '../../services/api';
import socket from '../../services/socket';

// ─── Constants ────────────────────────────────────────────────────────────────
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

// Same iframe-embedded-preview pattern Admin/Chairperson's Grade Approval
// pages use — opens the actual document with ?preview=1 (suppresses its own
// auto-print) instead of a plain new-tab link.
const DOC = {
  record: { label: 'Class Record', path: '/class-record' },
  sheet: { label: 'Grade Sheet', path: '/grading-sheet' },
};

// Program → Year → Section, same shape Admin's Grade Approval / Chairperson's
// Grading Sheets already group by — browsing into a program/year/section's
// own collapsible container IS the filter here, no dropdown needed.
function groupByProgramYearSection(list) {
  const byProgram = {};
  list.forEach((c) => {
    const program = c.subject?.program || 'No Program';
    const year = c.year_level ?? '—';
    const section = c.section || 'No Section';
    if (!byProgram[program]) byProgram[program] = {};
    if (!byProgram[program][year]) byProgram[program][year] = {};
    if (!byProgram[program][year][section]) byProgram[program][year][section] = [];
    byProgram[program][year][section].push(c);
  });
  return byProgram;
}

// Renders `items` as collapsible Program → Year → Section containers (each
// its own toggle, keyed off `idPrefix` so List/Archived/Released never share
// state) with a small table of rows at each section leaf — browsing into the
// container you want IS the filter, no dropdown needed. `openGroups`/
// `toggleGroup` are lifted to the parent so every tab shares one toggle map.
function GroupedClassTree({ items, idPrefix, openGroups, toggleGroup, headerRow, renderRow, emptyMessage }) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-10">{emptyMessage}</p>;
  }
  const groups = groupByProgramYearSection(items);
  const programs = Object.keys(groups).sort();
  return (
    <div>
      {programs.map((program) => {
        const years = groups[program];
        const programTotal = Object.values(years).reduce((s, secs) => s + Object.values(secs).reduce((s2, arr) => s2 + arr.length, 0), 0);
        const programKey = `${idPrefix}|${program}`;
        const programOpen = openGroups[programKey] ?? false;
        return (
          <div key={program} className="border-b border-gray-50 last:border-0">
            <button
              onClick={() => toggleGroup(programKey, !programOpen)}
              className="w-full px-5 py-2.5 flex items-center justify-between text-white border-none cursor-pointer font-sans transition-opacity hover:opacity-95"
              style={{ background: programCascadeGradient(program) }}
            >
              <div className="flex items-center gap-2.5">
                <ProgramDot program={program} />
                <span className="text-sm font-bold">{programShortLabel(program)}</span>
                <span className="text-xs opacity-80">{programTotal} class{programTotal !== 1 ? 'es' : ''}</span>
              </div>
              {programOpen ? <Icons.ChevronUp className="w-3.5 h-3.5" /> : <Icons.ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {programOpen && Object.keys(years).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a - b)).map((year) => {
              const sections = years[year];
              const yearTotal = Object.values(sections).reduce((s, arr) => s + arr.length, 0);
              const yearKey = `${programKey}|${year}`;
              const yearOpen = openGroups[yearKey] ?? false;
              return (
                <div key={year} className="border-t border-gray-50">
                  <button
                    onClick={() => toggleGroup(yearKey, !yearOpen)}
                    className="w-full pl-9 pr-5 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-blue-50/30 hover:bg-blue-50/60 transition-colors"
                  >
                    <span className="text-[12px] font-semibold text-blue-700">{year === '—' ? 'No Year Level' : `Year ${year}`}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400">{yearTotal}</span>
                      {yearOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                    </div>
                  </button>

                  {yearOpen && Object.keys(sections).sort().map((section) => {
                    const secClasses = sections[section];
                    const secKey = `${yearKey}|${section}`;
                    const secOpen = openGroups[secKey] ?? false;
                    return (
                      <div key={section} className="border-t border-gray-50">
                        <button
                          onClick={() => toggleGroup(secKey, !secOpen)}
                          className="w-full pl-14 pr-5 py-1.5 flex items-center justify-between border-none cursor-pointer font-sans bg-white hover:bg-gray-50 transition-colors"
                        >
                          <span className="text-[12px] text-gray-600">{section === 'No Section' ? section : `Section ${section}`}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="purple">{secClasses.length}</Badge>
                            {secOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                          </div>
                        </button>
                        {secOpen && (
                          <div className="overflow-x-auto">
                            {/* table-fixed — each Section is its own separate
                                <table> (so it can collapse independently),
                                which without a fixed layout lets every one
                                auto-size its own columns off its own content
                                (e.g. a longer subject name pushes Semester/
                                Progress/Actions further right in that table
                                only). The header below always ships explicit
                                widths so every section's table lands on the
                                same column boundaries as the ones above and
                                below it. */}
                            <table className="w-full table-fixed border-separate border-spacing-0">
                              {headerRow && <thead>{headerRow}</thead>}
                              <tbody>{secClasses.map(renderRow)}</tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
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

// ─── Main Component ───────────────────────────────────────────────────────────
export default function InstructorClasses() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Reused as-is for a teaching Chairperson under /chairperson/* — route every
  // in-page navigation off the account's actual role rather than hardcoding /faculty.
  const base = user?.role === 'Chairperson' ? '/chairperson' : '/faculty';
  // Filters/tab/collapsible-group state persist across navigation
  // (usePageState), namespaced by `base` so Faculty's own class list and a
  // teaching Chairperson's don't share state on this reused component.
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = usePageState(`${base}.classes.search`, '');
  const [semFilter, setSemFilter] = usePageState(`${base}.classes.semFilter`, '');
  const [semesters, setSemesters] = useState([]);
  const [activeTab, setActiveTab] = usePageState(`${base}.classes.activeTab`, 'list');
  const [releasedOpen, setReleasedOpen] = usePageState(`${base}.classes.releasedOpen`, false);
  const [readyOpen, setReadyOpen] = usePageState(`${base}.classes.readyOpen`, false);
  const [openReleasedSemesters, setOpenReleasedSemesters] = usePageState(`${base}.classes.openReleasedSemesters`, {});
  const [returnedOpen, setReturnedOpen] = usePageState(`${base}.classes.returnedOpen`, false);
  const [classListOpen, setClassListOpen] = usePageState(`${base}.classes.classListOpen`, false);
  const [preview, setPreview] = useState(null); // { cls, type: 'record' | 'sheet' }
  // Cross-program teaching means a faculty's own class list can span more
  // than one program — Program/Year/Section are collapsible containers to
  // browse into (same shape as Admin/Chairperson's Grade Approval pages),
  // not dropdown filters. Keyed by a composite string per level so every
  // program/year/section toggles independently; used across List, Archived,
  // and Released alike.
  const [openGroups, setOpenGroups] = usePageState(`${base}.classes.openGroups`, {});
  // Takes the NEXT value explicitly rather than inverting the raw stored
  // value — GroupedClassTree defaults an unset key to `true` (open) via
  // `openGroups[key] ?? true`, so `!prev[key]` on an untouched key inverted
  // `undefined` to `true` — the same value the read side was already
  // defaulting to — meaning the very first click on any freshly-loaded
  // group silently did nothing. Passing the already-known displayed boolean
  // (each call site already computed it as `xOpen`) sidesteps that mismatch.
  const toggleGroup = (key, next) => setOpenGroups((prev) => ({ ...prev, [key]: next }));

  const [subjects, setSubjects] = useState([]);
  const [semesterOptions, setSemesterOptions] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Draft-persisted — Subject/Year Level/Section (all now required, see
  // handleCreateClass) is real work to redo if a refresh or dropped
  // connection hits mid-fill. Semester stays whatever's actually current
  // regardless (see openCreateModal), so only the other fields are really
  // "the user's own input" being protected here.
  const [createForm, setCreateForm, clearCreateFormDraft] = useDraftState(`InstructorClasses.createForm.${user?.id}`, { subject_id: '', section: '', semester: '' });
  const [subjectSearch, setSubjectSearch] = useState('');
  const [subjectDropdownOpen, setSubjectDropdownOpen] = useState(false);
  const subjectPickerRef = useRef(null);

  // Schedule picker — Day(s), each with one or MORE of its own Start/End
  // time slots (a day can genuinely have more than one meeting — e.g.
  // morning lecture + afternoon lab on the same F), instead of a free-text
  // field the instructor had to hand-format themselves. createForm.schedule
  // (what actually gets submitted, and what the exported Class Record's own
  // "Schedule:" line reads) is the formatted string derived from this — a
  // day's slots list in order, and slots sharing the exact same time range
  // across different days still collapse into one group (e.g. "MWF
  // 8:00-9:00 AM") instead of repeating the same range three times.
  const SCHEDULE_DAYS = ['M', 'T', 'W', 'Th', 'F', 'S'];
  const [scheduleTimes, setScheduleTimes] = useState({}); // { M: [{ start, end }, ...], ... }

  // 24h "HH:MM" (native <input type="time">'s own format) -> "h:MM AM/PM".
  const formatTime12h = (t) => {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  };

  const buildScheduleString = (times) => {
    // Group (day, slot) pairs that share the exact same Start+End into one
    // segment, sorted to natural weekday order — skips any slot whose times
    // aren't both filled in yet. A day with 2 different time slots just
    // ends up contributing to 2 separate groups.
    const groups = [];
    const groupByKey = {};
    SCHEDULE_DAYS.forEach((day) => {
      (times[day] || []).forEach((slot) => {
        if (!slot.start || !slot.end) return;
        const key = `${slot.start}|${slot.end}`;
        if (!groupByKey[key]) {
          groupByKey[key] = { start: slot.start, end: slot.end, days: [] };
          groups.push(groupByKey[key]);
        }
        if (!groupByKey[key].days.includes(day)) groupByKey[key].days.push(day);
      });
    });
    return groups
      .map((g) => `${g.days.join('')} ${formatTime12h(g.start)} - ${formatTime12h(g.end)}`)
      .join(', ');
  };

  // A brand-new slot always starts on the hour (minutes at :00) rather than
  // blank — an empty native <input type="time"> otherwise opens its picker
  // wherever the browser feels like (often the current system time's own
  // minute), which meant the very first thing anyone had to do was fix the
  // minutes back to :00 before touching the hour at all.
  const DEFAULT_SLOT = { start: '08:00', end: '09:00' };

  const toggleScheduleDay = (day) => {
    setScheduleTimes((prev) => {
      const next = { ...prev };
      if (next[day]) {
        delete next[day];
      } else {
        next[day] = [{ ...DEFAULT_SLOT }];
      }
      setCreateForm((f) => ({ ...f, schedule: buildScheduleString(next) }));
      return next;
    });
  };

  const addScheduleSlot = (day) => {
    setScheduleTimes((prev) => {
      const next = { ...prev, [day]: [...(prev[day] || []), { ...DEFAULT_SLOT }] };
      setCreateForm((f) => ({ ...f, schedule: buildScheduleString(next) }));
      return next;
    });
  };

  const removeScheduleSlot = (day, slotIndex) => {
    setScheduleTimes((prev) => {
      const next = { ...prev, [day]: prev[day].filter((_, i) => i !== slotIndex) };
      setCreateForm((f) => ({ ...f, schedule: buildScheduleString(next) }));
      return next;
    });
  };

  const updateScheduleTime = (day, slotIndex, field, value) => {
    // Belt-and-suspenders on top of the inputs' own step="3600" — forces the
    // minute component back to :00 no matter what actually came through
    // (a pasted value, e.g., ignores the step restriction entirely), so
    // this is the one place that can't ever let a stray :15/:30/:45 through.
    const hourOnly = value ? `${value.slice(0, 2)}:00` : value;
    setScheduleTimes((prev) => {
      const next = {
        ...prev,
        [day]: prev[day].map((slot, i) => (i === slotIndex ? { ...slot, [field]: hourOnly } : slot)),
      };
      setCreateForm((f) => ({ ...f, schedule: buildScheduleString(next) }));
      return next;
    });
  };
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!subjectDropdownOpen) return;
    const onClickOutside = (e) => {
      if (subjectPickerRef.current && !subjectPickerRef.current.contains(e.target)) {
        setSubjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [subjectDropdownOpen]);

  const [enrollClass, setEnrollClass] = useState(null);
  const [eligibleStudents, setEligibleStudents] = useState([]);
  const [selectedStudentIds, setSelectedStudentIds] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [eligibleLoading, setEligibleLoading] = useState(false);

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

  // Live refresh — a Chairperson/Admin action on one of these classes
  // (verify, return for revision, approve...) changes what belongs here
  // (e.g. the "Returned by Chairperson" container, Status column) without
  // this page's own reload ever firing, so without this a Faculty sitting on
  // My Classes wouldn't see it until they manually navigated away and back.
  useEffect(() => {
    const handler = () => loadClasses();
    socket.on('gradesUpdated', handler);
    return () => socket.off('gradesUpdated', handler);
  }, [user.id, semFilter]);

  // Shared confirm-warning for Archive/Unarchive/Delete — one ConfirmDialog
  // instance instead of a separate confirm-target per action.
  const [confirmAction, setConfirmAction] = useState(null);
  const requestConfirm = (config) => setConfirmAction(config);
  const runConfirmedAction = async () => {
    const cfg = confirmAction;
    setConfirmAction(null);
    if (cfg?.action) await cfg.action();
  };

  const archiveClass = async (c) => {
    try {
      await classService.update(c.id, { status: 'Completed' });
      toast.success(`${c.subject?.code || 'Class'} archived`);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to archive class');
    }
  };

  const unarchiveClass = async (c) => {
    try {
      await classService.update(c.id, { status: 'Active' });
      toast.success(`${c.subject?.code || 'Class'} restored to active`);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to restore class');
    }
  };

  // The one action that actually makes grades visible to students — "can_release"
  // (computed server-side: submitted, Chairperson-verified, every Passed grade
  // Admin-approved, not already released) gates whether this is even clickable.
  // Once it succeeds, `can_release` and `all_released` are refreshed from the
  // server via loadClasses, so the button locks itself out again — there's
  // nothing left to release until a later resubmission cycle makes it true again.
  const releaseGrades = async (c) => {
    try {
      const { data } = await gradeService.releaseClass(c.id);
      toast.success(data.message || `Released grades for ${c.subject?.code || 'this class'} — students can now see them.`);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to release grades');
    }
  };

  // Export directly from this list — no need to open the class first. Fetches
  // just enough data on demand (this page never loads the full grade grid up
  // front) and hands it to the exact same generator GradeEncoding's own
  // Export button uses (utils/gradingSheetDocx.js), so the file is identical
  // either way.
  const [exportingId, setExportingId] = useState(null);
  const handleExportGradingSheet = async (c) => {
    setExportingId(`sheet-${c.id}`);
    try {
      const { data } = await gradeService.getByClass(c.id);
      await exportGradingSheetDocx({ classData: data.class, studentGrades: normalizeStudentGrades(data.student_grades) });
    } catch (err) {
      toast.error('Failed to export the Grading Sheet');
    } finally {
      setExportingId(null);
    }
  };

  // Same generator GradeEncoding's own Class Record tab uses
  // (utils/classRecordExcel.js) — a class's own components/scores live under
  // grade-components, not the grades endpoint, so they're fetched separately
  // the same way GradeEncoding's loadData does.
  const handleExportClassRecord = async (c) => {
    setExportingId(`record-${c.id}`);
    try {
      const { data } = await gradeService.getByClass(c.id);
      const studentGrades = normalizeStudentGrades(data.student_grades)
        .slice()
        // Alphabetical A-Z roster, matching the official Class Record.
        .sort((a, b) => comparePeopleNames(a.student, b.student));
      let components = [];
      let componentScores = {};
      try {
        const compRes = await API.get(`/grade-components/${c.id}/components`);
        components = compRes.data.components || [];
        const scoreRes = await API.get(`/grade-components/${c.id}/scores`);
        componentScores = scoreRes.data.scores || {};
      } catch (e) {
        // No components set up yet — exportClassRecordToExcel itself shows
        // the "no components set up" toast for an empty list below.
      }
      await exportClassRecordToExcel({ classData: data.class, components, studentGrades, componentScores });
    } catch (err) {
      toast.error('Failed to export the Class Record');
    } finally {
      setExportingId(null);
    }
  };

  const deleteClassRecord = async (c) => {
    try {
      await classService.delete(c.id);
      toast.success(`${c.subject?.code || 'Class'} deleted`);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete class');
    }
  };

  // Clears this class's entered scores/grades and resets its whole submit/
  // verify/approve/release pipeline — unlike deleteClassRecord above, the
  // class itself, its enrolled students, and its grade component/item setup
  // (weights, item names, max scores) all stay exactly as they are.
  const resetGrades = async (c) => {
    try {
      await API.post(`/grade-components/${c.id}/reset`);
      toast.success(`${c.subject?.code || 'Class'}'s grades and scores cleared`);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reset grades');
    }
  };

  const openCreateModal = async () => {
    // createForm itself is deliberately left alone here — it's the
    // localStorage-backed draft (see useDraftState above), so if it's
    // carrying values from an interrupted attempt (tab closed, refreshed,
    // connection dropped before Create Class was actually clicked), this
    // is exactly where wiping it on every open would have silently
    // discarded that. Only the ephemeral, UI-only state resets here.
    setSubjectSearch('');
    setSubjectDropdownOpen(false);
    setScheduleTimes({});
    setShowCreateModal(true);
    try {
      // `all: true` — cross-program teaching is allowed, so this picker shows
      // every program's curriculum, not just the ones this account teaches in.
      const [{ data: subjData }, { data: semData }] = await Promise.all([
        subjectService.getAll({ all: true }),
        semesterService.getAll(),
      ]);
      setSubjects(subjData.subjects || []);
      const semList = semData.semesters || [];
      setSemesterOptions(semList);
      // Always synced to whichever semester is actually current — this is a
      // locked, auto-filled display field (see the "Locked to the current
      // semester" note below), never something typed in, so there's nothing
      // of the user's own to preserve here even across a restored draft.
      const current = semList.find((s) => s.is_current);
      if (current) setCreateForm((f) => ({ ...f, semester: current.name }));
    } catch (err) {
      toast.error('Failed to load subjects/semesters');
    }
  };

  // Subject.semester is the curriculum's own short label ('1st Semester' /
  // '2nd Semester') — distinct from a real Semester row's `term`
  // ('First Semester' / 'Second Semester' / 'Summer'), same distinction
  // promotionController's own SEMESTER_ORDER_TO_SUBJECT_LABEL already draws
  // for the same reason. Maps the picked Semester over to that short label
  // so the Subject picker only ever offers subjects that actually belong to
  // the term being scheduled — a First Semester class built from a Second
  // Semester subject doesn't correspond to anything in the curriculum.
  const TERM_TO_SUBJECT_SEMESTER = { 'First Semester': '1st Semester', 'Second Semester': '2nd Semester', 'Summer': 'Summer' };
  const selectedSemesterTerm = semesterOptions.find((s) => s.name === createForm.semester)?.term;
  const subjectSemesterLabel = TERM_TO_SUBJECT_SEMESTER[selectedSemesterTerm];

  const handleCreateClass = async () => {
    // Year Level + Section aren't just cosmetic here — they're what the
    // Enroll Students picker filters by (see openEnrollModal below), so a
    // class saved without them would exist with no way to actually find its
    // students afterward. Required alongside Subject/Semester, not optional.
    if (!createForm.subject_id || !createForm.semester || !createForm.year_level || !createForm.section) {
      toast.error('Subject, Year Level, and Section are all required.');
      return;
    }
    try {
      setSaving(true);
      const { data } = await classService.create(createForm);
      // Students in this class's Year Level + Section are auto-enrolled
      // server-side — the response message reflects how many, if any.
      toast.success(data.message || 'Class created successfully');
      // Auto-expand the exact Class List path the new class lands in
      // (Program → Year → Section, all collapsed by default, plus the
      // Class List card itself) — otherwise it exists in `classes` after
      // loadClasses() below but stays hidden behind three collapsed
      // accordions, which just reads as "it didn't actually get created".
      const program = selectedSubject?.program || 'No Program';
      const yearLevel = createForm.year_level;
      const section = createForm.section || 'No Section';
      const programKey = `list|${program}`;
      const yearKey = `${programKey}|${yearLevel}`;
      const secKey = `${yearKey}|${section}`;
      setClassListOpen(true);
      setOpenGroups((prev) => ({ ...prev, [programKey]: true, [yearKey]: true, [secKey]: true }));
      // The class now exists server-side — leaving the draft around would
      // just resurrect these same values, already-used, the next time this
      // modal opens.
      clearCreateFormDraft();
      setShowCreateModal(false);
      // A semester filter left over from an earlier visit (persisted via
      // usePageState) would otherwise hide the class that was just created —
      // it always belongs to the current semester (see openCreateModal above),
      // so clearing back to "All Semesters" guarantees it's actually visible
      // instead of silently vanishing behind a stale filter.
      setSemFilter('');
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create class');
    } finally {
      setSaving(false);
    }
  };

  // Registration approval now happens on the Chairperson's Pending
  // Registrations page — by the time a class exists, its students are already
  // Active. This just filters that pool down to the class's own Year Level +
  // Section (both chosen explicitly at creation) so it's easy to find them.
  const openEnrollModal = async (cls) => {
    setEnrollClass(cls);
    setSelectedStudentIds([]);
    setEligibleStudents([]);
    setEligibleLoading(true);
    try {
      const { data } = await classService.getEligibleStudents(cls.id);
      setEligibleStudents((data.students || []).slice().sort(comparePeopleNames));
    } catch (err) {
      toast.error('Failed to load students');
    } finally {
      setEligibleLoading(false);
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

  const filteredSubjects = subjects.filter((s) => {
    // No subject has an unset semester in the curriculum, so a subject with
    // none recorded is left visible regardless (better to show it than
    // silently hide something that just hasn't been tagged yet) — only
    // actively excludes a subject that's tagged for a DIFFERENT term.
    if (subjectSemesterLabel && s.semester && s.semester !== subjectSemesterLabel) return false;
    if (!subjectSearch) return true;
    const q = subjectSearch.toLowerCase();
    return s.code?.toLowerCase().includes(q) || s.name?.toLowerCase().includes(q);
  });
  const selectedSubject = subjects.find((s) => s.id === Number(createForm.subject_id));

  // Once a class's semester is marked Completed by Admin, it moves out of the
  // active list into Archived — it's done, no more encoding, just history.
  const activeClasses = classes.filter((c) => !c.is_archived);
  const archivedClasses = classes.filter((c) => c.is_archived);

  const matchesSearch = (c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.subject?.name?.toLowerCase().includes(q) ||
      c.subject?.code?.toLowerCase().includes(q) ||
      c.section?.toLowerCase().includes(q)
    );
  };

  const filteredActive = activeClasses.filter(matchesSearch);

  // Three buckets, not two: still in progress, Admin-approved but not yet
  // released ("Ready for Export" — same c.can_release flag the row's own
  // Release button and GradeEncoding's export gate both key off), and
  // already released. Splitting the middle one out means "this is done,
  // go export/release it" doesn't get buried in a working list still full
  // of classes that genuinely aren't ready yet.
  const filtered = filteredActive.filter((c) => !c.all_released && !c.can_release);
  const filteredReadyForExport = filteredActive.filter((c) => !c.all_released && c.can_release);
  const filteredReleased = filteredActive.filter((c) => c.all_released);
  // Grouped by the raw semester string alone (not a separate Academic Year
  // level) — `c.semester` already bakes the year in ("First Semester
  // 2026-2027"), so a class missing its own `academic_year` column no longer
  // buckets into an ugly standalone "No Academic Year" group; the year is
  // shown alongside the term instead (see releasedSemesterYear below).
  const releasedBySemester = {};
  filteredReleased.forEach((c) => {
    const sem = c.semester || 'No Semester';
    if (!releasedBySemester[sem]) releasedBySemester[sem] = [];
    releasedBySemester[sem].push(c);
  });
  // The academic year to show beside a semester group's term — prefers the
  // class's own `academic_year` column, falling back to whatever 4-digit
  // pair is embedded in the semester string itself.
  const releasedSemesterYear = (sem, classes) =>
    classes.find((c) => c.academic_year)?.academic_year || (sem || '').match(/\d{4}-\d{4}/)?.[0] || '';

  const filteredArchived = archivedClasses.filter(matchesSearch);

  // Shared color map — stable across all tabs
  const colorMap = {};
  let ci = 0;
  classes.forEach(cls => {
    const code = cls.subject?.code || `cls-${cls.id}`;
    if (!colorMap[code]) { colorMap[code] = SUBJECT_COLORS[ci % SUBJECT_COLORS.length]; ci++; }
  });

  const returnedClasses = activeClasses.filter((c) => c.awaiting_faculty_revision);

  const total     = activeClasses.reduce((s, c) => s + (c.student_count || 0), 0);
  const pending   = activeClasses.reduce((s, c) => s + ((c.student_count || 0) - (c.submitted_count || 0)), 0);
  const submitted = activeClasses.reduce((s, c) => s + (c.submitted_count || 0), 0);

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">My Classes</h2>
          <p className="text-[13px] text-gray-500">Manage all your classes and student grades in one place.</p>
        </div>
        {/* Archived classes are read-only history — creating a new one from
            there doesn't belong, so this only shows on the actual Class List. */}
        {activeTab === 'list' && (
          <button className="btn btn-gold" onClick={openCreateModal}>
            <Icons.Plus /> Create Class
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Classes"  value={activeClasses.length} icon={<Icons.Book />}  iconBg="bg-blue-50 text-blue-500" />
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
          onClick={() => setActiveTab('archived')}
          className={`px-5 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all
            ${activeTab === 'archived' ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
        >
          <Icons.FileText className="w-3.5 h-3.5 inline mr-1.5" />Archived {archivedClasses.length > 0 ? `(${archivedClasses.length})` : ''}
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

          {/* Classes the Chairperson bounced back for revision (returnToFaculty)
              — sits between the filters and the Class List card itself, its own
              collapsible container grouped by Year → Section like the rest of
              the page, so it can't be missed but doesn't have to stay expanded
              once seen. */}
          {returnedClasses.length > 0 && (
            <div className="card overflow-hidden mb-6 border border-red-200">
              <button
                onClick={() => setReturnedOpen((o) => !o)}
                className="w-full px-5 py-2.5 bg-red-500 text-white flex items-center gap-2 border-none cursor-pointer font-sans hover:opacity-95 transition-opacity"
              >
                <Icons.AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-bold">Returned by Chairperson</span>
                <span className="text-xs opacity-80">{returnedClasses.length} class{returnedClasses.length !== 1 ? 'es' : ''} to fix and resubmit</span>
                {returnedOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <Icons.ChevronDown className="w-3.5 h-3.5 ml-auto" />}
              </button>
              {returnedOpen && (
                <GroupedClassTree
                  items={returnedClasses}
                  idPrefix="returned"
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  emptyMessage="No returned classes."
                  headerRow={
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[35%]">Subject</th>
                      <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[45%]">Chairperson's Reason</th>
                      <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[20%]">Actions</th>
                    </tr>
                  }
                  renderRow={(c) => (
                    <tr key={c.id} className="border-t border-gray-50">
                      <td className="px-4 py-3 align-top">
                        <p className="text-sm font-semibold text-navy">{c.subject?.code}</p>
                        <p className="text-xs text-gray-500">{c.subject?.name}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <p className="text-xs text-red-600">{c.chairperson_return_reason ? `"${c.chairperson_return_reason}"` : '—'}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <button
                          className="btn btn-navy btn-sm"
                          onClick={() => navigate(`${base}/encode/${c.id}`)}
                        >
                          Review &amp; Revise
                        </button>
                      </td>
                    </tr>
                  )}
                />
              )}
            </div>
          )}

          <div className="card overflow-hidden">
            <button
              onClick={() => setClassListOpen((o) => !o)}
              className="card-header w-full border-none bg-transparent cursor-pointer font-sans text-left"
            >
              <div>
                <h3 className="text-base font-semibold text-navy">Class List ({filtered.length})</h3>
                <p className="text-xs text-gray-400 mt-0.5">Grouped by Program → Year → Section — open the ones you want.</p>
              </div>
              {classListOpen ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
            </button>
            {classListOpen && <GroupedClassTree
              items={filtered}
              idPrefix="list"
              openGroups={openGroups}
              toggleGroup={toggleGroup}
              emptyMessage="No classes found."
              headerRow={
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[30%]">Subject</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[13%]">Semester</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[12%]">Students</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[17%]">Progress</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[10%]">Status</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[18%]">Actions</th>
                </tr>
              }
              renderRow={(c) => {
                const code  = c.subject?.code || `cls-${c.id}`;
                const color = colorMap[code] || SUBJECT_COLORS[0];
                return (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold truncate">{c.subject?.name}</p>
                          <p className="text-[11px] text-gray-500 truncate">{c.subject?.code} · {c.subject?.units} Units</p>
                        </div>
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
                      {c.all_released
                        ? <Badge variant="green"><Icons.Check /> Released</Badge>
                        : c.progress === 100
                          ? <Badge variant="green"><Icons.Check /> Complete</Badge>
                          : c.encoding_open
                            ? <Badge variant="yellow">Open</Badge>
                            : <Badge variant="red">Closed</Badge>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          className="btn-icon"
                          onClick={() => navigate(`${base}/encode/${c.id}`)}
                          title="Encode Grades"
                          disabled={!c.encoding_open && c.progress < 100}
                        >
                          <Icons.Edit />
                        </button>
                        <button className="btn-icon" onClick={() => openEnrollModal(c)} title="Class Roster">
                          <Icons.Users />
                        </button>
                        <button className="btn-icon" onClick={() => setPreview({ cls: c, type: 'record' })} title="Preview Class Record">
                          <Icons.Book />
                        </button>
                        <button className="btn-icon" onClick={() => setPreview({ cls: c, type: 'sheet' })} title="Preview Grade Sheet">
                          <Icons.FileText />
                        </button>
                        {/* Release and Archive both dropped from this row —
                            Release already lives on the class's own Grade
                            Encoding page (where the actual score entry
                            happens, right next to it), and Archive only ever
                            makes sense once a class is actually done
                            (Released), where it now lives instead — see the
                            Released group below. Having both here too, on
                            every class a Faculty/teaching Chairperson creates,
                            duplicated an action that belongs to a later step. */}
                        <button
                          className="btn-icon hover:!bg-red-50 hover:!text-red-500"
                          title="Delete Class"
                          onClick={() => requestConfirm({
                            title: 'Delete Class',
                            message: `Are you sure you want to delete ${c.subject?.code || 'this class'}${c.section ? ` - Section ${c.section}` : ''}? This permanently removes its grade components, enrollments, and grades — including any already submitted. This cannot be undone. If you just want it out of your active list without losing the grade history, Archive it instead.`,
                            confirmText: 'Delete',
                            variant: 'red',
                            action: () => deleteClassRecord(c),
                          })}
                        >
                          <Icons.Trash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              }}
            />}
          </div>

          {/* ── READY FOR EXPORT — Admin has finished approving these
              (c.can_release), but they haven't been released to students
              yet. Sits between the working list and Released so it reads as
              its own "your turn" queue instead of getting lost in either. ── */}
          {filteredReadyForExport.length > 0 && (
            <div className="card overflow-hidden mt-5">
              <button
                onClick={() => setReadyOpen((o) => !o)}
                className="w-full px-5 py-3.5 flex items-center justify-between border-none cursor-pointer font-sans text-white transition-colors bg-amber-500 hover:bg-amber-600"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold bg-white/20 rounded-full min-w-[26px] h-[26px] px-2 flex items-center justify-center">{filteredReadyForExport.length}</span>
                  <div className="text-left">
                    <p className="text-sm font-bold">Ready to Release</p>
                    <p className="text-[11px] text-white/75">Admin has approved these — release to students. Class Record/Grade Sheet exports unlock once released.</p>
                  </div>
                </div>
                {readyOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
              </button>

              {readyOpen && (
                <GroupedClassTree
                  items={filteredReadyForExport}
                  idPrefix="ready"
                  openGroups={openGroups}
                  toggleGroup={toggleGroup}
                  emptyMessage="Nothing ready yet."
                  headerRow={
                    <tr className="bg-gray-50 text-gray-500">
                      <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[45%]">Subject</th>
                      <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[20%]">Students</th>
                      <th className="text-right px-4 py-2 pr-5 text-[10px] font-semibold uppercase tracking-wide w-[35%]">Actions</th>
                    </tr>
                  }
                  renderRow={(c) => (
                    <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3.5">
                        <p className="text-[13px] font-semibold">{c.subject?.name}</p>
                        <p className="text-[11px] text-gray-500">{c.subject?.code} · {c.subject?.units} Units</p>
                      </td>
                      <td className="px-4 py-3.5"><Badge variant="blue">{c.student_count} students</Badge></td>
                      <td className="px-4 py-3.5 text-right pr-5">
                        <div className="flex items-center justify-end flex-wrap gap-1.5">
                          {/* Same two Export buttons the Released section
                              below has, shown here too but disabled — a
                              visible preview of what unlocks once Release is
                              clicked, instead of them just not existing yet. */}
                          <button
                            className="btn btn-outline btn-sm whitespace-nowrap opacity-60 cursor-not-allowed"
                            disabled
                            title="Available once released to students"
                          >
                            <Icons.FileText className="w-3.5 h-3.5" /> Export Grading Sheet
                          </button>
                          <button
                            className="btn btn-outline btn-sm whitespace-nowrap opacity-60 cursor-not-allowed"
                            disabled
                            title="Available once released to students"
                          >
                            <Icons.FileText className="w-3.5 h-3.5" /> Export Class Record
                          </button>
                          <button
                            className="btn btn-gold btn-sm whitespace-nowrap"
                            title="Release grades to students"
                            onClick={() => requestConfirm({
                              title: 'Release Grades',
                              message: `Release grades for ${c.subject?.code || 'this class'}${c.section ? ` - Section ${c.section}` : ''} to students? This makes them visible immediately, and unlocks the Class Record/Grade Sheet exports for this class.`,
                              confirmText: 'Release',
                              variant: 'green',
                              action: () => releaseGrades(c),
                            })}
                          >
                            <Icons.Send className="w-3.5 h-3.5" /> Release to Students
                          </button>
                          <button
                            className="btn-icon hover:!bg-red-50 hover:!text-red-500"
                            title="Reset Grades"
                            onClick={() => requestConfirm({
                              title: 'Reset Grades',
                              message: `Clear all entered scores and grades for ${c.subject?.code || 'this class'}${c.section ? ` - Section ${c.section}` : ''}? This un-releases it and resets it all the way back to the start of encoding — including anything already submitted, verified, or approved. The class itself, its enrolled students, and its grade component setup (weights, item names) are NOT affected. This cannot be undone.`,
                              confirmText: 'Reset Grades',
                              variant: 'red',
                              action: () => resetGrades(c),
                            })}
                          >
                            <Icons.RotateCcw />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                />
              )}
            </div>
          )}

          {/* ── RELEASED — grouped by Academic Year → Semester, kept separate
              from the working list above since there's nothing left to act on. ── */}
          {filteredReleased.length > 0 && (
            <div className="card overflow-hidden mt-5">
              <button
                onClick={() => setReleasedOpen((o) => !o)}
                className="w-full px-5 py-3.5 flex items-center justify-between border-none cursor-pointer font-sans text-white transition-colors bg-green-500 hover:bg-green-600"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold bg-white/20 rounded-full min-w-[26px] h-[26px] px-2 flex items-center justify-center">{filteredReleased.length}</span>
                  <div className="text-left">
                    <p className="text-sm font-bold">Released</p>
                    <p className="text-[11px] text-white/75">Grades already visible to students — nothing left to do here.</p>
                  </div>
                </div>
                {releasedOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
              </button>

              {releasedOpen && (
                <div className="border-t border-gray-100">
                  {Object.keys(releasedBySemester).sort().reverse().map((sem) => {
                    const semClasses = releasedBySemester[sem];
                    const semKey = `sem-${sem}`;
                    const semOpen = openReleasedSemesters[semKey] ?? false;
                    const yr = releasedSemesterYear(sem, semClasses);
                    // Program → Year Level → Section nested one level in,
                    // inside each Semester leaf — same collapsible-container
                    // browsing as the Class List above, scoped keys so every
                    // semester's tree toggles independently of every other one.
                    return (
                      <div key={sem} className="border-b border-gray-50 last:border-0">
                        <button
                          onClick={() => setOpenReleasedSemesters((prev) => ({ ...prev, [semKey]: !semOpen }))}
                          className="w-full px-5 py-2.5 flex items-center justify-between border-none cursor-pointer font-sans bg-gray-50/60 hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <Icons.Clock className="w-3.5 h-3.5 text-gray-400" />
                            {/* `sem` already bakes the academic year in
                                ("First Semester 2026-2027") — taking just the
                                term itself and pairing it with `yr` here
                                avoids ever showing the year twice, or a bare
                                "No Academic Year" group when a class is
                                missing its own academic_year column. */}
                            <span className="text-sm font-semibold text-navy">
                              {sem?.split(' ').slice(0, 2).join(' ')}{yr ? ` · A.Y. ${yr}` : ''}
                            </span>
                            <span className="text-xs text-gray-400">{semClasses.length} class{semClasses.length !== 1 ? 'es' : ''}</span>
                          </div>
                          {semOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                        </button>

                        {semOpen && (
                          <GroupedClassTree
                            items={semClasses}
                            idPrefix={`rel|${sem}`}
                            openGroups={openGroups}
                            toggleGroup={toggleGroup}
                            emptyMessage="No released classes."
                            headerRow={null}
                            renderRow={(c) => (
                              <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                                <td className="pl-14 pr-2 py-2.5">
                                  <p className="text-[13px] font-semibold">{c.subject?.code}</p>
                                  <p className="text-[11px] text-gray-500">{c.subject?.name}</p>
                                </td>
                                <td className="px-2 py-2.5"><Badge variant="blue">{c.student_count} students</Badge></td>
                                <td className="px-2 py-2.5"><Badge variant="green"><Icons.Check className="w-3 h-3" /> Released</Badge></td>
                                <td className="px-2 py-2.5 text-right pr-5">
                                  {/* CSS Grid, single implicit column, instead
                                      of the earlier flexbox attempts — a grid
                                      column's width is set once by its widest
                                      cell, and `justify-items-end` then aligns
                                      every cell's own box to that column's
                                      right edge, guaranteed by the grid spec
                                      itself rather than depending on manually
                                      matching pixel widths across differently
                                      padded/bordered elements (which is what
                                      kept drifting a few px off). */}
                                  <div className="grid justify-items-end gap-1.5">
                                    {/* Each file gets its own Export button —
                                        downloads directly, no detour through
                                        the class's own page first. */}
                                    <button
                                      className="btn btn-outline btn-sm whitespace-nowrap"
                                      onClick={() => handleExportGradingSheet(c)}
                                      disabled={exportingId === `sheet-${c.id}`}
                                      title="Export Grading Sheet (.docx)"
                                    >
                                      <Icons.FileText className="w-3.5 h-3.5 flex-shrink-0" /> {exportingId === `sheet-${c.id}` ? 'Exporting...' : 'Export Grading Sheet'}
                                    </button>
                                    <button
                                      className="btn btn-outline btn-sm whitespace-nowrap"
                                      onClick={() => handleExportClassRecord(c)}
                                      disabled={exportingId === `record-${c.id}`}
                                      title="Export Class Record (.xlsx)"
                                    >
                                      <Icons.FileText className="w-3.5 h-3.5 flex-shrink-0" /> {exportingId === `record-${c.id}` ? 'Exporting...' : 'Export Class Record'}
                                    </button>
                                    {/* Released classes are done — a Chairperson
                                        (or teaching Faculty) can tuck a
                                        finished one straight into the
                                        Archived tab from here, same
                                        archiveClass() the working Class List
                                        already uses, instead of having no way
                                        to get a Released class out of this
                                        list at all. */}
                                    <button
                                      className="btn-icon mt-1"
                                      title="Archive Class"
                                      onClick={() => requestConfirm({
                                        title: 'Archive Class',
                                        message: `Archive ${c.subject?.code || 'this class'}${c.section ? ` - Section ${c.section}` : ''}? It moves to the Archived tab and stops appearing in this Released list. You can restore it later from there.`,
                                        confirmText: 'Archive',
                                        variant: 'gold',
                                        action: () => archiveClass(c),
                                      })}
                                    >
                                      <Icons.Archive />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── ARCHIVED TAB — classes whose semester was marked Completed by Admin ── */}
      {activeTab === 'archived' && (
        <>
          <div className="flex flex-wrap gap-3 mb-5">
            <SearchBar value={search} onChange={setSearch} placeholder="Search by subject code, name, or section..." />
          </div>

          <div className="card overflow-hidden">
            <div className="card-header">
              <h3 className="text-base font-semibold text-navy">Archived Classes ({filteredArchived.length})</h3>
              <p className="text-xs text-gray-400 mt-0.5">Classes from semesters that have ended — read-only, kept for your records.</p>
            </div>
            <GroupedClassTree
              items={filteredArchived}
              idPrefix="archived"
              openGroups={openGroups}
              toggleGroup={toggleGroup}
              emptyMessage="No archived classes yet."
              headerRow={
                <tr className="bg-gray-50 text-gray-500">
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[32%]">Subject</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[15%]">Semester</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[13%]">Students</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[20%]">Class Record</th>
                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide w-[20%]">Actions</th>
                </tr>
              }
              renderRow={(c) => (
                <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3.5 truncate">
                    <p className="text-[13px] font-semibold text-gray-600">{c.subject?.name}</p>
                    <p className="text-[11px] text-gray-400">{c.subject?.code} · {c.subject?.units} Units</p>
                  </td>
                  <td className="px-4 py-3.5"><Badge variant="gray">{c.semester?.split(' ').slice(0, 2).join(' ')}</Badge></td>
                  <td className="px-4 py-3.5"><Badge variant="gray">{c.student_count} students</Badge></td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <button className="btn-icon" onClick={() => setPreview({ cls: c, type: 'record' })} title="Preview Class Record">
                        <Icons.Book />
                      </button>
                      <button className="btn-icon" onClick={() => setPreview({ cls: c, type: 'sheet' })} title="Preview Grade Sheet">
                        <Icons.FileText />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    {/* Only a class YOU archived (not one whose whole
                        semester Admin marked Completed) can be restored
                        here — reactivating a class from a closed term
                        doesn't make sense. */}
                    {c.manually_archived && (
                      <button
                        className="btn-icon"
                        title="Restore to Active"
                        onClick={() => requestConfirm({
                          title: 'Restore Class',
                          message: `Restore ${c.subject?.code || 'this class'}${c.section ? ` - Section ${c.section}` : ''} to your active classes?`,
                          confirmText: 'Restore',
                          variant: 'green',
                          action: () => unarchiveClass(c),
                        })}
                      >
                        <Icons.ArrowLeft />
                      </button>
                    )}
                  </td>
                </tr>
              )}
            />
          </div>
        </>
      )}

      {/* CREATE CLASS MODAL */}
      {showCreateModal && (
        <Modal
          title="Create Class"
          onClose={() => setShowCreateModal(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button
                className="btn btn-gold disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleCreateClass}
                disabled={saving || !createForm.subject_id || !createForm.semester || !createForm.year_level || !createForm.section}
                title={!createForm.subject_id || !createForm.semester || !createForm.year_level || !createForm.section ? 'Subject, Year Level, and Section are all required' : undefined}
              >
                {saving ? 'Creating...' : 'Create Class'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2" style={{ position: 'relative' }} ref={subjectPickerRef}>
              <label className="form-label">Subject <span className="text-red-500">*</span></label>
              <div
                className="form-input flex items-center justify-between cursor-pointer"
                onClick={() => setSubjectDropdownOpen((o) => !o)}
              >
                <span className={`flex items-center gap-2 min-w-0 ${selectedSubject ? 'text-gray-800' : 'text-gray-400'}`}>
                  <span className="truncate">
                    {selectedSubject ? `${selectedSubject.code} — ${selectedSubject.name}` : 'Select Subject'}
                  </span>
                  {selectedSubject && <ProgramBadge program={selectedSubject.program} short className="flex-shrink-0" />}
                </span>
                {subjectDropdownOpen ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
              </div>
              {subjectDropdownOpen && (
                <div
                  className="absolute z-20 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
                  style={{ top: '100%' }}
                >
                  <div className="p-2 border-b border-gray-100">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50 rounded-md">
                      <Icons.Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <input
                        autoFocus
                        className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px]"
                        placeholder="Search by code or name..."
                        value={subjectSearch}
                        onChange={(e) => setSubjectSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto">
                    {filteredSubjects.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">No subjects match your search.</p>
                    ) : (
                      filteredSubjects.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setCreateForm({ ...createForm, subject_id: s.id, year_level: createForm.year_level || s.year_level || '' });
                            setSubjectDropdownOpen(false);
                            setSubjectSearch('');
                          }}
                          className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-[13px] cursor-pointer border-none font-sans transition-colors
                            ${Number(createForm.subject_id) === s.id ? 'bg-gold/10 text-navy font-semibold' : 'bg-white hover:bg-gray-50 text-gray-700'}`}
                        >
                          <span className="truncate">{s.code} — {s.name}</span>
                          <ProgramBadge program={s.program} short className="flex-shrink-0" />
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Semester <span className="text-red-500">*</span></label>
              {/* Locked, not a picker — a class always belongs to whichever
                  semester the Admin has actually marked current, full stop.
                  Shown as plain read-only text (not a disabled <select>, so
                  the whole name is visible and never clipped/greyed-out
                  looking) rather than something Faculty could second-guess
                  or accidentally switch away from the real current term.
                  Spans the full modal width (not squeezed into a half-width
                  grid cell like the pickers beside it) — a semester name
                  like "First Semester 2026-2027" was getting clipped with an
                  ellipsis otherwise. */}
              <div className="form-input !bg-gray-50 !text-gray-700 flex items-center gap-2 cursor-default select-none">
                <Icons.Lock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="whitespace-nowrap">{createForm.semester || 'No current semester set'}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                {createForm.semester
                  ? 'Locked to the current semester — set by the Admin under Semester Management.'
                  : 'The Admin hasn\'t marked a semester current yet — ask them to set one before creating a class.'}
              </p>
            </div>
            <div>
              <label className="form-label">Year Level <span className="text-red-500">*</span></label>
              <select className="form-select" value={createForm.year_level} onChange={(e) => setCreateForm({ ...createForm, year_level: e.target.value })}>
                <option value="">Select Year Level</option>
                {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Defaults to the Subject's own curriculum year — override for retake/cross-year offerings.</p>
            </div>
            <div>
              <label className="form-label">Section <span className="text-red-500">*</span></label>
              <select className="form-select" value={createForm.section} onChange={(e) => setCreateForm({ ...createForm, section: e.target.value })}>
                <option value="">Select Section</option>
                {SECTIONS.map((s) => <option key={s} value={s}>Section {s}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Schedule</label>
              {/* Day(s), each with one or MORE of its own Start/End time
                  slots — a day can genuinely have more than one meeting
                  (e.g. a morning lecture and an afternoon lab both on F), so
                  a single shared time per day would be wrong. The "+" button
                  adds another slot row for that day; the trash icon removes
                  one (a day always keeps at least its first slot — untoggle
                  the day itself to drop it entirely). createForm.schedule is
                  the formatted string derived from this (buildScheduleString
                  — slots sharing the exact same range across different days
                  still collapse into one group, e.g. "MWF 8:00-9:00 AM").
                  Optional — flows straight into the Class Record's own
                  "Schedule:" line on export (classRecordExcel.js already
                  reads classData.schedule); leaving every day unchecked
                  leaves that line blank, same as before this field existed. */}
              <div className="flex items-center gap-1.5 flex-wrap mb-3">
                {SCHEDULE_DAYS.map((day) => {
                  const active = !!scheduleTimes[day];
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleScheduleDay(day)}
                      className={`w-9 h-9 rounded-lg text-sm font-semibold border cursor-pointer transition-colors font-sans
                        ${active ? 'bg-navy text-white border-navy' : 'bg-white text-gray-600 border-gray-200 hover:border-navy/40'}`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              {SCHEDULE_DAYS.filter((day) => scheduleTimes[day]).length > 0 && (
                <div className="space-y-3 mb-2">
                  {SCHEDULE_DAYS.filter((day) => scheduleTimes[day]).map((day) => (
                    <div key={day} className="space-y-1.5">
                      {scheduleTimes[day].map((slot, slotIndex) => (
                        <div key={slotIndex} className="flex items-center gap-3">
                          <span className="w-7 flex-shrink-0 text-sm font-semibold text-navy text-center">
                            {slotIndex === 0 ? day : ''}
                          </span>
                          {/* step="3600" (1 hour) locks the native time
                              picker to whole hours only — minutes always
                              read :00, never a stray :15/:30/:45 a scroll or
                              a typo could otherwise leave behind. */}
                          <input
                            type="time"
                            step="3600"
                            className="form-input flex-1"
                            value={slot.start}
                            onChange={(e) => updateScheduleTime(day, slotIndex, 'start', e.target.value)}
                          />
                          <span className="text-gray-400 text-xs flex-shrink-0">to</span>
                          <input
                            type="time"
                            step="3600"
                            className="form-input flex-1"
                            value={slot.end}
                            onChange={(e) => updateScheduleTime(day, slotIndex, 'end', e.target.value)}
                          />
                          {slotIndex === 0 ? (
                            <button
                              type="button"
                              className="btn-icon flex-shrink-0"
                              title={`Add another time slot for ${day}`}
                              onClick={() => addScheduleSlot(day)}
                            >
                              <Icons.Plus className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-icon flex-shrink-0 hover:!bg-red-50 hover:!text-red-500"
                              title="Remove this time slot"
                              onClick={() => removeScheduleSlot(day, slotIndex)}
                            >
                              <Icons.Trash className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
              {createForm.schedule && (
                <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1.5">
                  <Icons.Clock className="w-3 h-3 flex-shrink-0" /> {createForm.schedule}
                </p>
              )}
              <p className="text-[11px] text-gray-400 mt-1">Optional — shows on the exported Class Record's own "Schedule:" line.</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Year Level + Section determine which students show up in the Enroll Students picker for this class.
          </p>
        </Modal>
      )}

      {/* CLASS ROSTER MODAL — students are auto-enrolled server-side the
          moment a matching class exists or a matching student goes Active
          (see enrollStudentIntoMatchingClasses), so this is a roster view by
          default. The only time it still asks for input is the catch-up
          case: a student who matches this class's Year Level + Section but
          somehow never got auto-enrolled (e.g. their year/section changed
          after the class was created) — those show up below as an
          unchecked, actionable exception, not the normal path. */}
      {enrollClass && (
        <Modal
          title={`${eligibleStudents.some((s) => !s.is_enrolled) ? 'Enroll Students' : 'Class Roster'} — ${enrollClass.subject?.code}${enrollClass.year_level ? ` · Year ${enrollClass.year_level}` : ''}${enrollClass.section ? ` · Sec ${enrollClass.section}` : ''}`}
          onClose={() => setEnrollClass(null)}
          footer={
            eligibleStudents.some((s) => !s.is_enrolled) ? (
              <>
                <button className="btn btn-outline" onClick={() => setEnrollClass(null)}>Cancel</button>
                <button className="btn btn-gold" onClick={handleEnroll} disabled={enrolling}>
                  {enrolling ? 'Enrolling...' : `Enroll ${selectedStudentIds.length} Student(s)`}
                </button>
              </>
            ) : (
              <button className="btn btn-gold" onClick={() => setEnrollClass(null)}>Close</button>
            )
          }
        >
          {eligibleLoading ? (
            <LoadingSpinner />
          ) : eligibleStudents.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              No active students found matching this class's Year Level and Section yet.
              {!enrollClass.year_level || !enrollClass.section
                ? ' Set both on the class to narrow this list.'
                : ''}
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 px-1">
                <p className="text-[11px] text-gray-400">
                  {eligibleStudents.some((s) => !s.is_enrolled)
                    ? `${eligibleStudents.filter((s) => s.is_enrolled).length} already enrolled · ${eligibleStudents.filter((s) => !s.is_enrolled).length} not yet enrolled`
                    : `${eligibleStudents.length} student(s) enrolled — matched automatically by Year Level + Section`}
                </p>
                {eligibleStudents.some((s) => !s.is_enrolled) && (
                  <button
                    type="button"
                    className="text-xs text-gold font-semibold cursor-pointer bg-transparent border-none font-sans hover:underline"
                    onClick={() => {
                      const enrollableIds = eligibleStudents.filter((s) => !s.is_enrolled).map((s) => s.id);
                      const allSelected = enrollableIds.every((id) => selectedStudentIds.includes(id));
                      setSelectedStudentIds(allSelected ? [] : enrollableIds);
                    }}
                  >
                    {eligibleStudents.filter((s) => !s.is_enrolled).every((s) => selectedStudentIds.includes(s.id))
                      ? 'Deselect All'
                      : 'Select All'}
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
                {eligibleStudents.map((s, idx) => (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      s.is_enrolled
                        ? 'border-green-200 bg-green-50/60 cursor-default'
                        : 'border-gray-100 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-gold"
                      checked={s.is_enrolled || selectedStudentIds.includes(s.id)}
                      disabled={s.is_enrolled}
                      onChange={() => toggleStudent(s.id)}
                    />
                    <span className="text-[11px] text-gray-400 font-medium w-5 flex-shrink-0">{idx + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[13px] font-semibold">{formatPersonName(s.name)}</p>
                        {s.is_enrolled && <Badge variant="green"><Icons.Check className="w-3 h-3" /> Enrolled</Badge>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <RegularityBadge status={s.student_status} />
                        <StudentTypeBadge status={s.student_type} />
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">{s.student_no} · Year {s.year_level}{s.section ? ` · Section ${s.section}` : ''}</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}
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

      {/* PREVIEW MODAL — Class Record or Grade Sheet, embedded live (same
          ?preview=1 pattern Admin/Chairperson's Grade Approval use) instead
          of opening a new tab. */}
      {preview && (
        <Modal
          title={`${DOC[preview.type].label} — ${preview.cls.subject?.code}${preview.cls.section ? ` Sec ${preview.cls.section}` : ''}`}
          onClose={() => setPreview(null)}
          size="max-w-5xl"
        >
          <iframe
            key={`${preview.cls.id}-${preview.type}`}
            src={`${DOC[preview.type].path}/${preview.cls.id}?preview=1`}
            title="Document preview"
            style={{ width: '100%', height: '65vh', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
          />
        </Modal>
      )}
    </>
  );
}