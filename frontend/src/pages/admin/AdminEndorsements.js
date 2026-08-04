import { useState, useEffect } from 'react';
import { Icons, Avatar, Badge, SearchBar, StatCard, LoadingSpinner, ProgramDot } from '../../components/common';
import { endorsementService } from '../../services';
import API from '../../services/api';
import toast from 'react-hot-toast';

export default function AdminEndorsements() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [openGroups, setOpenGroups] = useState({});
  const [modal, setModal] = useState(null);
  const [notes, setNotes] = useState('');
  const [flagReason, setFlagReason] = useState('');
  const [actionLoading, setActionLoading] = useState({});

  // ✅ INC data: { [student_id]: [{ subject_code, subject_name, inc_remarks, inc_deadline, is_overdue }] }
  const [incMap, setIncMap] = useState({});
  const [incPopover, setIncPopover] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [endorseRes, incRes] = await Promise.allSettled([
        endorsementService.getAll(),
        API.get('/grades/inc'),
      ]);

      if (endorseRes.status === 'fulfilled') {
        setData(endorseRes.value.data.endorsements || []);
      } else {
        toast.error('Failed to load endorsements');
      }

      if (incRes.status === 'fulfilled') {
        const map = {};
        (incRes.value.data.inc_grades || []).forEach(g => {
          const sid = g.student_id;
          if (!map[sid]) map[sid] = [];
          map[sid].push({
            subject_code: g.class?.subject?.code,
            subject_name: g.class?.subject?.name,
            inc_remarks: g.inc_remarks,
            inc_deadline: g.inc_deadline,
            is_overdue: g.is_overdue,
            instructor: g.class?.instructor?.name,
          });
        });
        setIncMap(map);
      }
    } catch {
      toast.error('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const programs = [...new Set(data.map(e => e.student?.program).filter(Boolean))].sort();

  const filtered = data.filter(e => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (programFilter && e.student?.program !== programFilter) return false;
    if (statusFilter === 'INC' && !incMap[e.student_id]?.length) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.student?.name?.toLowerCase().includes(q) || e.student?.student_no?.includes(q);
    }
    return true;
  });

  const grouped = {};
  filtered.forEach(e => {
    const prog = e.student?.program || 'Unknown Program';
    const yr = e.student?.year_level || 0;
    const sec = e.student?.section || 'No Section';
    if (!grouped[prog]) grouped[prog] = {};
    if (!grouped[prog][yr]) grouped[prog][yr] = {};
    if (!grouped[prog][yr][sec]) grouped[prog][yr][sec] = [];
    grouped[prog][yr][sec].push(e);
  });

  const toggleGroup = (key) => setOpenGroups(prev => ({ ...prev, [key]: !prev[key] !== false ? !prev[key] : false }));

  const openModal = (type, studentId) => {
    setModal({ type, studentId });
    setNotes('');
    setFlagReason('');
  };

  const handleOverride = async () => {
    if (modal.type === 'flag' && !flagReason.trim()) return toast.error('Please provide a flag reason.');
    setActionLoading(prev => ({ ...prev, [modal.studentId]: true }));
    try {
      await endorsementService.adminOverride(
        modal.studentId,
        modal.type === 'endorse' ? 'Endorsed' : 'Flagged',
        notes,
        modal.type === 'flag' ? flagReason : null
      );
      toast.success(`Overridden to ${modal.type === 'endorse' ? 'Endorsed' : 'Flagged'}!`);
      setModal(null);
      await loadData();
    } catch {
      toast.error('Override failed. Try again.');
    } finally {
      setActionLoading({});
    }
  };

  const timeSince = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const statusBadge = (status) => {
    if (status === 'Endorsed') return <Badge variant="green"><Icons.Check /> Endorsed</Badge>;
    if (status === 'Flagged') return <Badge variant="red"><Icons.Flag /> Flagged</Badge>;
    return <Badge variant="yellow"><Icons.Clock /> Pending</Badge>;
  };

  const total = data.length;
  const endorsedCount = data.filter(e => e.status === 'Endorsed').length;
  const flaggedCount = data.filter(e => e.status === 'Flagged').length;
  // ✅ Count unique students with INC
  const incStudentCount = [...new Set(Object.keys(incMap).filter(sid => incMap[sid]?.length > 0))].length;
  const overdueCount = Object.values(incMap).flat().filter(i => i.is_overdue).length;

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Endorsements Overview</h2>
        <p className="text-[13px] text-gray-500">
          College of Arts and Sciences — All endorsements across all programs
        </p>
      </div>

      {/* Stats — ✅ added INC + overdue cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Records" value={total} icon={<Icons.Users />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Endorsed" value={endorsedCount} valueClass="text-green-500" icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Flagged" value={flaggedCount} valueClass="text-red-500" icon={<Icons.Flag />} iconBg="bg-red-50 text-red-500" />
        <StatCard label="With INC" value={incStudentCount} valueClass="text-orange-500" icon={<Icons.AlertCircle />} iconBg="bg-orange-50 text-orange-500" />
        <StatCard label="Overdue INC" value={overdueCount} valueClass="text-red-600" icon={<Icons.Clock />} iconBg="bg-red-50 text-red-500" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or student number..." />
        <select className="form-select w-auto text-sm py-2.5" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option value="Endorsed">Endorsed</option>
          <option value="Flagged">Flagged</option>
          <option value="INC">Has INC Grade</option>
        </select>
        <select className="form-select w-auto text-sm py-2.5" value={programFilter} onChange={e => setProgramFilter(e.target.value)}>
          <option value="">All Programs</option>
          {programs.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Accordion */}
      {Object.keys(grouped).length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Icons.FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No endorsement records found</p>
          <p className="text-sm mt-1">Endorsements made by Chairpersons will appear here.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).sort().map(([prog, yearGroups]) => (
            <div key={prog} className="card overflow-hidden">
              <div className="px-5 py-3.5 bg-navy text-white flex items-center gap-3">
                <ProgramDot program={prog} />
                <div>
                  <h3 className="text-sm font-semibold">{prog}</h3>
                  <p className="text-[11px] opacity-60">College of Arts and Sciences</p>
                </div>
              </div>

              <div className="divide-y divide-gray-100">
                {Object.entries(yearGroups).sort(([a], [b]) => a - b).map(([yr, sectionGroups]) =>
                  Object.entries(sectionGroups).sort().map(([sec, endorsements]) => {
                    const key = `${prog}||${yr}||${sec}`;
                    const isOpen = openGroups[key] !== false;
                    const incInGroup = endorsements.filter(e => incMap[e.student_id]?.length > 0).length;

                    return (
                      <div key={key}>
                        <div
                          className="px-5 py-3 flex items-center justify-between bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => toggleGroup(key)}
                        >
                          <div className="flex items-center gap-3">
                            <span className={`transition-transform duration-200 text-gray-400 ${isOpen ? 'rotate-90' : ''}`}>
                              <Icons.ChevronRight className="w-4 h-4" />
                            </span>
                            <div>
                              <p className="text-sm font-semibold text-navy">Year {yr} — Section {sec}</p>
                              <p className="text-[11px] text-gray-400">
                                {endorsements.length} students ·{' '}
                                <span className="text-green-500">{endorsements.filter(e => e.status === 'Endorsed').length} endorsed</span> ·{' '}
                                <span className="text-red-400">{endorsements.filter(e => e.status === 'Flagged').length} flagged</span>
                                {incInGroup > 0 && <> · <span className="text-orange-500">{incInGroup} with INC</span></>}
                              </p>
                            </div>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-white border-b border-gray-100">
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Chairperson</th>
                                  {/* ✅ New INC column */}
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">INC Subjects</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Status</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Remarks</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Date</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Override</th>
                                </tr>
                              </thead>
                              <tbody>
                                {endorsements
                                  .sort((a, b) => a.student?.name?.localeCompare(b.student?.name))
                                  .map(e => {
                                    const studentINCs = incMap[e.student_id] || [];
                                    const hasINC = studentINCs.length > 0;
                                    const hasOverdue = studentINCs.some(i => i.is_overdue);

                                    return (
                                      <tr
                                        key={e.id}
                                        className={`border-b border-gray-50 hover:bg-gray-50/50 ${hasINC ? 'bg-orange-50/30' : ''}`}
                                      >
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-2.5">
                                            <Avatar
                                              letter={e.student?.name?.[0]}
                                              className={e.status === 'Endorsed' ? 'bg-green-500 text-white' : 'bg-red-400 text-white'}
                                              size="w-8 h-8 text-xs"
                                            />
                                            <div>
                                              <p className="text-[13px] font-semibold">{e.student?.name}</p>
                                              <p className="text-[11px] text-gray-500">{e.student?.student_no}</p>
                                            </div>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-gray-500">{e.chairperson?.name || '—'}</td>

                                        {/* ✅ INC cell with popover */}
                                        <td className="px-4 py-3">
                                          {hasINC ? (
                                            <div className="relative">
                                              <button
                                                className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border cursor-pointer font-sans transition-colors
                                                  ${hasOverdue
                                                    ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                                    : 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100'
                                                  }`}
                                                onClick={() => setIncPopover(incPopover === e.student_id ? null : e.student_id)}
                                              >
                                                {hasOverdue ? '⚠' : '!'} {studentINCs.length} INC
                                                {hasOverdue && <span className="ml-1 text-[10px]">Overdue</span>}
                                              </button>

                                              {incPopover === e.student_id && (
                                                <div
                                                  className="absolute z-30 left-0 top-8 w-80 bg-white border border-orange-200 rounded-xl shadow-lg p-3"
                                                  onClick={ev => ev.stopPropagation()}
                                                >
                                                  <div className="flex items-center justify-between mb-2">
                                                    <p className="text-xs font-bold text-orange-700">INC Details — {e.student?.name}</p>
                                                    <button
                                                      className="text-gray-400 hover:text-gray-600 text-xs cursor-pointer bg-transparent border-none"
                                                      onClick={() => setIncPopover(null)}
                                                    >✕</button>
                                                  </div>
                                                  <div className="space-y-2.5">
                                                    {studentINCs.map((inc, idx) => (
                                                      <div
                                                        key={idx}
                                                        className={`rounded-lg p-2.5 border text-xs ${inc.is_overdue ? 'bg-red-50 border-red-200' : 'bg-orange-50 border-orange-100'}`}
                                                      >
                                                        <p className="font-semibold text-gray-800">
                                                          {inc.subject_code} — {inc.subject_name}
                                                        </p>
                                                        {inc.instructor && (
                                                          <p className="text-gray-400 mt-0.5">Faculty: {inc.instructor}</p>
                                                        )}
                                                        {inc.inc_remarks && (
                                                          <p className="text-gray-500 mt-1">
                                                            <span className="font-medium">Reason:</span> {inc.inc_remarks}
                                                          </p>
                                                        )}
                                                        {inc.inc_deadline && (
                                                          <p className={`mt-1 font-medium ${inc.is_overdue ? 'text-red-600' : 'text-orange-600'}`}>
                                                            Deadline: {new Date(inc.inc_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                                            {inc.is_overdue && ' — OVERDUE'}
                                                          </p>
                                                        )}
                                                      </div>
                                                    ))}
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          ) : (
                                            <span className="text-gray-300 text-xs">—</span>
                                          )}
                                        </td>

                                        <td className="px-4 py-3">{statusBadge(e.status)}</td>
                                        <td className="px-4 py-3">
                                          <p className="text-xs text-gray-500 max-w-[160px] truncate" title={e.notes || e.flagged_reason || '—'}>
                                            {e.notes || e.flagged_reason || '—'}
                                          </p>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-gray-400">
                                          {timeSince(e.createdAt || e.created_at)}
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="flex gap-1.5">
                                            {e.status !== 'Endorsed' && (
                                              <button
                                                disabled={actionLoading[e.student_id]}
                                                onClick={() => openModal('endorse', e.student_id)}
                                                className="btn text-xs px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-1"
                                              >
                                                <Icons.Check className="w-3 h-3" /> Endorse
                                              </button>
                                            )}
                                            {e.status !== 'Flagged' && (
                                              <button
                                                disabled={actionLoading[e.student_id]}
                                                onClick={() => openModal('flag', e.student_id)}
                                                className="btn text-xs px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center gap-1"
                                              >
                                                <Icons.Flag className="w-3 h-3" /> Flag
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Close popover on outside click */}
      {incPopover && (
        <div className="fixed inset-0 z-20" onClick={() => setIncPopover(null)} />
      )}

      {/* Override Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-navy mb-1">
              {modal.type === 'endorse' ? 'Override to Endorsed' : 'Override to Flagged'}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              This will override the Chairperson's decision for this student.
            </p>

            {modal.type === 'flag' && (
              <div className="mb-3">
                <label className="text-xs font-semibold text-gray-600 mb-1 block">
                  Flag Reason <span className="text-red-500">*</span>
                </label>
                <input
                  className="form-input w-full text-sm"
                  placeholder="e.g. Failed subjects, incomplete requirements..."
                  value={flagReason}
                  onChange={e => setFlagReason(e.target.value)}
                />
              </div>
            )}

            <div className="mb-5">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                Notes <span className="text-gray-400">(optional)</span>
              </label>
              <textarea
                className="form-input w-full text-sm resize-none"
                rows={3}
                placeholder="Admin override remarks..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setModal(null)} className="btn btn-outline text-sm px-4">Cancel</button>
              <button
                onClick={handleOverride}
                className={`btn text-sm px-5 text-white ${modal.type === 'endorse' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
              >
                Confirm Override
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}