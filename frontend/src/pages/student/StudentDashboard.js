import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner, ConfidentialityBanner, CurrentSemesterTag, studentYearSectionsLabel, studentCurrentYearSectionLabel, ConfirmDialog, studentTypeLabel, formatPersonNameFirstLast } from '../../components/common';
import { SubjectsTakingSection } from '../../components/student/EnrollmentPanel';
import RetakeSubjectsCard from '../../components/student/RetakeSubjectsCard';
import { gradeService, subjectService, userService, studentEnrollmentService } from '../../services';
import API from '../../services/api';
import { onGradesUpdated } from '../../services/socket';
import toast from 'react-hot-toast';

// Semester.term ("First Semester"/"Second Semester"/"Summer") vs. the format
// Subject.semester actually stores ("1st Semester"/"2nd Semester"/"Summer") —
// same mismatch ProspectusTable's own SEM_LABEL works around, just the
// reverse direction here (term -> subject label instead of label -> display text).
const TERM_TO_SUBJECT_SEMESTER = { 'First Semester': '1st Semester', 'Second Semester': '2nd Semester', 'Summer': 'Summer' };

// Dashboard shows the prospectus version of the student's grades — the full
// curriculum, collapsed by Year, with their own year opened by default so the
// most relevant section is visible without digging. Full detail + search
// lives on My Grades (StudentGrades.js), which reuses the same ProspectusTable.
//
// Promotion itself is Admin's call (Promotion Management) — a self-service
// "Promote Me" version of this page was tried and then deliberately
// reverted, so there's nothing promotion-related here anymore.
export default function StudentDashboard() {
  const { user, updateUser, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: result } = await gradeService.getStudentProspectus(user.id);
      setData(result);
    } catch (err) {
      console.error('Error loading student prospectus:', err);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // The classes this student is in this semester — added by their faculty's
  // class lists (studentEnrollmentController) — for "My Subjects Taking".
  const [enrollment, setEnrollment] = useState(null);
  const loadEnrollment = useCallback(async () => {
    try {
      const { data: res } = await studentEnrollmentService.getMine();
      setEnrollment(res);
    } catch (err) {
      console.error('Error loading enrollment:', err);
    }
  }, []);
  useEffect(() => { loadEnrollment(); }, [loadEnrollment]);

  useEffect(() => {
    // A grade release can be the exact moment gradeController.checkAndRegularizeStudent
    // auto-flips an Irregular student back to Regular server-side — refreshUser()
    // re-pulls the account so that shows up here (hero badge, Path to Regular
    // Status disappearing) without the student needing to log out and back in.
    const handler = () => { fetchData(); loadEnrollment(); refreshUser(); };
    // Also right after the student answers "Is this your class?" — a "No"
    // takes them off that class, so the list here must drop it at once.
    window.addEventListener('agms:enrollments-changed', handler);
    const off = onGradesUpdated(handler);
    return () => { window.removeEventListener('agms:enrollments-changed', handler); off(); };
  }, [fetchData, loadEnrollment, refreshUser]);

  if (loading) return <LoadingSpinner />;

  const summary = data?.summary || {};


  return (
    <>
      {/* HERO */}
      <div className="bg-gradient-to-r from-navy-dark via-navy to-navy-light rounded-xl p-7 text-white flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-5">
          <Avatar
            letter={user?.avatar || user?.name?.[0]}
            className="bg-gold text-white border-[3px] border-white/30 flex-none"
            size="w-16 h-16 text-2xl"
          />
          <div className="flex flex-col">
            {/* The badges' own default palette (light bg + dark text) is
                meant for a white card background — on this dark navy hero it
                needs an explicit override, same as CurrentSemesterTag below,
                or it renders unreadable/invisible against the gradient. */}
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold leading-none">{user?.name}</h2>
            </div>
            <p className="text-sm opacity-80 mt-1.5">{user?.student_no}</p>
            {/* Current Year + Section front and center — this is "where the
                student is right now" (studentCurrentYearSectionLabel), the
                one thing every student, Regular or Irregular, actually wants
                to see at a glance. An Irregular student's other Year+Section
                pairs (their back subjects) are still there too, just as
                smaller secondary text underneath instead of competing with
                this for top billing. */}
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-white/15 px-2.5 py-1 rounded-full">
                <Icons.Book className="w-3 h-3" />
                {studentCurrentYearSectionLabel(user)}
              </span>
              {/* Regular / Irregular — set by the system from the class lists. */}
              {user?.student_status && (
                <span
                  className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    user.student_status === 'Irregular' ? 'bg-red-400/25 text-red-50' : 'bg-green-400/25 text-green-50'
                  }`}
                  title="Set automatically from your class lists"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${user.student_status === 'Irregular' ? 'bg-red-300' : 'bg-green-300'}`} />
                  {user.student_status}
                </span>
              )}
              {user?.status_declared_at && user?.student_type && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold bg-white/15 px-2.5 py-1 rounded-full">
                  <Icons.User className="w-3 h-3" />
                  {studentTypeLabel(user.student_type)}
                </span>
              )}
              <CurrentSemesterTag className="!bg-white/10 !text-white" />
            </div>
            {/* The adviser of the student's own program, year and section
                (assigned by the Admin) — comes with the prospectus. */}
            <p className="text-[13px] mt-2 flex items-center gap-1.5">
              <Icons.Users className="w-3.5 h-3.5 opacity-80" />
              <span className="opacity-75">Adviser:</span>
              {data?.adviser?.name
                ? <span className="font-semibold">{formatPersonNameFirstLast(data.adviser.name)}</span>
                : <span className="opacity-75 italic">not yet assigned</span>}
            </p>
            {user?.student_status === 'Irregular' && user?.irregular_sections?.length > 1 && (() => {
              // Same fallback studentCurrentYearSectionLabel uses — legacy
              // accounts with no is_current on any pair treat the first as
              // "current" too, so it's excluded here the same way.
              const hasCurrentMarked = user.irregular_sections.some((p) => p.is_current);
              const others = hasCurrentMarked
                ? user.irregular_sections.filter((p) => !p.is_current)
                : user.irregular_sections.slice(1);
              if (others.length === 0) return null;
              const label = others
                .slice()
                .sort((a, b) => (a.year_level || 0) - (b.year_level || 0))
                .map((p) => `Year ${p.year_level}${p.section ? ` · Sec ${p.section}` : ''}`)
                .join(', ');
              return <p className="text-[11px] opacity-60 mt-1">Back subjects: {label}</p>;
            })()}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 flex-none self-center">
          <div className="w-20 h-20 rounded-full bg-gold flex items-center justify-center flex-none">
            <span className="text-xl font-bold">{summary.gwa || '—'}</span>
          </div>
          <p className="text-xs">Overall GWA</p>
        </div>
      </div>

      {!user?.email && (
        <div className="mb-6 p-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700/60 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 dark:text-amber-200">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-400 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icons.Mail className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">Email Address Required</p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                Your account does not have an email address yet. Please add your email address so you can recover your password if you ever forget it.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/student/settings')}
            className="btn btn-gold text-xs px-3.5 py-2 flex items-center gap-1.5 self-start sm:self-center flex-shrink-0 cursor-pointer"
          >
            <Icons.Settings className="w-3.5 h-3.5" />
            Set Email in Settings
          </button>
        </div>
      )}

      <ConfidentialityBanner />

      {/* STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Passed" value={summary.passed || 0} valueClass="text-green-500" />
        <StatCard label="Failed" value={summary.failed || 0} valueClass="text-red-500" />
        <StatCard label="In Progress" value={summary.in_progress || 0} valueClass="text-blue-500" />
        <StatCard label="Not Taken Yet" value={summary.not_taken || 0} valueClass="text-gray-400" />
      </div>

      {/* Failed / INC / dropped subjects still owed — gone once re-enrolled. */}
      <RetakeSubjectsCard />

      {/* MY SUBJECTS TAKING —the classes this student's faculty added them to
          (via class lists), in the same table as the prospectus (grades fill
          in as they're released). The full four-year curriculum stays on My
          Grades, reachable from the link. */}
      <SubjectsTakingSection
        enrollment={enrollment}
        prospectusYears={data?.years}
        headerRight={(
          <button
            className="text-sm text-gold font-medium cursor-pointer bg-transparent border-none"
            onClick={() => navigate('/student/grades')}
          >
            View Full Prospectus →
          </button>
        )}
      />
    </>
  );
}
