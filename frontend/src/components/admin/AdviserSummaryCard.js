import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icons, ProgramDot, programShortLabel, formatPersonName, SearchBar } from '../common';
import { userService } from '../../services';
import { onGradesUpdated } from '../../services/socket';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';

// Admin dashboard: every adviser and their advisory section(s) — students,
// accounts set up, Regular / Irregular, students still owing a subject, and
// how many the adviser has promoted this semester
// (userController.getAdviserSummary).
const Count = ({ value, of, tone = 'gray', title }) => {
  const tones = {
    gray: 'text-gray-700',
    green: 'text-green-600',
    red: 'text-red-600',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
  };
  return (
    <span className={`font-semibold ${value ? tones[tone] : 'text-gray-300'}`} title={title}>
      {value}{of != null && <span className="text-gray-400 font-normal">/{of}</span>}
    </span>
  );
};

export default function AdviserSummaryCard() {
  const [rows, setRows] = useState([]);
  const [semester, setSemester] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [program, setProgram] = useState('');
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await userService.getAdviserSummary();
      setRows(data.rows || []);
      setSemester(data.semester);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); return onGradesUpdated(load); }, [load]);
  useAutoRefresh(load);

  const programs = useMemo(() => [...new Set(rows.map((r) => r.program))].sort(), [rows]);
  const visible = rows.filter((r) => (!program || r.program === program)
    && (!search || r.adviser_name.toLowerCase().includes(search.toLowerCase())
      || `${programShortLabel(r.program)} ${r.year_level}-${r.section}`.toLowerCase().includes(search.toLowerCase())));
  const totals = visible.reduce((t, r) => ({
    students: t.students + r.students,
    set_up: t.set_up + r.set_up,
    regular: t.regular + r.regular,
    irregular: t.irregular + r.irregular,
    with_retakes: t.with_retakes + r.with_retakes,
    promoted: t.promoted + r.promoted,
    empty: t.empty + (r.students === 0 ? 1 : 0),
  }), { students: 0, set_up: 0, regular: 0, irregular: 0, with_retakes: 0, promoted: 0, empty: 0 });
  const advisers = new Set(visible.map((r) => r.adviser_id)).size;

  return (
    <div className="card mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 bg-white border-none cursor-pointer font-sans text-left border-b border-gray-100"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
            <Icons.Award className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-navy">Adviser Summary</h3>
            <p className="text-xs text-gray-400">
              {advisers} adviser{advisers !== 1 ? 's' : ''} · {visible.length} section{visible.length !== 1 ? 's' : ''} · {totals.students} student{totals.students !== 1 ? 's' : ''}
              {totals.empty > 0 && <span className="text-amber-600"> · {totals.empty} section{totals.empty !== 1 ? 's' : ''} with no class list yet</span>}
            </p>
          </div>
        </div>
        {open ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <>
          <div className="px-5 py-3 flex flex-wrap items-center gap-2 border-b border-gray-100 bg-gray-50/60">
            <div className="flex-1 min-w-[200px]">
              <SearchBar value={search} onChange={setSearch} placeholder="Search adviser or section (e.g. BSIT 4-D)…" />
            </div>
            <select className="form-select w-auto min-w-[160px] text-sm" value={program} onChange={(e) => setProgram(e.target.value)}>
              <option value="">All Programs</option>
              {programs.map((p) => <option key={p} value={p}>{programShortLabel(p)}</option>)}
            </select>
          </div>

          {loading ? (
            <p className="text-sm text-gray-400 text-center py-8">Loading advisers…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">{rows.length ? 'No adviser matches your search.' : 'No advisers have been assigned yet.'}</p>
          ) : (
            <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr className="text-[11px] uppercase text-gray-500">
                    <th className="px-4 py-2.5 text-left">Adviser</th>
                    <th className="px-4 py-2.5 text-left">Advisory</th>
                    <th className="px-3 py-2.5 text-center">Students</th>
                    <th className="px-3 py-2.5 text-center" title="Students who finished setting up their account">Accounts Set Up</th>
                    <th className="px-3 py-2.5 text-center">Regular</th>
                    <th className="px-3 py-2.5 text-center">Irregular</th>
                    <th className="px-3 py-2.5 text-center" title="Students with a Failed, INC or Dropped subject not yet passed">With Retakes</th>
                    <th className="px-3 py-2.5 text-center" title={semester ? `Promoted by the adviser for ${semester}` : 'Promoted this semester'}>Promoted</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r, i) => {
                    const sameAdviser = i > 0 && visible[i - 1].adviser_id === r.adviser_id;
                    return (
                      <tr key={`${r.adviser_id}-${r.program}-${r.year_level}-${r.section}`} className={`${sameAdviser ? '' : 'border-t border-gray-100'} hover:bg-gray-50/60`}>
                        <td className="px-4 py-2.5">
                          {!sameAdviser && (
                            <>
                              <p className="font-medium text-gray-800">{formatPersonName(r.adviser_name)}</p>
                              <p className="text-[11px] text-gray-400">{r.adviser_role === 'Chairperson' ? 'Chairperson' : r.employment_type === 'Part Time' ? 'Part Timer' : 'Faculty'}</p>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-navy">
                            <ProgramDot program={r.program} />
                            {programShortLabel(r.program)} {r.year_level}-{r.section}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {r.students ? <Count value={r.students} /> : <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 rounded-full px-2 py-0.5 whitespace-nowrap">No class list</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center">{r.students ? <Count value={r.set_up} of={r.students} tone={r.set_up === r.students ? 'green' : 'amber'} /> : '—'}</td>
                        <td className="px-3 py-2.5 text-center">{r.students ? <Count value={r.regular} tone="green" /> : '—'}</td>
                        <td className="px-3 py-2.5 text-center">{r.students ? <Count value={r.irregular} tone="amber" /> : '—'}</td>
                        <td className="px-3 py-2.5 text-center">{r.students ? <Count value={r.with_retakes} tone="red" /> : '—'}</td>
                        <td className="px-3 py-2.5 text-center">{r.students ? <Count value={r.promoted} of={r.students} tone="blue" /> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0">
                  <tr className="bg-navy text-white text-[12px] font-semibold">
                    <td className="px-4 py-2.5" colSpan={2}>Total</td>
                    <td className="px-3 py-2.5 text-center">{totals.students}</td>
                    <td className="px-3 py-2.5 text-center">{totals.set_up}/{totals.students}</td>
                    <td className="px-3 py-2.5 text-center">{totals.regular}</td>
                    <td className="px-3 py-2.5 text-center">{totals.irregular}</td>
                    <td className="px-3 py-2.5 text-center">{totals.with_retakes}</td>
                    <td className="px-3 py-2.5 text-center">{totals.promoted}/{totals.students}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
