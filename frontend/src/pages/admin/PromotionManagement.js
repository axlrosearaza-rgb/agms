import { useState, useEffect } from 'react';
import { Icons, Avatar, Badge, Modal, LoadingSpinner, ProgramBadge, ProgramDot, ConfirmDialog, programCascadeGradient, programShortLabel } from '../../components/common';
import { semesterService } from '../../services';
import API from '../../services/api';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';

const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

/**
 * Promotion path:
 *   1st Year 1st Sem → 1st Year 2nd Sem → 2nd Year 1st Sem → 2nd Year 2nd Sem
 *   → 3rd Year 1st Sem → 3rd Year 2nd Sem → 4th Year 1st Sem → 4th Year 2nd Sem → Graduate
 *
 * A student is "Eligible for Promotion" (to next year) only when they are in
 * their year's 2nd semester and passed all subjects.
 *
 * A student is "Eligible for Next Semester" (same year) when they are in 1st semester
 * and passed all subjects.
 *
 * A student is "For Graduation" when they are 4th year 2nd semester and passed all subjects.
 */

function getSemesterLabel(semesterName = '') {
  const lower = semesterName.toLowerCase();
  if (lower.includes('2nd') || lower.includes('second')) return '2nd';
  if (lower.includes('1st') || lower.includes('first')) return '1st';
  return null;
}

function getNextStep(yearLevel, semLabel) {
  if (yearLevel === 4 && semLabel === '2nd') return { label: 'Graduation', isGraduating: true };
  if (semLabel === '1st') return { label: `Year ${yearLevel} — 2nd Semester`, isGraduating: false };
  if (semLabel === '2nd') return { label: `Year ${yearLevel + 1} — 1st Semester`, isGraduating: false };
  return { label: 'Unknown', isGraduating: false };
}

function displayStudentName(name = '') {
  const parts = String(name || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length === 0) return '';

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const middleNames = parts.slice(1, -1);
  const middleInitial = middleNames.length > 0 ? ` ${middleNames[0].charAt(0).toUpperCase()}.` : '';

  return `${lastName}, ${firstName}${middleInitial}`;
}

function compareStudentNames(a, b) {
  const left = displayStudentName(a.name || a);
  const right = displayStudentName(b.name || b);
  return left.localeCompare(right);
}

