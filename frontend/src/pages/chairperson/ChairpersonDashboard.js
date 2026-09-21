import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner, FacultyProgramTags, CurrentSemesterTag, studentYearSectionsLabel, ProgramDot, programShortLabel, formatPersonName } from '../../components/common';
import { GradeDistributionChart } from '../../components/charts/GradeCharts';
import { GradeStatusChart, StudentsByYearChart } from '../../components/charts/AdminAnalyticsCharts';
import { endorsementService, dashboardService, gradeService, userService } from '../../services';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';
import ArchivedActivitiesModal from '../../components/common/ArchivedActivitiesModal';
import socket from '../../services/socket';

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

// Clicking a row jumps to Grade Approval (grading-sheets) pre-filtered to
// just this instructor's own classes — same search box that page's own
// filter bar already exposes, just pre-filled via a query param instead of
// making the chairperson retype the name there themselves.
function FacultyProgressRow({ f }) {
  const navigate = useNavigate();
  const done = f.classes.filter((c) => c.sent).length;
  const total = f.classes.length;
  const complete = total > 0 && done === total;
  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/chairperson/grading-sheets?instructor=${encodeURIComponent(f.instructor.name || '')}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(`/chairperson/grading-sheets?instructor=${encodeURIComponent(f.instructor.name || '')}`);
        }
      }}
      title={`View ${f.instructor.name}'s classes in Grade Approval`}
    >
      <Avatar letter={f.instructor.avatar || f.instructor.name?.[0]} className="bg-purple-500 text-white flex-shrink-0" size="w-8 h-8 text-xs" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{f.instructor.name}</p>
        <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
          <div
            className={`h-full rounded-full ${complete ? 'bg-green-500' : 'bg-amber-400'}`}
            style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
          />
        </div>
      </div>
      <Badge variant={complete ? 'green' : 'gray'} className="flex-shrink-0">
        {complete && <Icons.Check className="w-3 h-3" />} {done}/{total}
      </Badge>
    </div>
  );
}

// One CLASS's own row in Faculty Pending Review below (not one card per
// faculty) — a faculty carrying both a sent and a still-pending class needs
// to actually show up split between the Pending and Grades Sent groups, not
// pinned entirely to whichever status happens to cover ALL of their classes.
// Ordered Subject → Year → Section → Faculty name (compareClassEntries), so
// within a status group everything reads by class first, faculty second.
function ClassReviewRow({ c }) {
  return (
    <div className="flex items-center justify-between gap-4 border border-gray-100 rounded-xl p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-center gap-3 min-w-0">
        <Avatar letter={c.instructor?.avatar || c.instructor?.name?.[0]} className="bg-purple-500 text-white flex-shrink-0" size="w-9 h-9 text-xs" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-navy truncate">
            {c.subject_code}{c.year_level ? ` · Year ${c.year_level}` : ''}{c.section ? ` · Sec ${c.section}` : ''}
          </p>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <p className="text-xs text-gray-500 truncate">{c.instructor?.name}</p>
            <FacultyProgramTags user={c.instructor} />
          </div>
        </div>
      </div>
      <div className="flex-shrink-0">
        {c.sent ? (
          <div className="flex gap-1.5">
            <Badge variant="green">{c.passed} Passed</Badge>
            <Badge variant="yellow">{c.inc} INC</Badge>
            <Badge variant="gray">{c.dropped} Dropped</Badge>
          </div>
        ) : (
          <span className="text-xs text-gray-400 whitespace-nowrap">{c.submitted_count}/{c.total_students} submitted</span>
        )}
      </div>
    </div>
  );
}

