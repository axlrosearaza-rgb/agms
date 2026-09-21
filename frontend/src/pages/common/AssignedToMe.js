import { useState, useEffect, useCallback } from 'react';
import { Icons, Avatar, Badge, Modal, ConfirmDialog, ProgramBadge, programShortLabel, LoadingSpinner, EmptyState, StudentTypeBadge, RegularityBadge, formatStudentName, compareStudentNames } from '../../components/common';
import { verificationService } from '../../services';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';

// Shared by Faculty and Student — a Chairperson can delegate the Approve/Reject
// decision on a pending student's registration to either, so this page just
// lists whatever's been assigned to the logged-in user, regardless of role.
// Grouped into the same Program -> Year -> Section boxes as the Chairperson's
// own Pending Registrations page, for a consistent look across both. The
// Chairperson always keeps override power too, so a student here may
// occasionally already be gone (approved/rejected elsewhere) — handled
// gracefully via a normal error toast + list refresh, not treated as a bug.

const AVATAR_PALETTE = [
  'bg-slate-600', 'bg-indigo-600', 'bg-teal-600', 'bg-violet-600',
  'bg-blue-600', 'bg-emerald-600', 'bg-rose-600', 'bg-amber-600',
];
const avatarColorFor = (name = '') => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};

export default function AssignedToMe() {
  const { user } = useAuth();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [removingIds, setRemovingIds] = useState(() => new Set());
  // Full registration detail — everything the student actually filled in at
  // signup (email, student no, year/section, regularity, which classes an
  // Irregular student is taking) — not just the name/badges the card itself
  // shows, so a verifier can actually review before deciding instead of
  // approving/rejecting almost blind. Same modal shape as the Chairperson's
  // own Pending Registrations page.
  const [viewUser, setViewUser] = useState(null);
  // Approve/Reject warning — the same styled ConfirmDialog the Chairperson's
  // own Pending Registrations page uses, instead of the browser's plain
  // native window.confirm() popup (which looks and reads completely out of
  // place stacked on top of this page's own Student Details modal).
  const [confirmTarget, setConfirmTarget] = useState(null); // { student, status }
  // Every box starts collapsed — click one open to review it. Persists
  // across navigation (usePageState).
  const [expanded, setExpanded] = usePageState('AssignedToMe.expanded', new Set());
  const toggleGroup = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await verificationService.getMine();
      setStudents(data.students || []);
    } catch (err) {
      toast.error('Failed to load assigned registrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const requestDecide = (student, status) => setConfirmTarget({ student, status });

  const handleConfirmDecide = () => {
    if (!confirmTarget) return;
    const { student, status } = confirmTarget;
    setConfirmTarget(null);
    executeDecide(student, status);
  };

  const executeDecide = async (student, status) => {
    const verb = status === 'Active' ? 'Approve' : 'Reject';
    try {
      setActingId(student.id);
      await verificationService.decide(student.id, status);
      toast.success(status === 'Active' ? `${student.name} approved.` : `${student.name} rejected.`);
      setViewUser((v) => (v?.id === student.id ? null : v));
      setRemovingIds((prev) => new Set(prev).add(student.id));
      setTimeout(() => {
        setStudents((prev) => prev.filter((s) => s.id !== student.id));
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(student.id);
          return next;
        });
      }, 280);
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${verb.toLowerCase()} student`);
      load();
    } finally {
      setActingId(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  // Which Year/Section combinations the Chairperson has actually put on this
  // person's plate — the "what am I responsible for" summary.
  const scopeKey = (s) => `${s.program}::${s.year_level || '—'}::${s.section || '—'}`;
  const scopes = [...new Map(students.map((s) => [scopeKey(s), s])).values()];

  // Program -> Year -> Section, same shape as the Chairperson's Pending
  // Registrations page.
  const groups = [];
  students.forEach((s) => {
    const program = s.program || 'No Program';
    const yearLevel = s.year_level || 0;
    const section = s.section || 'No Section';
    let group = groups.find((g) => g.program === program && g.yearLevel === yearLevel);
    if (!group) {
      group = { program, yearLevel, sections: [] };
      groups.push(group);
    }
    let secGroup = group.sections.find((sg) => sg.section === section);
    if (!secGroup) {
      secGroup = { section, students: [] };
      group.sections.push(secGroup);
    }
    secGroup.students.push(s);
  });
  groups.sort((a, b) => a.program.localeCompare(b.program) || a.yearLevel - b.yearLevel);
  groups.forEach((g) => g.sections.sort((a, b) => a.section.localeCompare(b.section)));
  groups.forEach((g) => g.sections.forEach((sg) => sg.students.sort(compareStudentNames)));

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-navy">Assigned Work</h2>
        <p className="text-[13px] text-gray-500">
          Pending student registrations your Chairperson asked {user?.role === 'Student' ? 'you' : 'you'} to verify.
          Approving or rejecting activates or declines their account right away.
        </p>
      </div>

      {scopes.length > 0 && (
        <div className="card p-4 mb-6">
          <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-2">Assigned Year &amp; Section</p>
          <div className="flex flex-wrap gap-2">
            {scopes.map((s) => (
              <span key={scopeKey(s)} className="inline-flex items-center gap-1.5 text-xs font-medium bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full">
                <Icons.Flag className="w-3 h-3" />
                {programShortLabel(s.program)} · Year {s.year_level || '—'} · Sec {s.section || '—'}
              </span>
            ))}
          </div>
        </div>
      )}

      {students.length === 0 ? (
        <EmptyState
          icon={<Icons.Check className="w-8 h-8 opacity-30" />}
          title="Nothing assigned right now"
          description="When your Chairperson delegates a pending registration to you, it'll show up here."
        />
      ) : (
        groups.map((group) => {
          const groupKey = `${group.program}-${group.yearLevel}`;
          const isOpen = expanded.has(groupKey);
          const groupTotal = group.sections.reduce((t, sg) => t + sg.students.length, 0);
          return (
            <div key={groupKey} className="card overflow-hidden mb-6">
              <button
                onClick={() => toggleGroup(groupKey)}
                className="w-full px-5 py-3.5 bg-navy text-white flex items-center gap-3 border-none cursor-pointer font-sans text-left"
              >
                <ProgramBadge program={group.program} short />
                <span className="text-sm font-bold tracking-wide">{group.yearLevel ? `YEAR ${group.yearLevel}` : 'NO YEAR LEVEL'}</span>
                <span className="ml-auto text-xs font-medium text-white/60">{groupTotal} assigned</span>
                {isOpen ? <Icons.ChevronUp className="w-4 h-4 flex-shrink-0" /> : <Icons.ChevronDown className="w-4 h-4 flex-shrink-0" />}
              </button>
              {isOpen && (
                <div className="card-body space-y-4">
                  {group.sections.map((secGroup) => {
                    const secKey = `${groupKey}::${secGroup.section}`;
                    const isSecOpen = expanded.has(secKey);
                    return (
                      <div key={secKey} className="border border-gray-100 rounded-xl overflow-hidden">
                        <button
                          onClick={() => toggleGroup(secKey)}
                          className="w-full px-4 py-2.5 bg-gray-50 hover:bg-gray-100 flex items-center gap-2.5 border-none cursor-pointer font-sans text-left transition-colors"
                        >
                          <Icons.Flag className="w-3.5 h-3.5 text-gray-400" />
                          <span className="text-[13px] font-semibold text-gray-700">
                            {secGroup.section !== 'No Section' ? `Section ${secGroup.section}` : 'No Section'}
                          </span>
                          <Badge variant="blue">{secGroup.students.length}</Badge>
                          {isSecOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400 ml-auto" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400 ml-auto" />}
                        </button>
                        {isSecOpen && (
                          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {secGroup.students.map((s, idx) => {
                              const isIrregular = s.student_status === 'Irregular';
                              const isRemoving = removingIds.has(s.id);
                              return (
                                <div
                                  key={s.id}
                                  className={`group bg-white rounded-2xl border-l-4 border-y border-r border-gray-100 shadow-sm transition-all ease-in-out overflow-hidden flex flex-col ${
                                    isIrregular ? 'border-l-red-400' : 'border-l-green-400'
                                  } ${
                                    isRemoving
                                      ? 'opacity-0 scale-90 !max-h-0 pointer-events-none duration-300'
                                      : 'opacity-100 scale-100 hover:shadow-lg hover:-translate-y-0.5 duration-200'
                                  }`}
                                >
                                  <div className="p-4 pb-3 flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-3 min-w-0">
                                      <span className="text-[11px] text-gray-400 font-medium flex-shrink-0 w-4 text-right">{idx + 1}.</span>
                                      <Avatar letter={s.avatar || s.name?.[0]} className={`text-white ${avatarColorFor(s.name)}`} size="w-11 h-11 text-sm" />
                                      <div className="min-w-0">
                                        <p className="text-[13.5px] font-semibold text-gray-800 truncate">{formatStudentName(s.name)}</p>
                                        <p className="text-[11px] text-gray-400">{s.student_no}</p>
                                      </div>
                                    </div>
                                    <button className="btn-icon flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" onClick={() => setViewUser(s)} title="View Details">
                                      <Icons.Eye className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  <div className="px-4 flex items-center flex-wrap gap-1.5 mb-4">
                                    <RegularityBadge status={s.student_status} />
                                    <StudentTypeBadge status={s.student_type} />
                                  </div>

                                  <div className="mt-auto flex gap-2 px-4 py-3 bg-gray-50/70 border-t border-gray-50">
                                    <button
                                      onClick={() => requestDecide(s, 'Active')}
                                      disabled={actingId === s.id}
                                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-green-500 hover:bg-green-600 rounded-lg border-none cursor-pointer font-sans transition-colors disabled:opacity-50 shadow-sm"
                                    >
                                      <Icons.Check className="w-3.5 h-3.5" /> Approve
                                    </button>
                                    <button
                                      onClick={() => requestDecide(s, 'Rejected')}
                                      disabled={actingId === s.id}
                                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-gray-500 bg-white border border-gray-200 hover:border-red-300 hover:text-red-600 rounded-lg cursor-pointer font-sans transition-colors disabled:opacity-50"
                                    >
                                      <Icons.Trash className="w-3.5 h-3.5" /> Reject
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      {viewUser && (
        <Modal
          title="Student Details"
          onClose={() => setViewUser(null)}
          footer={
            <>
              <button onClick={() => requestDecide(viewUser, 'Active')} disabled={actingId === viewUser.id} className="btn text-white bg-green-500 hover:bg-green-600 text-sm px-4">
                <Icons.Check className="w-4 h-4" /> Approve
              </button>
              <button onClick={() => requestDecide(viewUser, 'Rejected')} disabled={actingId === viewUser.id} className="btn text-white bg-red-500 hover:bg-red-600 text-sm px-4">
                <Icons.Trash className="w-4 h-4" /> Reject
              </button>
              <button className="btn btn-outline" onClick={() => setViewUser(null)}>Close</button>
            </>
          }
        >
          <div className="flex items-center gap-4 mb-5">
            <Avatar letter={viewUser.avatar || viewUser.name?.[0]} className={`text-white ${avatarColorFor(viewUser.name)}`} size="w-14 h-14 text-xl" />
            <div>
              <h3 className="text-lg font-bold">{viewUser.name}</h3>
              <p className="text-sm text-gray-500">{viewUser.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            {viewUser.program && <div className="col-span-2"><span className="text-gray-500">Program:</span> <span className="ml-1"><ProgramBadge program={viewUser.program} /></span></div>}
            {viewUser.student_no && <div><span className="text-gray-500">Student No:</span> <span className="font-medium ml-1">{viewUser.student_no}</span></div>}
            {viewUser.year_level && <div><span className="text-gray-500">Year Level:</span> <span className="font-medium ml-1">Year {viewUser.year_level}</span></div>}
            {viewUser.section && <div><span className="text-gray-500">Section:</span> <span className="font-medium ml-1">Section {viewUser.section}</span></div>}
            <div className="col-span-2">
              <span className="text-gray-500">Status:</span>{' '}
              <RegularityBadge status={viewUser.student_status} />
            </div>
            {viewUser.irregular_sections && viewUser.irregular_sections.length > 0 && (
              <div className="col-span-2">
                <span className="text-gray-500">Taking Classes In:</span>{' '}
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  {viewUser.irregular_sections.map((p, i) => (
                    <Badge key={i} variant="red">Year {p.year_level} - Sec {p.section}{p.semester ? ` (${p.semester})` : ''}</Badge>
                  ))}
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.status === 'Active' ? 'Approve Registration' : 'Reject Registration'}
          message={`Are you sure you want to ${confirmTarget.status === 'Active' ? 'approve' : 'reject'} ${confirmTarget.student.name}'s registration?${confirmTarget.status !== 'Active' ? ' This cannot be undone easily.' : ''}`}
          confirmText={confirmTarget.status === 'Active' ? 'Approve' : 'Reject'}
          variant={confirmTarget.status === 'Active' ? 'green' : 'red'}
          onConfirm={handleConfirmDecide}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </>
  );
}
