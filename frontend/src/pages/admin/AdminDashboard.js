import { useState, useEffect, useRef } from 'react';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner, CurrentSemesterTag, ProgramDot, programShortLabel, formatPersonName } from '../../components/common';
import ArchivedActivitiesModal from '../../components/common/ArchivedActivitiesModal';
import { GradeDistributionChart } from '../../components/charts/GradeCharts';
import { ProgramStudentsChart, ProgramFacultyChart, ProgramClassesChart, ProgramPassRateChart, ProgramGWAChart } from '../../components/charts/AdminAnalyticsCharts';
import { dashboardService, gradeService } from '../../services';
import { useNavigate } from 'react-router-dom';
import { usePageState } from '../../hooks/usePageState';
import socket, { onGradesUpdated } from '../../services/socket';
import FacultyProgressRow from '../../components/common/FacultyProgressRow';
import SemesterEndingBanner from '../../components/admin/SemesterEndingBanner';
import ReleaseGradesCard from '../../components/admin/ReleaseGradesCard';
import AdviserSummaryCard from '../../components/admin/AdviserSummaryCard';
import { useSemesterLabels } from '../../utils/semesterLabels';

// Excluded from grouping (same as UserManagement.js) — GE is a bonus tag every
// program's faculty can carry, not a program of its own to bucket people under.
const GE_OPTION = 'General Education (GE)';

// Groups the Faculty Submission Progress list the same way UserManagement's
// staff directory groups Faculty: Part-Time instructors pulled into their own
// standalone "Part Timer" group (they're tagged with every program, so filing
// them under one specific program would misrepresent a real assignment), and
// everyone else bucketed under each of their real programs.
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

const sortLeastDoneFirst = (a, b) => {
  const pctA = a.classes.length ? a.classes.filter((c) => c.sent).length / a.classes.length : 0;
  const pctB = b.classes.length ? b.classes.filter((c) => c.sent).length / b.classes.length : 0;
  return pctA - pctB; // least-done first — the ones needing a nudge surface at the top
};


