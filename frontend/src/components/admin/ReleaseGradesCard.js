import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Icons, Badge, ConfirmDialog, ProgramBadge, formatPersonNameFirstLast } from '../common';
import { classService, gradeService } from '../../services';
import { onGradesUpdated } from '../../services/socket';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';

// Admin dashboard: classes whose Class Record and Grade Sheet are both
// approved — release each one's grades to its students (same action as the
// Release to Students button on Grade Approval), or all of them at once.
// Approving both documents already releases a class on its own; anything that
// still shows here (e.g. approved before that, or a release that failed) is
// released from here.
const label = (c) => `${c.subject?.code || 'Class'}${c.section ? ` ${c.year_level || ''}-${c.section}` : ''}`;

export default function ReleaseGradesCard() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(null); // class id, or 'all'
  const [confirm, setConfirm] = useState(null); // a class, or 'all'
  const [showReleased, setShowReleased] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await classService.getAll({ limit: 200 });
      // Approved, active, and actually has students (a class emptied of its
      // students has nothing to release). An INC completed later is released
      // to the student by itself — it never comes back here.
      setClasses((data.classes || []).filter((c) => (c.status || 'Active') === 'Active' && c.admin_class_record_approved && c.admin_grade_sheet_approved && (c.student_count || 0) > 0));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); return onGradesUpdated(load); }, [load]);
  useAutoRefresh(load);

  const waiting = classes.filter((c) => !c.all_released);
  const released = classes.filter((c) => c.all_released);

  const release = async (c) => {
    setReleasing(c.id);
    try {
      const { data } = await gradeService.releaseClass(c.id);
      toast.success(data.message || `Grades of ${label(c)} released.`);
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to release ${label(c)}`);
    } finally {
      setReleasing(null);
      load();
    }
  };

  const releaseAll = async () => {
    setReleasing('all');
    let ok = 0;
    for (const c of waiting) {
      try { await gradeService.releaseClass(c.id); ok += 1; } catch (err) { toast.error(err.response?.data?.message || `Failed to release ${label(c)}`); }
    }
    if (ok) toast.success(`Released the grades of ${ok} class${ok !== 1 ? 'es' : ''}.`);
    setReleasing(null);
    load();
  };

  const row = (c, isReleased) => (
    <tr key={c.id} className="border-t border-gray-100">
      <td className="px-4 py-3">
        <p className="text-[13px] font-semibold text-navy">{c.subject?.code}</p>
        <p className="text-[11px] text-gray-500">{c.subject?.name}</p>
      </td>
      <td className="px-3 py-3"><ProgramBadge program={c.subject?.program} short /></td>
      <td className="px-3 py-3 text-[13px] text-gray-700 whitespace-nowrap">Year {c.year_level || '—'}{c.section ? ` - ${c.section}` : ''}</td>
      <td className="px-3 py-3 text-[13px] text-gray-700">{c.instructor?.name ? formatPersonNameFirstLast(c.instructor.name) : '—'}</td>
      <td className="px-3 py-3 text-[13px] text-center">{c.student_count ?? '—'}</td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {isReleased ? (
          <Badge variant="green"><Icons.Check className="w-3 h-3" /> Released</Badge>
        ) : (
          <button className="btn btn-gold btn-sm" onClick={() => setConfirm(c)} disabled={!!releasing}>
            <Icons.Send className="w-3.5 h-3.5" /> {releasing === c.id ? 'Releasing…' : 'Release to Students'}
          </button>
        )}
      </td>
    </tr>
  );

  const table = (list, isReleased) => (
    // Scrolls inside the card once the list gets long; the header stays put.
    <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
      <table className="w-full min-w-[760px]">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-50 text-gray-500 text-[10px] font-semibold uppercase tracking-wide">
            <th className="text-left px-4 py-2">Subject</th>
            <th className="text-left px-3 py-2">Program</th>
            <th className="text-left px-3 py-2">Year &amp; Section</th>
            <th className="text-left px-3 py-2">Faculty</th>
            <th className="text-center px-3 py-2">Students</th>
            <th className="text-right px-4 py-2">Release</th>
          </tr>
        </thead>
        <tbody>{list.map((c) => row(c, isReleased))}</tbody>
      </table>
    </div>
  );

  return (
    <div className="card overflow-hidden mb-6">
      <div className="px-5 py-3.5 bg-green-600 text-white flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold bg-white/20 rounded-full min-w-[26px] h-[26px] px-2 flex items-center justify-center">{waiting.length}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">Release Grades to Students</p>
          <p className="text-[11px] text-white/80">Classes whose Class Record and Grade Sheet are both approved.</p>
        </div>
        {waiting.length > 1 && (
          <button className="btn btn-sm bg-white text-green-700 border-none font-semibold hover:bg-green-50" onClick={() => setConfirm('all')} disabled={!!releasing}>
            <Icons.Send className="w-3.5 h-3.5" /> {releasing === 'all' ? 'Releasing…' : `Release All (${waiting.length})`}
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
      ) : waiting.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          No grades waiting to be released.{released.length ? ` All ${released.length} approved class${released.length !== 1 ? 'es are' : ' is'} already released.` : ''}
        </p>
      ) : table(waiting, false)}

      {released.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            className="w-full px-5 py-2.5 flex items-center justify-between bg-transparent border-none cursor-pointer font-sans text-[13px] font-semibold text-gray-600 hover:bg-gray-50"
            onClick={() => setShowReleased((v) => !v)}
          >
            <span>Already released ({released.length})</span>
            {showReleased ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
          </button>
          {showReleased && table(released, true)}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm === 'all' ? 'Release all approved grades?' : 'Release grades to students?'}
          message={confirm === 'all'
            ? `The grades of all ${waiting.length} approved classes become visible to their students, who are notified. Each class's faculty is notified too.`
            : `The grades of ${label(confirm)}${confirm.instructor?.name ? ` (${formatPersonNameFirstLast(confirm.instructor.name)})` : ''} become visible to its students, who are notified. The faculty member is notified too.`}
          confirmText={confirm === 'all' ? 'Release All' : 'Release'}
          variant="green"
          onConfirm={async () => { const c = confirm; setConfirm(null); if (c === 'all') await releaseAll(); else await release(c); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
