import { useCallback, useEffect, useState } from 'react';
import { Icons } from '../common';
import { accountSetupService } from '../../services';
import { onGradesUpdated } from '../../services/socket';

const STATUS_STYLE = {
  Failed: 'bg-red-100 text-red-700',
  INC: 'bg-amber-100 text-amber-800',
  DRP: 'bg-gray-200 text-gray-700',
  Dropped: 'bg-gray-200 text-gray-700',
};
const yearLabel = (y) => (y ? `${y}${['th', 'st', 'nd', 'rd'][y] || 'th'} Year` : '—');

// Student dashboard: subjects failed / left INC / dropped and not yet passed,
// so the student can keep track of what they still owe. Each one disappears
// by itself once they're enrolled in that subject again (or pass it)
// — accountSetupController.getRetakes. Hidden when there's nothing to retake.
export default function RetakeSubjectsCard() {
  const [retakes, setRetakes] = useState([]);
  const load = useCallback(() => {
    accountSetupService.getRetakes().then(({ data }) => setRetakes(data.retakes || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const off = onGradesUpdated(load);
    window.addEventListener('agms:enrollments-changed', load);
    return () => { off(); window.removeEventListener('agms:enrollments-changed', load); };
  }, [load]);

  if (!retakes.length) return null;

  return (
    <div className="card mb-6 overflow-hidden border border-red-200">
      <div className="px-5 py-3 bg-red-50 border-b border-red-200 flex items-center gap-3">
        <span className="min-w-[28px] h-7 px-2 rounded-full bg-red-600 text-white text-sm font-bold flex items-center justify-center">{retakes.length}</span>
        <div>
          <h3 className="text-sm font-bold text-red-800">Subjects to Retake</h3>
          <p className="text-[11px] text-red-700/80">Failed, incomplete or dropped subjects you haven't passed yet. Each one leaves this list once you're enrolled in it again.</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-gray-50">
            <tr className="text-[11px] uppercase text-gray-500">
              <th className="px-4 py-2 text-left">Code</th>
              <th className="px-4 py-2 text-left">Description</th>
              <th className="px-4 py-2 text-center">Units</th>
              <th className="px-4 py-2 text-center">In the Curriculum</th>
              <th className="px-4 py-2 text-center">Taken</th>
              <th className="px-4 py-2 text-center">Grade</th>
              <th className="px-4 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {retakes.map((r) => (
              <tr key={r.subject_id} className="border-t border-gray-100">
                <td className="px-4 py-2 font-semibold text-navy whitespace-nowrap">{r.code}</td>
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 text-center">{r.units ?? '—'}</td>
                <td className="px-4 py-2 text-center whitespace-nowrap">{yearLabel(r.curriculum_year)} · {r.curriculum_semester || '—'}</td>
                <td className="px-4 py-2 text-center text-[12px] text-gray-500">{r.taken_semester}{r.taken_section ? ` (${r.taken_section})` : ''}</td>
                <td className="px-4 py-2 text-center font-mono">{r.status === 'Failed' && r.grade != null ? Number(r.grade).toFixed(2) : '—'}</td>
                <td className="px-4 py-2 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_STYLE[r.status] || 'bg-gray-100 text-gray-700'}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex items-center gap-1.5">
        <Icons.AlertCircle className="w-3.5 h-3.5" /> Talk to your adviser about when you can take these again. A subject that is a prerequisite must be passed before the subject after it.
      </div>
    </div>
  );
}
