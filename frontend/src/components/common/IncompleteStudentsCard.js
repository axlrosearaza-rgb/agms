import { useState, useEffect } from 'react';
import { Icons, formatPersonName } from './index';
import { gradeService } from '../../services';
import { onGradesUpdated } from '../../services/socket';

// Faculty's follow-up list of students still marked INC in classes whose
// grades were already released to students — shown on both My Classes and the
// Dashboard so there's one place to see who still needs to be completed. Each
// entry only stays for a set time (the INC deadline, or a default window when
// none was set — enforced server-side by GET /grades/inc/mine), then drops
// off; resolving the INC removes it right away. Renders nothing at all when
// there's no one to follow up on.
//
// `onOpenClass(classId)` decides where "Complete" goes — the Dashboard opens
// Grade Encoding in place, My Classes navigates to its routed page.
const timeLeftLabel = (days) => {
  if (days <= 0) return 'Due today';
  return `${days} day${days !== 1 ? 's' : ''} left`;
};

const timeLeftClass = (days) => {
  if (days <= 7) return 'bg-red-50 text-red-600';
  if (days <= 30) return 'bg-amber-50 text-amber-700';
  return 'bg-gray-100 text-gray-600';
};

export default function IncompleteStudentsCard({ onOpenClass }) {
  const [students, setStudents] = useState([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      const { data } = await gradeService.getMyIncStudents();
      setStudents(data.inc_students || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => { load(); }, []);
  // Marking/resolving an INC or releasing a class all change this list.
  useEffect(() => onGradesUpdated(() => load()), []);

  if (students.length === 0) return null;

  return (
    <div className="card overflow-hidden mb-6 border border-amber-200">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-2.5 bg-amber-500 text-white flex items-center gap-2 border-none cursor-pointer font-sans hover:opacity-95 transition-opacity"
      >
        <Icons.Clock className="w-4 h-4" />
        <span className="text-sm font-bold">Incomplete Students</span>
        <span className="text-xs opacity-80">{students.length} student{students.length !== 1 ? 's' : ''} to complete after release</span>
        {open ? <Icons.ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <Icons.ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>

      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500">
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Class</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Missing</th>
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Time Left</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-gray-50">
                  <td className="px-4 py-3 align-top">
                    <p className="text-sm font-medium text-navy">{formatPersonName(s.student?.name)}</p>
                    <p className="text-xs text-gray-400">{s.student?.student_no}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p className="text-sm font-semibold text-navy">{s.class?.subject?.code}</p>
                    <p className="text-xs text-gray-500">
                      {s.class?.subject?.name}{s.class?.section ? ` · Section ${s.class.section}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    {/* INC is per period — which one(s) this student still owes. */}
                    {(s.incomplete_periods || []).length > 0 && (
                      <p className="text-[11px] font-semibold text-amber-800 mb-0.5">
                        {s.incomplete_periods.join(' & ')}
                      </p>
                    )}
                    <p className="text-xs text-amber-700">{s.inc_remarks || '—'}</p>
                  </td>
                  <td className="px-4 py-3 align-top whitespace-nowrap">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${timeLeftClass(s.days_left)}`}>
                      {timeLeftLabel(s.days_left)}
                    </span>
                    <p className="text-[11px] text-gray-400 mt-1">
                      {s.deadline_is_default ? 'Until ' : 'Deadline: '}{new Date(s.inc_deadline).toLocaleDateString()}
                    </p>
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <button className="btn btn-navy btn-sm" onClick={() => onOpenClass(s.class.id)}>
                      Complete
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
}
