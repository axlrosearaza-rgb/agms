import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icons, Avatar, Badge, SearchBar, LoadingSpinner, ConfirmDialog, FacultyProgramTags, Modal, ProgramDot, programShortLabel, comparePeopleNames, formatPersonName } from '../../components/common';
import { classService, reportService, userService } from '../../services';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';
import socket from '../../services/socket';
import { useAuth } from '../../context/AuthContext';

// Mirrors Admin's Grade Approval page (same filter bar, grouped containers,
// and inline preview-modal pattern) since both pages are two ends of the
// same pipeline: Faculty encodes & submits → Chairperson reviews here and
// forwards → Admin reviews and approves → Faculty is notified, exports, and
// releases to Students. Class Record and Grade Sheet each get their own
// Approve button — only once BOTH are approved does this class actually
// forward to Admin (reportController.verifyDocument derives that
// automatically; nothing extra to click once the second one lands).
const YEAR_LEVELS = [1, 2, 3, 4];

// Same four-way split byTopGroup below buckets classes into — pulled out on
// its own so the Faculty completion rollup can reuse the exact same logic.
// A class Admin sent back (admin_return_reason set, via returnToChairperson)
// takes priority over the submitted/pending read entirely — it needs THIS
// Chairperson's attention regardless of whatever submission state the
// Grade rows happen to still be sitting in, so it gets pulled into its own
// dedicated group instead of blending into "Submitted" looking like any
// other class still waiting on a first-time verification.
const topGroupOf = (c) => {
  if (c.admin_return_reason) return 'returned';
  const hasSubmissions = (c.submitted_count ?? 0) > 0;
  return !hasSubmissions ? 'pending' : c.chairperson_verified ? 'done' : 'submitted';
};

const DOC = {
  record: { field: 'class_record_verified', label: 'Class Record', path: '/class-record' },
  sheet: { field: 'grade_sheet_verified', label: 'Grade Sheet', path: '/grading-sheet' },
};

// Top-level split: has Faculty actually put anything in yet, still needs
// this Chairperson's own verification, or is it fully done (both documents
// verified and forwarded to Admin) — same three-stage shape Admin's own
// Grade Approval page already uses ('needs_approval' vs 'done'), so a class
// that's already been forwarded doesn't sit mixed in with ones still
// waiting on a decision here. "Done" doesn't mean the whole pipeline is
// over — Admin/Faculty still have their own steps — just that there's
// nothing left for THIS Chairperson to do on it.
const TOP_GROUPS = [
  { key: 'pending', label: 'Pending Grades', hint: 'Not yet submitted by Faculty — nothing to review yet.', header: 'bg-gray-500 hover:bg-gray-600' },
  // Red — surfaced right after Pending, ahead of Submitted, since a class
  // Admin sent back needs this Chairperson to act (return it to Faculty)
  // before it can move again, instead of sitting mixed into "Submitted"
  // looking like an ordinary not-yet-verified class.
  { key: 'returned', label: 'Returned by Admin', hint: 'Admin found a problem — review the reason and return it to Faculty.', header: 'bg-red-500 hover:bg-red-600' },
  { key: 'submitted', label: 'Submitted', hint: 'Faculty has submitted — verify, or check what Admin still needs.', header: 'bg-amber-500 hover:bg-amber-600' },
  // Green — same "fully done" color Admin's own Grade Approval page uses for
  // its own "Done" stage, so the color means the same thing on both pages.
  { key: 'done', label: 'Done', hint: 'Both documents verified and forwarded to Admin — nothing left to do here.', header: 'bg-green-500 hover:bg-green-600' },
];

// Year → Section nested containers — a Chairperson only ever sees their own
// program(s) anyway (server-scoped), so Program isn't worth its own nesting
// level here; Year is what actually varies and is worth being able to
// collapse into on its own, with Section as the sub-container underneath.
function groupByYearSection(classes) {
  const byYear = {};
  classes.forEach((c) => {
    const year = c.year_level ?? '—';
    const section = c.section || 'No Section';
    if (!byYear[year]) byYear[year] = {};
    if (!byYear[year][section]) byYear[year][section] = [];
    byYear[year][section].push(c);
  });
  return byYear;
}

// A verified document shows the badge only; an unverified one shows the
// badge — the two documents are independent, so each gets its own. Approve
// only happens from inside the preview now (see the Preview modal's own
// Approve button below), not as a shortcut from this row.
function DocCell({ cls, type, verified, hasSubmissions, onPreview }) {
  const icon = type === 'record' ? <Icons.Book /> : <Icons.FileText />;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      {verified
        ? <Badge variant="green"><Icons.Check className="w-3 h-3" /> Verified</Badge>
        : <Badge variant="gray">Not Verified</Badge>}
      <button className="btn-icon flex-shrink-0" onClick={() => onPreview(cls, type)} title={`Preview ${DOC[type].label}`}>
        {icon}
      </button>
      {!verified && !hasSubmissions && (
        <span className="text-[11px] text-gray-400 italic">Nothing submitted yet</span>
      )}
    </div>
  );
}

