import { useState, useEffect, useCallback } from 'react';
import { Icons, Avatar, Badge, SearchBar, Modal, LoadingSpinner, ProgramBadge, StatCard, ConfirmDialog, StudentTypeBadge, RegularityBadge, formatStudentName, compareStudentNames } from '../../components/common';
import { userService, verificationService } from '../../services';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';

// Chairperson's stop: first look at new registrations in their own program(s),
// shown as a card queue rather than a nested table — a Chairperson is already
// scoped to their own program(s), so Year/Section/Type filters above the grid
// do the narrowing instead of a Program/Year/Section accordion. Once approved,
// Faculty can find a student by Year/Section the moment they create a
// matching class.

// Stable, muted per-student avatar color (hashed from name) — same idea as
// Slack/Notion/Linear give each person a consistent color instead of every
// avatar being identically navy. Deliberately restrained tones, not neon.
const AVATAR_PALETTE = [
  'bg-slate-600', 'bg-indigo-600', 'bg-teal-600', 'bg-violet-600',
  'bg-blue-600', 'bg-emerald-600', 'bg-rose-600', 'bg-amber-600',
];
const avatarColorFor = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

// Unique verifier names across a batch of students, for the "Assigned to"
// summary on a Year/Section header — so you can tell who's handling a group
// without expanding every card inside it.
const uniqueVerifiers = (students) => {
  const seen = new Map();
  students.forEach((s) => (s.verifiers || []).forEach((v) => seen.set(v.id, v)));
  return [...seen.values()];
};

