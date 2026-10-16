import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner, FacultyProgramTags, CurrentSemesterTag, studentYearSectionsLabel, ProgramDot, programShortLabel, formatPersonName, comparePeopleNames, SearchBar } from '../../components/common';
import { GradeDistributionChart } from '../../components/charts/GradeCharts';
import { GradeStatusChart, StudentsByYearChart } from '../../components/charts/AdminAnalyticsCharts';
import { endorsementService, dashboardService, gradeService } from '../../services';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';
import ArchivedActivitiesModal from '../../components/common/ArchivedActivitiesModal';
import FacultyProgressRow from '../../components/common/FacultyProgressRow';
import StudentGradeRecordModal from '../../components/common/StudentGradeRecordModal';
import socket, { onGradesUpdated } from '../../services/socket';
import { onSemestersUpdated } from '../../utils/semesterLabels';

// Excluded from grouping (same as UserManagement.js / AdminDashboard.js) — GE
// is a bonus tag every program's faculty can carry, not a program of its own.
const GE_OPTION = 'General Education (GE)';

// Groups the Faculty Submission Progress list the same way UserManagement's
// staff directory groups Faculty: Part-Time instructors pulled into their own
// standalone "Part Timer" group, everyone else bucketed under each of their
// real programs.
function groupFacultyReviewByProgram(facultyReview) {
  const partTime = facultyReview.filter((f) => f.instructor.employment_type === 'Part Time');
  const fullTime = facultyReview.filter((f) => f.instructor.employment_type !== 'Part Time');
  const grouped = {};
  fullTime.forEach((f) => {
    const realPrograms = (f.instructor.programs || []).filter((p) => p !== GE_OPTION);
    const tags = realPrograms.length > 0 ? realPrograms : (f.instructor.programs || []).length > 0 ? f.instructor.programs : ['Unassigned'];
    tags.forEach((tag) => {
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push(f);
    });
  });
  return { grouped, partTime };
}

// "Done" for a faculty means every one of their own classes/sections
// currently in view has been sent — shared by both Faculty Submission
// Progress and Faculty Pending Review below to split each into a Pending
// and a Grades Sent group.
const facultyAllSent = (f) => f.classes.length > 0 && f.classes.every((c) => c.sent);

const sortLeastDoneFirst = (a, b) => {
  const pctA = a.classes.length ? a.classes.filter((c) => c.sent).length / a.classes.length : 0;
  const pctB = b.classes.length ? b.classes.filter((c) => c.sent).length / b.classes.length : 0;
  return pctA - pctB; // least-done first — the ones needing a nudge surface at the top
};

// "Sep 2, 2026 · 2:30 PM" — date AND time, so a Chairperson can tell exactly
// when they verified or changed something, not just "a few hours ago."
const formatDateTime = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

