import { useCallback, useEffect, useState } from 'react';
import { Icons, formatPersonName } from '../common';
import { classService } from '../../services';
import socket, { onGradesUpdated } from '../../services/socket';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';

// Faculty dashboard: students who answered "No, not mine" about one of this
// instructor's classes. Each stays here until dismissed ("Got it"), so the
// instructor can't miss it. Updates live when a student answers.
export default function NotMyClassWarning() {
  const [disputes, setDisputes] = useState([]);

  const load = useCallback(() => {
    classService.getMyDisputes().then(({ data }) => setDisputes(data.disputes || [])).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    socket.on('notification:new', load);
    const off = onGradesUpdated(load);
    return () => { socket.off('notification:new', load); off(); };
  }, [load]);

  useAutoRefresh(load);

  const dismiss = async (id) => {
    setDisputes((list) => list.filter((d) => d.id !== id));
    try { await classService.dismissDispute(id); } catch (err) { load(); }
  };

  if (disputes.length === 0) return null;

  return (
    <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 mb-5">
      <div className="flex items-center gap-2 mb-2">
        <Icons.AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0" />
        <p className="text-sm font-bold text-red-900">
          {disputes.length} student{disputes.length !== 1 ? 's' : ''} said “Not my class”
        </p>
      </div>
      <ul className="space-y-1.5">
        {disputes.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white border border-red-100 rounded-lg px-3 py-2">
            <div className="flex-1 min-w-[220px]">
              <p className="text-[13px] text-gray-800">
                <b>{formatPersonName(d.student_name)}</b>
                {d.student_no ? <span className="text-gray-500"> ({d.student_no})</span> : null}
                {' '}is not taking <b>{d.class_label}</b>.
              </p>
              <p className="text-[11px] text-gray-500">
                {d.removed
                  ? 'Removed from the class list automatically.'
                  : 'Not removed — their grade was already submitted. Please check your class list.'}
                {' · '}
                {new Date(d.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
            <button type="button" className="btn btn-outline btn-sm flex-shrink-0" onClick={() => dismiss(d.id)} title="Remove this warning">
              <Icons.Check className="w-3.5 h-3.5" /> Got it
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
