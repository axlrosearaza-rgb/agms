import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icons, Badge, LoadingSpinner, StatCard, ProgramBadge, FacultyProgramTags, ConfirmDialog, comparePeopleNames, formatPersonName } from '../../components/common';
import { gradeService, reportService, userService } from '../../services';
import toast from 'react-hot-toast';

const statusBadge = (status) => {
  if (status === 'Passed') return <Badge variant="green">Passed</Badge>;
  if (status === 'Failed') return <Badge variant="red">Failed</Badge>;
  if (status === 'INC') return <Badge variant="yellow">INC</Badge>;
  if (status === 'DRP') return <Badge variant="gray">Dropped</Badge>;
  return <Badge variant="gray">Pending</Badge>;
};

export default function GradeApprovalDetail() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [programChairperson, setProgramChairperson] = useState(null);

  const load = async () => {
    try {
      const { data: result } = await gradeService.getByClass(classId);
      setData(result);

      // Who to reach for "ask if there's a need to revise" — the Chairperson(s)
      // of this class's own program, not just whoever's logged in.
      const program = result.class?.subject?.program;
      if (program) {
        try {
          const { data: chairData } = await userService.getAll({ role: 'Chairperson', all: true });
          const match = (chairData.users || []).find((u) => (u.programs || []).includes(program));
          setProgramChairperson(match || null);
        } catch {
          setProgramChairperson(null);
        }
      }
    } catch (err) {
      toast.error('Failed to load class');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [classId]);

  const handleSendApproved = async () => {
    setConfirmingSend(false);
    try {
      setSending(true);
      const { data: result } = await reportService.sendApprovedGradeSheet(classId);
      toast.success(result.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send the approved grade sheet');
    } finally {
      setSending(false);
    }
  };

  const handleApprove = async () => {
    setConfirmingApprove(false);
    try {
      setApproving(true);
      const { data: result } = await gradeService.approveClass(classId);
      toast.success(result.message);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to approve grades');
    } finally {
      setApproving(false);
    }
  };

  if (loading) return <LoadingSpinner />;
  if (!data) return <p className="p-10 text-center text-gray-400">Class not found.</p>;

  const cls = data.class;
  const rows = (data.student_grades || [])
    .slice()
    .sort((a, b) => comparePeopleNames(a.student, b.student));

  const passedCount = rows.filter((r) => r.grade?.status === 'Passed' && r.grade?.submitted).length;
  const approvedCount = rows.filter((r) => r.grade?.admin_approved).length;
  const notEligibleCount = rows.filter((r) => r.grade && ['Failed', 'INC', 'DRP'].includes(r.grade.status)).length;
  const pendingApproval = passedCount - approvedCount;

  return (
    <>
      {/* Goes back to wherever this was actually opened from (the Grade
          Approval list, most often — but also reachable via a notification
          link) rather than always landing on the list regardless. */}
      <div className="flex items-center justify-between mb-4">
        <button className="btn btn-outline" onClick={() => navigate(-1)}>
          <Icons.ArrowLeft /> Back
        </button>
        <a href={`/class-record/${cls.id}`} target="_blank" rel="noreferrer" className="btn btn-outline text-sm">
          <Icons.Book className="w-4 h-4" /> View Class Record
        </a>
      </div>

      <div className="flex items-center gap-3 mb-1">
        <Badge variant="blue">{cls.subject?.code}</Badge>
        {cls.subject?.program && <ProgramBadge program={cls.subject.program} short />}
        {cls.section && <Badge variant="purple">Sec {cls.section}</Badge>}
        <span className="ml-auto text-[13px] text-gray-500">{rows.length} Students</span>
      </div>
      <h2 className="text-xl font-bold mb-1">{cls.subject?.name}</h2>
      <p className="text-[13px] text-gray-500 mb-4 flex items-center gap-1.5 flex-wrap">
        {/* cls.semester already bakes the academic year in ("First Semester
            2026-2027") — appending cls.academic_year again duplicated it. */}
        <span>{cls.instructor?.name} · {cls.semester}</span>
        {cls.instructor && <FacultyProgramTags user={cls.instructor} />}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Passed" value={passedCount} icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Approved" value={approvedCount} valueClass="text-green-500" icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Awaiting Approval" value={pendingApproval} valueClass="text-amber-500" icon={<Icons.Clock />} iconBg="bg-amber-50 text-amber-500" />
        <StatCard label="Not Eligible (Failed/INC/DROP)" value={notEligibleCount} valueClass="text-red-500" icon={<Icons.AlertTriangle />} iconBg="bg-red-50 text-red-500" />
      </div>

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-navy">Student Roster</h3>
            <p className="text-xs text-gray-400 mt-0.5">Only Passed, submitted grades can be approved. INC/Dropped/Failed students stay pending until resolved.</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {cls.instructor && (
              <button
                className="btn btn-outline text-sm"
                onClick={() => navigate('/admin/messages', {
                  state: {
                    prefillContactId: cls.instructor.id,
                    prefillContactName: cls.instructor.name,
                    prefillText: `Hi ${cls.instructor.name}, I noticed a possible issue with the grades for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}. Could you take a look?`,
                  },
                })}
                title="Flag a grading problem to this class's instructor"
              >
                <Icons.Send className="w-4 h-4" /> Forward to Messages
              </button>
            )}
            {programChairperson && (
              <button
                className="btn btn-outline text-sm"
                onClick={() => navigate('/admin/messages', {
                  state: {
                    prefillContactId: programChairperson.id,
                    prefillContactName: programChairperson.name,
                    prefillText: `Hi ${programChairperson.name}, I'm reviewing the Grade Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''}. Is there any need to revise before I finalize approval?`,
                  },
                })}
                title="Ask this program's Chairperson if a revision is needed"
              >
                <Icons.MessageSquare className="w-4 h-4" /> Message Chairperson
              </button>
            )}
            <button
              className="btn btn-outline text-sm"
              onClick={() => setConfirmingSend(true)}
              disabled={sending || !cls.chairperson_verified || pendingApproval > 0 || approvedCount === 0}
              title={
                !cls.chairperson_verified
                  ? 'Waiting on Chairperson verification first'
                  : pendingApproval > 0
                    ? 'Approve all Passed students first'
                    : 'Notify the instructor and Chairperson that this Class Record and Grade Sheet are fully approved'
              }
            >
              <Icons.Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send Approved Grade Sheet'}
            </button>
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
              onClick={() => setConfirmingApprove(true)}
              disabled={approving || pendingApproval <= 0}
            >
              <Icons.Check className="w-4 h-4" /> {approving ? 'Approving...' : `Approve All Passed (${pendingApproval})`}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-center px-3 py-3 text-xs font-semibold uppercase rounded-tl-lg w-10">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Student No.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Name</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Midterm</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Finals</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Average</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Admin Approval</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const g = r.grade;
                const eligible = g?.status === 'Passed' && g?.submitted;
                return (
                  <tr key={r.student.id} className="border-b border-gray-50">
                    <td className="px-3 py-3.5 text-xs text-gray-400 text-center">{idx + 1}</td>
                    <td className="px-4 py-3.5 font-medium text-sm">{r.student.student_no}</td>
                    <td className="px-4 py-3.5 text-sm">{formatPersonName(r.student.name)}</td>
                    <td className="px-4 py-3.5 text-center text-sm">{g?.midterm ?? '—'}</td>
                    <td className="px-4 py-3.5 text-center text-sm">{g?.finals ?? '—'}</td>
                    <td className="px-4 py-3.5 text-center text-sm">{g?.average ?? '—'}</td>
                    <td className="px-4 py-3.5 text-center">{g ? statusBadge(g.status) : <Badge variant="gray">No Grade</Badge>}</td>
                    <td className="px-4 py-3.5 text-center">
                      {g?.admin_approved ? (
                        <Badge variant="green"><Icons.Check className="w-3 h-3" /> Approved</Badge>
                      ) : eligible ? (
                        <Badge variant="yellow">Awaiting Approval</Badge>
                      ) : (
                        <Badge variant="gray">Not Eligible</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan="7" className="text-center py-12 text-gray-400 text-sm">No enrolled students.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirmingApprove && (
        <ConfirmDialog
          title="Approve All Passed Students"
          message={`Approve all ${pendingApproval} currently Passed, submitted student${pendingApproval === 1 ? '' : 's'} in this class? This finalizes their grades on record.`}
          confirmText="Approve"
          variant="green"
          onConfirm={handleApprove}
          onCancel={() => setConfirmingApprove(false)}
        />
      )}

      {confirmingSend && (
        <ConfirmDialog
          title="Send Approved Grade Sheet?"
          message={`Notify the instructor and Chairperson that the Class Record and Grade Sheet for ${cls.subject?.code}${cls.section ? ` - Section ${cls.section}` : ''} are fully approved and finalized?`}
          confirmText={sending ? 'Sending...' : 'Send'}
          variant="green"
          confirmDisabled={sending}
          onConfirm={handleSendApproved}
          onCancel={() => setConfirmingSend(false)}
        />
      )}
    </>
  );
}