const timeAgo = (dateStr) => {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diffMs / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function PendingRegistrations() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  // Filters + expanded groups persist across navigation (usePageState).
  const [search, setSearch] = usePageState('PendingRegistrations.search', '');
  const [yearFilter, setYearFilter] = usePageState('PendingRegistrations.yearFilter', '');
  const [sectionFilter, setSectionFilter] = usePageState('PendingRegistrations.sectionFilter', '');
  const [typeFilter, setTypeFilter] = usePageState('PendingRegistrations.typeFilter', '');
  const [viewUser, setViewUser] = useState(null);
  const [actingId, setActingId] = useState(null);
  // Which Program/Year/Section boxes are expanded — absence from this set
  // means collapsed, so every box (including ones that only appear after a
  // filter change) starts closed until you click to open it.
  const [expanded, setExpanded] = usePageState('PendingRegistrations.expanded', new Set());
  const toggleGroup = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const [bulkActing, setBulkActing] = useState(false);
  // Cards mid-collapse after Approve/Reject — kept in `students` a moment
  // longer so the card can shrink/fade out in place instead of vanishing
  // instantly and snapping the rest of the grid up.
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const COLLAPSE_MS = 280;

  // Delegating verification — Chairperson can hand a whole Year or Section's
  // worth of pending students off to one or more Faculty/Active-Student
  // verifiers at once (per program) instead of deciding everything personally
  // or assigning student-by-student (still keeps override power via
  // Approve/Reject above).
  const [assignTarget, setAssignTarget] = useState(null); // { label, students }
  const [verifierCandidates, setVerifierCandidates] = useState(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedVerifierIds, setSelectedVerifierIds] = useState([]);
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await userService.getPending();
      setStudents(data.users || []);
    } catch (err) {
      toast.error('Failed to load pending registrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Every Approve/Reject — single card, the view modal, and the bulk buttons —
  // goes through this one confirmation dialog instead of a plain browser
  // confirm(), so the warning looks and reads the same everywhere on this page.
  const [confirmTarget, setConfirmTarget] = useState(null); // { kind: 'single'|'bulk', student?, list?, status }

  const requestDecide = (student, status) => setConfirmTarget({ kind: 'single', student, status });
  const requestBulk = (status, list) => { if (list.length > 0) setConfirmTarget({ kind: 'bulk', list, status }); };

  const handleConfirmDecide = async () => {
    if (!confirmTarget) return;
    const { kind, student, list, status } = confirmTarget;
    setConfirmTarget(null);
    if (kind === 'single') await executeDecide(student, status);
    else await executeBulk(status, list);
  };

  const executeDecide = async (student, status) => {
    const verb = status === 'Active' ? 'Approve' : 'Reject';
    try {
      setActingId(student.id);
      await userService.update(student.id, { status });
      toast.success(status === 'Active' ? `${student.name} approved.` : `${student.name} rejected.`);
      setViewUser((v) => (v?.id === student.id ? null : v));
      // Collapse the card out first, then drop it from the list once the
      // shrink/fade transition has actually finished playing.
      setRemovingIds((prev) => new Set(prev).add(student.id));
      setTimeout(() => {
        setStudents((prev) => prev.filter((s) => s.id !== student.id));
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(student.id);
          return next;
        });
      }, COLLAPSE_MS);
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${verb.toLowerCase()} student`);
    } finally {
      setActingId(null);
    }
  };

  const executeBulk = async (status, list) => {
    try {
      setBulkActing(true);
      const results = await Promise.allSettled(list.map((s) => userService.update(s.id, { status })));
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      if (succeeded > 0) toast.success(`${succeeded} student(s) ${status === 'Active' ? 'approved' : 'rejected'}.`);
      if (failed > 0) toast.error(`${failed} student(s) could not be updated.`);
      load();
    } finally {
      setBulkActing(false);
    }
  };

  // `students` is every pending student in the Year (or just one Section) —
  // the whole batch gets the same verifier(s) assigned in one go. Pre-checking
  // whoever's already assigned across the batch turns this into a reassign
  // flow too: uncheck them, check someone else, submit — replace semantics on
  // the backend drop the old assignment automatically.
  const openAssignModal = async (label, students, program) => {
    const currentIds = [...new Set(students.flatMap((s) => (s.verifiers || []).map((v) => v.id)))];
    setAssignTarget({ label, students, program });
    setAssignSearch('');
    setSelectedVerifierIds(currentIds);
    if (!verifierCandidates) {
      setCandidatesLoading(true);
      try {
        const [{ data: facultyData }, { data: studentData }] = await Promise.all([
          userService.getAll({ role: 'Faculty', status: 'Active', all: true }),
          userService.getAll({ role: 'Student', status: 'Active', all: true }),
        ]);
        setVerifierCandidates([...(facultyData.users || []), ...(studentData.users || [])]);
      } catch (err) {
        toast.error('Failed to load possible verifiers');
        setVerifierCandidates([]);
      } finally {
        setCandidatesLoading(false);
      }
    }
  };

  const toggleVerifier = (id) =>
    setSelectedVerifierIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleAssign = async () => {
    try {
      setAssigning(true);
      const results = await Promise.allSettled(
        assignTarget.students.map((s) => verificationService.assign(s.id, selectedVerifierIds))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      if (succeeded > 0) {
        toast.success(selectedVerifierIds.length > 0
          ? `Assigned verifier(s) to ${succeeded} student(s).`
          : `Cleared verifier assignment for ${succeeded} student(s).`);
      }
      if (failed > 0) toast.error(`Failed to update assignment for ${failed} student(s).`);
      setAssignTarget(null);
      load();
    } finally {
      setAssigning(false);
    }
  };

  const regularCount = students.filter((s) => s.student_status !== 'Irregular').length;
  const irregularCount = students.filter((s) => s.student_status === 'Irregular').length;

  const years = [...new Set(students.map((s) => s.year_level).filter(Boolean))].sort();
  const sections = [...new Set(students.map((s) => s.section).filter(Boolean))].sort();

  const filtered = students
    .filter((s) => !yearFilter || String(s.year_level) === yearFilter)
    .filter((s) => !sectionFilter || s.section === sectionFilter)
    .filter((s) => !typeFilter || s.student_status === typeFilter)
    .filter((s) => !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.student_no?.toLowerCase().includes(search.toLowerCase()))
    // Year Level, then Section, then name — so the grid reads top-to-bottom the
    // same way a class list would, instead of an alphabetical shuffle.
    .sort((a, b) =>
      (a.year_level || 99) - (b.year_level || 99)
      || (a.section || '').localeCompare(b.section || '')
      || compareStudentNames(a, b)
    );

  // Grouped into boxes — Program, then Year Level, then Section — each level
  // collapsible on its own via `collapsed` (keyed by a path string), so a
  // Chairperson managing more than one program/year/section can drill down
  // to just the batch they're reviewing.
  const groups = [];
  filtered.forEach((s) => {
    const program = s.program || 'No Program';
    const yearLevel = s.year_level || 0;
    const section = s.section || 'No Section';
    let group = groups.find((g) => g.program === program && g.yearLevel === yearLevel);
    if (!group) {
      group = { program, yearLevel, sections: [] };
      groups.push(group);
    }
    let secGroup = group.sections.find((sg) => sg.section === section);
    if (!secGroup) {
      secGroup = { section, students: [] };
      group.sections.push(secGroup);
    }
    secGroup.students.push(s);
  });
  groups.sort((a, b) => a.program.localeCompare(b.program) || a.yearLevel - b.yearLevel);
  groups.forEach((g) => g.sections.sort((a, b) => a.section.localeCompare(b.section)));

  if (loading) return <LoadingSpinner />;

  const pillBtn = (active) =>
    `px-3 py-1.5 text-xs font-semibold rounded-full border cursor-pointer font-sans transition-colors ${
      active ? 'bg-navy text-white border-navy' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'
    }`;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold text-navy">Pending Registrations</h2>
          <p className="text-[13px] text-gray-500">Approve or reject new student registrations in your program.</p>
        </div>
        {students.length > 0 && (
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => requestBulk('Active', filtered)} disabled={bulkActing || filtered.length === 0} className="btn btn-outline text-sm !border-green-300 !text-green-700 hover:!bg-green-50 disabled:opacity-50">
              <Icons.Check className="w-4 h-4" /> Accept All
            </button>
            <button onClick={() => requestBulk('Rejected', filtered)} disabled={bulkActing || filtered.length === 0} className="btn btn-outline text-sm !border-red-300 !text-red-700 hover:!bg-red-50 disabled:opacity-50">
              <Icons.Trash className="w-4 h-4" /> Reject All
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <StatCard label="Total Pending" value={students.length} icon={<Icons.Clock />} iconBg="bg-amber-50 text-amber-500" />
        <StatCard label="Regular" value={regularCount} valueClass="text-green-600" icon={<Icons.Check />} iconBg="bg-green-50 text-green-600" />
        <StatCard label="Irregular" value={irregularCount} valueClass="text-red-600" icon={<Icons.AlertTriangle />} iconBg="bg-red-50 text-red-600" />
      </div>

      <div className="card p-4 mb-6 space-y-3.5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or student no..." />

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mr-0.5">Year</span>
            <button className={pillBtn(yearFilter === '')} onClick={() => setYearFilter('')}>All</button>
            {years.map((y) => (
              <button key={y} className={pillBtn(yearFilter === String(y))} onClick={() => setYearFilter(String(y))}>Y{y}</button>
            ))}
          </div>

          <div className="w-px h-5 bg-gray-100 hidden sm:block" />

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mr-0.5">Type</span>
            <button className={pillBtn(typeFilter === '')} onClick={() => setTypeFilter('')}>All</button>
            <button className={pillBtn(typeFilter === 'Regular')} onClick={() => setTypeFilter('Regular')}>Regular</button>
            <button className={pillBtn(typeFilter === 'Irregular')} onClick={() => setTypeFilter('Irregular')}>Irregular</button>
          </div>

          {sections.length > 0 && (
            <>
              <div className="w-px h-5 bg-gray-100 hidden sm:block" />
              <select className="form-select w-auto text-xs py-1.5" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
                <option value="">All Sections</option>
                {sections.map((s) => <option key={s} value={s}>Section {s}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-500">{filtered.length} student{filtered.length !== 1 ? 's' : ''}</h3>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Icons.Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">{students.length === 0 ? 'No pending registrations.' : 'No students match your filters.'}</p>
        </div>
      ) : (
        groups.map((group) => {
          const groupKey = `${group.program}-${group.yearLevel}`;
          const isOpen = expanded.has(groupKey);
          const groupStudents = group.sections.flatMap((sg) => sg.students);
          const groupTotal = groupStudents.length;
          const groupVerifiers = uniqueVerifiers(groupStudents);
          return (
          <div key={groupKey} className="card overflow-hidden mb-6">
            <div className="w-full px-5 py-3.5 bg-navy text-white flex flex-wrap items-center gap-3">
              <button
                onClick={() => toggleGroup(groupKey)}
                className="flex items-center gap-3 flex-1 min-w-0 border-none bg-transparent cursor-pointer font-sans text-left text-white p-0"
              >
                <ProgramBadge program={group.program} short />
                <span className="text-sm font-bold tracking-wide">{group.yearLevel ? `YEAR ${group.yearLevel}` : 'NO YEAR LEVEL'}</span>
                <span className="text-xs font-medium text-white/60">{groupTotal} pending</span>
              </button>
              {groupVerifiers.length > 0 && (
                <span className="text-[11px] font-medium text-white/80 bg-white/10 px-2.5 py-1 rounded-full flex items-center gap-1 flex-shrink-0" title={groupVerifiers.map((v) => v.name).join(', ')}>
                  <Icons.User className="w-3 h-3" />
                  {groupVerifiers[0].name}{groupVerifiers.length > 1 ? ` +${groupVerifiers.length - 1}` : ''}
                </span>
              )}
              <button
                onClick={() => openAssignModal(`${group.yearLevel ? `Year ${group.yearLevel}` : 'this group'} (${group.program})`, groupStudents, group.program)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 rounded-lg border-none cursor-pointer font-sans transition-colors flex-shrink-0"
                title="Assign or reassign a verifier for everyone pending in this Year"
              >
                <Icons.Send className="w-3.5 h-3.5" /> {groupVerifiers.length > 0 ? 'Reassign' : 'Assign'}
              </button>
              <button onClick={() => toggleGroup(groupKey)} className="border-none bg-transparent cursor-pointer text-white p-0 flex-shrink-0">
                {isOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
              </button>
            </div>
            {isOpen && (
            <div className="card-body space-y-4">
              {group.sections.map((secGroup) => {
                const secKey = `${groupKey}::${secGroup.section}`;
                const isSecOpen = expanded.has(secKey);
                const secVerifiers = uniqueVerifiers(secGroup.students);
                return (
                  <div key={secKey} className="border border-gray-100 rounded-xl overflow-hidden">
                    <div className="w-full px-4 py-2.5 bg-gray-50 hover:bg-gray-100 flex flex-wrap items-center gap-2.5 transition-colors">
                      <button
                        onClick={() => toggleGroup(secKey)}
                        className="flex items-center gap-2.5 flex-1 min-w-0 border-none bg-transparent cursor-pointer font-sans text-left p-0"
                      >
                        <Icons.Flag className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-[13px] font-semibold text-gray-700">
                          {secGroup.section !== 'No Section' ? `Section ${secGroup.section}` : 'No Section'}
                        </span>
                        <Badge variant="blue">{secGroup.students.length}</Badge>
                      </button>
                      {secVerifiers.length > 0 && (
                        <span className="text-[11px] font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full flex items-center gap-1 flex-shrink-0" title={secVerifiers.map((v) => v.name).join(', ')}>
                          <Icons.User className="w-2.5 h-2.5" />
                          {secVerifiers[0].name}{secVerifiers.length > 1 ? ` +${secVerifiers.length - 1}` : ''}
                        </span>
                      )}
                      <button
                        onClick={() => openAssignModal(`${secGroup.section !== 'No Section' ? `Section ${secGroup.section}` : 'this section'} (${group.program})`, secGroup.students, group.program)}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-gray-600 bg-white border border-gray-200 hover:border-gray-300 rounded-lg cursor-pointer font-sans transition-colors flex-shrink-0"
                        title="Assign or reassign a verifier for everyone pending in this Section"
                      >
                        <Icons.Send className="w-3 h-3" /> {secVerifiers.length > 0 ? 'Reassign' : 'Assign'}
                      </button>
                      <button onClick={() => toggleGroup(secKey)} className="border-none bg-transparent cursor-pointer p-0 flex-shrink-0">
                        {isSecOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                      </button>
                    </div>
                    {isSecOpen && (
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {secGroup.students.map((s, idx) => {
                          const isIrregular = s.student_status === 'Irregular';
                          const isRemoving = removingIds.has(s.id);
                          return (
                            <div
                              key={s.id}
                              className={`group bg-white rounded-2xl border-l-4 border-y border-r border-gray-100 shadow-sm transition-all ease-in-out overflow-hidden flex flex-col ${
                                isIrregular ? 'border-l-red-400' : 'border-l-green-400'
                              } ${
                                isRemoving
                                  ? 'opacity-0 scale-90 !max-h-0 pointer-events-none duration-300'
                                  : 'opacity-100 scale-100 hover:shadow-lg hover:-translate-y-0.5 duration-200'
                              }`}
                            >
                              <div className="p-4 pb-3 flex items-start justify-between gap-2">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span className="text-[11px] text-gray-400 font-medium flex-shrink-0 w-4 text-right">{idx + 1}.</span>
                                  <Avatar letter={s.avatar || s.name?.[0]} className={`text-white ${avatarColorFor(s.name)}`} size="w-11 h-11 text-sm" />
                                  <div className="min-w-0">
                                    <p className="text-[13.5px] font-semibold text-gray-800 truncate">{formatStudentName(s.name)}</p>
                                    <p className="text-[11px] text-gray-400">{s.student_no}</p>
                                  </div>
                                </div>
                                <button className="btn-icon flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" onClick={() => setViewUser(s)} title="View Details">
                                  <Icons.Eye className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <div className="px-4 flex items-center flex-wrap gap-1.5 mb-3">
                                <RegularityBadge status={s.student_status} />
                                <StudentTypeBadge status={s.student_type} />
                              </div>

                              {s.verifiers && s.verifiers.length > 0 && (
                                <div className="px-4 mb-3">
                                  <p className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Assigned to</p>
                                  <div className="flex flex-wrap gap-1">
                                    {s.verifiers.map((v) => (
                                      <span key={v.id} className="inline-flex items-center gap-1 text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                                        <Icons.User className="w-2.5 h-2.5" /> {v.name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="px-4 mb-4">
                                <p className="text-[11px] text-gray-400 flex items-center gap-1">
                                  <Icons.Clock className="w-3 h-3" /> {timeAgo(s.created_at || s.createdAt)}
                                </p>
                              </div>

                              <div className="mt-auto flex gap-2 px-4 py-3 bg-gray-50/70 border-t border-gray-50">
                                <button
                                  onClick={() => requestDecide(s, 'Active')}
                                  disabled={actingId === s.id || bulkActing}
                                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded-lg border-none cursor-pointer font-sans transition-colors disabled:opacity-50 shadow-sm"
                                >
                                  <Icons.Check className="w-3.5 h-3.5" /> Approve
                                </button>
                                <button
                                  onClick={() => requestDecide(s, 'Rejected')}
                                  disabled={actingId === s.id || bulkActing}
                                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-500 bg-white border border-gray-200 hover:border-red-300 hover:text-red-600 rounded-lg cursor-pointer font-sans transition-colors disabled:opacity-50"
                                >
                                  <Icons.Trash className="w-3.5 h-3.5" /> Reject
                                </button>
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
            )}
          </div>
          );
        })
      )}

      {viewUser && (
        <Modal
          title="Student Details"
          onClose={() => setViewUser(null)}
          footer={
            <>
              <button onClick={() => requestDecide(viewUser, 'Active')} disabled={actingId === viewUser.id} className="btn text-white bg-green-500 hover:bg-green-600 text-sm px-4">
                <Icons.Check className="w-4 h-4" /> Approve
              </button>
              <button onClick={() => requestDecide(viewUser, 'Rejected')} disabled={actingId === viewUser.id} className="btn text-white bg-red-500 hover:bg-red-600 text-sm px-4">
                <Icons.Trash className="w-4 h-4" /> Reject
              </button>
              <button className="btn btn-outline" onClick={() => setViewUser(null)}>Close</button>
            </>
          }
        >
          <div className="flex items-center gap-4 mb-5">
            <Avatar letter={viewUser.avatar || viewUser.name?.[0]} className={`text-white ${avatarColorFor(viewUser.name)}`} size="w-14 h-14 text-xl" />
            <div>
              <h3 className="text-lg font-bold">{viewUser.name}</h3>
              <p className="text-sm text-gray-500">{viewUser.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {viewUser.program && <div className="col-span-2"><span className="text-gray-500">Program:</span> <span className="ml-1"><ProgramBadge program={viewUser.program} /></span></div>}
            {viewUser.student_no && <div><span className="text-gray-500">Student No:</span> <span className="font-medium ml-1">{viewUser.student_no}</span></div>}
            {viewUser.year_level && <div><span className="text-gray-500">Year Level:</span> <span className="font-medium ml-1">Year {viewUser.year_level}</span></div>}
            {viewUser.section && <div><span className="text-gray-500">Section:</span> <span className="font-medium ml-1">Section {viewUser.section}</span></div>}
            <div className="col-span-2">
              <span className="text-gray-500">Status:</span>{' '}
              <RegularityBadge status={viewUser.student_status} />
            </div>
            {viewUser.irregular_sections && viewUser.irregular_sections.length > 0 && (
              <div className="col-span-2">
                <span className="text-gray-500">Taking Classes In:</span>{' '}
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  {viewUser.irregular_sections.map((p, i) => (
                    <Badge key={i} variant="red">Year {p.year_level} - Sec {p.section}{p.semester ? ` (${p.semester})` : ''}</Badge>
                  ))}
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {assignTarget && (
        <Modal
          title={`Assign Verifier — ${assignTarget.label}`}
          onClose={() => setAssignTarget(null)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setAssignTarget(null)}>Cancel</button>
              <button className="btn btn-gold" onClick={handleAssign} disabled={assigning}>
                {assigning ? 'Assigning...' : `Assign ${selectedVerifierIds.length || ''}`.trim()}
              </button>
            </>
          }
        >
          <p className="text-xs text-gray-500 mb-3">
            Pick one or more Faculty or already-verified students to hand these {assignTarget.students.length} pending registration(s) to.
            You can still Approve or Reject any of them yourself at any time.
          </p>
          <input
            className="form-input mb-3 text-[13px]"
            value={assignSearch}
            onChange={(e) => setAssignSearch(e.target.value)}
            placeholder="Search by name..."
          />
          {candidatesLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-4">
              {(() => {
                // Only people who actually teach/study in this exact program —
                // a Chairperson managing several programs can't cross-assign.
                const eligible = (verifierCandidates || []).filter((c) =>
                  c.role === 'Faculty' ? (c.programs || []).includes(assignTarget.program) : c.program === assignTarget.program
                );
                if (eligible.length === 0) {
                  return <p className="text-sm text-gray-400 text-center py-6">No eligible Faculty or verified students found in {assignTarget.program}.</p>;
                }
                return null;
              })()}
              {['Faculty', 'Student'].map((role) => {
                const list = (verifierCandidates || [])
                  .filter((c) => c.role === role)
                  .filter((c) => role === 'Faculty' ? (c.programs || []).includes(assignTarget.program) : c.program === assignTarget.program)
                  .filter((c) => !assignSearch || c.name?.toLowerCase().includes(assignSearch.toLowerCase()))
                  .sort(compareStudentNames);
                if (list.length === 0) return null;
                return (
                  <div key={role}>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">
                      {role === 'Faculty' ? 'Faculty' : 'Verified Students'}
                    </p>
                    <div className="space-y-1">
                      {list.map((c, idx) => (
                        <label key={c.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            className="accent-gold"
                            checked={selectedVerifierIds.includes(c.id)}
                            onChange={() => toggleVerifier(c.id)}
                          />
                          {role === 'Student' && <span className="text-[11px] text-gray-400 font-medium w-4 flex-shrink-0 text-right">{idx + 1}.</span>}
                          <Avatar letter={c.avatar || c.name?.[0]} className="bg-navy text-white" size="w-7 h-7 text-xs" />
                          <span className="text-[13px] font-medium">{c.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}

      {/* APPROVE/REJECT WARNING — every Approve/Reject action on this page,
          single or bulk, routes through here. */}
      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.status === 'Active' ? 'Approve Registration' : 'Reject Registration'}
          message={
            confirmTarget.kind === 'single'
              ? `Are you sure you want to ${confirmTarget.status === 'Active' ? 'approve' : 'reject'} ${confirmTarget.student.name}'s registration?${confirmTarget.status !== 'Active' ? ' This cannot be undone easily.' : ''}`
              : `Are you sure you want to ${confirmTarget.status === 'Active' ? 'approve' : 'reject'} ${confirmTarget.list.length} pending registration(s)? This cannot be undone easily.`
          }
          confirmText={confirmTarget.status === 'Active' ? 'Approve' : 'Reject'}
          variant={confirmTarget.status === 'Active' ? 'green' : 'red'}
          onConfirm={handleConfirmDecide}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </>
  );
}
