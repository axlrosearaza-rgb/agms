import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Icons, Badge, StatCard, LoadingSpinner, CurrentSemesterTag, ConfirmDialog, ProgramDot, programCascadeGradient, programShortLabel } from '../../components/common';
import { classService, gradeService } from '../../services';
import GradeEncoding from './GradeEncoding';
import toast from 'react-hot-toast';
import socket from '../../services/socket';

// ─── Constants ────────────────────────────────────────────────────────────────
// Program → Year → Section, same shape My Classes (InstructorClasses.js) and
// Admin/Chairperson's Grade Approval pages already group by — browsing into
// a program/year/section's own collapsible container IS the filter here, no
// dropdown needed.
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

// Year → Section, used by the "Returned by Chairperson" container — flatter
// than the full Program/Year/Section tree below since these are meant to
// stand out as a short, urgent list, not another whole browsing structure.
function groupByYearSection(list) {
  const byYear = {};
  list.forEach((c) => {
    const year = c.year_level ?? '—';
    const section = c.section || 'No Section';
    if (!byYear[year]) byYear[year] = {};
    if (!byYear[year][section]) byYear[year][section] = [];
    byYear[year][section].push(c);
  });
  return byYear;
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
export default function InstructorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [releaseTarget, setReleaseTarget] = useState(null);
  const [releasing, setReleasing] = useState(false);
  // Cross-program teaching means the assigned-classes grid can span more than
  // one program — Program/Year/Section are collapsible containers to browse
  // into (same shape as My Classes), not dropdown filters.
  const [openGroups, setOpenGroups] = useState({});
  // Takes the NEXT value explicitly rather than inverting the raw stored
  // value — every read site here defaults an unset key to `true` (open) via
  // `openGroups[key] ?? true`, so `!prev[key]` on an untouched key inverted
  // `undefined` to `true`, i.e. the same value the read side was already
  // defaulting to — the very first click on any freshly-loaded group
  // silently did nothing. Passing the already-known displayed boolean (each
  // call site already computed it as `xOpen`) sidesteps that mismatch
  // entirely instead of trying to keep two separate defaults in sync.
  const toggleGroup = (key, next) => setOpenGroups((prev) => ({ ...prev, [key]: next }));
  // "Encode Grades" opens right here on the Dashboard instead of navigating
  // to /faculty/encode/:classId — My Classes (InstructorClasses.js) keeps
  // that routed page for its own "Encode Grades" action, fully separate from
  // this. Set back to null to return to the normal Dashboard view.
  const [encodingClassId, setEncodingClassId] = useState(null);

  const loadClasses = async () => {
    try {
      const { data } = await classService.getInstructorClasses(user.id);
      setClasses(data.classes || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadClasses(); }, [user.id]);

  // Live refresh — a Chairperson/Admin action on one of these classes
  // (verify, return for revision, approve...) changes what belongs here
  // (e.g. the "Returned by Chairperson" container) without this page's own
  // reload ever firing, so without this a Faculty sitting on their Dashboard
  // wouldn't see it until they manually navigated away and back.
  useEffect(() => {
    const handler = () => loadClasses();
    socket.on('gradesUpdated', handler);
    return () => socket.off('gradesUpdated', handler);
  }, [user.id]);

  // Same eligibility (can_release) and one-time-only behavior as My Classes —
  // locks itself again the moment it succeeds (all_released refreshes from
  // the server), so there's nothing left to click until a later resubmission.
  const handleRelease = async () => {
    const cls = releaseTarget;
    setReleaseTarget(null);
    if (!cls) return;
    try {
      setReleasing(true);
      const { data } = await gradeService.releaseClass(cls.id);
      toast.success(data.message || `Released grades for ${cls.subject?.code || 'this class'} — students can now see them.`);
      // Straight to My Classes afterward — that released class is about to
      // disappear from this Dashboard's own Assigned Classes list (it moves
      // into My Classes' Released section instead), so there's nothing left
      // here for Faculty to look at; My Classes is where the class they just
      // released actually lives now.
      navigate('/faculty/classes');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to release grades');
    } finally {
      setReleasing(false);
    }
  };

  if (encodingClassId) {
    return (
      <GradeEncoding
        classId={encodingClassId}
        onBack={() => { setEncodingClassId(null); loadClasses(); }}
      />
    );
  }

  if (loading) return <LoadingSpinner />;

  const totalStudents = classes.reduce((s, c) => s + (c.student_count || 0), 0);
  const pending       = classes.reduce((s, c) => s + ((c.student_count || 0) - (c.submitted_count || 0)), 0);
  const submitted     = classes.reduce((s, c) => s + (c.submitted_count || 0), 0);
  // Submitted grades still actually waiting on a Chairperson/Admin action —
  // NOT the whole submitted-but-not-released pipeline, which also includes a
  // class that's already fully approved and just sitting there for Faculty
  // themselves to click Release Grades. Once chairperson_verified is true AND
  // there's no pending_admin_approval left, review is DONE — nobody else is
  // going to act on it, so it has no business still showing as "pending."
  // Also excludes a class the Chairperson already bounced back
  // (awaiting_faculty_revision) — that's surfaced in its own "Returned by
  // Chairperson" container instead, since that one's "waiting on you," not
  // "waiting on review."
  const isPendingReview = (c) => !c.awaiting_faculty_revision && !c.all_released && (!c.chairperson_verified || (c.pending_admin_approval || 0) > 0);
  const pendingReview = classes.reduce((s, c) => s + (isPendingReview(c) ? (c.submitted_count || 0) : 0), 0);

  // Build shared color map
  const colorMap = {};
  let ci = 0;
  classes.forEach(cls => {
    const code = cls.subject?.code || `cls-${cls.id}`;
    if (!colorMap[code]) { colorMap[code] = SUBJECT_COLORS[ci % SUBJECT_COLORS.length]; ci++; }
  });

  // Classes the Chairperson bounced back for revision (returnToFaculty) —
  // pulled into their own container up top so they can't be missed among the
  // regular Program/Year/Section browsing below.
  const returnedClasses = classes.filter((c) => c.awaiting_faculty_revision);

  // Same isPendingReview test the stat card above counts students for, just
  // at the class level so each one can actually be listed here with where
  // exactly it's sitting in the Chairperson/Admin pipeline. A class that's
  // fully approved and just waiting on Faculty's own Release Grades click
  // never lands here — see isPendingReview's own comment above.
  const pendingReviewClasses = classes.filter((c) => isPendingReview(c) && (c.submitted_count || 0) > 0);
  const reviewStageLabel = (c) => (!c.chairperson_verified ? 'Awaiting Chairperson verification' : 'Awaiting Admin approval');

  // Once released, a class is done — it belongs in My Classes' own
  // "Released" container (grouped by Academic Year → Semester), not sitting
  // here alongside classes that still need attention.
  const assignedClasses = classes.filter((c) => !c.all_released);
  const releasedCount = classes.length - assignedClasses.length;
  const groups = groupByProgramYearSection(assignedClasses);
  const programs = Object.keys(groups).sort();

  const returnedContainerOpen = openGroups['returned|container'] ?? false;
  const returnedGroups = groupByYearSection(returnedClasses);
  const returnedYears = Object.keys(returnedGroups).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a - b));

  const pendingReviewContainerOpen = openGroups['pendingReview|container'] ?? false;
  const pendingReviewGroups = groupByYearSection(pendingReviewClasses);
  const pendingReviewYears = Object.keys(pendingReviewGroups).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a - b));

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-display text-2xl font-bold text-navy">Welcome back, {user?.name}!</h2>
          <CurrentSemesterTag />
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Manage your classes and student grades efficiently.</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard label="My Classes"     value={classes.length} icon={<Icons.Book />}  iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Total Students" value={totalStudents}  icon={<Icons.Users />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Pending Grades" value={pending} valueClass="text-red-500"     icon={<Icons.Clock />} iconBg="bg-red-50 text-red-500" />
        <StatCard label="Submitted"      value={submitted}      icon={<Icons.Check />} iconBg="bg-amber-50 text-amber-500" />
        <StatCard label="Pending Review" value={pendingReview} valueClass="text-purple-500" icon={<Icons.Clock />} iconBg="bg-purple-50 text-purple-500" />
      </div>

      {/* Its own standalone section, above "Assigned Classes" and its own
          heading — NOT nested under that header the way it briefly was,
          which read as if these submitted-and-waiting classes were part of
          the "still need grades encoded" list right below. They aren't:
          Faculty already submitted these, there's nothing left to encode,
          just a Chairperson/Admin step still pending. Purple, not red —
          nothing here needs Faculty to act, unlike "Returned by
          Chairperson" below. */}
      {pendingReviewClasses.length > 0 && (
        <div className="mb-6">
          <h3 className="text-base font-semibold text-navy mb-3">Pending Review</h3>
          <div className="card overflow-hidden border border-purple-200">
            <button
              onClick={() => toggleGroup('pendingReview|container', !pendingReviewContainerOpen)}
              className="w-full px-5 py-2.5 bg-purple-500 text-white flex items-center gap-2 border-none cursor-pointer font-sans hover:opacity-95 transition-opacity"
            >
              <Icons.Clock className="w-4 h-4" />
              <span className="text-xs opacity-80">{pendingReviewClasses.length} class{pendingReviewClasses.length !== 1 ? 'es' : ''} awaiting Chairperson/Admin review</span>
              {pendingReviewContainerOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <Icons.ChevronDown className="w-3.5 h-3.5 ml-auto" />}
            </button>

            {pendingReviewContainerOpen && pendingReviewYears.map((year) => {
              const sections = pendingReviewGroups[year];
              const yearTotal = Object.values(sections).reduce((s, arr) => s + arr.length, 0);
              const yearKey = `pendingReview|year|${year}`;
              const yearOpen = openGroups[yearKey] ?? false;
              return (
                <div key={year} className="border-t border-gray-50">
                  <button
                    onClick={() => toggleGroup(yearKey, !yearOpen)}
                    className="w-full px-5 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-purple-50/40 hover:bg-purple-50/70 transition-colors"
                  >
                    <span className="text-[12px] font-semibold text-purple-700">{year === '—' ? 'No Year Level' : `Year ${year}`}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400">{yearTotal}</span>
                      {yearOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                    </div>
                  </button>

                  {yearOpen && Object.keys(sections).sort().map((section) => {
                    const secClasses = sections[section];
                    const secKey = `${yearKey}|section|${section}`;
                    const secOpen = openGroups[secKey] ?? false;
                    return (
                      <div key={section} className="border-t border-gray-50">
                        <button
                          onClick={() => toggleGroup(secKey, !secOpen)}
                          className="w-full pl-9 pr-5 py-1.5 flex items-center justify-between border-none cursor-pointer font-sans bg-white hover:bg-gray-50 transition-colors"
                        >
                          <span className="text-[12px] text-gray-600">{section === 'No Section' ? section : `Section ${section}`}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="purple">{secClasses.length}</Badge>
                            {secOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                          </div>
                        </button>
                        {secOpen && (
                          <div className="divide-y divide-gray-50">
                            {secClasses.map((c) => (
                              <div key={c.id} className="p-4 pl-9 flex items-start justify-between gap-4 flex-wrap">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold text-navy">{c.subject?.code}</p>
                                  <p className="text-xs text-gray-500 mb-1">{c.subject?.name}</p>
                                  <p className="text-xs text-purple-600">{reviewStageLabel(c)}</p>
                                </div>
                                <button
                                  className="btn btn-outline btn-sm flex-shrink-0"
                                  onClick={() => setEncodingClassId(c.id)}
                                >
                                  View
                                </button>
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
        </div>
      )}

      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-navy">Assigned Classes</h3>
          {releasedCount > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              {releasedCount} released — see them in{' '}
              <button className="text-gold font-medium bg-transparent border-none cursor-pointer p-0 font-sans" onClick={() => navigate('/faculty/classes')}>
                My Classes
              </button>{"'"} own Released section.
            </p>
          )}
        </div>
        {/* No collapse toggle here — unlike every other browsing/filter
            container in the system, the class list on the Dashboard's own
            landing view always stays visible; My Classes (InstructorClasses.js)
            is where the collapsible version lives. */}
        <button
          className="text-sm text-gold font-medium cursor-pointer bg-transparent border-none flex-shrink-0"
          onClick={() => navigate('/faculty/classes')}
        >
          View All →
        </button>
      </div>

      {/* Sits between the "Assigned Classes" header and the actual list below
          — same placement My Classes (InstructorClasses.js) gives its own
          copy of this container, below its filters and above the Class List
          card. */}
      {returnedClasses.length > 0 && (
        <div className="card overflow-hidden mb-6 border border-red-200">
          <button
            onClick={() => toggleGroup('returned|container', !returnedContainerOpen)}
            className="w-full px-5 py-2.5 bg-red-500 text-white flex items-center gap-2 border-none cursor-pointer font-sans hover:opacity-95 transition-opacity"
          >
            <Icons.AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-bold">Returned by Chairperson</span>
            <span className="text-xs opacity-80">{returnedClasses.length} class{returnedClasses.length !== 1 ? 'es' : ''} to fix and resubmit</span>
            {returnedContainerOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <Icons.ChevronDown className="w-3.5 h-3.5 ml-auto" />}
          </button>

          {returnedContainerOpen && returnedYears.map((year) => {
            const sections = returnedGroups[year];
            const yearTotal = Object.values(sections).reduce((s, arr) => s + arr.length, 0);
            const yearKey = `returned|year|${year}`;
            const yearOpen = openGroups[yearKey] ?? false;
            return (
              <div key={year} className="border-t border-gray-50">
                <button
                  onClick={() => toggleGroup(yearKey, !yearOpen)}
                  className="w-full px-5 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-red-50/40 hover:bg-red-50/70 transition-colors"
                >
                  <span className="text-[12px] font-semibold text-red-700">{year === '—' ? 'No Year Level' : `Year ${year}`}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">{yearTotal}</span>
                    {yearOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                  </div>
                </button>

                {yearOpen && Object.keys(sections).sort().map((section) => {
                  const secClasses = sections[section];
                  const secKey = `${yearKey}|section|${section}`;
                  const secOpen = openGroups[secKey] ?? false;
                  return (
                    <div key={section} className="border-t border-gray-50">
                      <button
                        onClick={() => toggleGroup(secKey, !secOpen)}
                        className="w-full pl-9 pr-5 py-1.5 flex items-center justify-between border-none cursor-pointer font-sans bg-white hover:bg-gray-50 transition-colors"
                      >
                        <span className="text-[12px] text-gray-600">{section === 'No Section' ? section : `Section ${section}`}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="red">{secClasses.length}</Badge>
                          {secOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                        </div>
                      </button>
                      {secOpen && (
                        <div className="divide-y divide-gray-50">
                          {secClasses.map((c) => (
                            <div key={c.id} className="p-4 pl-9 flex items-start justify-between gap-4 flex-wrap">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-navy">{c.subject?.code}</p>
                                <p className="text-xs text-gray-500 mb-1">{c.subject?.name}</p>
                                {c.chairperson_return_reason && (
                                  <p className="text-xs text-red-600">Chairperson: "{c.chairperson_return_reason}"</p>
                                )}
                              </div>
                              <button
                                className="btn btn-navy btn-sm flex-shrink-0"
                                onClick={() => setEncodingClassId(c.id)}
                              >
                                Review &amp; Revise
                              </button>
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
      )}

      {(assignedClasses.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Icons.Book className="w-10 h-10 mx-auto mb-3 opacity-30" />
          {classes.length === 0 ? (
            <>
              <p className="font-medium">No classes assigned yet</p>
              <p className="text-sm mt-1">Contact the Admin to get classes assigned to you.</p>
            </>
          ) : (
            <>
              <p className="font-medium">All caught up</p>
              <p className="text-sm mt-1">Every class's grades have been released — see them in My Classes.</p>
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {programs.map((program) => {
            const years = groups[program];
            const programTotal = Object.values(years).reduce((s, secs) => s + Object.values(secs).reduce((s2, arr) => s2 + arr.length, 0), 0);
            // How many of this program's classes are can_release (Chairperson
            // + Admin both cleared, just waiting on Faculty's own click) — the
            // same flag each class's own card below already shows "Ready to
            // release grades to students" for, surfaced here too so it's
            // visible without opening the program at all.
            const programReadyCount = Object.values(years).reduce((s, secs) => s + Object.values(secs).reduce((s2, arr) => s2 + arr.filter((c) => c.can_release).length, 0), 0);
            const programKey = `program|${program}`;
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
                    {programReadyCount > 0 && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(255,255,255,0.2)' }}>
                        <Icons.Check className="w-3 h-3" /> {programReadyCount} class{programReadyCount !== 1 ? 'es' : ''} ready to release
                      </span>
                    )}
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
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-4 bg-gray-50/40">
                                {secClasses.map((c) => {
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
                                      <p className="text-xs text-gray-500 flex items-center gap-1 mb-4">
                                        <Icons.Users className="w-3 h-3" /> {c.student_count} Students
                                      </p>
                                      {/* Chairperson + Admin both cleared it — nothing left in the
                                          review pipeline (see isPendingReview above, which is exactly
                                          why this class no longer shows in "Pending Review"), just
                                          Faculty's own Release Grades click still pending. */}
                                      {c.can_release && (
                                        <p className="text-xs text-green-600 font-medium flex items-center gap-1 mb-3 -mt-2">
                                          <Icons.Check className="w-3 h-3" /> Ready to release grades to students
                                        </p>
                                      )}
                                      <div className="flex flex-col gap-2">
                                        <button
                                          className="btn btn-navy btn-sm w-full justify-center"
                                          onClick={() => setEncodingClassId(c.id)}
                                        >
                                          Encode Grades
                                        </button>
                                        {/* Shown once eligible (Chairperson + Admin both cleared it).
                                            Once clicked, the class disappears from this list entirely
                                            on the next load (moves to My Classes' Released section)
                                            instead of sticking around with a "Released" label. */}
                                        {c.can_release && (
                                          <button
                                            className="btn btn-sm w-full justify-center text-white"
                                            style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
                                            onClick={() => setReleaseTarget(c)}
                                          >
                                            <Icons.Send className="w-3.5 h-3.5" /> Release Grades
                                          </button>
                                        )}
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
                  );
                })}
              </div>
            );
          })}
        </div>
      ))}

      {releaseTarget && (
        <ConfirmDialog
          title="Release Grades"
          message={`Release grades for ${releaseTarget.subject?.code || 'this class'}${releaseTarget.section ? ` - Section ${releaseTarget.section}` : ''} to students? This makes them visible immediately, and this button locks again right after.`}
          confirmText={releasing ? 'Releasing...' : 'Release'}
          variant="green"
          confirmDisabled={releasing}
          onConfirm={handleRelease}
          onCancel={() => setReleaseTarget(null)}
        />
      )}
    </>
  );
}