// Admin-only now — Chairperson used to evaluate/promote/release/mark-irregular
// on their own program, but that action moved to Admin once Admin approval
// became the final sign-off (Chairperson's own part is now just verifying the
// class on Grade Sheet and Class Records).
export default function PromotionManagement() {
  const canAct = true;
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // Below: usePageState instead of useState — clicking away to another page
  // and back (or just switching sidebar sections) used to wipe all of this
  // (Evaluate's results, whatever filters/tab/search you had set, which
  // groups you'd expanded) since React unmounts this whole component on
  // navigation. usePageState keeps it cached outside the component's own
  // lifecycle so it's still there when you come back. Transient stuff that
  // SHOULD reset — loading/evaluating/promoting spinners above, and the
  // view-student modal / confirm dialog below — stays as plain useState.
  const [students, setStudents] = usePageState('PromotionManagement.students', []);
  const [semesters, setSemesters] = useState([]);
  const [selectedSemester, setSelectedSemester] = usePageState('PromotionManagement.selectedSemester', '');
  const [programFilter, setProgramFilter] = usePageState('PromotionManagement.programFilter', '');
  const [yearFilter, setYearFilter] = usePageState('PromotionManagement.yearFilter', '');
  const [evaluated, setEvaluated] = usePageState('PromotionManagement.evaluated', false);
  const [viewStudent, setViewStudent] = useState(null);
  const [activeTab, setActiveTab] = usePageState('PromotionManagement.activeTab', 'regular');
  // Collapsible Program → Year → Section browsing for the Review tab — with
  // thousands of students now possible, rendering every group open by
  // default buries the page; closed by default, expand only what you need.
  // Keyed by composite strings so every level (and every tab's own tree)
  // toggles independently.
  const [expanded, setExpanded] = usePageState('PromotionManagement.expanded', {});
  const toggleExpanded = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  // Retake Blocked tab's own extra filter — narrows down to students stuck
  // on one specific subject, since a Chairperson/Admin often wants "who's
  // waiting on CC103" rather than the whole blocked list at once.
  const [retakeSubjectFilter, setRetakeSubjectFilter] = usePageState('PromotionManagement.retakeSubjectFilter', '');
  // Shared confirm-warning for Promote/Mark Irregular — same styled
  // ConfirmDialog pattern used elsewhere, instead of the browser's own
  // plain window.confirm() popup.
  const [confirmAction, setConfirmAction] = useState(null);
  const requestConfirm = (config) => setConfirmAction(config);
  const runConfirmedAction = async () => {
    const cfg = confirmAction;
    setConfirmAction(null);
    if (cfg?.action) await cfg.action();
  };

  // Derive what semester we're evaluating (1st or 2nd)
  const currentSemLabel = getSemesterLabel(selectedSemester);

  useEffect(() => {
    semesterService.getAll()
      .then(({ data }) => setSemesters(data.semesters || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleEvaluate = async () => {
    if (!selectedSemester) { toast.error('Please select a semester to evaluate'); return; }
    try {
      setEvaluating(true);
      setStudents([]);
      const { data } = await API.get('/promotions/evaluate', {
        params: {
          semester: selectedSemester,
          program: programFilter || undefined,
          year_level: yearFilter || undefined,
        },
      });
      setStudents(data.students || []);
      setEvaluated(true);
      setActiveTab('regular');
      toast.success(`Evaluated ${data.students?.length || 0} students`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to evaluate students');
    } finally {
      setEvaluating(false);
    }
  };

  // Always the full eligible list now — there's no per-student picking
  // anymore, promoting is all-or-nothing for whatever's showing under the
  // current filters.
  const handlePromote = (ids) => {
    if (ids.length === 0) { toast.error('No eligible students to promote'); return; }

    const actionLabel = currentSemLabel === '1st'
      ? 'move to 2nd Semester'
      : 'promote to the next year level';

    requestConfirm({
      title: 'Promote All Eligible Students',
      message: `${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} for ALL ${ids.length} student(s)? This cannot be undone.`,
      confirmText: 'Promote All',
      variant: 'gold',
      action: async () => {
        try {
          setPromoting(true);
          const { data } = await API.post('/promotions/promote', {
            student_ids: ids,
            semester: selectedSemester,
          });
          toast.success(`Successfully processed ${data.promoted} student(s)!`);
          handleEvaluate();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed to promote students');
        } finally {
          setPromoting(false);
        }
      },
    });
  };

  // ── Categorize ──────────────────────────────────────────────────────
  // Graduating: 4th year, 2nd sem, all passed
  const graduatingStudents = students.filter(s =>
    s.promotion_status === 'For Graduation' ||
    (s.year_level === 4 && currentSemLabel === '2nd' && s.promotion_status === 'Eligible')
  );

  // Regular: eligible for next step (not graduating)
  // "Eligible (Retake Required)" — promotable (a Failed subject with no
  // prerequisite/co-requisite chain doesn't block advancing), just still
  // owes a retake alongside next term's load — belongs in the same Review
  // tab as plain "Eligible", not off in Irregular with the genuinely-blocked.
  // "Already Promoted" counts here too — same successful outcome, just
  // already actioned for this exact semester (re-running Evaluate after
  // already clicking Promote once shouldn't make these students vanish
  // from every bucket while still counting toward the total).
  const regularStudents = students.filter(s =>
    (s.promotion_status === 'Eligible' || s.promotion_status === 'Eligible (Retake Required)' || s.promotion_status === 'For Next Semester' || s.promotion_status === 'Already Promoted') &&
    !graduatingStudents.find(g => g.id === s.id)
  );

  // A Failed subject never blocks promotion anymore — every one of these
  // students has already been advanced, flagged Irregular, with the retake
  // riding along on next term's load. What lands here specifically is the
  // subset who can't even be auto-enrolled in that retake YET, because the
  // failed subject's own prerequisite/co-requisite chain isn't cleared —
  // the one group that genuinely needs a Chairperson/Admin's attention.
  const irregularStudents = students.filter(s => (s.retakable_failed_subjects || []).some(f => f.blocked_by_prereq));
  // Distinct from "Failed" — nothing they were graded on was Failed, but
  // they're still missing a Passed grade for at least one curriculum-
  // required subject this year+semester (never enrolled, or enrolled but
  // never submitted). Can't be promoted either way, but for a different reason.
  // "Missing Prerequisites" folds into this same tab — it's still "not done
  // yet", just with the added, more specific reason that a subject they're
  // missing can't even be enrolled in until its own prerequisite/co-requisite
  // is cleared (see the per-row "Blocked by prerequisite" note below).
  const incompleteStudents = students.filter(s => s.promotion_status === 'Incomplete Subjects' || s.promotion_status === 'Missing Prerequisites');
  // Passed everything required — but at least one of those classes hasn't
  // cleared both sign-offs yet (Chairperson verification + Admin approval).
  // Not a grading problem, just not signed off yet, so it's kept distinct
  // from "Incomplete"/"Failed" — the fix here is verifying/approving the
  // class, not re-grading anything.
  const pendingVerificationStudents = students.filter(s => s.promotion_status === 'Pending Verification');
  const noGradesStudents  = students.filter(s => s.promotion_status === 'No Grades');

  // ── Apply filters ───────────────────────────────────────────────────
  const applyFilters = (list) => list.filter(s => {
    if (programFilter && s.program !== programFilter) return false;
    if (yearFilter && s.year_level !== parseInt(yearFilter)) return false;
    return true;
  });

  const filteredRegular    = applyFilters(regularStudents);
  const filteredIrregular  = applyFilters(irregularStudents);
  const filteredIncomplete = applyFilters(incompleteStudents);
  const filteredPendingVerification = applyFilters(pendingVerificationStudents);
  const filteredNoGrades   = applyFilters(noGradesStudents);
  const filteredGraduating = applyFilters(graduatingStudents);

  // ── Group regular: Program → Year → Section ──────────────────────────
  const groupedRegular = {};
  filteredRegular.forEach(s => {
    const prog = s.program || 'No Program';
    const yr   = `Year ${s.year_level || '?'}`;
    const sec  = s.section || 'No Section';
    if (!groupedRegular[prog]) groupedRegular[prog] = {};
    if (!groupedRegular[prog][yr]) groupedRegular[prog][yr] = {};
    if (!groupedRegular[prog][yr][sec]) groupedRegular[prog][yr][sec] = [];
    groupedRegular[prog][yr][sec].push(s);
  });

  // Retake Blocked's own Program → Year grouping is computed inline where
  // it's rendered (it also needs the tab's own subject filter applied first).

  // ── Group incomplete: Program → Year ─────────────────────────────────
  const groupedIncomplete = {};
  filteredIncomplete.forEach(s => {
    const prog = s.program || 'No Program';
    const yr   = `Year ${s.year_level || '?'}`;
    if (!groupedIncomplete[prog]) groupedIncomplete[prog] = {};
    if (!groupedIncomplete[prog][yr]) groupedIncomplete[prog][yr] = [];
    groupedIncomplete[prog][yr].push(s);
  });

  // ── Group pending verification: Program → Year ───────────────────────
  const groupedPendingVerification = {};
  filteredPendingVerification.forEach(s => {
    const prog = s.program || 'No Program';
    const yr   = `Year ${s.year_level || '?'}`;
    if (!groupedPendingVerification[prog]) groupedPendingVerification[prog] = {};
    if (!groupedPendingVerification[prog][yr]) groupedPendingVerification[prog][yr] = [];
    groupedPendingVerification[prog][yr].push(s);
  });

  // ── Group no grades: Program → Year ─────────────────────────────────
  const groupedNoGrades = {};
  filteredNoGrades.forEach(s => {
    const prog = s.program || 'No Program';
    const yr   = `Year ${s.year_level || '?'}`;
    if (!groupedNoGrades[prog]) groupedNoGrades[prog] = {};
    if (!groupedNoGrades[prog][yr]) groupedNoGrades[prog][yr] = [];
    groupedNoGrades[prog][yr].push(s);
  });

  // ── Group graduating: Program ─────────────────────────────────────────
  const groupedGraduating = {};
  filteredGraduating.forEach(s => {
    const prog = s.program || 'No Program';
    if (!groupedGraduating[prog]) groupedGraduating[prog] = [];
    groupedGraduating[prog].push(s);
  });

  // ── Promote button label based on semester ──────────────────────────
  const promoteLabel = currentSemLabel === '1st'
    ? 'Advance to 2nd Semester'
    : 'Promote to Next Year';

  if (loading) return <LoadingSpinner />;

  // ── Semester flow stepper data ────────────────────────────────────────
  const semesterSteps = [
    { label: '1st Year', sems: ['1st Sem', '2nd Sem'] },
    { label: '2nd Year', sems: ['1st Sem', '2nd Sem'] },
    { label: '3rd Year', sems: ['1st Sem', '2nd Sem'] },
    { label: '4th Year', sems: ['1st Sem', '2nd Sem'] },
  ];

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Promotion Management</h2>
          <p className="text-[13px] text-gray-500">
            Evaluate and promote students once verified — across all programs
          </p>
        </div>
      </div>

      {/* ── Promotion Pathway Info ─────────────────────────────────────── */}
      <div className="card mb-5 bg-navy/5 border border-navy/10">
        <div className="card-body py-4">
          <p className="text-xs font-semibold text-navy uppercase tracking-wide mb-3">Promotion Pathway</p>
          {/* Wraps to fit the card's own width instead of forcing a
              horizontal scrollbar — each step (box + its arrow) is one
              flex-shrink-0 unit, so a narrower viewport (e.g. Admin's
              sidebar layout) just wraps onto a second line instead of
              spilling out of or getting clipped by the card's rounded
              corners. */}
          <div className="flex flex-wrap items-center gap-y-2">
            {semesterSteps.map((yr, yi) =>
              yr.sems.map((sem, si) => {
                const isLast = yi === 3 && si === 1;
                return (
                  <div key={`${yi}-${si}`} className="flex items-center flex-shrink-0">
                    <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg text-center ${isLast ? 'bg-purple-100 border border-purple-200' : 'bg-white border border-gray-200'}`}>
                      <span className="text-[10px] font-bold text-gray-400 whitespace-nowrap">{yr.label}</span>
                      <span className={`text-[13px] font-bold mt-0.5 whitespace-nowrap ${isLast ? 'text-purple-700' : 'text-navy'}`}>{sem}</span>
                    </div>
                    {!(yi === 3 && si === 1) && (
                      <div className={`flex items-center mx-1 flex-shrink-0 ${si === 1 ? 'text-gold' : 'text-gray-300'}`}>
                        <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {si === 1 && <span className="text-[10px] font-bold text-gold -ml-1 mr-1 whitespace-nowrap">YR</span>}
                      </div>
                    )}
                    {yi === 3 && si === 1 && (
                      <div className="flex items-center ml-2 flex-shrink-0">
                        <span className="text-[13px] font-bold text-purple-600 bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-lg whitespace-nowrap">🎓 Graduate</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            <span className="text-gold font-bold">YR</span> = Year promotion · Students must pass each semester to advance to the next step
          </p>
        </div>
      </div>

      {/* ── Step 1: Configure ─────────────────────────────────────────── */}
      <div className="card mb-5">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 bg-navy text-white rounded-full text-xs font-bold flex items-center justify-center">1</span>
            <h3 className="text-base font-semibold text-navy">Select Evaluation Period</h3>
          </div>
          <p className="text-xs text-gray-400 mt-1 ml-8">
            Choose the semester. For 1st semester results: students advance to 2nd semester. For 2nd semester results: students promote to the next year level.
          </p>
        </div>
        <div className="card-body">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="form-label">Semester <span className="text-red-500">*</span></label>
              <select className="form-select" value={selectedSemester} onChange={e => { setSelectedSemester(e.target.value); setEvaluated(false); setStudents([]); }}>
                <option value="">Select Semester</option>
                {semesters.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            {selectedSemester && currentSemLabel && (
              <div>
                {/* Invisible label spacer — matches the real `form-label`
                    height above Semester/Program/Year Level next to it, so
                    this badge's own row lines up with theirs under
                    `items-end` instead of floating at an odd height. */}
                <label className="form-label invisible" aria-hidden="true">Status</label>
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-semibold whitespace-nowrap ${currentSemLabel === '2nd' ? 'bg-gold/10 border-gold/30 text-gold' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                  {currentSemLabel === '2nd'
                    ? <><Icons.Award className="w-3.5 h-3.5" /> Year Promotion Semester</>
                    : <><Icons.Flag className="w-3.5 h-3.5" /> Semester Advancement</>
                  }
                </div>
              </div>
            )}

            <div className="flex-1 min-w-[200px]">
              <label className="form-label">Program (optional)</label>
              <select className="form-select" value={programFilter} onChange={e => setProgramFilter(e.target.value)}>
                <option value="">All Programs</option>
                {PROGRAMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="min-w-[140px]">
              <label className="form-label">Year Level (optional)</label>
              <select className="form-select" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
                <option value="">All Years</option>
                {[1, 2, 3, 4].map(y => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label invisible" aria-hidden="true">Go</label>
              <button className="btn btn-gold whitespace-nowrap" onClick={handleEvaluate} disabled={!selectedSemester || evaluating}>
                {evaluating
                  ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Evaluating...</>
                  : <><Icons.Search className="w-4 h-4" /> Evaluate Students</>
                }
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Results ──────────────────────────────────────────────────── */}
      {evaluated && (
        <>
          {/* Step 2: Summary */}
          <div className="card mb-5">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 bg-navy text-white rounded-full text-xs font-bold flex items-center justify-center">2</span>
                <h3 className="text-base font-semibold text-navy">Evaluation Results — {selectedSemester}</h3>
              </div>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                {/* Regular / Eligible */}
                <div
                  onClick={() => setActiveTab('regular')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'regular' ? 'bg-green-100 border-green-400 ring-2 ring-green-300' : 'bg-green-50 border-green-100 hover:border-green-300'}`}
                >
                  <p className="text-2xl font-bold text-green-600">{regularStudents.length}</p>
                  <p className="text-xs text-green-700 font-medium mt-1">
                    {currentSemLabel === '1st' ? 'Advance to 2nd Sem' : 'Promote to Next Year'}
                  </p>
                  <p className="text-[10px] text-green-500 mt-0.5">All subjects passed</p>
                </div>

                {/* Irregular */}
                <div
                  onClick={() => setActiveTab('irregular')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'irregular' ? 'bg-red-100 border-red-400 ring-2 ring-red-300' : 'bg-red-50 border-red-100 hover:border-red-300'}`}
                >
                  <p className="text-2xl font-bold text-red-500">{irregularStudents.length}</p>
                  <p className="text-xs text-red-700 font-medium mt-1">Retake Blocked</p>
                  <p className="text-[10px] text-red-400 mt-0.5">Prerequisite not yet cleared</p>
                </div>

                {/* Incomplete Subjects */}
                <div
                  onClick={() => setActiveTab('incomplete')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'incomplete' ? 'bg-orange-100 border-orange-400 ring-2 ring-orange-300' : 'bg-orange-50 border-orange-100 hover:border-orange-300'}`}
                >
                  <p className="text-2xl font-bold text-orange-500">{incompleteStudents.length}</p>
                  <p className="text-xs text-orange-700 font-medium mt-1">Incomplete Subjects</p>
                  <p className="text-[10px] text-orange-500 mt-0.5">Missing a required subject</p>
                </div>

                {/* Pending Verification */}
                <div
                  onClick={() => setActiveTab('pending-verification')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'pending-verification' ? 'bg-blue-100 border-blue-400 ring-2 ring-blue-300' : 'bg-blue-50 border-blue-100 hover:border-blue-300'}`}
                >
                  <p className="text-2xl font-bold text-blue-500">{pendingVerificationStudents.length}</p>
                  <p className="text-xs text-blue-700 font-medium mt-1">Pending Verification</p>
                  <p className="text-[10px] text-blue-500 mt-0.5">Passed, awaiting sign-off</p>
                </div>

                {/* No Grades */}
                <div
                  onClick={() => setActiveTab('no-grades')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'no-grades' ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300' : 'bg-amber-50 border-amber-100 hover:border-amber-300'}`}
                >
                  <p className="text-2xl font-bold text-amber-600">{noGradesStudents.length}</p>
                  <p className="text-xs text-amber-700 font-medium mt-1">No Grades Yet</p>
                  <p className="text-[10px] text-amber-500 mt-0.5">Grades not submitted</p>
                </div>

                {/* Graduating */}
                <div
                  onClick={() => setActiveTab('graduating')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'graduating' ? 'bg-purple-100 border-purple-400 ring-2 ring-purple-300' : 'bg-purple-50 border-purple-100 hover:border-purple-300'}`}
                >
                  <p className="text-2xl font-bold text-purple-600">{graduatingStudents.length}</p>
                  <p className="text-xs text-purple-700 font-medium mt-1">For Graduation</p>
                  <p className="text-[10px] text-purple-400 mt-0.5">4th Year, 2nd Sem · All passed</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">
                Click a card to switch view · {students.length} total students evaluated
              </p>
            </div>
          </div>

          {/* Step 3: Review */}
          <div className="card mb-5">
            <div className="card-header border-b border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 bg-navy text-white rounded-full text-xs font-bold flex items-center justify-center">3</span>
                  <h3 className="text-base font-semibold text-navy">Review & Process Students</h3>
                </div>
              </div>

            </div>

            {/* ══ REGULAR TAB ══════════════════════════════════════════════ */}
            {activeTab === 'regular' && (
              <div className="p-5">
                {/* Context banner */}
                {currentSemLabel && (
                  <div className={`flex items-start gap-3 px-4 py-3 rounded-xl mb-5 border ${currentSemLabel === '2nd' ? 'bg-gold/10 border-gold/30' : 'bg-blue-50 border-blue-200'}`}>
                    <Icons.Flag className={`w-4 h-4 mt-0.5 flex-shrink-0 ${currentSemLabel === '2nd' ? 'text-gold' : 'text-blue-500'}`} />
                    <div className="flex-1">
                      <p className={`text-sm font-semibold ${currentSemLabel === '2nd' ? 'text-amber-800' : 'text-blue-800'}`}>
                        {currentSemLabel === '1st'
                          ? 'Advancing students from 1st Semester → 2nd Semester (same year level)'
                          : 'Promoting students from 2nd Semester → Next Year Level'}
                      </p>
                      <p className={`text-xs mt-0.5 ${currentSemLabel === '2nd' ? 'text-amber-700' : 'text-blue-600'}`}>
                        {currentSemLabel === '1st'
                          ? 'These students passed all 1st semester subjects and are eligible to enroll in 2nd semester courses.'
                          : 'These students passed all 2nd semester subjects and are eligible for year-level promotion. 4th year students will be marked For Graduation.'}
                      </p>
                    </div>
                  </div>
                )}

                {filteredRegular.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No eligible students found</p>
                    <p className="text-sm mt-1">Try adjusting your filters</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupedRegular).sort().map(([program, yearGroups]) => {
                      const programStudents = Object.values(yearGroups).flatMap(yr => Object.values(yr).flat());
                      const programKey = `reg|${program}`;
                      const programOpen = !!expanded[programKey];

                      return (
                        <div key={program} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-navy text-white flex items-center justify-between">
                            <button
                              onClick={() => toggleExpanded(programKey)}
                              className="flex items-center gap-3 border-none bg-transparent cursor-pointer font-sans text-left p-0 flex-1"
                            >
                              {programOpen ? <Icons.ChevronUp className="w-4 h-4 text-white/60 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-white/60 flex-shrink-0" />}
                              <Icons.Award className="w-4 h-4 text-gold opacity-90 flex-shrink-0" />
                              <div>
                                <h4 className="text-sm font-semibold flex items-center gap-1.5"><ProgramDot program={program} />{program}</h4>
                                <p className="text-[11px] opacity-60">{programStudents.length} students eligible</p>
                              </div>
                            </button>
                          </div>

                          {programOpen && Object.entries(yearGroups).sort().map(([year, sections]) => {
                            const totalInYear = Object.values(sections).reduce((t, s) => t + s.length, 0);
                            const yearNum = parseInt(year.replace('Year ', ''));
                            const { label: nextStepLabel } = getNextStep(yearNum, currentSemLabel);
                            const yearKey = `${programKey}|${year}`;
                            const yearOpen = !!expanded[yearKey];

                            return (
                              <div key={year} className="border-t border-gray-100">
                                <button
                                  onClick={() => toggleExpanded(yearKey)}
                                  className="w-full px-5 py-2.5 bg-blue-50/60 hover:bg-blue-50 flex items-center justify-between border-none cursor-pointer font-sans transition-colors"
                                >
                                  <div className="flex items-center gap-2">
                                    {yearOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-blue-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-blue-400" />}
                                    <Icons.Flag className="w-3.5 h-3.5 text-blue-500" />
                                    <span className="text-sm font-semibold text-blue-800">{year}</span>
                                    <span className="text-[11px] text-gray-400">
                                      · {totalInYear} students · {Object.keys(sections).length} section{Object.keys(sections).length > 1 ? 's' : ''}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-blue-600 font-semibold bg-blue-100 px-2.5 py-1 rounded-full">
                                    → {nextStepLabel}
                                  </span>
                                </button>

                                {yearOpen && Object.entries(sections).sort().map(([section, sectionStudents]) => {
                                  const sectionKey = `${yearKey}|${section}`;
                                  const sectionOpen = !!expanded[sectionKey];

                                  return (
                                    <div key={section} className="border-t border-gray-100">
                                      <div className="px-6 py-2 bg-white flex items-center justify-between">
                                        <button
                                          onClick={() => toggleExpanded(sectionKey)}
                                          className="flex items-center gap-2 border-none bg-transparent cursor-pointer font-sans text-left p-0"
                                        >
                                          {sectionOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                                          <span className="w-6 h-6 bg-gold/20 text-gold rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0">
                                            {section === 'No Section' ? '?' : section.charAt(0)}
                                          </span>
                                          <span className="text-sm font-semibold text-gray-700">
                                            {section === 'No Section' ? 'No Section Assigned' : `Section ${section}`}
                                          </span>
                                          <Badge variant="blue">{sectionStudents.length} students</Badge>
                                        </button>
                                      </div>

                                      {sectionOpen && (
                                      <div className="overflow-x-auto">
                                      <table className="w-full">
                                        <thead>
                                          <tr className="bg-gray-50/80">
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Subjects Passed</th>
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Next Step</th>
                                            <th className="w-10 px-4 py-2" />
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sectionStudents.sort(compareStudentNames).map(s => {
                                            const { label: nextStep } = getNextStep(s.year_level, currentSemLabel);
                                            return (
                                              <tr
                                                key={s.id}
                                                className="border-b border-gray-50 transition-colors hover:bg-gray-50/40"
                                              >
                                                <td className="px-4 py-2.5">
                                                  <div className="flex items-center gap-2">
                                                    <Avatar letter={s.avatar || s.name?.[0]} className="bg-green-500 text-white" size="w-7 h-7 text-xs" />
                                                    <div>
                                                      <span className="text-[13px] font-medium">{displayStudentName(s.name)}</span>
                                                      {/* Promotable, but flagged Irregular once actually promoted —
                                                          a standalone Failed subject (no prerequisite/co-requisite
                                                          chain) doesn't block advancing, it just rides along as an
                                                          extra retake next term. */}
                                                      {(s.retakable_failed_subjects || []).length > 0 && (
                                                        <p className="text-[10px] text-amber-600 font-medium">
                                                          Retaking: {s.retakable_failed_subjects.map((sub) => sub.code).join(', ')}
                                                        </p>
                                                      )}
                                                    </div>
                                                  </div>
                                                </td>
                                                <td className="px-4 py-2.5 text-sm text-gray-500">{s.student_no}</td>
                                                <td className="px-4 py-2.5">
                                                  <span className={`font-bold text-sm ${parseFloat(s.gwa) <= 3.0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {s.gwa || 'N/A'}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-sm">
                                                  <span className="text-green-600 font-semibold">{s.passed_count}</span>
                                                  <span className="text-gray-400 text-xs ml-1">subjects</span>
                                                </td>
                                                <td className="px-4 py-2.5">
                                                  <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                                    → {nextStep}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2.5">
                                                  <button className="btn-icon" onClick={() => setViewStudent(s)} title="View grades">
                                                    <Icons.Eye />
                                                  </button>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
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

                {filteredRegular.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <p className="text-sm text-gray-500">
                      <span className="font-semibold text-navy">{filteredRegular.length}</span> eligible student{filteredRegular.length !== 1 ? 's' : ''}
                    </p>
                    {canAct && (
                      <div className="flex gap-2">
                        <button
                          className="btn btn-gold"
                          onClick={() => handlePromote(filteredRegular.map((s) => s.id))}
                          disabled={promoting}
                        >
                          {promoting
                            ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Processing...</>
                            : <><Icons.Check className="w-4 h-4" /> {promoteLabel} — All ({filteredRegular.length})</>
                          }
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ══ IRREGULAR TAB ════════════════════════════════════════════ */}
            {activeTab === 'irregular' && (() => {
              // Every unique subject code someone here is blocked on — feeds
              // the "still needs" filter below.
              const blockedSubjectCodes = [...new Set(
                filteredIrregular.flatMap((s) => (s.retakable_failed_subjects || []).filter((f) => f.blocked_by_prereq).map((f) => f.code))
              )].sort();

              const subjectFilteredIrregular = retakeSubjectFilter
                ? filteredIrregular.filter((s) => (s.retakable_failed_subjects || []).some((f) => f.blocked_by_prereq && f.code === retakeSubjectFilter))
                : filteredIrregular;

              const groupedSubjectFiltered = {};
              subjectFilteredIrregular.forEach((s) => {
                const prog = s.program || 'No Program';
                const yr = `Year ${s.year_level || '?'}`;
                if (!groupedSubjectFiltered[prog]) groupedSubjectFiltered[prog] = {};
                if (!groupedSubjectFiltered[prog][yr]) groupedSubjectFiltered[prog][yr] = [];
                groupedSubjectFiltered[prog][yr].push(s);
              });

              return (
              <div className="p-5">
                {filteredIrregular.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Check className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No retakes blocked</p>
                    <p className="text-sm mt-1">Every retake owed right now can already be auto-enrolled once its class opens.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-red-50 border border-red-200 rounded-xl mb-5">
                      <Icons.AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-red-700">
                          {irregularStudents.length} student{irregularStudents.length > 1 ? 's' : ''} can't retake a failed subject yet
                        </p>
                        <p className="text-xs text-red-500 mt-0.5">
                          A failed subject never blocks promotion — these students have already advanced and are flagged Irregular.
                          But the subject(s) below have their own prerequisite/co-requisite that isn't cleared yet, so the system
                          can't auto-enroll them into a retake until that's passed first.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mb-4">
                      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Still needs:</label>
                      <select
                        className="form-select max-w-xs"
                        value={retakeSubjectFilter}
                        onChange={(e) => setRetakeSubjectFilter(e.target.value)}
                      >
                        <option value="">All subjects ({blockedSubjectCodes.length})</option>
                        {blockedSubjectCodes.map((code) => <option key={code} value={code}>{code}</option>)}
                      </select>
                      {retakeSubjectFilter && (
                        <button className="text-xs text-gray-400 hover:text-gray-600 bg-transparent border-none cursor-pointer font-sans underline" onClick={() => setRetakeSubjectFilter('')}>
                          Clear
                        </button>
                      )}
                      <span className="text-xs text-gray-400 ml-auto">{subjectFilteredIrregular.length} of {filteredIrregular.length} shown</span>
                    </div>

                    {subjectFilteredIrregular.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-10">No students blocked on {retakeSubjectFilter}.</p>
                    ) : (
                    <div className="space-y-3">
                      {Object.entries(groupedSubjectFiltered).sort().map(([program, yearGroups]) => {
                        const progKey = `irreg|${program}`;
                        const progOpen = !!expanded[progKey];
                        const progTotal = Object.values(yearGroups).reduce((t, yr) => t + yr.length, 0);
                        return (
                        <div key={program} className="border border-red-200 rounded-xl overflow-hidden shadow-sm">
                          <button
                            onClick={() => toggleExpanded(progKey)}
                            className="w-full px-5 py-3.5 bg-red-600 text-white flex items-center gap-3 border-none cursor-pointer font-sans transition-opacity hover:opacity-95"
                          >
                            {progOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 flex-shrink-0" /> : <Icons.ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />}
                            <Icons.Flag className="w-4 h-4 opacity-80" />
                            <div className="text-left">
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">{progTotal} student(s) with a blocked retake</p>
                            </div>
                          </button>

                          {progOpen && Object.entries(yearGroups).sort().map(([year, yearStudents]) => {
                            const yearKey = `${progKey}|${year}`;
                            const yearOpen = !!expanded[yearKey];
                            return (
                            <div key={year} className="border-t border-red-100">
                              <button
                                onClick={() => toggleExpanded(yearKey)}
                                className="w-full px-5 py-2.5 bg-red-50/70 flex items-center gap-2 border-none cursor-pointer font-sans hover:bg-red-50"
                              >
                                {yearOpen ? <Icons.ChevronUp className="w-3 h-3 text-red-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-3 h-3 text-red-400 flex-shrink-0" />}
                                <span className="text-sm font-semibold text-red-700">{year}</span>
                                <span className="text-[11px] text-gray-400">· {yearStudents.length} students</span>
                              </button>

                              {yearOpen && (
                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Blocked Retake — Still Needs</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Passed</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {yearStudents.sort(compareStudentNames).map(s => (
                                      <tr key={s.id} className="border-b border-gray-50 hover:bg-red-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-2.5">
                                            <Avatar letter={s.avatar || s.name?.[0]} className="bg-red-400 text-white" size="w-8 h-8 text-xs" />
                                            <span className="text-[13px] font-semibold">{displayStudentName(s.name)}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                        <td className="px-4 py-3">
                                          {s.section
                                            ? <Badge variant="blue">Section {s.section}</Badge>
                                            : <span className="text-gray-400 text-xs">—</span>
                                          }
                                        </td>
                                        <td className="px-4 py-3">
                                          <span className="font-bold text-sm text-red-500">{s.gwa || 'N/A'}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="flex flex-col gap-1">
                                            {(s.retakable_failed_subjects || []).filter(f => f.blocked_by_prereq).map((f, i) => (
                                              <div key={i} className="text-[11px]">
                                                <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">{f.code}</span>
                                                <span className="text-gray-400 ml-1.5">needs {(f.unmet_prerequisites || []).join(', ')}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                          <span className="text-green-600 font-semibold">{s.passed_count}</span>
                                          <span className="text-gray-400 text-xs ml-1">subj</span>
                                        </td>
                                        <td className="px-4 py-3">
                                          <button className="btn-icon" onClick={() => setViewStudent(s)} title="View all grades">
                                            <Icons.Eye />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
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
                  </>
                )}
              </div>
              );
            })()}

            {/* ══ INCOMPLETE SUBJECTS TAB ═════════════════════════════════════
                Nothing they were graded on was Failed, but they're still
                missing a Passed grade for at least one curriculum-required
                subject this year+semester — never enrolled, or enrolled but
                never submitted. Shows exactly which subject(s) are missing. */}
            {activeTab === 'incomplete' && (
              <div className="p-5">
                {filteredIncomplete.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Check className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No students with incomplete subjects</p>
                    <p className="text-sm mt-1">Everyone evaluated has either finished every required subject or failed one.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-orange-50 border border-orange-200 rounded-xl mb-5">
                      <Icons.Clock className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-orange-700">
                          {incompleteStudents.length} student{incompleteStudents.length > 1 ? 's' : ''} still missing a required subject
                        </p>
                        <p className="text-xs text-orange-500 mt-0.5">
                          Not Failed — but not done either. They were never enrolled in, or enrolled but never graded
                          for, at least one subject their curriculum requires this year and semester — including some who
                          can't even enroll yet because a prerequisite or co-requisite isn't cleared (flagged below) — so
                          they can't be promoted yet. Running {promoteLabel} on the Review tab will automatically mark them Irregular.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {Object.entries(groupedIncomplete).sort().map(([program, yearGroups]) => (
                        <div key={program} className="border border-orange-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-orange-500 text-white flex items-center gap-3">
                            <Icons.Clock className="w-4 h-4 opacity-80" />
                            <div>
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">
                                {Object.values(yearGroups).reduce((t, yr) => t + yr.length, 0)} students with incomplete subjects
                              </p>
                            </div>
                          </div>

                          {Object.entries(yearGroups).sort().map(([year, yearStudents]) => (
                            <div key={year} className="border-t border-orange-100">
                              <div className="px-5 py-2.5 bg-orange-50/70 flex items-center gap-2">
                                <Icons.Clock className="w-3.5 h-3.5 text-orange-400" />
                                <span className="text-sm font-semibold text-orange-700">{year}</span>
                                <span className="text-[11px] text-gray-400">· {yearStudents.length} students</span>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Completed</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Missing Subject(s)</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {yearStudents.sort(compareStudentNames).map(s => (
                                      <tr key={s.id} className="border-b border-gray-50 hover:bg-orange-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-2.5">
                                            <Avatar letter={s.avatar || s.name?.[0]} className="bg-orange-400 text-white" size="w-8 h-8 text-xs" />
                                            <span className="text-[13px] font-semibold">{displayStudentName(s.name)}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                        <td className="px-4 py-3">
                                          {s.section
                                            ? <Badge variant="blue">Section {s.section}</Badge>
                                            : <span className="text-gray-400 text-xs">—</span>
                                          }
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                          <span className="text-green-600 font-semibold">{s.passed_count}</span>
                                          <span className="text-gray-400 text-xs"> / {s.required_count ?? '—'} required</span>
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="flex flex-wrap gap-1">
                                            {(s.missing_subjects || []).map((sub, i) => (
                                              <span key={i} className="text-[11px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-semibold" title={sub.name}>
                                                {sub.code}
                                              </span>
                                            ))}
                                          </div>
                                          {(s.missing_prerequisites || []).length > 0 && (
                                            <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                                              <Icons.AlertTriangle className="w-3 h-3 flex-shrink-0" />
                                              Blocked by prerequisite: {s.missing_prerequisites.flatMap((sub) => sub.unmet).join(', ')}
                                            </p>
                                          )}
                                        </td>
                                        <td className="px-4 py-3">
                                          <button className="btn-icon" onClick={() => setViewStudent(s)} title="View all grades">
                                            <Icons.Eye />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══ PENDING VERIFICATION TAB ═════════════════════════════════════
                Passed every required subject — but at least one of those
                classes hasn't cleared both sign-offs yet (Chairperson
                verification + Admin approval on every Passed grade). Nothing
                to re-grade here; the fix is verifying/approving the class
                itself, on the Grade Sheet and Class Records / Grade Approval
                pages — Promote re-checks this server-side regardless, so
                these students are skipped either way. */}
            {activeTab === 'pending-verification' && (
              <div className="p-5">
                {filteredPendingVerification.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Check className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">Nothing pending verification</p>
                    <p className="text-sm mt-1">Everyone who's passed everything has also been fully verified and approved.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-blue-50 border border-blue-200 rounded-xl mb-5">
                      <Icons.Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-blue-700">
                          {pendingVerificationStudents.length} student{pendingVerificationStudents.length > 1 ? 's' : ''} passed everything, but aren't fully signed off yet
                        </p>
                        <p className="text-xs text-blue-500 mt-0.5">
                          Not failed, not incomplete — just waiting on Chairperson verification and/or Admin approval for one
                          or more classes. Verify &amp; Forward those classes on Grade Sheet and Class Records (or approve them
                          on Grade Approval) before they can be released or promoted.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {Object.entries(groupedPendingVerification).sort().map(([program, yearGroups]) => (
                        <div key={program} className="border border-blue-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-blue-500 text-white flex items-center gap-3">
                            <Icons.Clock className="w-4 h-4 opacity-80" />
                            <div>
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">
                                {Object.values(yearGroups).reduce((t, yr) => t + yr.length, 0)} students pending verification
                              </p>
                            </div>
                          </div>

                          {Object.entries(yearGroups).sort().map(([year, yearStudents]) => (
                            <div key={year} className="border-t border-blue-100">
                              <div className="px-5 py-2.5 bg-blue-50/70 flex items-center gap-2">
                                <Icons.Clock className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-sm font-semibold text-blue-700">{year}</span>
                                <span className="text-[11px] text-gray-400">· {yearStudents.length} students</span>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Awaiting Sign-off</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {yearStudents.sort(compareStudentNames).map(s => (
                                      <tr key={s.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-2.5">
                                            <Avatar letter={s.avatar || s.name?.[0]} className="bg-blue-400 text-white" size="w-8 h-8 text-xs" />
                                            <span className="text-[13px] font-semibold">{displayStudentName(s.name)}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                        <td className="px-4 py-3">
                                          {s.section
                                            ? <Badge variant="blue">Section {s.section}</Badge>
                                            : <span className="text-gray-400 text-xs">—</span>
                                          }
                                        </td>
                                        <td className="px-4 py-3">
                                          <span className="font-bold text-sm text-navy">{s.gwa || 'N/A'}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="flex flex-wrap gap-1">
                                            {(s.unverified_subjects || []).map((sub, i) => (
                                              <span key={i} className="text-[11px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold" title={sub.name}>
                                                {sub.code}
                                              </span>
                                            ))}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3">
                                          <button className="btn-icon" onClick={() => setViewStudent(s)} title="View all grades">
                                            <Icons.Eye />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══ NO GRADES TAB ════════════════════════════════════════════ */}
            {activeTab === 'no-grades' && (
              <div className="p-5">
                {filteredNoGrades.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Check className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">All students have grades submitted</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl mb-5">
                      <Icons.AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-amber-800">
                          {noGradesStudents.length} student{noGradesStudents.length > 1 ? 's' : ''} have no submitted grades for this semester
                        </p>
                        <p className="text-xs text-amber-600 mt-0.5">
                          These students cannot be evaluated for promotion until their faculty submit grades.
                          Please follow up with the concerned instructors.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {Object.entries(groupedNoGrades).sort().map(([program, yearGroups]) => (
                        <div key={program} className="border border-amber-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-amber-500 text-white flex items-center gap-3">
                            <Icons.Flag className="w-4 h-4 opacity-80" />
                            <div>
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">
                                {Object.values(yearGroups).reduce((t, yr) => t + yr.length, 0)} students without grades
                              </p>
                            </div>
                          </div>

                          {Object.entries(yearGroups).sort().map(([year, yearStudents]) => (
                            <div key={year} className="border-t border-amber-100">
                              <div className="px-5 py-2.5 bg-amber-50/70 flex items-center gap-2">
                                <Icons.Flag className="w-3.5 h-3.5 text-amber-400" />
                                <span className="text-sm font-semibold text-amber-800">{year}</span>
                                <span className="text-[11px] text-gray-400">· {yearStudents.length} students · pending grade submission</span>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Program</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Status</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {yearStudents.sort(compareStudentNames).map(s => (
                                      <tr key={s.id} className="border-b border-gray-50 hover:bg-amber-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-2.5">
                                            <Avatar letter={s.avatar || s.name?.[0]} className="bg-amber-400 text-white" size="w-8 h-8 text-xs" />
                                            <span className="text-[13px] font-semibold">{displayStudentName(s.name)}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                        <td className="px-4 py-3">
                                          {s.section
                                            ? <Badge variant="blue">Section {s.section}</Badge>
                                            : <span className="text-gray-400 text-xs">—</span>
                                          }
                                        </td>
                                        <td className="px-4 py-3">
                                          {s.program ? <ProgramBadge program={s.program} /> : <span className="text-xs text-gray-600">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                          <Badge variant="yellow">No Grades Submitted</Badge>
                                        </td>
                                        <td className="px-4 py-3">
                                          <button className="btn-icon" onClick={() => setViewStudent(s)} title="View student details">
                                            <Icons.Eye />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══ GRADUATING TAB ═══════════════════════════════════════════ */}
            {activeTab === 'graduating' && (
              <div className="p-5">
                {filteredGraduating.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Award className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No graduating students</p>
                    <p className="text-sm mt-1">
                      {currentSemLabel !== '2nd'
                        ? 'Graduating students only appear during 2nd semester evaluation.'
                        : 'No 4th year students with all subjects passed found.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-purple-50 border border-purple-200 rounded-xl mb-5">
                      <Icons.Award className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-purple-800">
                          🎓 {graduatingStudents.length} student{graduatingStudents.length > 1 ? 's' : ''} eligible for graduation
                        </p>
                        <p className="text-xs text-purple-600 mt-0.5">
                          These are 4th year students who have passed all subjects in their final semester.
                          Process their graduation clearance and mark them as graduated.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {Object.entries(groupedGraduating).sort().map(([program, progStudents]) => (
                        <div key={program} className="border border-purple-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-purple-700 text-white flex items-center gap-3">
                            <Icons.Award className="w-4 h-4 opacity-90" />
                            <div>
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">{progStudents.length} graduating students</p>
                            </div>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-purple-50/50 border-b border-purple-100">
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Subjects Passed</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Status</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {progStudents.sort(compareStudentNames).map(s => (
                                  <tr key={s.id} className="border-b border-gray-50 hover:bg-purple-50/30 transition-colors">
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2.5">
                                        <Avatar letter={s.avatar || s.name?.[0]} className="bg-purple-500 text-white" size="w-8 h-8 text-xs" />
                                        <div>
                                          <span className="text-[13px] font-semibold">{displayStudentName(s.name)}</span>
                                          <p className="text-[10px] text-purple-500 font-medium">4th Year · Final Semester</p>
                                          {(s.retakable_failed_subjects || []).length > 0 && (
                                            <p className="text-[10px] text-amber-600 font-medium">
                                              Retaking: {s.retakable_failed_subjects.map((sub) => sub.code).join(', ')}
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                    <td className="px-4 py-3">
                                      {s.section
                                        ? <Badge variant="blue">Section {s.section}</Badge>
                                        : <span className="text-gray-400 text-xs">—</span>
                                      }
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`font-bold text-sm ${parseFloat(s.gwa) <= 3.0 ? 'text-green-600' : 'text-gray-400'}`}>
                                        {s.gwa || 'N/A'}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                      <span className="text-green-600 font-semibold">{s.passed_count}</span>
                                      <span className="text-gray-400 text-xs ml-1">subjects</span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Badge variant="purple"><Icons.Award className="w-3 h-3" /> For Graduation</Badge>
                                    </td>
                                    <td className="px-4 py-3">
                                      <button className="btn-icon" onClick={() => setViewStudent(s)} title="View grades">
                                        <Icons.Eye />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
                      <p className="text-sm text-gray-500">
                        <span className="font-semibold text-purple-700">{filteredGraduating.length}</span> student{filteredGraduating.length !== 1 ? 's' : ''} ready for graduation processing
                      </p>
                      <p className="text-xs text-gray-400">Process graduation clearance through the Graduation module</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Grade Detail Modal ─────────────────────────────────────────── */}
      {viewStudent && (
        <Modal
          title={`${viewStudent.name} — Grade Detail`}
          onClose={() => setViewStudent(null)}
          size="max-w-2xl"
          footer={<button className="btn btn-outline" onClick={() => setViewStudent(null)}>Close</button>}
        >
          <div className="grid grid-cols-2 gap-3 text-sm mb-5">
            <div><span className="text-gray-500">Program:</span> <span className="ml-1">{viewStudent.program ? <ProgramBadge program={viewStudent.program} /> : '—'}</span></div>
            <div><span className="text-gray-500">Student No:</span> <span className="font-medium ml-1">{viewStudent.student_no}</span></div>
            <div><span className="text-gray-500">Year Level:</span> <span className="font-medium ml-1">Year {viewStudent.year_level}</span></div>
            <div><span className="text-gray-500">Section:</span> <span className="font-medium ml-1">{viewStudent.section ? `Section ${viewStudent.section}` : '—'}</span></div>
            <div>
              <span className="text-gray-500">GWA:</span>
              <span className={`font-bold ml-1 ${parseFloat(viewStudent.gwa) <= 3.0 ? 'text-green-600' : 'text-red-500'}`}>
                {viewStudent.gwa || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>
              <span className="ml-1">
                {(viewStudent.promotion_status === 'Eligible' || viewStudent.promotion_status === 'For Next Semester') &&
                  viewStudent.year_level !== 4 && (
                  <Badge variant="green">
                    {currentSemLabel === '1st' ? 'Advance to 2nd Semester' : 'Eligible for Promotion'}
                  </Badge>
                )}
                {viewStudent.promotion_status === 'Eligible (Retake Required)' && (
                  <Badge variant="yellow">Promotable — Retake Required</Badge>
                )}
                {viewStudent.promotion_status === 'Missing Prerequisites' && <Badge variant="red">Missing Prerequisites</Badge>}
                {viewStudent.promotion_status === 'Incomplete Subjects' && <Badge variant="orange">Incomplete Subjects</Badge>}
                {viewStudent.promotion_status === 'Pending Verification' && <Badge variant="blue">Pending Verification</Badge>}
                {(viewStudent.promotion_status === 'For Graduation' || (viewStudent.year_level === 4 && viewStudent.promotion_status === 'Eligible')) && (
                  <Badge variant="purple">For Graduation</Badge>
                )}
                {viewStudent.promotion_status === 'No Grades' && <Badge variant="yellow">No Grades Yet</Badge>}
              </span>
            </div>
          </div>

          {(viewStudent.retakable_failed_subjects || []).length > 0 && (
            <div className="mb-4 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-xs font-semibold text-amber-700 mb-1">
                Promotable — still owes a retake (never blocks advancing):
              </p>
              <div className="flex flex-col gap-1">
                {viewStudent.retakable_failed_subjects.map((sub, i) => (
                  sub.blocked_by_prereq ? (
                    <div key={i} className="text-[11px]">
                      <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold" title={sub.name}>{sub.code}</span>
                      <span className="text-red-500 ml-1.5">blocked until {(sub.unmet_prerequisites || []).join(', ')} passed</span>
                    </div>
                  ) : (
                    <div key={i} className="text-[11px]">
                      <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold" title={sub.name}>{sub.code}</span>
                      <span className="text-amber-600 ml-1.5">ready to auto-enroll once the class opens</span>
                    </div>
                  )
                ))}
              </div>
            </div>
          )}

          {(viewStudent.promotion_status === 'Incomplete Subjects' || viewStudent.promotion_status === 'Missing Prerequisites') && (viewStudent.missing_subjects || []).length > 0 && (
            <div className="mb-4 px-3 py-2.5 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-xs font-semibold text-orange-700 mb-1">
                Missing {viewStudent.missing_subjects.length} required subject{viewStudent.missing_subjects.length > 1 ? 's' : ''} this semester:
              </p>
              <div className="flex flex-wrap gap-1">
                {viewStudent.missing_subjects.map((sub, i) => (
                  <span key={i} className="text-[11px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-semibold" title={sub.name}>
                    {sub.code}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(viewStudent.missing_prerequisites || []).length > 0 && (
            <div className="mb-4 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-xs font-semibold text-red-700 mb-1">
                Can't enroll yet — prerequisite/co-requisite not cleared:
              </p>
              <div className="space-y-1">
                {viewStudent.missing_prerequisites.map((sub, i) => (
                  <p key={i} className="text-[11px] text-red-600">
                    <span className="font-semibold">{sub.code}</span> requires: {sub.unmet.join(', ')}
                  </p>
                ))}
              </div>
            </div>
          )}

          {viewStudent.promotion_status === 'Pending Verification' && (viewStudent.unverified_subjects || []).length > 0 && (
            <div className="mb-4 px-3 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs font-semibold text-blue-700 mb-1">
                Passed, but awaiting Chairperson verification and/or Admin approval — not yet visible to the student — on:
              </p>
              <div className="flex flex-wrap gap-1">
                {viewStudent.unverified_subjects.map((sub, i) => (
                  <span key={i} className="text-[11px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold" title={sub.name}>
                    {sub.code}
                  </span>
                ))}
              </div>
            </div>
          )}

          <h4 className="font-semibold text-navy mb-1 text-sm">Subjects This Semester</h4>
          <p className="text-[11px] text-gray-400 mb-3">
            This is what Admin sees for promotion evaluation — a subject only shows up on the student's own My Grades once Faculty actually clicks Release.
          </p>
          <div className="border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Subject</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Midterm</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Finals</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Average</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Remarks</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Visible to Student?</th>
                </tr>
              </thead>
              <tbody>
                {(viewStudent.grades || []).map((g, i) => (
                  <tr key={i} className={`border-t border-gray-50 ${g.status === 'Failed' ? 'bg-red-50/50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{g.subject_code}</p>
                      <p className="text-xs text-gray-400">{g.subject_name}</p>
                    </td>
                    {g.released ? (
                      <>
                        <td className="px-3 py-2.5 text-center font-semibold">{g.midterm ? parseFloat(g.midterm).toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5 text-center font-semibold">{g.finals ? parseFloat(g.finals).toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`font-bold ${g.status === 'Passed' ? 'text-green-600' : 'text-red-500'}`}>
                            {g.average ? parseFloat(g.average).toFixed(1) : '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Badge variant={g.status === 'Passed' ? 'green' : 'red'}>{g.status}</Badge>
                        </td>
                      </>
                    ) : (
                      // Not released yet — the actual scores stay hidden here
                      // too, not just on the student's own side, so this view
                      // can't be used as a backdoor to see a grade early.
                      <td colSpan="4" className="px-3 py-2.5 text-center text-xs text-gray-400 italic">Hidden until released</td>
                    )}
                    <td className="px-3 py-2.5 text-center">
                      {g.released
                        ? <Badge variant="green">Yes — Released</Badge>
                        : <Badge variant="gray">Not yet</Badge>}
                    </td>
                  </tr>
                ))}
                {(!viewStudent.grades || viewStudent.grades.length === 0) && (
                  <tr><td colSpan="6" className="text-center py-6 text-gray-400 text-xs">No submitted grades found.</td></tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
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