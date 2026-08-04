import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, SearchBar, StatCard, LoadingSpinner, ProgramBadge } from '../../components/common';
import { endorsementService } from '../../services';
import API from '../../services/api';
import toast from 'react-hot-toast';

export default function Endorsements() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [openGroups, setOpenGroups] = useState({});
  const [actionLoading, setActionLoading] = useState({});
  const [modal, setModal] = useState(null);
  const [notes, setNotes] = useState('');
  const [flagReason, setFlagReason] = useState('');

  // ✅ INC data per student: { [student_id]: [{ subject, inc_remarks, inc_deadline }] }
  const [incMap, setIncMap] = useState({});
  const [incPopover, setIncPopover] = useState(null); // student_id of open popover

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: result } = await endorsementService.getDepartmentStudents();
      setData(result);

      const groups = {};
      (result.students || []).forEach(s => {
        const key = `${s.program}||${s.year_level}||${s.section}`;
        groups[key] = true;
      });
      setOpenGroups(groups);

      // ✅ Fetch INC list for the department
      try {
        const { data: incData } = await API.get('/grades/inc');
        const map = {};
        (incData.inc_grades || []).forEach(g => {
          const sid = g.student_id;
          if (!map[sid]) map[sid] = [];
          map[sid].push({
            subject_code: g.class?.subject?.code,
            subject_name: g.class?.subject?.name,
            inc_remarks: g.inc_remarks,
            inc_deadline: g.inc_deadline,
            is_overdue: g.is_overdue,
          });
        });
        setIncMap(map);
      } catch {
        setIncMap({});
      }
    } catch (err) {
      toast.error('Failed to load endorsement data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const allStudents = data?.students || [];
  const endorsed = allStudents.filter(s => s.endorsement?.status === 'Endorsed');
  const flagged = allStudents.filter(s => s.endorsement?.status === 'Flagged');
  const pending = allStudents.filter(s => !s.endorsement);

  // Derive program name from students
  const programName = allStudents[0]?.program || data?.department || 'N/A';

  // ✅ Count students with at least one INC
  const incStudentCount = allStudents.filter(s => incMap[s.id]?.length > 0).length;

  const filtered = allStudents.filter(s => {
    if (statusFilter === 'Endorsed' && s.endorsement?.status !== 'Endorsed') return false;
    if (statusFilter === 'Flagged' && s.endorsement?.status !== 'Flagged') return false;
    if (statusFilter === 'Pending' && s.endorsement) return false;
    if (statusFilter === 'INC' && !incMap[s.id]?.length) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name?.toLowerCase().includes(q) || s.student_no?.includes(q);
    }
    return true;
  });

  const grouped = {};
  filtered.forEach(s => {
    const prog = s.program || 'No Program';
    const yr = s.year_level || 0;
    const sec = s.section || 'No Section';
    if (!grouped[prog]) grouped[prog] = {};
    if (!grouped[prog][yr]) grouped[prog][yr] = {};
    if (!grouped[prog][yr][sec]) grouped[prog][yr][sec] = [];
    grouped[prog][yr][sec].push(s);
  });

  const toggleGroup = (key) => setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));

  const openModal = (type, studentIds, isBulk = false) => {
    setModal({ type, studentIds, isBulk });
    setNotes('');
    setFlagReason('');
  };

  const closeModal = () => setModal(null);

  const handleEndorse = async () => {
    const ids = modal.studentIds;
    setActionLoading(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, true])) }));
    try {
      await Promise.all(ids.map(id => endorsementService.endorse(id, notes)));
      toast.success(ids.length > 1 ? `${ids.length} students endorsed!` : 'Student endorsed!');
      closeModal();
      await loadData();
    } catch {
      toast.error('Failed to endorse. Try again.');
    } finally {
      setActionLoading({});
    }
  };

  const handleFlag = async () => {
    if (!flagReason.trim()) return toast.error('Please provide a flag reason.');
    const ids = modal.studentIds;
    setActionLoading(prev => ({ ...prev, ...Object.fromEntries(ids.map(id => [id, true])) }));
    try {
      await Promise.all(ids.map(id => endorsementService.flag(id, flagReason, notes)));
      toast.success(ids.length > 1 ? `${ids.length} students flagged!` : 'Student flagged!');
      closeModal();
      await loadData();
    } catch {
      toast.error('Failed to flag. Try again.');
    } finally {
      setActionLoading({});
    }
  };

  const timeSince = (date) => {
    if (!date) return '—';
    return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const statusBadge = (s) => {
    if (s.endorsement?.status === 'Endorsed') return <Badge variant="green"><Icons.Check /> Endorsed</Badge>;
    if (s.endorsement?.status === 'Flagged') return <Badge variant="red"><Icons.Flag /> Flagged</Badge>;
    return <Badge variant="yellow"><Icons.Clock /> Pending</Badge>;
  };

  return (
    <>
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Endorsement History</h2>
        <p className="text-[13px] text-gray-500 flex items-center gap-1.5"><ProgramBadge program={programName} /> — Grouped by Year & Section</p>
      </div>

      {/* Stats — ✅ added INC stat card */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Students" value={allStudents.length} icon={<Icons.Users />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Endorsed" value={endorsed.length} valueClass="text-green-500" icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Flagged" value={flagged.length} valueClass="text-red-500" icon={<Icons.Flag />} iconBg="bg-red-50 text-red-500" />
        <StatCard label="Pending Review" value={pending.length} valueClass="text-amber-500" icon={<Icons.Clock />} iconBg="bg-amber-50 text-amber-500" />
        <StatCard label="With INC" value={incStudentCount} valueClass="text-orange-500" icon={<Icons.AlertCircle />} iconBg="bg-orange-50 text-orange-500" />
      </div>

      {/* Filters — ✅ added INC filter option */}
      <div className="flex flex-wrap gap-3 mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or student number..." />
        <select className="form-select w-auto min-w-[160px] text-sm py-2.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Students</option>
          <option value="Endorsed">Endorsed Only</option>
          <option value="Flagged">Flagged Only</option>
          <option value="Pending">Pending Only</option>
          <option value="INC">Has INC Grade</option>
        </select>
      </div>

      {/* Accordion */}
      {Object.keys(grouped).length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Icons.FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No students found</p>
          <p className="text-sm mt-1">Try adjusting your filters.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).sort().map(([program, yearGroups]) => (
            <div key={program} className="card overflow-hidden">
              <div className="px-5 py-3.5 bg-navy text-white flex items-center gap-3">
                <Icons.FileText className="w-4 h-4 opacity-70" />
                <h3 className="text-sm font-semibold">{program}</h3>
              </div>

              <div className="divide-y divide-gray-100">
                {Object.entries(yearGroups).sort(([a], [b]) => a - b).map(([yr, sectionGroups]) =>
                  Object.entries(sectionGroups).sort().map(([sec, sectionStudents]) => {
                    const key = `${program}||${yr}||${sec}`;
                    const isOpen = openGroups[key] !== false;
                    const pendingInGroup = sectionStudents.filter(s => !s.endorsement);
                    const allEndorsed = sectionStudents.every(s => s.endorsement?.status === 'Endorsed');
                    const allFlagged = sectionStudents.every(s => s.endorsement?.status === 'Flagged');
                    const incInGroup = sectionStudents.filter(s => incMap[s.id]?.length > 0).length;

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
                              <p className="text-sm font-semibold text-navy">
                                Year {yr} — Section {sec}
                              </p>
                              <p className="text-[11px] text-gray-400">
                                {sectionStudents.length} students ·{' '}
                                <span className="text-green-500">{sectionStudents.filter(s => s.endorsement?.status === 'Endorsed').length} endorsed</span> ·{' '}
                                <span className="text-red-400">{sectionStudents.filter(s => s.endorsement?.status === 'Flagged').length} flagged</span> ·{' '}
                                <span className="text-amber-500">{pendingInGroup.length} pending</span>
                                {incInGroup > 0 && <> · <span className="text-orange-500">{incInGroup} INC</span></>}
                              </p>
                            </div>
                          </div>

                          <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                            {!allEndorsed && (
                              <button
                                className="btn btn-sm bg-green-500 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                                onClick={() => openModal('endorse', sectionStudents.map(s => s.id), true)}
                              >
                                <Icons.Check className="w-3 h-3" /> Endorse All
                              </button>
                            )}
                            {!allFlagged && (
                              <button
                                className="btn btn-sm bg-red-500 hover:bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5"
                                onClick={() => openModal('flag', sectionStudents.map(s => s.id), true)}
                              >
                                <Icons.Flag className="w-3 h-3" /> Flag All
                              </button>
                            )}
                          </div>
                        </div>

                        {isOpen && (
                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-white border-b border-gray-100">
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Year / Section</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Current Faculty / Subject</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                  {/* ✅ New INC column */}
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">INC Subjects</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Status</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Remarks</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Date</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {sectionStudents.sort((a, b) => a.name.localeCompare(b.name)).map(s => {
                                  const studentINCs = incMap[s.id] || [];
                                  const hasINC = studentINCs.length > 0;
                                  const hasOverdue = studentINCs.some(i => i.is_overdue);

                                  return (
                                    <tr
                                      key={s.id}
                                      className={`border-b border-gray-50 hover:bg-gray-50/50 ${hasINC ? 'bg-orange-50/30' : ''}`}
                                    >
                                      <td className="px-4 py-3">
                                        <div className="flex items-center gap-2.5">
                                          <Avatar
                                            letter={s.avatar || s.name?.[0]}
                                            className={
                                              s.endorsement?.status === 'Endorsed' ? 'bg-green-500 text-white' :
                                              s.endorsement?.status === 'Flagged' ? 'bg-red-400 text-white' :
                                              'bg-gray-400 text-white'
                                            }
                                            size="w-8 h-8 text-xs"
                                          />
                                          <div>
                                            <p className="text-[13px] font-semibold flex items-center gap-1.5">
                                              {s.name}
                                              <Badge variant={s.student_status === 'Irregular' ? 'orange' : 'gray'}>
                                                {s.student_status === 'Irregular' ? 'Irreg' : 'Reg'}
                                              </Badge>
                                            </p>
                                            <p className="text-[11px] text-gray-500">{s.student_no}</p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-4 py-3 text-xs text-gray-600">
                                        Year {s.year_level} — Sec {s.section || '—'}
                                      </td>
                                      <td className="px-4 py-3">
                                        {s.current_classes?.length > 0 ? (
                                          <div className="space-y-1">
                                            {s.current_classes.map((cc, i) => (
                                              <p key={i} className="text-xs text-gray-600">
                                                <span className="font-semibold">{cc.subject_code}</span>
                                                {cc.instructor_name ? ` · ${cc.instructor_name}` : ''}
                                                {cc.section ? ` · Sec ${cc.section}` : ''}
                                              </p>
                                            ))}
                                          </div>
                                        ) : (
                                          <span className="text-gray-300 text-xs">No current enrollment</span>
                                        )}
                                      </td>
                                      <td className="px-4 py-3">
                                        <span className={`font-bold text-sm ${s.gwa && parseFloat(s.gwa) <= 3.0 ? 'text-green-500' : s.gwa ? 'text-red-500' : 'text-gray-400'}`}>
                                          {s.gwa || 'N/A'}
                                        </span>
                                      </td>

                                      {/* ✅ INC cell — shows badge + popover with details */}
                                      <td className="px-4 py-3">
                                        {hasINC ? (
                                          <div className="relative">
                                            <button
                                              className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border cursor-pointer font-sans transition-colors
                                                ${hasOverdue
                                                  ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                                  : 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100'
                                                }`}
                                              onClick={() => setIncPopover(incPopover === s.id ? null : s.id)}
                                            >
                                              {hasOverdue ? '⚠' : '!'} {studentINCs.length} INC
                                              {hasOverdue && <span className="ml-1 text-[10px]">Overdue</span>}
                                            </button>

                                            {/* ✅ Popover with full INC details */}
                                            {incPopover === s.id && (
                                              <div
                                                className="absolute z-30 left-0 top-8 w-72 bg-white border border-orange-200 rounded-xl shadow-lg p-3"
                                                onClick={e => e.stopPropagation()}
                                              >
                                                <div className="flex items-center justify-between mb-2">
                                                  <p className="text-xs font-bold text-orange-700">INC Details — {s.name}</p>
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

                                      <td className="px-4 py-3">{statusBadge(s)}</td>
                                      <td className="px-4 py-3">
                                        <p className="text-xs text-gray-500 max-w-[160px] truncate" title={s.endorsement?.notes || s.endorsement?.flagged_reason || '—'}>
                                          {s.endorsement?.notes || s.endorsement?.flagged_reason || '—'}
                                        </p>
                                      </td>
                                      <td className="px-4 py-3 text-xs text-gray-400">
                                        {timeSince(s.endorsement?.createdAt || s.endorsement?.created_at)}
                                      </td>
                                      <td className="px-4 py-3">
                                        <div className="flex gap-1.5">
                                          {s.endorsement?.status !== 'Endorsed' && (
                                            <button
                                              disabled={actionLoading[s.id]}
                                              onClick={() => openModal('endorse', [s.id])}
                                              className="btn text-xs px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center gap-1"
                                            >
                                              <Icons.Check className="w-3 h-3" /> Endorse
                                            </button>
                                          )}
                                          {s.endorsement?.status !== 'Flagged' && (
                                            <button
                                              disabled={actionLoading[s.id]}
                                              onClick={() => openModal('flag', [s.id])}
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

      {/* Endorse / Flag Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-navy mb-1">
              {modal.type === 'endorse'
                ? modal.isBulk ? `Endorse ${modal.studentIds.length} Students` : 'Endorse Student'
                : modal.isBulk ? `Flag ${modal.studentIds.length} Students` : 'Flag Student'}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              {modal.type === 'endorse'
                ? 'Add optional notes for this endorsement.'
                : 'Please provide a reason for flagging.'}
            </p>

            {modal.type === 'flag' && (
              <div className="mb-3">
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Flag Reason <span className="text-red-500">*</span></label>
                <input
                  className="form-input w-full text-sm"
                  placeholder="e.g. Failed subjects, incomplete requirements..."
                  value={flagReason}
                  onChange={e => setFlagReason(e.target.value)}
                />
              </div>
            )}

            <div className="mb-5">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Notes <span className="text-gray-400">(optional)</span></label>
              <textarea
                className="form-input w-full text-sm resize-none"
                rows={3}
                placeholder="Additional remarks..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={closeModal} className="btn btn-outline text-sm px-4">Cancel</button>
              <button
                onClick={modal.type === 'endorse' ? handleEndorse : handleFlag}
                className={`btn text-sm px-5 text-white ${modal.type === 'endorse' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}
              >
                {modal.type === 'endorse' ? 'Confirm Endorse' : 'Confirm Flag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}