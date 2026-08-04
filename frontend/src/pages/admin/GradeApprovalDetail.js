import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icons, Badge, LoadingSpinner, StatCard } from '../../components/common';
import { gradeService } from '../../services';
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

  const load = async () => {
    try {
      const { data: result } = await gradeService.getByClass(classId);
      setData(result);
    } catch (err) {
      toast.error('Failed to load class');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [classId]);

  const handleApprove = async () => {
    if (!window.confirm('Approve all currently Passed, submitted students in this class?')) return;
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
    .sort((a, b) => (a.student?.name || '').localeCompare(b.student?.name || ''));

  const passedCount = rows.filter((r) => r.grade?.status === 'Passed' && r.grade?.submitted).length;
  const approvedCount = rows.filter((r) => r.grade?.admin_approved).length;
  const notEligibleCount = rows.filter((r) => r.grade && ['Failed', 'INC', 'DRP'].includes(r.grade.status)).length;
  const pendingApproval = passedCount - approvedCount;

  return (
    <>
      <button className="btn btn-outline mb-4" onClick={() => navigate('/admin/grade-approval')}>
        <Icons.ArrowLeft /> Back to Grade Approval
      </button>

      <div className="flex items-center gap-3 mb-1">
        <Badge variant="blue">{cls.subject?.code}</Badge>
        {cls.section && <Badge variant="purple">Sec {cls.section}</Badge>}
        <span className="ml-auto text-[13px] text-gray-500">{rows.length} Students</span>
      </div>
      <h2 className="text-xl font-bold mb-1">{cls.subject?.name}</h2>
      <p className="text-[13px] text-gray-500 mb-4">
        {cls.instructor?.name} · {cls.semester} {cls.academic_year}
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Passed" value={passedCount} icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Approved" value={approvedCount} valueClass="text-green-500" icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Awaiting Approval" value={pendingApproval} valueClass="text-amber-500" icon={<Icons.Clock />} iconBg="bg-amber-50 text-amber-500" />
        <StatCard label="Not Eligible (Failed/INC/DRP)" value={notEligibleCount} valueClass="text-red-500" icon={<Icons.AlertTriangle />} iconBg="bg-red-50 text-red-500" />
      </div>

      <div className="card">
        <div className="card-header flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-navy">Student Roster</h3>
            <p className="text-xs text-gray-400 mt-0.5">Only Passed, submitted grades can be approved. INC/Dropped/Failed students stay pending until resolved.</p>
          </div>
          <div className="flex gap-2">
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
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
              onClick={handleApprove}
              disabled={approving || pendingApproval <= 0}
            >
              <Icons.Check className="w-4 h-4" /> {approving ? 'Approving...' : `Approve All Passed (${pendingApproval})`}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Student No.</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Name</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Midterm</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Finals</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Average</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Admin Approval</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const g = r.grade;
                const eligible = g?.status === 'Passed' && g?.submitted;
                return (
                  <tr key={r.student.id} className="border-b border-gray-50">
                    <td className="px-4 py-3.5 font-medium text-sm">{r.student.student_no}</td>
                    <td className="px-4 py-3.5 text-sm">{r.student.name}</td>
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
    </>
  );
}
