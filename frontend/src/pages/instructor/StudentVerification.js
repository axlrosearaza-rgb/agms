import { useState, useEffect, useCallback } from 'react';
import { Icons, Avatar, Badge, Modal, LoadingSpinner, ProgramBadge } from '../../components/common';
import { userService } from '../../services';
import toast from 'react-hot-toast';

export default function StudentVerification() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewUser, setViewUser] = useState(null);
  const [actingId, setActingId] = useState(null);

  const loadPending = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await userService.getPending();
      setStudents(data.users || []);
    } catch (err) {
      toast.error('Failed to load pending students');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPending(); }, [loadPending]);

  const handleApprove = async (student) => {
    if (!window.confirm(`Verify and activate ${student.name}?`)) return;
    try {
      setActingId(student.id);
      await userService.update(student.id, { status: 'Active' });
      toast.success(`${student.name} has been verified!`);
      loadPending();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to verify student');
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (student) => {
    if (!window.confirm(`Reject ${student.name}'s registration? This cannot be undone easily.`)) return;
    try {
      setActingId(student.id);
      await userService.update(student.id, { status: 'Deactivated' });
      toast.success(`${student.name} has been rejected.`);
      loadPending();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject student');
    } finally {
      setActingId(null);
    }
  };

  const openView = async (student) => {
    try {
      const { data } = await userService.getById(student.id);
      setViewUser(data.user);
    } catch (err) {
      toast.error('Failed to load student details');
    }
  };

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Student Verification</h2>
        <p className="text-[13px] text-gray-500">
          Review and verify new student registrations in your program ({students.length} pending)
        </p>
      </div>

      {loading ? <LoadingSpinner /> : students.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Icons.Check className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No pending registrations</p>
          <p className="text-sm mt-1">All registrations in your program have been reviewed.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {students.map((s) => (
            <div key={s.id} className="card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Avatar letter={s.avatar || s.name?.[0]} className="bg-amber-500 text-white" size="w-12 h-12 text-lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[15px] font-bold">{s.name}</p>
                  <Badge variant={s.student_status === 'Irregular' ? 'orange' : 'gray'}>
                    {s.student_status === 'Irregular' ? 'Irreg' : 'Reg'}
                  </Badge>
                  <Badge variant="yellow"><Icons.Clock className="w-3 h-3" /> Pending</Badge>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">{s.email}</p>
                <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-gray-500">
                  {s.student_no && <span>Student No: <strong>{s.student_no}</strong></span>}
                  {s.program && <span className="inline-flex items-center gap-1">Program: <ProgramBadge program={s.program} /></span>}
                  {s.year_level && <span>Year: <strong>{s.year_level}</strong></span>}
                  {s.section && <span>Section: <strong>{s.section}</strong></span>}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => handleApprove(s)}
                  disabled={actingId === s.id}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-green-500 hover:bg-green-600 rounded-lg border-none cursor-pointer font-sans transition-colors disabled:opacity-50"
                >
                  <Icons.Check className="w-4 h-4" /> Verify
                </button>
                <button
                  onClick={() => handleReject(s)}
                  disabled={actingId === s.id}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg border-none cursor-pointer font-sans transition-colors disabled:opacity-50"
                >
                  <Icons.Trash className="w-4 h-4" /> Reject
                </button>
                <button className="btn-icon" onClick={() => openView(s)} title="View Details">
                  <Icons.Eye />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewUser && (
        <Modal
          title="Student Details"
          onClose={() => setViewUser(null)}
          footer={
            <>
              <button onClick={() => { handleApprove(viewUser); setViewUser(null); }} className="btn text-white bg-green-500 hover:bg-green-600 text-sm px-4">
                <Icons.Check className="w-4 h-4" /> Verify
              </button>
              <button onClick={() => { handleReject(viewUser); setViewUser(null); }} className="btn text-white bg-red-500 hover:bg-red-600 text-sm px-4">
                <Icons.Trash className="w-4 h-4" /> Reject
              </button>
              <button className="btn btn-outline" onClick={() => setViewUser(null)}>Close</button>
            </>
          }
        >
          <div className="flex items-center gap-4 mb-5">
            <Avatar letter={viewUser.avatar || viewUser.name?.[0]} className="bg-navy text-white" size="w-14 h-14 text-xl" />
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
            <div><span className="text-gray-500">Student Type:</span> <span className="font-medium ml-1">{viewUser.student_status === 'Irregular' ? 'Irregular' : 'Regular'}</span></div>
            {viewUser.irregular_sections && viewUser.irregular_sections.length > 0 && (
              <div className="col-span-2">
                <span className="text-gray-500">Taking Classes In:</span>{' '}
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  {viewUser.irregular_sections.map((p, i) => (
                    <Badge key={i} variant="orange">Year {p.year_level} - Sec {p.section}{p.semester ? ` (${p.semester})` : ''}</Badge>
                  ))}
                </span>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
