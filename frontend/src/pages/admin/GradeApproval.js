import { useState, useEffect, useMemo } from 'react';
import { Icons, Avatar, Badge, SearchBar, LoadingSpinner, FacultyProgramTags, Modal, ConfirmDialog, ProgramDot, programShortLabel, comparePeopleNames, formatPersonName, groupBySemester } from '../../components/common';
import { classService, reportService, gradeService, dashboardService, userService } from '../../services';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';
import { useSearchParams } from 'react-router-dom';
import { EncodingProgress } from '../../components/common/FacultyProgressRow';
import { onGradesUpdated } from '../../services/socket';
import FloatingPanel from '../../components/common/FloatingPanel';

const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];
const YEAR_LEVELS = [1, 2, 3, 4];

// Excluded from grouping (same as UserManagement.js) — GE is a bonus tag
// every program's faculty can carry, not a program of its own to bucket under.
const GE_OPTION = 'General Education (GE)';

// Class Record and Grade Sheet each have their own independent verification
// flag (Chairperson's `field`) AND their own independent Admin-approval flag
// (`adminField`) — this maps the preview's 'record' | 'sheet' type to both,
// plus the label/route, so the rest of the component doesn't need to branch
// on that everywhere.
const DOC = {
  record: { field: 'class_record_verified', adminField: 'admin_class_record_approved', label: 'Class Record', path: '/class-record' },
  sheet: { field: 'grade_sheet_verified', adminField: 'admin_grade_sheet_approved', label: 'Grade Sheet', path: '/grading-sheet' },
};

// Where a class sits in the pipeline right now — drives which stage container
// it lands in:
// - 'pending': Not yet submitted by Faculty or awaiting Chairperson verification.
// - 'needs_approval': Chairperson has verified and forwarded — awaiting Admin approval.
// - 'to_release': Both documents approved by Admin, grades not yet released to the students.
// - 'done': Approved AND released to the students.
const stageOf = (c) => {
  if (c.admin_class_record_approved && c.admin_grade_sheet_approved) return c.all_released ? 'done' : 'to_release';
  if (c.chairperson_verified) return 'needs_approval';
  return 'pending';
};

// Solid color, not a pale tint — each stage's header is its own bright block
// (white text/icons throughout) so the three containers read apart from each
// other at a glance instead of blurring into one long grey list.
const STAGES = [
  { key: 'pending', label: 'Pending Grades', hint: 'Not yet submitted by Faculty or awaiting Chairperson verification.', header: 'bg-gray-500 hover:bg-gray-600' },
  { key: 'needs_approval', label: 'Needs Your Approval', hint: 'Chairperson has forwarded these — approve each document.', header: 'bg-amber-500 hover:bg-amber-600' },
  { key: 'to_release', label: 'Unreleased Grades', hint: 'Both documents approved — not yet released to the students.', header: 'bg-blue-600 hover:bg-blue-700' },
  { key: 'done', label: 'Done', hint: 'Approved and released — the students can see their grades.', header: 'bg-green-500 hover:bg-green-600' },
];

// Approve only happens from inside the preview now (see the Preview modal's
// own Approve button below) — this cell is just the status badge plus the
// button that opens that preview, not a shortcut around actually reviewing
// the document first.
function DocCell({ cls, type, verified, approved, onPreview }) {
  const icon = type === 'record' ? <Icons.Book /> : <Icons.FileText />;
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      {approved
        ? <Badge variant="green"><Icons.Check className="w-3 h-3" /> Approved</Badge>
        : verified
          ? <Badge variant="blue">Verified by Chairperson</Badge>
          : <Badge variant="gray">Not Verified</Badge>}
      <button className="btn-icon flex-shrink-0" onClick={() => onPreview(cls, type)} title={`Preview ${DOC[type].label}`}>
        {icon}
      </button>
    </div>
  );
}