const ACTIVITY_BOXES = [
  { role: 'Faculty', label: 'Faculty', icon: 'User', header: 'bg-purple-600' },
  { role: 'Student', label: 'Students', icon: 'Users', header: 'bg-blue-600' },
  { role: 'Chairperson', label: 'Chairpersons', icon: 'Award', header: 'bg-orange-500' },
  { role: 'Admin', label: 'Administrators', icon: 'Shield', header: 'bg-navy' },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [activities, setActivities] = useState([]);
  const [facultyReview, setFacultyReview] = useState([]);
  const [programBreakdown, setProgramBreakdown] = useState([]);
  const [currentSemester, setCurrentSemester] = useState(null);
  const { abbrFor } = useSemesterLabels();
  const [distribution, setDistribution] = useState(null);
  const [loading, setLoading] = useState(true);
  // "" = All Semesters; otherwise `${academic_year}::${semester}` — combined
  // since Class.semester alone is just the term label ("1st Semester") and
  // collides across different academic years without it.
  const [semesterKey, setSemesterKey] = useState('');
  // Archived-semester picker for GWA Distribution — a separate popover
  // (button + panel), not folded into the same dropdown as "Current", so
  // switching to an old semester is a deliberate, distinct action rather
  // than one more row in an otherwise plain select.
  const [showArchivedSemesters, setShowArchivedSemesters] = useState(false);
  // Escape dismisses the popover, same as clicking outside it.
  useEffect(() => {
    if (!showArchivedSemesters) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setShowArchivedSemesters(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showArchivedSemesters]);
  const [showArchive, setShowArchive] = useState(false);
  const [showLoginArchive, setShowLoginArchive] = useState(false);
  // Faculty Submission Progress starts collapsed — usePageState (not plain
  // useState) so navigating away and back within the session remembers
  // whatever Admin last left it as, starting collapsed the very first time.
  const [progressExpanded, setProgressExpanded] = usePageState('AdminDashboard.progressExpanded', false);
  const navigate = useNavigate();

  useEffect(() => { loadDashboard(); loadFacultyReview(); }, []);
  useEffect(() => { loadDistribution(); }, [semesterKey]);

  // Live refresh — same 'gradesUpdated' socket event GradeApproval.js (this
  // page's own approval queue) and every role's own dashboard already key
  // their live refresh off of. Without this, Faculty Submission Progress and
  // Faculty Pending Review here only ever reflected whatever the numbers
  // were the moment this page was first opened, stale until a manual
  // refresh. Distribution/promotion widgets are left off this handler —
  // those aren't grade-submission-lifecycle data, and re-fetching them on
  // every grade change would be wasted work.
  useEffect(() => {
    const handler = () => { loadDashboard(); loadFacultyReview(); };
    return onGradesUpdated(handler);
  }, []);

  // 'gradesUpdated' above only reaches this page WHILE the socket is
  // actually connected — a dropped connection (backgrounded tab, network
  // blip) silently swallows whatever happened during that gap. Re-pull the
  // moment a (re)connection actually lands, same reconnect-resync fix
  // Messages.js already applies to its own conversation list.
  useEffect(() => {
    const handler = () => { loadDashboard(); loadFacultyReview(); };
    socket.on('connect', handler);
    return () => socket.off('connect', handler);
  }, []);

  // GWA Distribution defaults to whichever semester is actually current the
  // moment it's known, instead of sitting on "All Semesters" until Admin
  // manually picks one — fires once, the first time currentSemester loads;
  // switching the picker afterward (e.g. to look at an archived semester)
  // is never overridden back.
  //
  // Uses currentSemester.name, not .term — Class.semester (what this filter
  // actually has to match, see loadDistribution below and semesterController's
  // own `name = `${term} ${academic_year}``) is that full combined name, not
  // the bare enum term ("First Semester" alone matches nothing).
  const autoSelectedCurrent = useRef(false);
  useEffect(() => {
    if (!autoSelectedCurrent.current && currentSemester) {
      autoSelectedCurrent.current = true;
      setSemesterKey(`${currentSemester.academic_year || ''}::${currentSemester.name}`);
    }
  }, [currentSemester]);

  // Same "Faculty Pending Review" panel the Chairperson dashboard uses (just
  // system-wide instead of scoped to one Chairperson's own program(s)) —
  // reused as-is rather than re-derived, so the two dashboards can never
  // disagree on what "sent" means for a class.
  const loadFacultyReview = async () => {
    try {
      const { data } = await dashboardService.getChairpersonFacultyReview();
      setFacultyReview(data?.faculty || []);
    } catch (err) {
      console.error('Faculty review error:', err);
    }
  };

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const { data } = await dashboardService.getAdmin();
      setStats(data?.stats || {});
      setActivities(data?.recent_activities || []);
      setProgramBreakdown(data?.program_breakdown || []);
      setCurrentSemester(data?.current_semester || null);
    } catch (err) {
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDistribution = async () => {
    try {
      const params = {};
      if (semesterKey) {
        const [academicYear, sem] = semesterKey.split('::');
        if (academicYear) params.academic_year = academicYear;
        if (sem) params.semester = sem;
      }
      const { data } = await gradeService.getDistribution(params);
      setDistribution(data);
    } catch (err) {
      console.error('Distribution error:', err);
    }
  };

  // Each entry is { semester, academic_year } — combined into one dropdown
  // option since the term label alone ("1st Semester") repeats every year.
  const semesters = distribution?.semesters || [];
  // Matches the shape loadDistribution() itself builds from semesterKey
  // (`${academic_year}::${name}`, using the full combined name — see the
  // auto-select effect above for why .term alone won't match) — used to keep
  // the current semester out of its own Archived list below, and to label
  // the chart accurately.
  const currentSemesterKey = currentSemester ? `${currentSemester.academic_year || ''}::${currentSemester.name}` : null;
  const archivedSemesters = semesters.filter(
    (s) => `${s.academic_year || ''}::${s.semester}` !== currentSemesterKey
  );
  const isViewingCurrent = !semesterKey || semesterKey === currentSemesterKey;
  const formatSemesterDate = (date) => date
    ? new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  const timeSince = (date) => {
    if (!date) return '—';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const formatDateTime = (date) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const roleBadge = (role) => {
    const map = { Student: 'blue', Faculty: 'purple', Chairperson: 'orange', Admin: 'green' };
    return <Badge variant={map[role] || 'blue'}>{role}</Badge>;
  };

  if (loading) return <LoadingSpinner />;

  const groupedFacultyReview = groupFacultyReviewByProgram(facultyReview);

  const loginActivities = activities.filter(a => a.action?.toLowerCase().includes('logged in'));
  const systemActivities = activities.filter(a => !a.action?.toLowerCase().includes('logged in'));
  // Was capped to 8 to avoid growing the page — now that each box scrolls
  // internally (see the card-body below), show everything the backend already
  // fetched instead of hiding activity that would otherwise just get cut off.
  const activitiesByRole = (role) => systemActivities.filter(a => a.user?.role === role);

  return (
    <>
      <SemesterEndingBanner />
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-navy">Welcome back, Administrator!</h2>
          <CurrentSemesterTag />
        </div>
        <p className="text-sm text-gray-500">Here's what's happening in your academic system today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total Students" value={stats?.total_students || 0} icon={<Icons.Users />}
          iconBg="bg-blue-50 text-blue-500" accent="border-blue-400"
        />
        <StatCard
          label="Total Faculty" value={stats?.total_faculty || 0} icon={<Icons.User />}
          iconBg="bg-purple-50 text-purple-500" accent="border-purple-400"
        />
        <div className="stat-card border-l-4 border-amber-400">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-2">Student Grade Status</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />Passed</span>
                <span className="text-sm font-bold text-gray-800">{stats?.grade_status_counts?.Passed || 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />Failed</span>
                <span className="text-sm font-bold text-gray-800">{stats?.grade_status_counts?.Failed || 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-gray-400 flex-shrink-0" />Dropped</span>
                <span className="text-sm font-bold text-gray-800">{stats?.grade_status_counts?.DRP || 0}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[11px] text-gray-500"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />INC</span>
                <span className="text-sm font-bold text-gray-800">{stats?.grade_status_counts?.INC || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Per-program breakdown, as charts */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="font-semibold text-navy">Program Breakdown</h3>
        </div>
        <div className="card-body">
          {/* min-w-0 on every chart cell — a grid item's default min-width is
              its content's min-content size, which for a Chart.js canvas can
              exceed the column's actual share of the row; without this it
              forces the whole grid (and the page) wider than the viewport on
              mobile instead of the chart just scaling down to fit. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Students by Program</h4>
              <ProgramStudentsChart rows={programBreakdown} />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Faculty by Program</h4>
              <ProgramFacultyChart rows={programBreakdown} partTimeTotal={stats?.total_part_time_faculty || 0} />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Active Classes by Program</h4>
              <ProgramClassesChart rows={programBreakdown} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Pass Rate by Program</h4>
              <ProgramPassRateChart rows={programBreakdown} />
            </div>
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-gray-600 mb-2">Average GWA by Program</h4>
              <ProgramGWAChart rows={programBreakdown} />
            </div>
          </div>
        </div>
      </div>

      {/* Approved classes — release their grades to the students. */}
      <ReleaseGradesCard />

      {/* Every adviser's section — students, set-up accounts, retakes, promoted. */}
      <AdviserSummaryCard />

      {/* Faculty Submission Progress — "3/15" per instructor: how many of
          their own classes/sections this semester are fully submitted
          (c.sent), out of how many they're teaching in total. Same widget
          as the Chairperson dashboard's own version, just system-wide here
          (every program) instead of scoped to one Chairperson's program(s) —
          and "instructor" already covers a teaching Chairperson too, since
          getChairpersonFacultyReview groups by Class.instructor_id
          regardless of that account's role, not by a Faculty-only filter. */}
      <div className="card mb-6">
        <button
          onClick={() => setProgressExpanded((prev) => !prev)}
          className="card-header w-full flex items-center justify-between gap-3 border-none bg-transparent cursor-pointer font-sans text-left"
        >
          <div>
            <h3 className="font-semibold text-navy">Faculty Submission Progress</h3>
            <p className="text-xs text-gray-400 mt-0.5">Sections fully submitted, out of how many each faculty is teaching this semester — every program, including a teaching Chairperson's own classes.</p>
          </div>
          {progressExpanded ? <Icons.ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
        </button>
        {progressExpanded && (
        <div className="card-body space-y-4 max-h-[420px] overflow-y-auto">
          {facultyReview.length === 0 ? (
            <p className="text-center py-8 text-gray-400 text-sm">No active classes found.</p>
          ) : (
            <>
              {Object.entries(groupedFacultyReview.grouped)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([program, list]) => (
                  <div key={program}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ProgramDot program={program} />
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{programShortLabel(program)}</h4>
                    </div>
                    <div className="space-y-1">
                      {list.slice().sort(sortLeastDoneFirst).map((f) => <FacultyProgressRow key={f.instructor.id} f={f} gradeApprovalPath="/admin/grade-approval" />)}
                    </div>
                  </div>
                ))}
              {groupedFacultyReview.partTime.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 flex-shrink-0" />
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Part Timer</h4>
                  </div>
                  <div className="space-y-1">
                    {groupedFacultyReview.partTime.slice().sort(sortLeastDoneFirst).map((f) => <FacultyProgressRow key={f.instructor.id} f={f} gradeApprovalPath="/admin/grade-approval" />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        )}
      </div>


      {/* System Activities */}
      <div className="mb-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="font-semibold text-navy">System Activities</h3>
              <span className="text-[11px] text-gray-400">Last 7 days</span>
            </div>
            <div className="flex items-center gap-3">
              {currentSemester && (
                <span className="text-xs text-gray-500">
                  {currentSemester.term || currentSemester.name} · {abbrFor(currentSemester)} {currentSemester.academic_year}
                </span>
              )}
              <button
                onClick={() => setShowArchive(true)}
                className="text-xs text-gold font-medium bg-transparent border-none cursor-pointer font-sans hover:underline flex items-center gap-1"
              >
                <Icons.Clock className="w-3 h-3" /> View Archived
              </button>
            </div>
          </div>
          <div className="space-y-4">
            {ACTIVITY_BOXES.map((box) => {
              const boxActivities = activitiesByRole(box.role);
              const BoxIcon = Icons[box.icon];
              return (
                <div key={box.role} className="card overflow-hidden">
                  <div className={`px-4 py-2.5 ${box.header} text-white flex items-center gap-2`}>
                    <BoxIcon className="w-4 h-4" />
                    <h4 className="text-sm font-semibold">{box.label}</h4>
                  </div>
                  <div className="card-body max-h-[280px] overflow-y-auto">
                    {boxActivities.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">No recent {box.label.toLowerCase()} activity</p>
                    ) : boxActivities.map((a) => {
                      const userName = a.user?.name;
                      const actionText = (userName && a.action?.toLowerCase().startsWith(userName.toLowerCase()))
                        ? a.action.slice(userName.length).trim()
                        : a.action;
                      return (
                        <div key={a.id} className="flex gap-3 py-2.5 border-b last:border-none">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm">
                              <span className="font-semibold text-navy">{userName || 'System'}</span>{' '}
                              <span className="text-gray-600">{actionText}</span>
                            </p>
                          </div>
                          <span className="text-xs text-gray-400 flex-shrink-0">{timeSince(a.created_at || a.createdAt)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ====== LOGIN HISTORY ====== */}
      <div className="card mb-6">
        <div className="card-header flex items-center justify-between">
          <h3 className="font-semibold text-navy">Login History</h3>
          <button
            onClick={() => setShowLoginArchive(true)}
            className="text-xs text-gold font-medium bg-transparent border-none cursor-pointer font-sans hover:underline flex items-center gap-1"
          >
            <Icons.Clock className="w-3 h-3" /> View Archived
          </button>
        </div>

        {loginActivities.length === 0 ? (
          <div className="card-body text-center py-10 text-gray-400">
            <Icons.Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No login history yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide rounded-tl-lg">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide">Date & Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide rounded-tr-lg">When</th>
                </tr>
              </thead>
              <tbody>
                {loginActivities.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          letter={a.user?.avatar || a.user?.name?.[0]}
                          className="bg-blue-500 text-white"
                          size="w-8 h-8 text-xs"
                        />
                        <div>
                          <p className="text-[13px] font-semibold">{a.user?.name}</p>
                          <p className="text-xs text-gray-500">{a.user?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">{roleBadge(a.user?.role)}</td>
                    <td className="px-4 py-3.5 text-[13px] text-gray-700">{formatDateTime(a.created_at || a.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <span className="text-[12px] text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
                        {timeSince(a.created_at || a.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GWA Distribution — opens on the current semester automatically.
          Every other semester it has data for lives behind a separate
          "Archived" button/popover, not mixed into the same control as
          "Current" — picking an old semester is a deliberate detour, not
          just one more row in a plain dropdown. */}
      <div className="card">
        <div className="card-header flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold text-navy">GWA Distribution</h3>
            {currentSemester && (
              <p className="text-xs text-gray-400 mt-0.5">
                {isViewingCurrent ? (
                  <>
                    Showing <span className="font-medium text-gray-600">{currentSemester.term} · {abbrFor(currentSemester)} {currentSemester.academic_year}</span> — the current semester
                    {formatSemesterDate(currentSemester.end_date) && <> · ends {formatSemesterDate(currentSemester.end_date)}</>}
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600 font-medium">
                    <Icons.Archive className="w-3 h-3" /> {semesterKey ? 'Viewing an archived semester' : 'Viewing all semesters'}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="relative flex items-center gap-2">
            {!isViewingCurrent && (
              <button
                onClick={() => setSemesterKey(currentSemesterKey || '')}
                className="text-xs text-navy font-semibold bg-transparent border-none cursor-pointer font-sans hover:underline"
              >
                ← Back to current
              </button>
            )}
            <button
              onClick={() => setShowArchivedSemesters((v) => !v)}
              className={`text-xs font-medium border rounded-lg px-3 py-1.5 cursor-pointer font-sans flex items-center gap-1.5 transition-colors ${
                !isViewingCurrent ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Icons.Archive className="w-3.5 h-3.5" /> Archived
              {showArchivedSemesters ? <Icons.ChevronUp className="w-3 h-3" /> : <Icons.ChevronDown className="w-3 h-3" />}
            </button>

            {showArchivedSemesters && (
              <>
                <div className="fixed inset-0 z-[998]" onClick={() => setShowArchivedSemesters(false)} />
                <div className="absolute right-0 top-[calc(100%+6px)] w-64 bg-white rounded-xl shadow-2xl z-[999] border border-gray-100 overflow-hidden">
                  <button
                    onClick={() => { setSemesterKey(''); setShowArchivedSemesters(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm border-none bg-transparent cursor-pointer font-sans hover:bg-gray-50 ${!semesterKey ? 'text-navy font-semibold bg-blue-50' : 'text-gray-600'}`}
                  >
                    All Semesters
                  </button>
                  <div className="border-t border-gray-100 max-h-[240px] overflow-y-auto">
                    {archivedSemesters.length === 0 ? (
                      <p className="px-4 py-4 text-xs text-gray-400 text-center">Nothing archived yet.</p>
                    ) : archivedSemesters.map((s, i) => {
                      const key = `${s.academic_year || ''}::${s.semester}`;
                      return (
                        <button
                          key={i}
                          onClick={() => { setSemesterKey(key); setShowArchivedSemesters(false); }}
                          className={`w-full text-left px-4 py-2.5 text-sm border-none bg-transparent cursor-pointer font-sans hover:bg-gray-50 ${semesterKey === key ? 'text-navy font-semibold bg-blue-50' : 'text-gray-600'}`}
                        >
                          {s.academic_year ? `${abbrFor(s.semester)} ${s.academic_year} · ${s.semester}` : s.semester}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="p-6">
          {distribution ? (
            <GradeDistributionChart distribution={distribution.distribution} />
          ) : (
            <LoadingSpinner />
          )}
        </div>
      </div>

      {showArchive && <ArchivedActivitiesModal onClose={() => setShowArchive(false)} />}
      {showLoginArchive && (
        <ArchivedActivitiesModal
          onClose={() => setShowLoginArchive(false)}
          action="logged in"
          title="Archived Login History"
          emptyText="No archived logins yet."
        />
      )}
    </>
  );
}