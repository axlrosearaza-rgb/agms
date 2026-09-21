import { useState, useEffect, useCallback } from 'react';
import { Avatar, Badge, ProgramBadge, RegularityBadge, Modal, LoadingSpinner } from './index';
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
          <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-5 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <Avatar letter={student.avatar || student.name?.[0]} className="bg-navy text-white" size="w-12 h-12 text-lg" />
              <div>
                <h3 className="text-base font-bold text-navy">{student.name}</h3>
                <div className="flex items-center flex-wrap gap-2 mt-1">
                  <span className="text-xs text-gray-500">{student.student_no}</span>
                  {student.program && <ProgramBadge program={student.program} bs />}
                  <RegularityBadge status={student.student_status} />
                  {student.year_level && <Badge variant="blue">Year {student.year_level}{student.section ? ` - Sec ${student.section}` : ''}</Badge>}
                </div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Overall GWA</p>
              <p className="text-2xl font-bold text-navy tabular-nums">{summary?.gwa ?? '—'}</p>
              <p className="text-[11px] text-gray-400">{summary?.passed ?? 0} passed · {summary?.failed ?? 0} failed{summary?.inc ? ` · ${summary.inc} INC` : ''}</p>
            </div>
          </div>

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
