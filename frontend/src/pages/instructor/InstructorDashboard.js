import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Icons, StatCard, LoadingSpinner, CurrentSemesterTag } from '../../components/common';
import { classService } from '../../services';
import GradeEncoding from './GradeEncoding';
import IncompleteStudentsCard from '../../components/common/IncompleteStudentsCard';
import ReleaseStatusCard from '../../components/instructor/ReleaseStatusCard';
import GradeDeadlineBanner from '../../components/instructor/GradeDeadlineBanner';
import NotMyClassWarning from '../../components/instructor/NotMyClassWarning';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import InstructorClasses from './InstructorClasses';
import { onGradesUpdated } from '../../services/socket';

export default function InstructorDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
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
  const toggleGroup = (key, next) => setOpenGroups((prev) => ({
    ...prev,
    [key]: next !== undefined ? next : !prev[key]
  }));
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
  // Anything saved (e.g. in the Class List below) → stats and trackers refresh.
  useAutoRefresh(() => loadClasses());

  // Live refresh — a Chairperson/Admin action on one of these classes
  // (verify, return for revision, approve...) changes what belongs here
  // (e.g. the "Returned by Chairperson" container) without this page's own
  // reload ever firing, so without this a Faculty sitting on their Dashboard
  // wouldn't see it until they manually navigated away and back.
  useEffect(() => {
    const handler = () => loadClasses();
    return onGradesUpdated(handler);
  }, [user.id]);

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
  // Admin's side counts as done only once BOTH of its documents are approved
  // (the same two flags releasing to students checks server-side), not merely
  // "no Passed grade is pending" — a class with no Passed grades would
  // otherwise skip Admin's review entirely.
  const adminApproved = (c) => !!(c.admin_class_record_approved && c.admin_grade_sheet_approved) && (c.pending_admin_approval || 0) === 0;
  const isPendingReview = (c) => !c.awaiting_faculty_revision && !c.all_released && (c.submitted_count || 0) > 0 && (!c.chairperson_verified || !adminApproved(c));
  const pendingReview = classes.reduce((s, c) => s + (isPendingReview(c) ? (c.submitted_count || 0) : 0), 0);

  return (
    <>
      <GradeDeadlineBanner classes={classes} onOpenClasses={() => navigate(`${user?.role === 'Chairperson' ? '/chairperson' : '/faculty'}/classes`)} />
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
        <StatCard label="Pending Review" value={pendingReview} valueClass="text-blue-600" icon={<Icons.Clock />} iconBg="bg-blue-50 text-blue-600" />
      </div>

      {/* Students who answered "No, not mine" — below the stat cards. */}
      <NotMyClassWarning />

      {/* The same Class List as My Classes — every class with its actions
          (edit, class list, add students, previews, delete). */}
      <InstructorClasses embedded />

      {/* Where each class's grades stand — Admin releases them. */}
      <ReleaseStatusCard classes={classes} onOpenClass={(classId) => setEncodingClassId(classId)} />

      {/* Students still INC in classes already released to students — the
          follow-up list (self-loading; renders nothing when empty). Complete
          opens that class's Grade Encoding right here, same as Encode Grades. */}
      <IncompleteStudentsCard onOpenClass={(classId) => setEncodingClassId(classId)} />
    </>
  );
}