// Program → Year → Section — same three-level shape the Archived container
// on this page already uses. Admin sees every program at once, so a single
// Year bucket routinely spans several of them; nesting Program as its own
// collapsible container (instead of only showing it per-row) makes that
// visible instead of requiring every section to be opened to tell them apart.
function groupByProgramYearSection(classes) {
  const byProgram = {};
  classes.forEach((c) => {
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

// Year → Section only — used within a single already-selected program (the
// Archived container groups by Program first, then calls this per-program).
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

export default function GradeApproval() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  // Filters + collapsible state persist across navigation (usePageState).
  const [search, setSearch] = usePageState('GradeApproval.search', '');

  useEffect(() => {
    const instructor = searchParams.get('instructor');
    if (instructor) {
      setSearch(instructor);
      setSearchParams({}, { replace: true });
    }
  }, []);
  const [programFilter, setProgramFilter] = usePageState('GradeApproval.programFilter', '');
  const [yearFilter, setYearFilter] = usePageState('GradeApproval.yearFilter', '');
  const [sectionFilter, setSectionFilter] = usePageState('GradeApproval.sectionFilter', '');

  // Collapsible state, keyed by a composite string per level so every
  // stage/program/year toggles independently of the others.
  const [openStages, setOpenStages] = usePageState('GradeApproval.openStages', {}); // every stage starts collapsed
  const [openGroups, setOpenGroups] = usePageState('GradeApproval.openGroups', {});

  // Class Record/Grade Sheet PREVIEW — opened inline (iframe of the same
  // auto-printing pages, with ?preview=1 so they don't actually pop a print
  // dialog) instead of navigating away, so Admin can check it and decide
  // right there instead of round-tripping through a separate tab/page.
  const [preview, setPreview] = useState(null); // { cls, type: 'record' | 'sheet' }
  const [showReturnForm, setShowReturnForm] = useState(false);
  const [returnMessage, setReturnMessage] = useState('');
  const [returning, setReturning] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  // Shown after a successful Send Back — a real popup summarizing exactly
  // what just happened (who was notified, and the reason sent), not just the
  // small toast that's easy to miss. { subjectLabel, reason, chairpersonCount }
  const [returnSent, setReturnSent] = useState(null);

  // Approving is also fully inline now — no more sending Admin to a separate
  // page just to click one button; the confirm dialog is the only extra step.
  const [approveTarget, setApproveTarget] = useState(null); // { cls, type }
  const [approving, setApproving] = useState(false);

  // Archive/Restore — a class only ever archives from "Done" (fully
  // approved, nothing left for Admin to do), tucking it into its own
  // collapsed section instead of leaving finished classes in that list
  // forever. Same `status` field Faculty's own Archive button and
  // Chairperson's Grading Sheets page both already use.
  const [archiving, setArchiving] = useState(null); // class id currently in flight
  const [archiveTarget, setArchiveTarget] = useState(null); // class about to be archived, pending confirm
  // Admin releases a fully approved class's grades to its students.
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [releasing, setReleasing] = useState(null); // class id being released
  const handleRelease = async (cls) => {
    setReleasing(cls.id);
    try {
      const { data } = await gradeService.releaseClass(cls.id);
      toast.success(data.message || 'Grades released to students');
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to release grades');
    } finally {
      setReleasing(null);
    }
  };
  const [showArchived, setShowArchived] = usePageState('GradeApproval.showArchived', false);

  // Faculty completion widget's own data — deliberately NOT the `classes`
  // state below, which only ever holds what's already been forwarded by a
  // Chairperson. This is every Faculty with an Active class this semester,
  // system-wide, whether they've submitted anything yet or not, so the
  // widget actually answers "how many faculty are done submitting" instead
  // of only counting the ones who already made it to this page.
  const [facultyReview, setFacultyReview] = useState([]);
  // Every actual Faculty account in the system — same source/count
  // UserManagement.js's Faculty box uses (`role=Faculty, all=true`) — so a
  // Faculty with 0 Active classes right now still shows up here instead of
  // silently disappearing (facultyReview above only ever knows about
  // instructors on an Active class).
  const [allFaculty, setAllFaculty] = useState([]);
  const [allClasses, setAllClasses] = useState([]);
  const [openFacultyGroups, setOpenFacultyGroups] = usePageState('GradeApproval.openFacultyGroups', {});

  const loadClasses = async () => {
    try {
      const { data } = await classService.getAll({ limit: 200 });
      const clsList = data.classes || [];
      setAllClasses(clsList);
      // Both forwarded and pending classes are shown under their respective stages
      setClasses(clsList);
    } catch (err) {
      toast.error('Failed to load classes');
    } finally {
      setLoading(false);
    }
  };

  const loadFacultyReview = async () => {
    try {
      const { data } = await dashboardService.getChairpersonFacultyReview();
      setFacultyReview(data.faculty || []);
    } catch (err) {
      toast.error('Failed to load faculty submission progress');
    }
  };

  const loadAllFaculty = async () => {
    try {
      // Faculty, plus every Chairperson who also teaches — a teaching
      // Chairperson has classes of their own and submits a Class Record and
      // Grade Sheet for them like any Faculty, so they belong in this roster
      // and in its counts.
      const [faculty, chairs] = await Promise.all([
        userService.getAll({ all: true, role: 'Faculty' }),
        userService.getAll({ all: true, role: 'Chairperson' }),
      ]);
      setAllFaculty([
        ...(faculty.data.users || []),
        ...(chairs.data.users || []).filter((u) => u.is_teaching),
      ]);
    } catch (err) {
      toast.error('Failed to load faculty list');
    }
  };

  useEffect(() => { loadClasses(); loadFacultyReview(); loadAllFaculty(); }, []);

  // Live refresh — Faculty submitting, or a Chairperson verifying/returning
  // a class, changes what belongs in "Needs Your Approval" without this
  // page's own reload ever firing, so without this an Admin sitting on this
  // page wouldn't see it until they manually reloaded. Also refreshes
  // facultyReview — the Faculty completion widget's own per-class chip data
  // (subject/year/section) comes from that separate endpoint, not from
  // `classes`, so loadClasses() alone left it stale after any action.
  useEffect(() => {
    const handler = () => { loadClasses(); loadFacultyReview(); };
    return onGradesUpdated(handler);
  }, []);

  const handleArchiveToggle = async (cls, archived) => {
    setArchiving(cls.id);
    try {
      await classService.archive(cls.id, archived);
      toast.success(archived ? `${cls.subject?.code || 'Class'} archived.` : `${cls.subject?.code || 'Class'} restored.`);
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${archived ? 'archive' : 'restore'} this class`);
    } finally {
      setArchiving(null);
    }
  };

  const openPreview = (cls, type) => {
    setPreview({ cls, type });
    setShowReturnForm(false);
    setReturnMessage('');
  };

  const closePreview = () => {
    setPreview(null);
    setShowReturnForm(false);
    setReturnMessage('');
  };

  // "Send Back to Chairperson" — a real state change (un-verifies just this
  // document, and drops the combined verified gate too), not just a chat
  // message, so it actually blocks approval/release until the Chairperson
  // and instructor address the problem and forward it again.
  const handleReturnToChairperson = async () => {
    if (!preview || !returnMessage.trim()) {
      toast.error("Explain what needs to be revised.");
      return;
    }
    const subjectLabel = `${preview.cls.subject?.code || 'This class'}${preview.cls.section ? ` - Section ${preview.cls.section}` : ''}`;
    const reason = returnMessage.trim();
    try {
      setReturning(true);
      const { data } = await reportService.returnToChairperson(preview.cls.id, reason);
      toast.success(data.message);
      closePreview();
      loadClasses();
      // The toast alone is easy to miss — this is the actual confirmation
      // that the send-back went through, who it went to, and what reason
      // was sent, so Admin doesn't have to just trust a message that
      // disappears in a few seconds.
      const chairpersonCount = parseInt(data.message?.match(/\d+/)?.[0] || '0', 10);
      setReturnSent({ subjectLabel, reason, chairpersonCount });
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send this back');
    } finally {
      setReturning(false);
    }
  };

  // This IS "done verifying" from Admin's side for ONE document — once BOTH
  // documents are approved this way, the backend also clears every pending
  // Passed grade and notifies Faculty they can export & release. No separate
  // page involved either way.
  const handleApprove = async () => {
    const target = approveTarget;
    setApproveTarget(null);
    if (!target) return;
    try {
      setApproving(true);
      const { data } = await gradeService.approveDocument(target.cls.id, target.type);
      toast.success(data.message);
      closePreview();
      loadClasses();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve this document');
    } finally {
      setApproving(false);
    }
  };

  // Sections actually in use (rather than a fixed A–H list) — keeps the
  // dropdown short and free of options that would return zero results.
  const availableSections = useMemo(
    () => [...new Set(classes.map((c) => c.section).filter(Boolean))].sort(),
    [classes]
  );

  // Archived classes (status flipped via the Archive button below) get their
  // own section entirely, out of the Needs Approval/Done stage view — same
  // `status !== 'Active'` concept Faculty's Archive tab and Chairperson's
  // Grading Sheets page both already use. Subject to the same search/
  // Program/Year/Section filters as the active stage view above it, not a
  // separate unfiltered dump.
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

  const byStage = { pending: [], needs_approval: [], to_release: [], done: [] };
  filtered.forEach((c) => {
    const stage = stageOf(c);
    if (byStage[stage]) byStage[stage].push(c);
  });

  // Faculty completion — every Faculty with an Active class this semester
  // (facultyReview, not the forwarded-only `classes` list), all-or-nothing
  // per instructor: "done submitting" means every one of their classes has
  // been submitted (Grade.submitted on every student, same `sent` flag the
  // Dashboard's own widget uses) — this is the Faculty side of the job, not
  // whether Admin has approved it yet. Broken down by Program (same
  // grouping UserManagement.js's staff directory uses) — GE_OPTION excluded
  // from grouping, Part-Time faculty pulled into their own "Part Timer"
  // bucket instead of a program (they're tagged with every program, so
  // filing them under one would misrepresent a real assignment).
  // "Passed" — every one of a faculty's classes has actually made it all the
  // way through: forwarded by their Chairperson AND both Class Record and
  // Grade Sheet approved by Admin (stageOf === 'done'). Cross-referenced
  // against `classes` (this page's own forwarded-only list, which is the
  // only place admin_class_record_approved/admin_grade_sheet_approved
  // live) rather than facultyReview, which only knows about submission.
  // A class that hasn't even been forwarded yet correctly keeps its faculty
  // out of "passed", same as one still sitting in Needs Your Approval.
  const approvedClassIds = new Set(classes.filter((c) => ['to_release', 'done'].includes(stageOf(c))).map((c) => c.id));
  // A class with zero enrolled students has nothing to submit at all — it
  // can never turn `sent` true no matter what, so counting it in the
  // all-or-nothing check below permanently blocked a faculty from ever
  // reading as "done" once every class that actually HAS students is
  // already through, just because some other unrelated empty class was
  // still sitting there. Only classes with real students in them count
  // toward whether a faculty is actually done.
  const realClasses = (f) => f.classes.filter((c) => (c.total_students ?? 0) > 0);
  const facultyPassed = (f) => { const rc = realClasses(f); return rc.length > 0 && rc.every((c) => approvedClassIds.has(c.class_id)); };
  const facultySent = (f) => { const rc = realClasses(f); return rc.length > 0 && rc.every((c) => c.sent); };

  // Merge the full Faculty roster (allFaculty — every Faculty account,
  // regardless of whether they have an Active class right now) with the
  // per-class progress data (facultyReview — only knows about instructors
  // teaching an Active class). A Faculty with 0 classes this semester still
  // shows up, just with an empty classes array — `facultySent`/
  // `facultyPassed` both correctly treat 0 classes as "not done" rather than
  // vacuously true.
  const reviewByInstructorId = {};
  facultyReview.forEach((f) => { reviewByInstructorId[f.instructor.id] = f; });
  const rosterIds = new Set(allFaculty.map((u) => u.id));
  const facultyList = [
    ...allFaculty.map((u) => reviewByInstructorId[u.id] || { instructor: u, classes: [] }),
    // Anyone with an active class who is somehow not in the roster above is
    // still shown: a class with grades to approve must never be left out.
    ...facultyReview.filter((r) => !rosterIds.has(r.instructor.id)),
  ];
  const facultyDoneCount = facultyList.filter(facultySent).length;
  const facultyPassedCount = facultyList.filter(facultyPassed).length;

  const facultyPartTime = facultyList.filter((f) => f.instructor.employment_type === 'Part Time');
  const facultyFullTime = facultyList.filter((f) => f.instructor.employment_type !== 'Part Time');
  const facultyByProgram = {};
  facultyFullTime.forEach((f) => {
    const realPrograms = (f.instructor.programs || []).filter((p) => p !== GE_OPTION);
    const tags = realPrograms.length > 0 ? realPrograms : (f.instructor.programs || []).length > 0 ? f.instructor.programs : ['Unassigned'];
    tags.forEach((tag) => {
      if (!facultyByProgram[tag]) facultyByProgram[tag] = [];
      facultyByProgram[tag].push(f);
    });
  });
  // Every known program shows up here even with 0 faculty right now (not
  // just the ones that happen to have someone in facultyByProgram already)
  // — a program isn't supposed to disappear from the roster just because
  // nobody's teaching in it yet this semester. No separate "(Teaching Here)"
  // tile for cross-program teaching — a faculty appears once, under their
  // own real (account) program, same as everyone else; their own row's
  // class chips (below) already list every class they teach regardless of
  // program, so a BSIT class still shows up there even for a Psychology
  // faculty's own entry.
  const facultyGroups = [
    ...PROGRAMS.map((program) => ({ key: program, label: programShortLabel(program), program, list: facultyByProgram[program] || [] })),
    ...Object.entries(facultyByProgram).filter(([program]) => !PROGRAMS.includes(program)).sort(([a], [b]) => a.localeCompare(b)).map(([program, list]) => ({ key: program, label: programShortLabel(program), program, list })),
    ...(facultyPartTime.length > 0 ? [{ key: 'part_time', label: 'Part Timer', list: facultyPartTime }] : []),
  ];

  const allClassMap = new Map((allClasses || []).map((c) => [c.id, c]));
  const activeClassesList = (allClasses || []).filter((c) => !isArchived(c));
  const totalDoneClasses = activeClassesList.filter((c) => stageOf(c) === 'done').length;
  const totalPendingRecordClasses = activeClassesList.filter((c) => !c.admin_class_record_approved).length;
  const totalPendingSheetClasses = activeClassesList.filter((c) => !c.admin_grade_sheet_approved).length;

  const toggleStage = (key) => setOpenStages((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleGroup = (key) => setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  const toggleFacultyGroup = (key) => setOpenFacultyGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  if (loading) return <LoadingSpinner />;

  const previewDoc = preview && DOC[preview.type];
  const previewApproved = preview && !!preview.cls[previewDoc.adminField];

  const renderRow = (c, isDoneStage) => (
    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
      {/* Program/Year/Section are now the outer containers' own headers
          (groupByProgramYearSection), so none of them need repeating on
          every row. */}
      <td className="px-4 py-3.5 align-middle">
        <p className="font-semibold text-[13px] text-navy whitespace-nowrap">{c.subject?.code}</p>
        <p className="text-gray-500 text-xs min-w-[180px] max-w-[260px]">{c.subject?.name}</p>
        {c.admin_return_reason && (
          <p className="text-[11px] text-red-600 mt-1 max-w-xs">
            <Icons.AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />
            Returned: "{c.admin_return_reason}"
          </p>
        )}
      </td>
      {/* `c.semester` already bakes the academic year in ("First Semester
          2026-2027") — appending c.academic_year again duplicated it into
          "First Semester 2026-2027 2026-2027" whenever both were set. */}
      <td className="px-4 py-3.5 text-xs align-middle whitespace-nowrap">{c.semester}</td>
      <td className="px-4 py-3.5 text-[13px] align-middle">
        <div className="whitespace-nowrap font-medium">{c.instructor?.name || '—'}</div>
        {c.instructor && (
          <div className="mt-1 flex flex-wrap gap-1">
            <FacultyProgramTags user={c.instructor} />
          </div>
        )}
      </td>
      <td className="px-4 py-3.5 text-[13px] align-middle min-w-[150px]">
        <EncodingProgress c={c} />
      </td>
      <td className="px-4 py-3.5 align-middle">
        <DocCell cls={c} type="record" verified={c.class_record_verified} approved={c.admin_class_record_approved} onPreview={openPreview} />
      </td>
      <td className="px-4 py-3.5 align-middle">
        <DocCell cls={c} type="sheet" verified={c.grade_sheet_verified} approved={c.admin_grade_sheet_approved} onPreview={openPreview} />
      </td>
      {/* Archive is only ever offered once a class is actually Done (both
          documents approved) — not while it's still Needs Your Approval. */}
      {isDoneStage && (
        <td className="px-4 py-3.5 align-middle text-center">
          <div className="flex flex-col items-center gap-1.5">
            {/* Admin releases the grades once both documents are approved. */}
            {c.all_released ? (
              <Badge variant="green"><Icons.Check className="w-3 h-3" /> Released to Students</Badge>
            ) : (
              <button
                className="btn btn-gold btn-sm whitespace-nowrap"
                onClick={() => setReleaseTarget(c)}
                disabled={releasing === c.id}
                title="Make these grades visible to the students"
              >
                <Icons.Send className="w-3.5 h-3.5" /> {releasing === c.id ? 'Releasing...' : 'Release to Students'}
              </button>
            )}
            {/* Archive comes AFTER the release — it only appears once the
                grades have been released to the students, so a class can't
                be tucked away with its grades still unreleased. */}
            {c.all_released && (
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

  const renderStage = (stage) => {
    const stageClasses = byStage[stage.key] || [];
    if (stageClasses.length === 0) return null;
    const stageOpen = !!openStages[stage.key] || hasActiveFilters;
    const programs = groupByProgramYearSection(stageClasses);
    const programKeys = Object.keys(programs).sort((a, b) => (a === 'No Program' ? 1 : b === 'No Program' ? -1 : a.localeCompare(b)));
    const isDoneStage = stage.key === 'done' || stage.key === 'to_release';

    return (
      <div key={stage.key} className="card overflow-hidden mb-5">
        <button
          onClick={() => toggleStage(stage.key)}
          className={`w-full px-5 py-3.5 flex items-center justify-between border-none cursor-pointer font-sans text-white transition-colors ${stage.header}`}
        >
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold bg-white/20 rounded-full min-w-[26px] h-[26px] px-2 flex items-center justify-center">{stageClasses.length}</span>
            <div className="text-left">
              <p className="text-sm font-bold">{stage.label}</p>
              <p className="text-[11px] text-white/75">{stage.hint}</p>
            </div>
          </div>
          {stageOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
        </button>

        {stageOpen && (
          <div className="border-t border-gray-100">
            {programKeys.map((program) => {
              const years = programs[program];
              const programTotal = Object.values(years).reduce((s, secs) => s + Object.values(secs).reduce((s2, arr) => s2 + arr.length, 0), 0);
              const programKey = `${stage.key}|${program}`;
              const programOpen = !!openGroups[programKey];
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
                      <span className="text-xs text-gray-400">{programTotal} class{programTotal !== 1 ? 'es' : ''}</span>
                    </div>
                    {programOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
                  </button>

                  {programOpen && yearKeys.map((year) => {
                    const sections = years[year];
                    const yearTotal = Object.values(sections).reduce((s, arr) => s + arr.length, 0);
                    const yearKey = `${programKey}|${year}`;
                    const yearOpen = !!openGroups[yearKey];
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

                        {yearOpen && Object.keys(sections).sort().map((section) => {
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
                                <div className="overflow-x-auto">
                                  <table className="w-full border-separate border-spacing-0">
                                    <thead>
                                      <tr className="bg-gray-50 text-gray-500">
                                        <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Subject</th>
                                        <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Semester</th>
                                        <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Faculty</th>
                                        <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Progress</th>
                                        <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Class Record</th>
                                        <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Grade Sheet</th>
                                        {isDoneStage && <th className="text-center px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Action</th>}
                                      </tr>
                                    </thead>
                                    <tbody>{secClasses.map((c) => renderRow(c, isDoneStage))}</tbody>
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
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Grade Approval</h2>
        <p className="text-[13px] text-gray-500">
          Approve each class's Class Record and Grade Sheet — once both are approved, Faculty is notified automatically.
        </p>
      </div>

      {/* Faculty completion — every Faculty account in the system (same
          roster/count UserManagement.js's Faculty box shows), not just the
          ones with an Active class right now. A faculty only counts as
          "done" once every one of their classes has been submitted — one
          with 0 classes this semester just sits at 0 classes, never
          vacuously "done" — broken out by Program with Part-Time faculty in
          their own "Part Timer" group. */}
      {facultyList.length > 0 && (
        <div className="card p-4 mb-5">
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${totalDoneClasses > 0 ? 'bg-green-50 text-green-500' : 'bg-amber-50 text-amber-500'}`}>
              <Icons.Users className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-bold text-navy leading-snug">
                  <span className="text-green-600 font-bold">{totalDoneClasses}</span> Done
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-sm font-semibold text-amber-600 leading-snug">
                  {totalPendingRecordClasses} Pending Class Record
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-sm font-semibold text-blue-600 leading-snug">
                  {totalPendingSheetClasses} Pending Grade Sheet
                </span>
              </div>
              <p className="text-xs text-gray-400 leading-snug mt-0.5">
                Overview across College of Arts and Sciences programs
              </p>
            </div>
          </div>
          {/* auto-fit instead of a fixed column count — with only a handful of
              groups (one per program + Part Timer), a fixed 5-wide grid either
              stretched each tile too wide or left an orphaned tile alone on
              its own row; this sizes tiles to their content instead (each
              clamped between 140px and an even share of the row) so they
              pack snugly regardless of how many groups exist. */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            {facultyGroups.map((g) => {
              const total = g.list.length;

              // Collect classes belonging exclusively to this program group's instructors
              const seenClassIds = new Set();
              const groupClasses = [];
              g.list.forEach((f) => {
                (f.classes || []).forEach((c) => {
                  if (!seenClassIds.has(c.class_id)) {
                    seenClassIds.add(c.class_id);
                    const fullClass = allClassMap.get(c.class_id) || c;
                    groupClasses.push(fullClass);
                  }
                });
              });

              const doneClasses = groupClasses.filter((c) => stageOf(c) === 'done').length;
              const pendingRecordClasses = groupClasses.filter((c) => !c.admin_class_record_approved).length;
              const pendingSheetClasses = groupClasses.filter((c) => !c.admin_grade_sheet_approved).length;
              const classCount = groupClasses.length;

              // Jumps to (and opens) this program's own dropdown in the
              // "Every group's own faculty" list further down the card,
              // instead of leaving the tile purely informational and making
              // the admin go hunt for the matching group by hand. Mirrors
              // Chairperson's own GradingSheets.js tile behavior exactly.
              const openGroupBelow = () => {
                setOpenFacultyGroups((prev) => ({ ...prev, [g.key]: true }));
                document.getElementById(`faculty-group-${g.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              };
              return (
                <div
                  key={g.key}
                  className="border border-gray-100 dark:border-slate-800 rounded-lg p-3 min-w-0 cursor-pointer hover:border-navy/30 hover:shadow-sm transition-all bg-white dark:bg-slate-900 flex flex-col justify-between"
                  role="button"
                  tabIndex={0}
                  onClick={openGroupBelow}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openGroupBelow(); } }}
                  title={`View ${g.label} faculty`}
                >
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
                      {g.key === 'part_time'
                        ? <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0 inline-block" />
                        : <ProgramDot program={g.program} />}
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide truncate">{g.label}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mb-2">{total} faculty · {classCount} class{classCount !== 1 ? 'es' : ''}</p>

                    {classCount === 0 ? (
                      <p className="text-xs text-gray-300 dark:text-slate-600 italic py-3 text-center">No active classes</p>
                    ) : (
                      <div className="space-y-2 py-0.5">
                        <div>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-gray-600 dark:text-gray-300 flex items-center gap-1 font-medium">
                              <Icons.Check className="w-3.5 h-3.5 text-green-500" /> Done
                            </span>
                            <span className={`font-bold ${doneClasses > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                              {doneClasses}/{classCount}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${(doneClasses / classCount) * 100}%` }} />
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-300 flex items-center gap-1 truncate" title="Pending Class Record">
                            <Icons.Book className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" /> Pending Class Record
                          </span>
                          <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${pendingRecordClasses > 0 ? 'text-amber-700 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/40' : 'text-gray-400'}`}>
                            {pendingRecordClasses}
                          </span>
                        </div>

                        <div className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-300 flex items-center gap-1 truncate" title="Pending Grade Sheet">
                            <Icons.FileText className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" /> Pending Grade Sheet
                          </span>
                          <span className={`font-bold px-1.5 py-0.5 rounded text-xs ${pendingSheetClasses > 0 ? 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40' : 'text-gray-400'}`}>
                            {pendingSheetClasses}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Every group's own faculty, each with how many classes they
              personally handle — the tile above only gives the group's
              totals, this dropdown is what makes up that "N faculty · M
              classes". Collapsed by default, one per program — including
              programs with 0 faculty right now, so the full 4-program (+
              Part Timer) roster is always visible here, not just the ones
              that currently have someone in them. */}
          {facultyGroups.map((g) => {
            const facultyOpen = !!openFacultyGroups[g.key];
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
              <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
                {g.list
                  .slice()
                  .sort((a, b) => comparePeopleNames(a.instructor, b.instructor))
                  .map((f) => {
                    const sent = facultySent(f);
                    const passed = facultyPassed(f);
                    // Partial progress, not just the all-or-nothing badges
                    // beside it — a faculty with 5 classes and 3 submitted
                    // reads as "3/5", not just an undifferentiated "5 classes".
                    // Counted against realClasses (students > 0), not
                    // f.classes.length — an empty, unenrolled class has
                    // nothing to submit, so it shouldn't read as a missing
                    // one dragging the ratio down (e.g. "1/2" for a faculty
                    // whose only real class is fully done).
                    const rc = realClasses(f);
                    const classesSubmitted = rc.filter((c) => c.sent).length;
                    const classesApproved = rc.filter((c) => approvedClassIds.has(c.class_id)).length;
                    return (
                      <div key={f.instructor.id} className="px-3 py-2 rounded-lg border border-gray-100">
                        <div className="flex items-center gap-3">
                          <Avatar letter={f.instructor.avatar || f.instructor.name?.[0]} className="bg-purple-500 text-white flex-shrink-0" size="w-8 h-8 text-xs" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{formatPersonName(f.instructor.name)}</p>
                            <p className="text-[11px] text-gray-400">{f.classes.length} class{f.classes.length !== 1 ? 'es' : ''} handled</p>
                          </div>
                          <Badge variant={sent ? 'green' : 'gray'} className="flex-shrink-0" title={sent ? 'Every class submitted' : 'Not every class submitted yet'}>
                            {sent && <Icons.Check className="w-3 h-3" />} {classesSubmitted}/{rc.length} submitted
                          </Badge>
                          <Badge variant={passed ? 'green' : 'gray'} className="flex-shrink-0" title={passed ? 'Every class approved' : 'Not every class approved yet'}>
                            {passed && <Icons.Check className="w-3 h-3" />} {classesApproved}/{rc.length} approved
                          </Badge>
                        </div>
                        {/* The actual classes this faculty created/is teaching
                            — not just the count above — each its own chip so
                            it's visible which specific class is still holding
                            up an otherwise-incomplete faculty. */}
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
                              String(a.subject_code ?? '').localeCompare(String(b.subject_code ?? ''))
                            ).map((c) => {
                              const classApproved = approvedClassIds.has(c.class_id);
                              return (
                                <span
                                  key={c.class_id}
                                  title={`${c.subject_name || c.subject_code}${c.section ? ` · Section ${c.section}` : ''}${c.year_level ? ` · Year ${c.year_level}` : ''}`}
                                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${
                                    classApproved
                                      ? 'bg-green-50 border-green-200 text-green-700'
                                      : c.sent
                                        ? 'bg-blue-50 border-blue-200 text-blue-700'
                                        : 'bg-gray-50 border-gray-200 text-gray-500'
                                  }`}
                                >
                                  {classApproved && <Icons.Check className="w-2.5 h-2.5" />}
                                  {c.subject_code}{c.year_level ? ` · Y${c.year_level}` : ''}{c.section ? ` · ${c.section}` : ''}
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-300 mt-1.5 pl-11">No Active class this semester</p>
                        )}
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

      {/* Grid instead of flex-wrap — the Program option text is long enough
          ("Bachelor of Science in Information Technology") that flex-wrap
          would size its column to fit that text, then wrap whatever didn't
          fit onto an orphaned second line with nothing to align it. A grid
          gives every filter a fixed track, so it reflows in whole rows
          instead, and the Program column itself is capped/truncated so it
          can't blow out the row width in the first place. */}
      <div className="card p-4 mb-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <SearchBar value={search} onChange={setSearch} placeholder="Search by subject, course title, or faculty..." />
          </div>
          <select
            className="form-select text-sm py-2.5 w-full truncate"
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            title={programFilter || 'All Programs'}
          >
            <option value="">All Programs</option>
            {PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
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
        <div className="card text-center py-14 text-gray-400 text-sm mb-6">
          <Icons.FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          {hasActiveFilters ? (
            <>
              No classes match your filters.{' '}
              <button className="text-navy font-medium underline underline-offset-2" onClick={clearFilters}>Clear filters</button>
            </>
          ) : 'No classes found.'}
        </div>
      ) : (
        STAGES.map(renderStage)
      )}

      {/* ARCHIVED — classes Archived from the Done stage above, tucked away
          behind its own collapsed toggle since most visits have nothing to
          do here. Same status field Faculty's own Archive button and
          Chairperson's Grading Sheets page both already use. */}
      {archivedList.length > 0 && (
        <div className="card overflow-hidden mt-6 mb-6">
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
              Admin sees every program at once, so a single Year bucket
              routinely spans several of them, with no way to tell them
              apart short of opening every section underneath. */}
          {showArchived && groupBySemester(archivedList).map(({ semester, list: semesterClasses }) => {
            // SEMESTER first — every archived class sits under the semester it
            // belongs to (a semester's classes are all archived when it ends).
            const semesterKey = `archived-semester|${semester}`;
            const semesterOpen = !!openGroups[semesterKey];
            return (
              <div key={semester} className="border-t border-gray-200">
                <button
                  onClick={() => toggleGroup(semesterKey)}
                  className="w-full px-5 py-3 flex items-center justify-between border-none cursor-pointer font-sans bg-navy/5 hover:bg-navy/10 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Icons.Clock className="w-4 h-4 text-navy" />
                    <span className="text-sm font-bold text-navy">{semester}</span>
                    <span className="text-xs text-gray-500">{semesterClasses.length} class{semesterClasses.length !== 1 ? 'es' : ''}</span>
                  </div>
                  {semesterOpen ? <Icons.ChevronUp className="w-4 h-4 text-gray-500" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-500" />}
                </button>
          {semesterOpen && (() => {
            const byProgram = {};
            semesterClasses.forEach((c) => {
              const program = c.subject?.program || 'No Program';
              if (!byProgram[program]) byProgram[program] = [];
              byProgram[program].push(c);
            });
            const programKeys = Object.keys(byProgram).sort((a, b) => (a === 'No Program' ? 1 : b === 'No Program' ? -1 : a.localeCompare(b)));
            return (
              <div className="border-t border-gray-100">
                {programKeys.map((program) => {
                  const programClasses = byProgram[program];
                  const programKey = `archived|${semester}|${program}`;
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
                                              <p className="text-xs text-gray-500 truncate">{c.instructor?.name || 'No faculty'}</p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-1.5 flex-shrink-0">
                                            {/* Archiving only ever happens from Done — both documents are
                                                already fully approved — so these are always just previews,
                                                same read-only iframe modal the active rows use. */}
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
            );
          })}
        </div>
      )}

      {/* PREVIEW MODAL — Class Record or Grade Sheet, embedded live instead of
          opening a new tab. Chairperson verification is mandatory and comes
          from their own forward action, so Admin's levers here are to send
          it back if something's wrong, or — once forwarded — approve it and
          send it on to Faculty, right from this same modal. */}
      {preview && (
        <Modal
          title={`${previewDoc.label} — ${preview.cls.subject?.code}${preview.cls.section ? ` Sec ${preview.cls.section}` : ''}`}
          onClose={closePreview}
          size="max-w-[98vw]"
          footer={
            isArchived(preview.cls) ? (
              // Archived is always already fully approved (that's the only
              // stage a class ever archives from) — this is a read-only
              // look-back, not a place to take a new action on it.
              <Badge variant="green"><Icons.Check className="w-3 h-3" /> Approved</Badge>
            ) : (
              <>
                {previewApproved ? (
                  <Badge variant="green"><Icons.Check className="w-3 h-3" /> Approved</Badge>
                ) : !preview.cls.chairperson_verified ? (
                  <button
                    className="btn btn-gold opacity-50 cursor-not-allowed"
                    disabled
                    title="This class has not been verified and forwarded by the Chairperson yet."
                  >
                    <Icons.Clock className="w-4 h-4" /> Awaiting Chairperson
                  </button>
                ) : (
                  <button className="btn btn-gold" onClick={() => setApproveTarget({ cls: preview.cls, type: preview.type })} disabled={approving || showReturnForm} title={showReturnForm ? 'Not available while you are returning this class to the Chairperson' : `Approve the ${previewDoc.label}`}>
                    <Icons.Check className="w-4 h-4" /> Approve
                  </button>
                )}
                {!showReturnForm && (
                  <button className="btn btn-outline !text-red-500 !border-red-200 hover:!bg-red-50" onClick={() => setShowReturnForm(true)}>
                    <Icons.AlertTriangle className="w-4 h-4" /> Send Back to Chairperson
                  </button>
                )}
              </>
            )
          }
        >
            <iframe
              key={`${preview.cls.id}-${preview.type}`}
              src={`${previewDoc.path}/${preview.cls.id}?preview=1`}
              title="Document preview"
              style={{ width: '100%', height: 'calc(90vh - 200px)', minHeight: 360, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}
            />
        </Modal>
      )}

      {/* SEND BACK TO CHAIRPERSON — a small window that floats over the preview
          and can be dragged out of the way, so the Class Record or Grade Sheet
          stays visible while the reason is typed. Hidden while the final
          "Send back?" confirmation is up; what was typed is kept. */}
      {preview && showReturnForm && !confirmReturn && !isArchived(preview.cls) && (
        <FloatingPanel
          title={`Send Back to Chairperson — ${preview.cls.subject?.code || ''}${preview.cls.section ? ` Sec ${preview.cls.section}` : ''}`}
          onClose={() => setShowReturnForm(false)}
          footer={(
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setShowReturnForm(false)} disabled={returning}>Cancel</button>
              <button className="btn btn-red btn-sm" onClick={() => setConfirmReturn(true)} disabled={returning || !returnMessage.trim()}>
                <Icons.Send className="w-4 h-4" /> {returning ? 'Sending...' : 'Send Back'}
              </button>
            </>
          )}
        >
          <p className="text-[12px] text-gray-500 mb-3">
            This sends BOTH the Class Record and Grade Sheet back to {preview.cls.subject?.program || 'the'} Chairperson
            (and notifies {preview.cls.instructor?.name ? formatPersonName(preview.cls.instructor.name) : 'the faculty'}) — they always move together, so this
            un-verifies both documents (and any of your own approvals) until the issue is fixed and it's forwarded again.
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
        </FloatingPanel>
      )}

      {confirmReturn && (
        <ConfirmDialog
          title="Send back to Chairperson?"
          message={`This un-verifies the ${previewDoc.label} for ${preview?.cls.subject?.code || 'this class'} and blocks approval until the Chairperson and faculty address it and forward it again. Reason: "${returnMessage.trim()}"`}
          confirmText={returning ? 'Sending...' : 'Send Back'}
          variant="red"
          confirmDisabled={returning}
          onConfirm={async () => { setConfirmReturn(false); await handleReturnToChairperson(); }}
          onCancel={() => setConfirmReturn(false)}
        />
      )}

      {/* Confirmation popup for the Send Back itself — the toast alone is
          easy to miss, this is what actually tells Admin the action went
          through, who was notified, and what reason was sent. */}
      {returnSent && (
        <Modal
          title="Sent Back to Chairperson"
          onClose={() => setReturnSent(null)}
          footer={<button className="btn btn-navy" onClick={() => setReturnSent(null)}>Done</button>}
        >
          <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 mb-3">
            <Icons.Check className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-green-800">
              {returnSent.subjectLabel}'s Class Record and Grade Sheet were sent back to {returnSent.chairpersonCount} chairperson{returnSent.chairpersonCount !== 1 ? 's' : ''} for revision.
              Both documents are un-verified again, and any of your own approvals on them were cleared — nothing moves forward until the Chairperson reviews this and forwards it again.
            </p>
          </div>
          <label className="form-label">Reason sent</label>
          <p className="text-sm text-gray-600 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">"{returnSent.reason}"</p>
        </Modal>
      )}

      {releaseTarget && (
        <ConfirmDialog
          title="Release grades to students?"
          message={`The grades of ${releaseTarget.subject?.code || 'this class'}${releaseTarget.section ? ` - Section ${releaseTarget.section}` : ''} (${releaseTarget.instructor?.name || 'Faculty'}) become visible to its students, who are notified. The faculty member is notified too and can then export the Class Record and Grade Sheet.`}
          confirmText="Release"
          variant="gold"
          onConfirm={async () => { const cls = releaseTarget; setReleaseTarget(null); await handleRelease(cls); }}
          onCancel={() => setReleaseTarget(null)}
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

      {approveTarget && (
        <ConfirmDialog
          title={`Approve ${DOC[approveTarget.type].label}`}
          message={`Approve the ${DOC[approveTarget.type].label} for ${approveTarget.cls.subject?.code || 'this class'}${approveTarget.cls.section ? ` - Section ${approveTarget.cls.section}` : ''}? Once both the Class Record and Grade Sheet are approved, release the grades to the students here or from the dashboard.`}
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