// Subject → Year → Section → Faculty name, in that order — matches how the
// rest of this page (and GradingSheets.js) already reads a class.
const compareClassEntries = (a, b) =>
  String(a.subject_code ?? '').localeCompare(String(b.subject_code ?? '')) ||
  (a.year_level ?? 0) - (b.year_level ?? 0) ||
  String(a.section ?? '').localeCompare(String(b.section ?? '')) ||
  String(a.instructor?.name ?? '').localeCompare(String(b.instructor?.name ?? ''));

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
  const [pendingCount, setPendingCount] = useState(0);
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
    socket.on('gradesUpdated', handler);
    return () => socket.off('gradesUpdated', handler);
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
    socket.on('connect', handler);
    return () => socket.off('connect', handler);
  }, []);

  const loadData = async () => {
    try {
      const [{ data: result }, { data: reviewResult }, { data: distResult }, { data: pendingResult }] = await Promise.all([
        endorsementService.getDepartmentStudents(),
        dashboardService.getChairpersonFacultyReview(),
        gradeService.getDistribution(),
        // Same source the sidebar's own "Pending Registrations" badge uses —
        // data?.summary?.pending (below) is a leftover from the old
        // Endorsement workflow ("active students never endorsed/flagged"),
        // which is always ~everyone now that Endorsements no longer exist in
        // the UI. This is the real, actionable "nobody to verify" count.
        userService.getPending(),
      ]);
      setData(result);
      setFacultyReview(reviewResult.faculty || []);
      setDistribution(distResult);
      setPendingCount(pendingResult.users?.length || 0);
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
  const irregSectionOptions = [...new Set(irregularStudents.map((s) => s.section).filter(Boolean))].sort();
  const filteredIrregularStudents = irregularStudents.filter((s) =>
    (!irregYearFilter || String(s.year_level) === irregYearFilter) &&
    (!irregSectionFilter || s.section === irregSectionFilter)
  );
  const regularStudents = data?.students?.filter((s) => s.student_status !== 'Irregular') || [];

  // "Submitted Grades by Status" — one bucket per STUDENT (not per grade
  // row), matching how the GWA Distribution chart above it already counts:
  // a student who's Failed even one submitted subject reads as Failed
  // overall, so this can't disagree with "how many of my students are in
  // trouble" just because a student with 5 Passed classes and 1 Failed one
  // padded the Passed count five times. Students with no submitted grades
  // yet aren't counted either way — there's nothing to classify them by.
  const gradeStatusCounts = { Passed: 0, Failed: 0 };
  (data?.students || []).forEach((s) => {
    if (!s.grades || s.grades.length === 0) return;
    if ((s.failed_count || 0) > 0) gradeStatusCounts.Failed += 1;
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Program Students" value={data?.summary?.total || 0} icon={<Icons.Users />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Pending Registrations" value={pendingCount} icon={<Icons.Clock />} iconBg="bg-amber-50 text-amber-500" />
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
            <p className="text-xs text-gray-400 mt-0.5">Sections fully submitted, out of how many each instructor is teaching this semester.</p>
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
                          {progList.slice().sort(sortLeastDoneFirst).map((f) => <FacultyProgressRow key={f.instructor.id} f={f} />)}
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
                        {partTime.slice().sort(sortLeastDoneFirst).map((f) => <FacultyProgressRow key={f.instructor.id} f={f} />)}
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

      {/* Faculty Pending Review */}
      <div className="card mb-6">
        <button
          onClick={() => setPendingReviewExpanded((prev) => !prev)}
          className="card-header w-full flex items-center justify-between gap-3 border-none bg-transparent cursor-pointer font-sans text-left"
        >
          <div>
            <h3 className="text-base font-semibold text-navy">Faculty Pending Review</h3>
            <p className="text-xs text-gray-400 mt-0.5">Grade submission status per class, sorted by subject, year, and section.</p>
          </div>
          {pendingReviewExpanded ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
        </button>
        {pendingReviewExpanded && (() => {
          // Flattened to one row per CLASS (not one card per faculty) — a
          // faculty with 2 classes, one sent and one not, needs their sent
          // class to actually land in the Grades Sent group and their
          // pending one in Pending, not have the whole faculty pinned to
          // whichever status covers ALL their classes.
          const classEntries = facultyReview.flatMap((f) => f.classes.map((c) => ({ ...c, instructor: f.instructor })));
          const pendingClasses = classEntries.filter((c) => !c.sent).sort(compareClassEntries);
          const sentClasses = classEntries.filter((c) => c.sent).sort(compareClassEntries);
          return (
        <div className="card-body space-y-3 max-h-[420px] overflow-y-auto">
          {classEntries.length === 0 && (
            <p className="text-center py-8 text-gray-400 text-sm">No active classes found for your program(s).</p>
          )}
          {classEntries.length > 0 && (
              <>
                {pendingClasses.length > 0 && (
                  <div>
                    <button
                      onClick={() => setPendingGroupOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between mb-2 border-none bg-transparent cursor-pointer font-sans p-0"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icons.Clock className="w-3.5 h-3.5 text-amber-500" />
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Pending — {pendingClasses.length}</h4>
                      </span>
                      {pendingGroupOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                    {pendingGroupOpen && (
                      <div className="space-y-2">
                        {pendingClasses.map((c) => <ClassReviewRow key={c.class_id} c={c} />)}
                      </div>
                    )}
                  </div>
                )}
                {sentClasses.length > 0 && (
                  <div className={pendingClasses.length > 0 ? 'mt-5' : ''}>
                    <button
                      onClick={() => setSentGroupOpen((prev) => !prev)}
                      className="w-full flex items-center justify-between mb-2 border-none bg-transparent cursor-pointer font-sans p-0"
                    >
                      <span className="flex items-center gap-1.5">
                        <Icons.Check className="w-3.5 h-3.5 text-green-500" />
                        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Grades Sent — {sentClasses.length}</h4>
                      </span>
                      {sentGroupOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                    </button>
                    {sentGroupOpen && (
                      <div className="space-y-2">
                        {sentClasses.map((c) => <ClassReviewRow key={c.class_id} c={c} />)}
                      </div>
                    )}
                  </div>
                )}
              </>
          )}
        </div>
          );
        })()}
      </div>

      {/* Irregular Students */}
      {irregularStudents.length > 0 && (
        <div className="card">
          <button
            onClick={() => setIrregularExpanded((prev) => !prev)}
            className="card-header w-full flex items-center justify-between gap-3 border-none bg-transparent cursor-pointer font-sans text-left"
          >
            <div>
              <h3 className="text-base font-semibold text-navy">Irregular Students</h3>
              <p className="text-xs text-gray-400 mt-0.5">Students in your program(s) currently flagged Irregular.</p>
            </div>
            {irregularExpanded ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
          </button>
          {irregularExpanded && (
          <div className="card-body">
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
                    ${irregYearFilter === String(y) ? 'bg-red-500 text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300 hover:text-red-600'}`}
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
              {(irregYearFilter || irregSectionFilter) && (
                <button
                  className="btn btn-outline text-xs py-1.5 px-2.5"
                  onClick={() => { setIrregYearFilter(''); setIrregSectionFilter(''); }}
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
            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {filteredIrregularStudents.length === 0 && (
                <p className="text-center py-6 text-gray-400 text-sm">No Irregular students match this filter.</p>
              )}
              {filteredIrregularStudents.slice().sort(comparePeopleNames).map((s, idx) => (
                <div key={s.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-lg hover:border-red-200 hover:bg-red-50/30 transition-colors">
                  <span className="text-xs font-semibold text-gray-400 w-5 flex-shrink-0 text-right">{idx + 1}.</span>
                  <Avatar letter={s.name?.[0]} className="bg-red-500 text-white flex-shrink-0" size="w-8 h-8 text-xs" />
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
                  <Badge variant="red" className="text-right whitespace-normal">{studentYearSectionsLabel(s)}</Badge>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      )}

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
