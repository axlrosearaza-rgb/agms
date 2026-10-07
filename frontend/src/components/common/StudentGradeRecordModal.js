import { useState, useEffect, useCallback } from 'react';
import { Avatar, Badge, ProgramBadge, Modal, LoadingSpinner, formatPersonName, Icons } from './index';
import ProspectusTable from '../student/ProspectusTable';
import { gradeService } from '../../services';
import toast from 'react-hot-toast';

// Read-only copy of a student's full curriculum record — every subject, Year
// 1 through 4, with their actual outcome overlaid, plus their overall GWA —
// for Admin/Chairperson/Faculty to pull up from wherever a student already
// appears in their own workflow (User Management, a class roster, ...)
// without sending them to the student's own My Grades page. Built on the
// exact same data (getStudentProspectus) and the exact same table
// (ProspectusTable) the student's own page uses, so this can never disagree
// with what the student themselves sees. View-only, deliberately — the
// Evaluation of Grades .docx export stays a student-only action from their
// own My Grades page (exportEvaluationOfGradesDocx), not offered here.
export default function StudentGradeRecordModal({ studentId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: result } = await gradeService.getStudentProspectus(studentId);
      setData(result);
    } catch (err) {
      toast.error('Failed to load this student\'s grade record');
      onClose();
    } finally {
      setLoading(false);
    }
  }, [studentId, onClose]);

  useEffect(() => { load(); }, [load]);

  const student = data?.student;
  const summary = data?.summary;
  const isPendingSetup = !student?.account_setup_at || data?.account_setup_pending;

  return (
    <Modal
      title="Student Grade Record"
      onClose={onClose}
      size="max-w-5xl"
      footer={<button className="btn btn-outline" onClick={onClose}>Close</button>}
    >
      {loading ? (
        <LoadingSpinner />
      ) : !data ? null : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-5 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-4">
              <Avatar letter={student.avatar || student.name?.[0]} className="bg-navy text-white shadow-sm" size="w-14 h-14 text-xl" />
              <div>
                <h3 className="text-lg font-bold text-navy dark:text-sky-300">{formatPersonName(student.name)}</h3>
                <div className="flex items-center flex-wrap gap-2.5 mt-1 text-sm">
                  <span className="text-gray-500 font-medium">{student.student_no}</span>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span className="font-semibold text-gray-800 dark:text-gray-200">{student.program || '—'}</span>
                  {student.year_level && (
                    <>
                      <span className="text-gray-300 dark:text-gray-600">·</span>
                      <span className="font-medium text-blue-600 dark:text-blue-400">Year {student.year_level}{student.section ? ` - Sec ${student.section}` : ''}</span>
                    </>
                  )}
                  {isPendingSetup && <Badge variant="yellow">Account Not Set Up</Badge>}
                </div>
              </div>
            </div>
            <div className="text-right flex-shrink-0 bg-gray-50 dark:bg-gray-800/60 px-4 py-2.5 rounded-xl border border-gray-100 dark:border-gray-700/60">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Overall GWA</p>
              <p className="text-2xl font-bold text-navy dark:text-sky-300 tabular-nums">{isPendingSetup ? '—' : (summary?.gwa ?? '—')}</p>
              {isPendingSetup ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Pending account setup</p>
              ) : (
                <p className="text-xs text-gray-500">{summary?.passed ?? 0} passed · {summary?.failed ?? 0} failed{summary?.inc ? ` · ${summary.inc} INC` : ''}</p>
              )}
            </div>
          </div>

          {isPendingSetup && (
            <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <Icons.AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Account setup pending:</strong> This student has not completed their account setup yet. Grades are recorded in the system and will automatically appear once the student completes their account setup.
              </span>
            </div>
          )}

          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
            {/* Collapsible per Year (ProspectusTable's own built-in support
                for it) — a 4-year record is a lot to scroll through just to
                check one year, so every year folds shut except the
                student's own current one, open by default so the most
                relevant part is visible without clicking anything first. */}
            <ProspectusTable years={data.years || {}} collapsible defaultExpandedYear={student.year_level} />
          </div>
        </>
      )}
    </Modal>
  );
}