export default function ChairpersonDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [facultyReview, setFacultyReview] = useState([]);
  const [distribution, setDistribution] = useState(null);
  // Chairperson activity feed is department/program scoped — the log is
  // populated from the users inside the chairperson's program scope, so
  // the dashboard summarizes the same cross-user trace the department sees.
  const [activities, setActivities] = useState([]);
  const [showArchive, setShowArchive] = useState(false);
  const [loading, setLoading] = useState(true);
  // Faculty Submission Progress / Faculty Pending Review both start
  // collapsed — usePageState (not plain useState) so navigating away and
  // back within the session remembers whatever the Chairperson last left
  // each one as, starting collapsed the very first time.
  const [progressExpanded, setProgressExpanded] = usePageState('ChairpersonDashboard.progressExpanded', false);
  const [pendingReviewExpanded, setPendingReviewExpanded] = usePageState('ChairpersonDashboard.pendingReviewExpanded', false);
  // Each of the two Faculty Pending Review sub-groups (Pending / Grades
  // Sent) collapses independently — Pending starts open (it's the one that
  // actually needs attention), Grades Sent starts collapsed since it's just
  // a "these are done" reference list.
  const [pendingGroupOpen, setPendingGroupOpen] = usePageState('ChairpersonDashboard.pendingGroupOpen', true);
  const [sentGroupOpen, setSentGroupOpen] = usePageState('ChairpersonDashboard.sentGroupOpen', false);
  // Same Pending/Grades Sent split as Faculty Pending Review below, applied
  // to Faculty Submission Progress too — each still grouped by Program
  // underneath, just under a status header instead of interleaved by
  // "least done first" alone.
  const [submissionPendingOpen, setSubmissionPendingOpen] = usePageState('ChairpersonDashboard.submissionPendingOpen', true);
  const [submissionSentOpen, setSubmissionSentOpen] = usePageState('ChairpersonDashboard.submissionSentOpen', false);
  // Irregular Students list filters — Year/Section, same idea as
  // UserManagement's own filters. Filtered against each student's home
  // year_level/section (not their irregular_sections pairs), matching the
  // single "Year X · Sec Y" the rest of this list is keyed by elsewhere.
  const [irregYearFilter, setIrregYearFilter] = useState('');
  const [irregSectionFilter, setIrregSectionFilter] = useState('');
  const [irregSearch, setIrregSearch] = useState('');
  // Which list the card shows: 'Regular' or 'Irregular' students.
  const [statusTab, setStatusTab] = usePageState('ChairpersonDashboard.statusTab', 'Regular');
  // A student's full prospectus with grades (Chairperson of their program can view it).
  const [prospectusTarget, setProspectusTarget] = useState(null);
  // Starts collapsed — usePageState (not plain useState) so navigating away
  // and back within the session remembers whatever the Chairperson last
  // left it as, starting collapsed the very first time.
  const [irregularExpanded, setIrregularExpanded] = usePageState('ChairpersonDashboard.irregularExpanded', false);

  useEffect(() => { loadData(); }, []);

  // Live refresh — a Faculty submitting/resubmitting, or Admin approving/
  // returning a class, changes Faculty Submission Progress and Faculty
  // Pending Review's own numbers without this page's own load ever firing
  // again on its own. Same 'gradesUpdated' socket event GradingSheets.js
  // (the Chairperson's Grade Approval page) and the Instructor/Student
  // dashboards already key their own live refresh off of — without this,
  // this page only ever showed whatever it looked like at the moment it was
  // first opened, stale until a manual refresh or navigating away and back.
  useEffect(() => {
    const handler = () => loadData();
    return onGradesUpdated(handler);
  }, []);

  // 'gradesUpdated' above only reaches this page WHILE the socket is
  // actually connected — a dropped connection (backgrounded tab, network
  // blip, laptop sleep) silently swallows whatever happened during that
  // gap, with nothing to ever catch it back up. socket.io-client
  // reconnects on its own but doesn't replay missed events, so re-pull
  // everything from the real REST endpoints the moment a (re)connection
  // actually lands — same fix Messages.js already applies to its own
  // conversation list on reconnect.
  useEffect(() => {
    const handler = () => loadData();
    return onSemestersUpdated(handler);
  }, []);

  useEffect(() => {
    const handler = () => loadData();
    socket.on('connect', handler);
    return () => socket.off('connect', handler);
  }, []);

  const loadData = async () => {
    try {
      const [{ data: result }, { data: reviewResult }, { data: distResult }] = await Promise.all([
        endorsementService.getDepartmentStudents(),
        dashboardService.getChairpersonFacultyReview(),
        gradeService.getDistribution(),
      ]);
      setData(result);
      setFacultyReview(reviewResult.faculty || []);
      setDistribution(distResult);
    } catch (err) {
      toast.error('Failed to load program data');
    } finally {
      setLoading(false);
    }

    // Kept out of the Promise.all above on purpose — this is a nice-to-have
    // addition to the dashboard, not core data. A failure here (a backend
    // that hasn't restarted since this endpoint was opened up to
    // Chairperson yet, a slow query, anything) used to fail the WHOLE
    // Promise.all and blank out Program Students/Regular/Irregular too —
    // exactly the bug this fixes: the Activity Log card just quietly stays
    // empty instead of taking the rest of the dashboard down with it.
    try {
      const { data: activityResult } = await dashboardService.getActivities({ limit: 20 });
      setActivities(activityResult?.activities || []);
    } catch (err) {
      console.error('Activity log fetch failed:', err);
    }
  };

  if (loading) return <LoadingSpinner />;

  const irregularStudents = data?.students?.filter((s) => s.student_status === 'Irregular') || [];
  // Section options come from whoever's actually in the list — a fixed A-H
  // list would offer choices with zero matches whenever this smaller,
  // already-filtered-to-Irregular set doesn't happen to touch every section.
  // Year uses a fixed 1-4 tab row instead (see below), so it needs no such
  // derived list.
  const regularStudents = data?.students?.filter((s) => s.student_status !== 'Irregular') || [];
  // The Regular / Irregular card lists one group at a time (statusTab); the
  // Year tabs, Section filter and search apply to whichever is shown.
  const showingIrregular = statusTab === 'Irregular';
  const statusList = showingIrregular ? irregularStudents : regularStudents;
  const irregSectionOptions = [...new Set(statusList.map((s) => s.section).filter(Boolean))].sort();
  const matchesStatusFilters = (s) =>
    (!irregYearFilter || String(s.year_level) === irregYearFilter) &&
    (!irregSectionFilter || s.section === irregSectionFilter) &&
    (!irregSearch.trim() || s.name?.toLowerCase().includes(irregSearch.trim().toLowerCase()) || s.student_no?.includes(irregSearch.trim()));
  const filteredIrregularStudents = statusList.filter(matchesStatusFilters);

  // "Submitted Grades by Status" — one bucket per STUDENT (not per grade
  // row), matching how the GWA Distribution chart above it already counts:
  // a student who's Failed even one submitted subject reads as Failed
  // overall, so this can't disagree with "how many of my students are in
  // trouble" just because a student with 5 Passed classes and 1 Failed one
  // padded the Passed count five times. Students with no submitted grades
  // yet aren't counted either way — there's nothing to classify them by.
  // Released grades only: a student is counted once the Admin has released
  // their grades, same as the Admin's dashboard.
  const gradeStatusCounts = { Passed: 0, Failed: 0 };
  (data?.students || []).forEach((s) => {
    const released = (s.grades || []).filter((g) => g.released);
    if (released.length === 0) return;
    if (released.some((g) => g.status === 'Failed')) gradeStatusCounts.Failed += 1;
    else gradeStatusCounts.Passed += 1;
  });
  const gradeStatusRows = Object.entries(gradeStatusCounts).map(([status, count]) => ({ status, count }));

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-display text-2xl font-bold text-navy">Welcome back, {user?.name?.split(' ')[0]}!</h2>
          <CurrentSemesterTag />
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Academic standing validation and endorsement</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard label="Program Students" value={data?.summary?.total || 0} icon={<Icons.Users />} iconBg="bg-blue-50 text-blue-500" />
        {/* Count-only tiles; the actual Irregular names live in the card
            below where there's room to list them without cramping a stat
            tile. Regular sits right beside it so the split (not just the
            flagged half) is visible at a glance. */}
        <StatCard label="Regular Students" value={regularStudents.length} icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Irregular Students" value={irregularStudents.length} icon={<Icons.AlertTriangle />} iconBg="bg-red-50 text-red-500" />
      </div>

      {/* Activity Log — department-wide recent actions, showing who did what */}
      <div className="card mb-6">
        <div className="card-header py-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-navy">Activity Log</h3>
            <p className="text-xs text-gray-400 mt-0.5">What your department has verified or changed, most recent first.</p>
          </div>
          {/* Every entry here ages out of this list on its own after 24h —
              a flat window, not the 7-day one Admin's own feed uses (see
              chairpersonActivityRetentionWhere) — and is still reachable
              here afterward instead of just disappearing. */}
          <button
            onClick={() => setShowArchive(true)}
            className="text-xs text-gold font-medium bg-transparent border-none cursor-pointer font-sans hover:underline flex items-center gap-1 flex-shrink-0"
          >
            <Icons.Clock className="w-3 h-3" /> View Archived
          </button>
        </div>
        <div className="card-body space-y-0 max-h-[360px] overflow-y-auto">
          {activities.length === 0 ? (
            <p className="text-center py-6 text-gray-400 text-sm">No activity recorded yet.</p>
          ) : activities.map((a) => {
            const userName = a.user?.name;
            const actionText = (userName && a.action?.toLowerCase().startsWith(userName.toLowerCase()))
              ? a.action.slice(userName.length).trim()
              : a.action;
            const roleVariant = { Student: 'blue', Faculty: 'purple', Chairperson: 'orange', Admin: 'green' }[a.user?.role] || 'gray';

            return (
              <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 px-1 rounded transition-colors">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <Avatar letter={a.user?.avatar || userName?.[0] || '?'} className="bg-navy/10 text-navy font-semibold flex-shrink-0" size="w-7 h-7 text-xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 leading-snug">
                      <span className="font-semibold text-navy">{userName || 'System'}</span>{' '}
                      <span className="text-gray-600">{actionText}</span>
                    </p>
                  </div>
                  {a.user?.role && (
                    <Badge variant={roleVariant} className="text-[10px] py-0 px-1.5 flex-shrink-0 hidden sm:inline-flex">
                      {a.user.role}
                    </Badge>
                  )}
                </div>
                <span className="text-[11px] text-gray-400 flex-shrink-0 whitespace-nowrap ml-2">
                  {formatDateTime(a.created_at || a.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ====== ANALYTICS ====== */}
      <h3 className="text-sm font-semibold text-navy mb-2">Analytics Overview</h3>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="card">
          <div className="card-header py-3"><h3 className="text-sm font-semibold text-navy">Students by Year Level</h3></div>
          <div className="card-body py-3"><StudentsByYearChart students={data?.students} height={180} /></div>
        </div>
        <div className="card">
          <div className="card-header py-3"><h3 className="text-sm font-semibold text-navy">Students Passed vs. Failed</h3></div>
          <div className="card-body py-3"><GradeStatusChart rows={gradeStatusRows} height={180} /></div>
        </div>
      </div>
      <div className="card mb-6">
        <div className="card-header py-3"><h3 className="text-sm font-semibold text-navy">GWA Distribution</h3></div>
        <div className="p-4">
          {distribution ? <GradeDistributionChart distribution={distribution.distribution} height={200} /> : <LoadingSpinner />}
        </div>
      </div>

      {/* Faculty Submission Progress — "3/15" per faculty: how many of their
          own classes/sections this semester are fully submitted (c.sent),
          out of how many they're teaching in total. Complements Faculty
          Pending Review below (which is per-class detail) with a single
          at-a-glance completion count per instructor. */}
      <div className="card mb-6">
        <button
          onClick={() => setProgressExpanded((prev) => !prev)}
          className="card-header w-full flex items-center justify-between gap-3 border-none bg-transparent cursor-pointer font-sans text-left"
        >
          <div>
            <h3 className="text-base font-semibold text-navy">Faculty Submission Progress</h3>
            <p className="text-xs text-gray-400 mt-0.5">Sections fully submitted, out of how many each faculty is teaching this semester.</p>
          </div>
          {progressExpanded ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
        </button>
        {progressExpanded && (
        <div className="card-body space-y-5 max-h-[420px] overflow-y-auto">
          {facultyReview.length === 0 ? (
            <p className="text-center py-8 text-gray-400 text-sm">No active classes found for your program(s).</p>
          ) : (() => {
            // Same Pending/Grades Sent split as Faculty Pending Review — each
            // still grouped by Program underneath (Part Timer its own group),
            // just under a status header instead of one flat list ordered
            // purely by "least done first".
            const renderProgramGroups = (list) => {
              const { grouped, partTime } = groupFacultyReviewByProgram(list);
              return (
                <div className="space-y-4">
                  {Object.entries(grouped)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([program, progList]) => (
                      <div key={program}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <ProgramDot program={program} />
                          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{programShortLabel(program)}</h4>
                        </div>
                        <div className="space-y-1">
                          {progList.slice().sort(sortLeastDoneFirst).map((f) => <FacultyProgressRow key={f.instructor.id} f={f} gradeApprovalPath="/chairperson/grading-sheets" />)}
                        </div>
                      </div>
                    ))}
                  {partTime.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Part Timer</h4>
                      </div>
                      <div className="space-y-1">
                        {partTime.slice().sort(sortLeastDoneFirst).map((f) => <FacultyProgressRow key={f.instructor.id} f={f} gradeApprovalPath="/chairperson/grading-sheets" />)}
                      </div>
                    </div>
                  )}
                </div>
              );
            };

            const pendingSubmission = facultyReview.filter((f) => !facultyAllSent(f));
            const sentSubmission = facultyReview.filter(facultyAllSent);

            return (
              <>
                {pendingSubmission.length > 0 && (
                  <div>
                    <button
                      onClick={() => setSubmissionPendingOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between mb-2 border-none bg-transparent cursor-pointer font-sans p-0"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icons.Clock className="w-3.5 h-3.5 text-amber-500" />
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending — {pendingSubmission.length}</h4>
                      </span>
                      {submissionPendingOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                    {submissionPendingOpen && renderProgramGroups(pendingSubmission)}
                  </div>
                )}
                {sentSubmission.length > 0 && (
                  <div>
                    <button
                      onClick={() => setSubmissionSentOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between mb-2 border-none bg-transparent cursor-pointer font-sans p-0"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icons.Check className="w-3.5 h-3.5 text-green-500" />
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Grades Sent — {sentSubmission.length}</h4>
                      </span>
                      {submissionSentOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                    {submissionSentOpen && renderProgramGroups(sentSubmission)}
                  </div>
                )}
              </>
            );
          })()}
        </div>
        )}
      </div>

      {/* Regular and Irregular Students — one card, a tab for each list. */}
      {(regularStudents.length > 0 || irregularStudents.length > 0) && (
        <div className="card">
          <button
            onClick={() => setIrregularExpanded((prev) => !prev)}
            className="card-header w-full flex items-center justify-between gap-3 border-none bg-transparent cursor-pointer font-sans text-left"
          >
            <div>
              <h3 className="text-base font-semibold text-navy">Regular and Irregular Students</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Students in your program(s): <span className="font-semibold text-green-600">{regularStudents.length} Regular</span> · <span className="font-semibold text-red-500">{irregularStudents.length} Irregular</span>
              </p>
            </div>
            {irregularExpanded ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
          </button>
          {irregularExpanded && (
          <div className="card-body">
            {/* Which list: Regular or Irregular. */}
            <div className="flex flex-wrap gap-2 mb-3">
              {[
                { key: 'Regular', count: regularStudents.length, on: 'bg-green-600 text-white border-transparent', off: 'hover:border-green-300 hover:text-green-700' },
                { key: 'Irregular', count: irregularStudents.length, on: 'bg-red-500 text-white border-transparent', off: 'hover:border-red-300 hover:text-red-600' },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setStatusTab(t.key); setIrregSectionFilter(''); }}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer font-sans border transition-colors ${statusTab === t.key ? t.on : `bg-white text-gray-600 border-gray-200 ${t.off}`}`}
                >
                  {t.key} Students <span className={`ml-1 text-xs font-normal ${statusTab === t.key ? 'opacity-80' : 'text-gray-400'}`}>({t.count})</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {/* Year as tabs — "YEAR 1"/"YEAR 2"/... — rather than a dropdown,
                  so switching years is a single click and the current one is
                  always visible at a glance. Fixed 1-4 (not derived from who's
                  actually Irregular) since the whole point is to be able to
                  jump straight to a specific year even if it's currently empty. */}
              {[1, 2, 3, 4].map((y) => (
                <button
                  key={y}
                  onClick={() => setIrregYearFilter(irregYearFilter === String(y) ? '' : String(y))}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer font-sans border transition-colors
                    ${irregYearFilter === String(y) ? 'bg-navy text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}
                >
                  YEAR {y}
                </button>
              ))}
              <select
                className="form-select w-auto text-xs py-1.5"
                value={irregSectionFilter}
                onChange={(e) => setIrregSectionFilter(e.target.value)}
              >
                <option value="">All Sections</option>
                {irregSectionOptions.map((sec) => <option key={sec} value={sec}>Section {sec}</option>)}
              </select>
              <div className="flex-1 min-w-[200px] flex">
                <SearchBar value={irregSearch} onChange={setIrregSearch} placeholder="Search name or student no..." />
              </div>
              {(irregYearFilter || irregSectionFilter || irregSearch) && (
                <button
                  className="btn btn-outline text-xs py-1.5 px-2.5"
                  onClick={() => { setIrregYearFilter(''); setIrregSectionFilter(''); setIrregSearch(''); }}
                >
                  <Icons.X className="w-3 h-3" /> Clear
                </button>
              )}
            </div>
            {/* Scroll constraint lives here, on its own div — .card-body
                already carries max-h-[70vh] overflow-y-auto by default
                (index.css), and stacking a second, smaller max-h directly on
                that same element fought over the box's height instead of
                just capping it, leaving a large gap under a short list. */}
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {filteredIrregularStudents.length === 0 && (
                <p className="text-center py-6 text-gray-400 text-sm">{statusList.length === 0 ? `No ${statusTab} students in your program(s).` : `No ${statusTab} students match this filter.`}</p>
              )}
              {filteredIrregularStudents.slice().sort(comparePeopleNames).map((s, idx) => (
                <div key={s.id} className={`flex items-center gap-3 p-3 border border-gray-100 rounded-lg transition-colors ${showingIrregular ? 'hover:border-red-200 hover:bg-red-50/30' : 'hover:border-green-200 hover:bg-green-50/30'}`}>
                  <span className="text-xs font-semibold text-gray-400 w-5 flex-shrink-0 text-right">{idx + 1}.</span>
                  <Avatar letter={s.name?.[0]} className={`${showingIrregular ? 'bg-red-500' : 'bg-green-600'} text-white flex-shrink-0`} size="w-8 h-8 text-xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-navy truncate">{formatPersonName(s.name)}</p>
                    <p className="text-xs text-gray-500">{s.student_no}</p>
                    {/* Read-only — the student themselves picks these subjects
                        from their own dashboard (StudentDashboard.js); this just
                        shows the Chairperson what the student has committed to. */}
                    {s.regularization_subjects?.length > 0 && (
                      <p className="text-[11px] text-emerald-600 font-medium mt-0.5">
                        {s.regularization_subjects.length} subject{s.regularization_subjects.length !== 1 ? 's' : ''} targeted to clear
                      </p>
                    )}
                  </div>
                  <Badge variant={showingIrregular ? 'red' : 'green'} className="text-right whitespace-normal">{studentYearSectionsLabel(s)}</Badge>
                  <button type="button" className="btn btn-outline btn-sm flex items-center gap-1 flex-shrink-0" onClick={() => setProspectusTarget(s)} title="View this student's prospectus with grades">
                    <Icons.FileText className="w-3.5 h-3.5" /> Prospectus
                  </button>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      )}

      {prospectusTarget && <StudentGradeRecordModal studentId={prospectusTarget.id} onClose={() => setProspectusTarget(null)} />}

      {showArchive && (
        <ArchivedActivitiesModal
          onClose={() => setShowArchive(false)}
          windowLabel="24 hours"
          emptyText="Nothing archived yet."
        />
      )}
    </>
  );
}