export default function GradingSheets() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  // Filters + collapsible state persist across navigation (usePageState).
  const [search, setSearch] = usePageState('ChairpersonGradingSheets.search', '');

  // Arriving from the Dashboard's "Faculty Submission Progress" row (or
  // anywhere else that wants to deep-link straight to one instructor's
  // classes) carries ?instructor=<name> — apply it as the search filter
  // once, then drop it from the URL so it doesn't fight the search box on
  // a later manual edit or a plain page refresh.
  useEffect(() => {
    const instructor = searchParams.get('instructor');
    if (instructor) {
      setSearch(instructor);
      setSearchParams({}, { replace: true });
    }
    // Deliberately runs once on mount only — re-running on every
    // searchParams/setSearch change would re-apply ?instructor= right after
    // it's cleared below, or after the chairperson has already edited the
    // search box by hand.
  }, []);
  const [programFilter, setProgramFilter] = usePageState('ChairpersonGradingSheets.programFilter', '');
  const [yearFilter, setYearFilter] = usePageState('ChairpersonGradingSheets.yearFilter', '');
  const [sectionFilter, setSectionFilter] = usePageState('ChairpersonGradingSheets.sectionFilter', '');

  const [openStages, setOpenStages] = usePageState('ChairpersonGradingSheets.openStages', {}); // every stage starts collapsed
  const [openGroups, setOpenGroups] = usePageState('ChairpersonGradingSheets.openGroups', {});
  const [openFacultyGroups, setOpenFacultyGroups] = usePageState('ChairpersonGradingSheets.openFacultyGroups', {});
  // Filters which faculty show up inside each expanded group's own list
  // below (name only) — doesn't touch the tile counts above it, those stay
  // the group's real totals regardless of what's currently searched for.
  const [facultySearch, setFacultySearch] = usePageState('ChairpersonGradingSheets.facultySearch', '');

  const [preview, setPreview] = useState(null); // { cls, type: 'record' | 'sheet' }
  const [approveTarget, setApproveTarget] = useState(null); // { cls, type }
  const [approving, setApproving] = useState(false);

  // "Return to Faculty" — the counterpart to Admin's "Send Back to
  // Chairperson". Class Record and Grade Sheet always move together, so this
  // acts on the whole class, not whichever document happens to be open.
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnMessage, setReturnMessage] = useState('');
  const [returning, setReturning] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);

  // "Return All to Faculty" — bulk counterpart in the "Returned by Admin"
  // container's own header: every class there already carries its own
  // admin_return_reason (that's what put it in this group), so bulk-sending
  // just forwards each one's own reason instead of asking for one message to
  // apply to every class regardless of what Admin actually flagged on each.
  const [showBulkReturnConfirm, setShowBulkReturnConfirm] = useState(false);
  const [bulkReturning, setBulkReturning] = useState(false);

  // Archive/Restore — a class only ever archives from "Done" (nothing left
  // to do here), tucking it into its own collapsed section out of the way
  // instead of leaving finished classes sitting in that list forever.
  const [archiving, setArchiving] = useState(null); // class id currently in flight
  const [archiveTarget, setArchiveTarget] = useState(null); // class about to be archived, pending confirm
  const [showArchived, setShowArchived] = usePageState('ChairpersonGradingSheets.showArchived', false);

  // Every actual Faculty account in this Chairperson's own program(s) — the
  // backend already scopes a Chairperson caller's User list to their own
  // programs, so this naturally stays "their" faculty only. Without this, a
  // Faculty with 0 classes in `classes` below (nothing assigned yet this
  // semester) never showed up in the Faculty completion widget at all.
  const [allFaculty, setAllFaculty] = useState([]);

  const loadAllFaculty = async () => {
    try {
      const { data } = await userService.getAll({ all: true, role: 'Faculty' });
      setAllFaculty(data.users || []);
    } catch (err) {
      toast.error('Failed to load faculty list');
    }
  };

  const load = async () => {
    try {
      const { data } = await classService.getAll({ limit: 200 });
      // Sent back to Faculty for revision — this is Faculty's problem now,
      // not the Chairperson's, so it stays off this page entirely (not shown
      // in "Not Yet Submitted" either) until Faculty resubmits.
      setClasses((data.classes || []).filter((c) => !c.awaiting_faculty_revision));
    } catch (err) {
      toast.error('Failed to load classes');
    } finally {
      setLoading(false);
    }
  };

  const handleArchiveToggle = async (cls, archived) => {
    setArchiving(cls.id);
    try {
      await classService.archive(cls.id, archived);
      toast.success(archived ? `${cls.subject?.code || 'Class'} archived.` : `${cls.subject?.code || 'Class'} restored.`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${archived ? 'archive' : 'restore'} this class`);
    } finally {
      setArchiving(null);
    }
  };

  useEffect(() => { load(); loadAllFaculty(); }, []);

  // Live refresh — Faculty submitting/resubmitting, or Admin approving/
  // returning a class, changes what belongs in which container here without
  // this page's own reload ever firing, so without this a Chairperson
  // sitting on this page wouldn't see it until they manually reloaded.
  useEffect(() => {
    const handler = () => load();
    socket.on('gradesUpdated', handler);
    return () => socket.off('gradesUpdated', handler);
  }, []);

  const openPreview = (cls, type) => {
    setPreview({ cls, type });
    setShowReturnForm(false);
    setReturnMessage('');
  };

  // Direct shortcut from the "Returned by Admin" container's own row button —
  // skips straight to the return form (pre-filled with Admin's own reason,
  // still editable) instead of making the Chairperson open the preview first.
  const openReturnFormDirect = (cls) => {
    setPreview({ cls, type: 'record' });
    setReturnMessage(cls.admin_return_reason || '');
    setShowReturnForm(true);
  };

  const closePreview = () => {
    setPreview(null);
    setShowReturnForm(false);
    setReturnMessage('');
  };

  const handleReturnToFaculty = async () => {
    if (!preview || !returnMessage.trim()) {
      toast.error('Explain what needs to be revised.');
      return;
    }
    try {
      setReturning(true);
      const { data } = await reportService.returnToFaculty(preview.cls.id, returnMessage.trim());
      toast.success(data.message);
      closePreview();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send this back to Faculty');
    } finally {
      setReturning(false);
    }
  };

  const handleBulkReturnToFaculty = async () => {
    const targets = byTopGroup.returned;
    if (targets.length === 0) { setShowBulkReturnConfirm(false); return; }
    setBulkReturning(true);
    try {
      const results = await Promise.allSettled(
        targets.map((c) => reportService.returnToFaculty(c.id, c.admin_return_reason || 'Admin found a problem with this Class Record/Grade Sheet — see your Grade Approval page for details.'))
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      const succeeded = results.length - failed;
      if (succeeded > 0) toast.success(`Returned ${succeeded} class${succeeded !== 1 ? 'es' : ''} to Faculty.`);
      if (failed > 0) toast.error(`Failed to return ${failed} class${failed !== 1 ? 'es' : ''} — try again.`);
      load();
    } finally {
      setBulkReturning(false);
      setShowBulkReturnConfirm(false);
    }
  };

  const handleApprove = async () => {
    const target = approveTarget;
    setApproveTarget(null);
    if (!target) return;
    try {
      setApproving(true);
      const { data } = await reportService.verifyDocument(target.cls.id, target.type);
      toast.success(data.message);
      closePreview();
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve this document');
    } finally {
      setApproving(false);
    }
  };

  // Scoped server-side to the Chairperson's own program(s) already
  // (classController.getClasses) — these options naturally cover only
  // what's relevant instead of listing every program in the system.
  const programOptions = useMemo(
    () => [...new Set(classes.map((c) => c.subject?.program).filter(Boolean))].sort(),
    [classes]
  );
  const availableSections = useMemo(
    () => [...new Set(classes.map((c) => c.section).filter(Boolean))].sort(),
    [classes]
  );

  // Archived classes (status flipped via the Archive button below) get their
  // own section entirely, out of the Pending/Submitted/Done pipeline view —
  // same `status !== 'Active'` concept Faculty's own Archive tab already
  // uses. Subject to the same search/Program/Year/Section filters as the
  // active pipeline view above it, not a separate unfiltered dump.
  const isArchived = (c) => c.status && c.status !== 'Active';
  const matchesFilters = (c) =>
    (!search ||
      c.subject?.code?.toLowerCase().includes(search.toLowerCase()) ||
      c.subject?.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.instructor?.name?.toLowerCase().includes(search.toLowerCase())) &&
    (!programFilter || c.subject?.program === programFilter) &&
    (!yearFilter || String(c.year_level) === yearFilter) &&
    (!sectionFilter || c.section === sectionFilter);

  const archivedList = classes.filter(isArchived).filter(matchesFilters);
  const filtered = classes.filter((c) => !isArchived(c)).filter(matchesFilters);

  const hasActiveFilters = !!(search || programFilter || yearFilter || sectionFilter);
  const clearFilters = () => {
    setSearch('');
    setProgramFilter('');
    setYearFilter('');
    setSectionFilter('');
  };

  const byTopGroup = { pending: [], returned: [], submitted: [], done: [] };
  filtered.forEach((c) => {
    const key = topGroupOf(c);
    byTopGroup[key].push(c);
  });

  // Faculty completion — "done submitting" here means the Faculty side of
  // the job, not this Chairperson's own verification: every one of an
  // instructor's classes currently in view has at least been submitted
  // (i.e. isn't sitting in "Pending Grades" — Submitted or Done both count),
  // same all-or-nothing rollup Admin's own Grade Approval page uses, just
  // against a different stage since a Chairperson doesn't approve, only
  // verifies. Broken out by Program, Part-Time faculty in their own "Part
  // Timer" tile instead of one program (they're tagged with every program a
  // Chairperson might see, so filing them under one would misrepresent it).
  const facultyByInstructor = {};
  filtered.forEach((c) => {
    if (!c.instructor) return;
    if (!facultyByInstructor[c.instructor.id]) facultyByInstructor[c.instructor.id] = { instructor: c.instructor, classes: [] };
    facultyByInstructor[c.instructor.id].classes.push(c);
  });
  // Merge the full Faculty roster (allFaculty — every Faculty tagged for
  // this Chairperson's own program(s), backend-scoped by user.programs)
  // with the per-class data above (facultyByInstructor — every instructor
  // who actually has a class in `classes`, which is scoped by the CLASS's
  // own subject program instead). The two scopes can disagree — cross-
  // program teaching means a Faculty tagged for a different program
  // entirely can still be teaching a subject that belongs here — so
  // starting from allFaculty alone and only looking up matches silently
  // dropped any such instructor's class from this whole page: they're not
  // in allFaculty, so mapping over just that list never visits them.
  // Unioning both id sets is what actually catches them. A Faculty with 0
  // classes right now still shows up too, just with an empty classes array.
  const facultyIds = new Set([...allFaculty.map((u) => u.id), ...Object.keys(facultyByInstructor).map(Number)]);
  const facultyById = Object.fromEntries(allFaculty.map((u) => [u.id, u]));
  const facultyList = [...facultyIds].map((id) =>
    facultyByInstructor[id] || { instructor: facultyById[id], classes: [] }
  );
  const facultySent = (f) => f.classes.length > 0 && f.classes.every((c) => topGroupOf(c) !== 'pending');
  const facultyDoneCount = facultyList.filter(facultySent).length;
  // "Passed" here means fully verified and forwarded to Admin — as far as
  // THIS Chairperson's own job on it goes (Admin still has its own approval
  // step afterward), same all-or-nothing rule.
  const facultyPassed = (f) => f.classes.length > 0 && f.classes.every((c) => topGroupOf(c) === 'done');
  const facultyPassedCount = facultyList.filter(facultyPassed).length;

  const facultyPartTime = facultyList.filter((f) => f.instructor.employment_type === 'Part Time');
  const facultyFullTime = facultyList.filter((f) => f.instructor.employment_type !== 'Part Time');

  // Cross-program teaching — a Faculty tagged for a different program
  // entirely (not in allFaculty, i.e. their own `programs` doesn't overlap
  // this Chairperson's) who still has a class here, because that class's
  // own subject belongs to this Chairperson's program even though its
  // instructor doesn't. Filed under their OWN actual program tag, in its
  // own separate container — same reasoning Part-Time already gets pulled
  // into its own tile for: putting them in this Chairperson's "BSIT" bucket
  // (say) would misrepresent them as BSIT faculty when they're actually
  // BSIS, just teaching a class here.
  //
  // `allFaculty` is fetched with role: 'Faculty' only, so a Chairperson who
  // is_teaching a class in their OWN overseen program was falling through
  // this same "not in allFaculty" check (their account is role Chairperson,
  // never in that list) and landing in crossProgramFaculty — mislabeled
  // "(Teaching Here)" as if they were foreign faculty borrowing a slot. They
  // chair that program, so their own account counts as "own faculty" here
  // too — same BSIT bucket as everyone else they oversee, no special label.
  const ownFacultyIds = new Set([...allFaculty.map((u) => u.id), ...(user ? [user.id] : [])]);
  const crossProgramFaculty = facultyFullTime.filter((f) => !ownFacultyIds.has(f.instructor.id));
  const ownFullTime = facultyFullTime.filter((f) => ownFacultyIds.has(f.instructor.id));

  const facultyByProgram = {};
  ownFullTime.forEach((f) => {
    // Tag by the program(s) of the classes actually in this Chairperson's own
    // queue (not the instructor's full `programs` list, which can include
    // other programs this Chairperson doesn't oversee — e.g. a faculty who
    // also teaches GE or a second program elsewhere). `classes` is already
    // scoped server-side to this Chairperson's own program(s), so deriving
    // tags from the visible classes naturally keeps this to "their" programs.
    // A faculty with 0 classes has nothing to derive from, so falls back to
    // their account's own `programs` list (also backend-scoped to this
    // Chairperson already, via the allFaculty fetch above).
    const classTags = [...new Set(f.classes.map((c) => c.subject?.program).filter(Boolean))];
    const tags = classTags.length > 0 ? classTags : (f.instructor.programs?.length > 0 ? f.instructor.programs : ['Unassigned']);
    tags.forEach((tag) => {
      if (!facultyByProgram[tag]) facultyByProgram[tag] = [];
      facultyByProgram[tag].push(f);
    });
  });

  const crossProgramByProgram = {};
  crossProgramFaculty.forEach((f) => {
    // Same reasoning as facultyByProgram above: tag by the program(s) of the
    // classes actually visible here, not the instructor's whole `programs`
    // list — a foreign faculty tagged for BOTH BSIS and GE (say) but only
    // teaching a BSIS class in this queue was otherwise showing up in BOTH
    // the "BSIS (Teaching Here)" AND "GE (Teaching Here)" tiles, duplicated
    // under a program they aren't actually teaching here at all.
    const classTags = [...new Set(f.classes.map((c) => c.subject?.program).filter(Boolean))];
    const tags = classTags.length > 0 ? classTags : (f.instructor.programs?.length > 0 ? f.instructor.programs : ['Other Program']);
    tags.forEach((tag) => {
      if (!crossProgramByProgram[tag]) crossProgramByProgram[tag] = [];
      crossProgramByProgram[tag].push(f);
    });
  });

  const facultyGroups = [
    ...Object.entries(facultyByProgram).sort(([a], [b]) => a.localeCompare(b)).map(([program, list]) => ({ key: program, label: programShortLabel(program), program, list })),
    // Own container per foreign program tag, distinguished with a small
    // "teaching here" suffix so it never reads as if this Chairperson
    // actually oversees that program.
    ...Object.entries(crossProgramByProgram).sort(([a], [b]) => a.localeCompare(b)).map(([program, list]) => ({ key: `cross:${program}`, label: `${programShortLabel(program)} (Teaching Here)`, program, list })),
    ...(facultyPartTime.length > 0 ? [{ key: 'part_time', label: 'Part Timer', list: facultyPartTime }] : []),
  ];

  const toggleStage = (key) => setOpenStages((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleGroup = (key) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleFacultyGroup = (key) => setOpenFacultyGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  if (loading) return <LoadingSpinner />;

  const previewDoc = preview && DOC[preview.type];
  const previewVerified = preview && !!preview.cls[previewDoc.field];
  const previewHasSubmissions = preview && (preview.cls.submitted_count ?? 0) > 0;

  // `showActionCol` is passed per-table (true if ANY row in this section has
  // an Admin return reason, OR the whole section is the Done stage) rather
  // than derived per-row, so every row in the table keeps the same column
  // count. Archive is only ever offered once a class is actually Done
  // (Faculty submitted, both documents verified and forwarded to Admin) —
  // not on something still Pending or merely Submitted-but-unverified.
  const renderRow = (c, showActionCol, isDoneStage) => (
    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
      {/* Program only — Year is now the outer container's own header
          (groupByYearSection), so it doesn't need repeating on every row. */}
      <td className="px-4 py-3.5 align-top whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <ProgramDot program={c.subject?.program} />
          <span className="text-xs font-semibold text-gray-600">{programShortLabel(c.subject?.program)}</span>
        </div>
      </td>
      <td className="px-4 py-3.5 align-top">
        <p className="font-semibold text-[13px] text-navy whitespace-nowrap">{c.subject?.code}</p>
        <p className="text-gray-500 text-xs">{c.subject?.name}</p>
        {c.admin_return_reason && (
          <p className="text-[11px] text-red-600 mt-1 max-w-xs">
            <Icons.AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
            Admin: "{c.admin_return_reason}"
          </p>
        )}
      </td>
      {/* `c.semester` already bakes the academic year in ("First Semester
          2026-2027") — appending c.academic_year again duplicated it into
          "First Semester 2026-2027 2026-2027" whenever both were set. */}
      <td className="px-4 py-3.5 text-xs align-top whitespace-nowrap">{c.semester}</td>
      <td className="px-4 py-3.5 text-[13px] align-top">
        <div>{c.instructor?.name || '—'}</div>
        {c.instructor && (
          <div className="mt-1 flex flex-wrap gap-1">
            <FacultyProgramTags user={c.instructor} />
          </div>
        )}
      </td>
      <td className="px-4 py-3.5 text-[13px] align-top text-center">{c.student_count ?? 0}</td>
      <td className="px-4 py-3.5 align-top">
        <DocCell cls={c} type="record" verified={c.class_record_verified} hasSubmissions={(c.submitted_count ?? 0) > 0} onPreview={openPreview} />
      </td>
      <td className="px-4 py-3.5 align-top">
        <DocCell cls={c} type="sheet" verified={c.grade_sheet_verified} hasSubmissions={(c.submitted_count ?? 0) > 0} onPreview={openPreview} />
      </td>
      {showActionCol && (
        <td className="px-4 py-3.5 align-top">
          <div className="flex flex-col items-center gap-1.5">
            {c.admin_return_reason && (
              <button className="btn btn-red btn-sm whitespace-nowrap" onClick={() => openReturnFormDirect(c)}>
                <Icons.Send className="w-3.5 h-3.5" /> Return to Faculty
              </button>
            )}
            {isDoneStage && (
              <button
                className="btn btn-outline btn-sm whitespace-nowrap"
                onClick={() => setArchiveTarget(c)}
                disabled={archiving === c.id}
                title="Move this class to Archived"
              >
                <Icons.Archive className="w-3.5 h-3.5" /> {archiving === c.id ? 'Archiving...' : 'Archive'}
              </button>
            )}
          </div>
        </td>
      )}
    </tr>
  );

  const renderTopGroup = (group) => {
    const groupClasses = byTopGroup[group.key];
    if (groupClasses.length === 0) return null;
    // Active filters (search included, e.g. arriving via ?instructor= from
    // the Dashboard) already narrowed groupClasses down to matches only, so
    // auto-expanding straight through every level below is safe — nothing
    // irrelevant gets pulled open along with it. Falls back to whatever the
    // chairperson last toggled by hand once filters are cleared again.
    const groupOpen = !!openStages[group.key] || hasActiveFilters;
    const years = groupByYearSection(groupClasses);
    const yearKeys = Object.keys(years).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a - b));
    const isDoneStage = group.key === 'done';

    return (
      <div key={group.key} className="card overflow-hidden mb-5">
        <div className={`w-full px-5 py-3.5 flex items-center justify-between gap-3 text-white transition-colors ${group.header}`}>
          <button
            onClick={() => toggleStage(group.key)}
            className="flex-1 min-w-0 flex items-center gap-3 border-none bg-transparent cursor-pointer font-sans text-white text-left p-0"
          >
            <span className="text-sm font-bold bg-white/20 rounded-full min-w-[26px] h-[26px] px-2 flex items-center justify-center flex-shrink-0">{groupClasses.length}</span>
            <div>
              <p className="text-sm font-bold">{group.label}</p>
              <p className="text-[11px] text-white/75">{group.hint}</p>
            </div>
          </button>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Bulk counterpart to each row's own "Return to Faculty" —
                only makes sense on this group, where every class already
                carries its own admin_return_reason to forward. */}
            {group.key === 'returned' && (
              <button
                className="btn btn-sm bg-white !text-red-600 hover:bg-red-50 whitespace-nowrap"
                onClick={() => setShowBulkReturnConfirm(true)}
                disabled={bulkReturning}
              >
                <Icons.Send className="w-3.5 h-3.5" /> Return All to Faculty
              </button>
            )}
            <button
              onClick={() => toggleStage(group.key)}
              className="border-none bg-transparent cursor-pointer text-white p-0 flex items-center"
              title={groupOpen ? 'Collapse' : 'Expand'}
            >
              {groupOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {groupOpen && (
          <div className="border-t border-gray-100">
            {yearKeys.map((year) => {
              const sections = years[year];
              const yearTotal = Object.values(sections).reduce((s, arr) => s + arr.length, 0);
              const yearKey = `${group.key}|${year}`;
              const yearOpen = !!openGroups[yearKey] || hasActiveFilters;
              const sectionKeys = Object.keys(sections).sort();
              return (
                <div key={year} className="border-b border-gray-50 last:border-0">
                  <button
                    onClick={() => toggleGroup(yearKey)}
                    className="w-full px-5 py-2.5 flex items-center justify-between border-none cursor-pointer font-sans bg-blue-50/30 hover:bg-blue-50/60 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-semibold text-blue-700">{year === '—' ? 'No Year Level' : `Year ${year}`}</span>
                      <span className="text-xs text-gray-400">{yearTotal} class{yearTotal !== 1 ? 'es' : ''}</span>
                    </div>
                    {yearOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                  </button>

                  {yearOpen && sectionKeys.map((section) => {
                    const secClasses = sections[section];
                    const secKey = `${yearKey}|${section}`;
                    const secOpen = !!openGroups[secKey] || hasActiveFilters;
                    const hasReturned = !isDoneStage && secClasses.some((c) => !!c.admin_return_reason);
                    const showActionCol = isDoneStage || hasReturned;
                    return (
                      <div key={section} className="border-t border-gray-50">
                        <button
                          onClick={() => toggleGroup(secKey)}
                          className="w-full pl-9 pr-5 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-navy hover:opacity-95 transition-opacity"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="text-sm font-bold text-white">{section === 'No Section' ? section : `Section ${section}`}</span>
                            <span className="text-xs text-white/70">{secClasses.length} class{secClasses.length !== 1 ? 'es' : ''}</span>
                          </div>
                          {secOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-white" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-white" />}
                        </button>

                        {secOpen && (
                          <div className="overflow-x-auto">
                            <table className="w-full border-separate border-spacing-0">
                              <thead>
                                <tr className="bg-gray-50 text-gray-500">
                                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Program</th>
                                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Subject</th>
                                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Semester</th>
                                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Faculty</th>
                                  <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Students</th>
                                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Class Record</th>
                                  <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Grade Sheet</th>
                                  {showActionCol && <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Action</th>}
                                </tr>
                              </thead>
                              <tbody>{secClasses.map((c) => renderRow(c, showActionCol, isDoneStage))}</tbody>
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
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Grade Approval</h2>
        <p className="text-[13px] text-gray-500">
          Approve each class's Class Record and Grade Sheet — once both are approved, it forwards to Admin automatically.
        </p>
      </div>

      {/* Faculty completion — a faculty only counts as "done" once every one
          of their classes currently in view has at least been submitted
          (Submitted or Done — not sitting in Pending Grades), broken out by
          Program with Part-Time faculty in their own "Part Timer" group.
          Mirrors Admin's Grade Approval page. Static — no expand/collapse;
          the whole point is to see everyone at a glance. */}
      {facultyList.length > 0 && (
        <div className="card p-4 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${facultyDoneCount === facultyList.length ? 'bg-green-50 text-green-500' : 'bg-amber-50 text-amber-500'}`}>
              <Icons.Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-navy leading-snug">
                {facultyDoneCount}/{facultyList.length} faculty done submitting · {facultyPassedCount}/{facultyList.length} fully verified
              </p>
              <p className="text-xs text-gray-400 leading-snug mt-0.5">Submitted = Faculty sent every class. Verified = you've forwarded every class to Admin.</p>
            </div>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {facultyGroups.map((g) => {
              const done = g.list.filter((f) => facultySent(f)).length;
              const passed = g.list.filter(facultyPassed).length;
              const total = g.list.length;
              const complete = total > 0 && done === total;
              const allPassed = total > 0 && passed === total;
              // Total classes this program's faculty are carrying — a
              // faculty only counts as "done" once ALL of their classes are
              // in (unchanged all-or-nothing rule above), but the class
              // count itself is what that "all" actually means for this
              // group, so it's worth showing alongside the faculty count.
              const classCount = g.list.reduce((sum, f) => sum + f.classes.length, 0);
              // Jumps to (and opens) this program's own dropdown in the
              // "Every group's own faculty" list further down the card,
              // instead of leaving the tile purely informational and making
              // the chairperson go hunt for the matching group by hand.
              const openGroupBelow = () => {
                setOpenFacultyGroups((prev) => ({ ...prev, [g.key]: true }));
                document.getElementById(`faculty-group-${g.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              };
              return (
                <div
                  key={g.key}
                  className="border border-gray-100 rounded-lg p-3 min-w-0 cursor-pointer hover:border-navy/30 hover:shadow-sm transition-all"
                  role="button"
                  tabIndex={0}
                  onClick={openGroupBelow}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGroupBelow(); } }}
                  title={`View ${g.label} faculty`}
                >
                  <div className="flex items-center gap-1.5 mb-2 min-w-0">
                    {g.key === 'part_time'
                      ? <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 inline-block" />
                      : <ProgramDot program={g.program} />}
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">{g.label}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mb-1.5">{total} faculty · {classCount} class{classCount !== 1 ? 'es' : ''} total</p>

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">Submitted</span>
                    <span className={`text-xs font-bold ${complete ? 'text-green-600' : 'text-navy'}`}>{done}/{total}</span>
                  </div>
                  <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mt-1 mb-2">
                    <div className={`h-full rounded-full ${complete ? 'bg-green-500' : 'bg-amber-400'}`} style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500 uppercase tracking-wide">Verified</span>
                    <span className={`text-xs font-bold ${allPassed ? 'text-green-600' : 'text-navy'}`}>{passed}/{total}</span>
                  </div>
                  <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden mt-1 mb-2">
                    <div className={`h-full rounded-full ${allPassed ? 'bg-green-500' : 'bg-blue-400'}`} style={{ width: `${total > 0 ? (passed / total) * 100 : 0}%` }} />
                  </div>

                  {/* Spelled out explicitly, not just left to the ratio above
                      — the whole point of the tile is answering "how many
                      have passed and how many haven't, per program" at a
                      glance. */}
                  <div className="flex items-center gap-3 pt-1 border-t border-gray-50">
                    <span className="flex items-center gap-1 text-[11px] text-green-600 font-medium">
                      <Icons.Check className="w-3 h-3" /> {passed} passed
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-gray-400 font-medium">
                      <Icons.Clock className="w-3 h-3" /> {total - passed} not yet
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Every group's own faculty, each with how many classes they
              personally handle — the tile above only gives the group's
              totals, this dropdown is what makes up that "N faculty · M
              classes". Collapsed by default, one per program. facultyGroups
              is already scoped to this Chairperson's own program(s), so
              there's no 0-faculty program to filter out here the way
              Admin's page has to — this just guards the shape in case that
              ever changes. */}
          {facultyList.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <SearchBar value={facultySearch} onChange={setFacultySearch} placeholder="Search faculty by name..." />
            </div>
          )}
          {facultyGroups.map((g) => {
            const visibleList = g.list
              .slice()
              .sort(comparePeopleNames)
              .filter((f) => !facultySearch || formatPersonName(f.instructor.name)?.toLowerCase().includes(facultySearch.toLowerCase()));
            // A search match auto-expands its own program's group — so
            // finding someone surfaces which program they're under without
            // having to click open every group to check. Falls back to
            // whatever the user last toggled manually once the search box
            // is cleared again.
            const facultyOpen = (facultySearch && visibleList.length > 0) || !!openFacultyGroups[g.key];
            const dot = g.key === 'part_time'
              ? <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 inline-block" />
              : <ProgramDot program={g.program} />;
            if (g.list.length === 0) {
              return (
                <div key={`${g.key}-faculty`} id={`faculty-group-${g.key}`} className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-1.5">
                  {dot}
                  <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">{g.label} — no faculty yet</span>
                </div>
              );
            }
            return (
            <div key={`${g.key}-faculty`} id={`faculty-group-${g.key}`} className="mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => toggleFacultyGroup(g.key)}
                className="w-full flex items-center justify-between mb-2 border-none bg-transparent cursor-pointer p-0"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {dot}
                  {g.label} — {g.list.length} faculty
                </span>
                {facultyOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </button>
              {facultyOpen && (
              visibleList.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-2">No faculty match "{facultySearch}".</p>
              ) : (
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {visibleList
                  .map((f) => {
                    const sent = facultySent(f);
                    const passed = facultyPassed(f);
                    // Partial progress, not just the all-or-nothing badges
                    // beside it — a faculty with 5 classes and 3 submitted
                    // reads as "3/5", not just an undifferentiated "5 classes".
                    const classesSubmitted = f.classes.filter((c) => topGroupOf(c) !== 'pending').length;
                    const classesVerified = f.classes.filter((c) => topGroupOf(c) === 'done').length;
                    return (
                      <div key={f.instructor.id} className="px-3 py-2 rounded-lg border border-gray-100">
                        <div className="flex items-center gap-3">
                          <Avatar letter={f.instructor.avatar || f.instructor.name?.[0]} className="bg-purple-500 text-white flex-shrink-0" size="w-8 h-8 text-xs" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium truncate">{formatPersonName(f.instructor.name)}</p>
                              {/* This faculty's OWN program tag(s) — e.g. a
                                  BSIS instructor who's shown here under the
                                  "GE (Teaching Here)" tile because they teach
                                  a GE class in this queue still reads as BSIS
                                  by tag, with GE alongside it if they're
                                  tagged for that too. */}
                              <FacultyProgramTags user={f.instructor} />
                            </div>
                            <p className="text-[11px] text-gray-400">{f.classes.length} class{f.classes.length !== 1 ? 'es' : ''} handled</p>
                          </div>
                          <Badge variant={sent ? 'green' : 'gray'} className="flex-shrink-0" title={sent ? 'Every class submitted' : 'Not every class submitted yet'}>
                            {sent && <Icons.Check className="w-3 h-3" />} {classesSubmitted}/{f.classes.length} submitted
                          </Badge>
                          <Badge variant={passed ? 'green' : 'gray'} className="flex-shrink-0" title={passed ? 'Every class verified' : 'Not every class verified yet'}>
                            {passed && <Icons.Check className="w-3 h-3" />} {classesVerified}/{f.classes.length} verified
                          </Badge>
                        </div>
                        {/* The actual classes this faculty created/is
                            teaching — not just the count above — each its own
                            chip so it's visible which specific class is still
                            holding up an otherwise-incomplete faculty. */}
                        {f.classes.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mt-2 pl-11">
                            {/* Sorted Year → Section → Subject, same reading
                                order every other Program/Year/Section
                                container on this page already groups by,
                                instead of whatever order the classes
                                happened to load in. */}
                            {f.classes.slice().sort((a, b) =>
                              (a.year_level ?? 0) - (b.year_level ?? 0) ||
                              String(a.section ?? '').localeCompare(String(b.section ?? '')) ||
                              String(a.subject?.code ?? '').localeCompare(String(b.subject?.code ?? ''))
                            ).map((c) => {
                              const stage = topGroupOf(c);
                              return (
                                <span
                                  key={c.id}
                                  title={`${c.subject?.name || c.subject?.code}${c.section ? ` · Section ${c.section}` : ''}${c.year_level ? ` · Year ${c.year_level}` : ''}`}
                                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                                    stage === 'done'
                                      ? 'bg-green-50 border-green-200 text-green-700'
                                      : stage === 'returned'
                                        ? 'bg-red-50 border-red-200 text-red-700'
                                        : stage === 'submitted'
                                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                                          : 'bg-gray-50 border-gray-200 text-gray-500'
                                  }`}
                                >
                                  {stage === 'done' && <Icons.Check className="w-2.5 h-2.5" />}
                                  {stage === 'returned' && <Icons.AlertTriangle className="w-2.5 h-2.5" />}
                                  {c.subject?.code}{c.year_level ? ` · Y${c.year_level}` : ''}{c.section ? ` · ${c.section}` : ''}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-300 mt-1.5 pl-11">No class in your program(s) this semester</p>
                        )}
                      </div>
                    );
                  })}
              </div>
              )
              )}
            </div>
            );
          })}
        </div>
      )}

      <div className="card p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <SearchBar value={search} onChange={setSearch} placeholder="Search by subject, course title, or instructor..." />
          </div>
          {programOptions.length > 1 && (
            <select
              className="form-select text-sm py-2.5 w-full truncate"
              value={programFilter}
              onChange={(e) => setProgramFilter(e.target.value)}
              title={programFilter || 'All Programs'}
            >
              <option value="">All Programs</option>
              {programOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          <select className="form-select text-sm py-2.5 w-full" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
            <option value="">All Years</option>
            {YEAR_LEVELS.map((y) => <option key={y} value={y}>Year {y}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <select className="form-select text-sm py-2.5 w-full" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
              <option value="">All Sections</option>
              {availableSections.map((s) => <option key={s} value={s}>Section {s}</option>)}
            </select>
            {hasActiveFilters && (
              <button className="btn-icon flex-shrink-0" onClick={clearFilters} title="Clear all filters">
                <Icons.X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center py-14 text-gray-400 text-sm">
          <Icons.FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          {hasActiveFilters ? (
            <>
              No classes match your filters.{' '}
              <button className="text-navy font-medium underline underline-offset-2" onClick={clearFilters}>Clear filters</button>
            </>
          ) : 'No classes found.'}
        </div>
      ) : (
        TOP_GROUPS.map(renderTopGroup)
      )}

      {/* ARCHIVED — classes Archived from the Done section above, tucked away
          behind its own collapsed toggle instead of a permanently-visible
          section, since most visits have nothing to do here. */}
      {archivedList.length > 0 && (
        <div className="card overflow-hidden mb-5">
          <button
            onClick={() => setShowArchived((v) => !v)}
            className="w-full px-5 py-3.5 flex items-center justify-between border-none cursor-pointer font-sans text-white transition-colors bg-gray-400 hover:bg-gray-500"
          >
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold bg-white/20 rounded-full min-w-[26px] h-[26px] px-2 flex items-center justify-center">{archivedList.length}</span>
              <div className="text-left">
                <p className="text-sm font-bold flex items-center gap-1.5"><Icons.Archive className="w-3.5 h-3.5" /> Archived</p>
                <p className="text-[11px] text-white/75">Classes tucked away from the active pipeline view.</p>
              </div>
            </div>
            {showArchived ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
          </button>
          {/* Program → Year → Section nesting, same three-level shape the
              cross-program containers elsewhere on this page already use —
              a Chairperson overseeing more than one program (or with
              cross-program classes archived alongside their own) could
              otherwise have a single Year bucket silently span several
              programs with no way to tell them apart short of opening every
              section underneath. */}
          {showArchived && (() => {
            const byProgram = {};
            archivedList.forEach((c) => {
              const program = c.subject?.program || 'No Program';
              if (!byProgram[program]) byProgram[program] = [];
              byProgram[program].push(c);
            });
            const programKeys = Object.keys(byProgram).sort((a, b) => (a === 'No Program' ? 1 : b === 'No Program' ? -1 : a.localeCompare(b)));
            return (
              <div className="border-t border-gray-100">
                {programKeys.map((program) => {
                  const programClasses = byProgram[program];
                  const programKey = `archived|${program}`;
                  const programOpen = !!openGroups[programKey];
                  const years = groupByYearSection(programClasses);
                  const yearKeys = Object.keys(years).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a - b));
                  return (
                    <div key={program} className="border-b border-gray-100 last:border-0">
                      <button
                        onClick={() => toggleGroup(programKey)}
                        className="w-full px-5 py-2.5 flex items-center justify-between border-none cursor-pointer font-sans bg-gray-100 hover:bg-gray-200 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          {program !== 'No Program' && <ProgramDot program={program} />}
                          <span className="text-sm font-bold text-navy">{program === 'No Program' ? program : programShortLabel(program)}</span>
                          <span className="text-xs text-gray-400">{programClasses.length} class{programClasses.length !== 1 ? 'es' : ''}</span>
                        </div>
                        {programOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                      </button>

                      {programOpen && yearKeys.map((year) => {
                        const sections = years[year];
                        const yearTotal = Object.values(sections).reduce((s, arr) => s + arr.length, 0);
                        const yearKey = `${programKey}|${year}`;
                        const yearOpen = !!openGroups[yearKey];
                        const sectionKeys = Object.keys(sections).sort();
                        return (
                          <div key={year} className="border-t border-gray-50">
                            <button
                              onClick={() => toggleGroup(yearKey)}
                              className="w-full pl-9 pr-5 py-2.5 flex items-center justify-between border-none cursor-pointer font-sans bg-blue-50/30 hover:bg-blue-50/60 transition-colors"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="text-sm font-semibold text-blue-700">{year === '—' ? 'No Year Level' : `Year ${year}`}</span>
                                <span className="text-xs text-gray-400">{yearTotal} class{yearTotal !== 1 ? 'es' : ''}</span>
                              </div>
                              {yearOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                            </button>

                            {yearOpen && sectionKeys.map((section) => {
                              const secClasses = sections[section];
                              const secKey = `${yearKey}|${section}`;
                              const secOpen = !!openGroups[secKey];
                              return (
                                <div key={section} className="border-t border-gray-50">
                                  <button
                                    onClick={() => toggleGroup(secKey)}
                                    className="w-full pl-14 pr-5 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-navy hover:opacity-95 transition-opacity"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <span className="text-sm font-bold text-white">{section === 'No Section' ? section : `Section ${section}`}</span>
                                      <span className="text-xs text-white/70">{secClasses.length} class{secClasses.length !== 1 ? 'es' : ''}</span>
                                    </div>
                                    {secOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-white" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-white" />}
                                  </button>
                                  {secOpen && (
                                    <div className="divide-y divide-gray-50">
                                      {secClasses.map((c) => (
                                        <div key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <ProgramDot program={c.subject?.program} />
                                            <div className="min-w-0">
                                              <p className="text-sm font-semibold text-navy truncate">{c.subject?.code}</p>
                                              <p className="text-xs text-gray-400 truncate">{c.subject?.name} · {c.semester}</p>
                                              <p className="text-xs text-gray-500 truncate">{c.instructor?.name || 'No instructor'}</p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {/* Archiving only ever happens from Done — both documents are
                                                already verified — so these are always just previews, same
                                                read-only iframe modal the active rows use. */}
                                            <button className="btn-icon" onClick={() => openPreview(c, 'record')} title="Preview Class Record">
                                              <Icons.Book className="w-4 h-4" />
                                            </button>
                                            <button className="btn-icon" onClick={() => openPreview(c, 'sheet')} title="Preview Grade Sheet">
                                              <Icons.FileText className="w-4 h-4" />
                                            </button>
                                            <button
                                              className="btn btn-outline btn-sm"
                                              onClick={() => handleArchiveToggle(c, false)}
                                              disabled={archiving === c.id}
                                            >
                                              <Icons.RotateCcw className="w-3.5 h-3.5" /> {archiving === c.id ? 'Restoring...' : 'Restore'}
                                            </button>
                                          </div>
                                        </div>
                                      ))}
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
          })()}
        </div>
      )}

      {/* PREVIEW MODAL — Class Record or Grade Sheet, embedded live instead of
          opening a new tab. Approving applies to just the document currently
          open; Return to Faculty always acts on the whole class (both
          documents move together) regardless of which one's open. */}
      {preview && (
        <Modal
          title={`${previewDoc.label} — ${preview.cls.subject?.code}${preview.cls.section ? ` Sec ${preview.cls.section}` : ''}`}
          onClose={closePreview}
          size="max-w-5xl"
          footer={
            showReturnForm ? (
              <>
                <button className="btn btn-outline" onClick={() => setShowReturnForm(false)} disabled={returning}>Cancel</button>
                <button className="btn btn-red" onClick={() => setConfirmReturn(true)} disabled={returning || !returnMessage.trim()}>
                  <Icons.Send className="w-4 h-4" /> {returning ? 'Sending...' : 'Send Back'}
                </button>
              </>
            ) : (
              <>
                {previewVerified ? (
                  <Badge variant="green"><Icons.Check className="w-3 h-3" /> Verified</Badge>
                ) : previewHasSubmissions ? (
                  <button className="btn btn-gold" onClick={() => setApproveTarget({ cls: preview.cls, type: preview.type })} disabled={approving} title={`Approve the ${previewDoc.label}`}>
                    <Icons.Check className="w-4 h-4" /> Approve
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 italic">Nothing submitted yet</span>
                )}
                {!preview.cls.chairperson_verified && (
                  <button
                    className="btn btn-outline !text-red-500 !border-red-200 hover:!bg-red-50"
                    onClick={() => { setReturnMessage(preview.cls.admin_return_reason || ''); setShowReturnForm(true); }}
                  >
                    <Icons.AlertTriangle className="w-4 h-4" /> Return to Faculty
                  </button>
                )}
              </>
            )
          }
        >
          {showReturnForm ? (
            <div>
              <p className="text-[13px] text-gray-500 mb-3">
                This sends BOTH the Class Record and Grade Sheet back to {preview.cls.instructor?.name || 'the instructor'} for
                revision — they always move together. Every grade unlocks for editing, and once resubmitted it goes through
                Chairperson and Admin review again from the start.
              </p>
              <label className="form-label">What needs to be revised? <span className="text-red-500">*</span></label>
              <textarea
                className="form-input"
                rows={4}
                value={returnMessage}
                onChange={(e) => setReturnMessage(e.target.value)}
                placeholder="e.g. Grade for student X looks incorrect — please double-check the Midterm score."
                autoFocus
              />
            </div>
          ) : (
            <iframe
              key={`${preview.cls.id}-${preview.type}`}
              src={`${previewDoc.path}/${preview.cls.id}?preview=1`}
              title="Document preview"
              style={{ width: '100%', height: '65vh', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
            />
          )}
        </Modal>
      )}

      {confirmReturn && (
        <ConfirmDialog
          title="Send back to Faculty?"
          message={`This un-verifies the ${previewDoc.label} for ${preview?.cls.subject?.code || 'this class'} and unlocks every grade in it for the instructor to re-edit. It goes through Chairperson and Admin review again once resubmitted. Reason: "${returnMessage.trim()}"`}
          confirmText={returning ? 'Sending...' : 'Send Back'}
          variant="red"
          confirmDisabled={returning}
          onConfirm={async () => { setConfirmReturn(false); await handleReturnToFaculty(); }}
          onCancel={() => setConfirmReturn(false)}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          title="Archive this class?"
          message={`${archiveTarget.subject?.code || 'This class'}${archiveTarget.section ? ` - Section ${archiveTarget.section}` : ''} will move out of this list into Archived. You can restore it from there later.`}
          confirmText={archiving === archiveTarget.id ? 'Archiving...' : 'Archive'}
          variant="gold"
          confirmDisabled={archiving === archiveTarget.id}
          onConfirm={async () => { const cls = archiveTarget; setArchiveTarget(null); await handleArchiveToggle(cls, true); }}
          onCancel={() => setArchiveTarget(null)}
        />
      )}

      {showBulkReturnConfirm && (
        <ConfirmDialog
          title="Return All to Faculty"
          message={`Return all ${byTopGroup.returned.length} class${byTopGroup.returned.length !== 1 ? 'es' : ''} in "Returned by Admin" to their instructors? Each one goes back with Admin's own reason already attached — every grade unlocks for editing, and once resubmitted it goes through Chairperson and Admin review again from the start.`}
          confirmText={bulkReturning ? 'Sending...' : 'Return All'}
          variant="red"
          confirmDisabled={bulkReturning}
          onConfirm={handleBulkReturnToFaculty}
          onCancel={() => setShowBulkReturnConfirm(false)}
        />
      )}

      {approveTarget && (
        <ConfirmDialog
          title={`Approve ${DOC[approveTarget.type].label}`}
          message={`Approve the ${DOC[approveTarget.type].label} for ${approveTarget.cls.subject?.code || 'this class'}${approveTarget.cls.section ? ` - Section ${approveTarget.cls.section}` : ''}? Once both the Class Record and Grade Sheet are approved, this class forwards to Admin automatically.`}
          confirmText={approving ? 'Approving...' : 'Approve'}
          variant="green"
          confirmDisabled={approving}
          onConfirm={handleApprove}
          onCancel={() => setApproveTarget(null)}
        />
      )}
    </>
  );
}
