import { useState, useEffect, useCallback } from 'react';
import { Icons, Badge, Modal, LoadingSpinner, StatCard } from '../../components/common';
import { semesterService } from '../../services';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const TERMS = ['First Semester', 'Second Semester', 'Summer'];
const emptyForm = { term: 'First Semester', academic_year: '', start_date: '', end_date: '', is_current: false, status: 'Upcoming' };

export default function SemesterManagement() {
  const { user } = useAuth();
  const canManage = user?.role === 'Admin' || !!user?.can_manage_semester;
  const [semesters, setSemesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editSem, setEditSem] = useState(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const loadSemesters = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await semesterService.getAll();
      setSemesters(data.semesters || []);
    } catch (err) {
      toast.error('Failed to load semesters');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSemesters(); }, [loadSemesters]);

  const openCreate = () => {
    setEditSem(null);
    setFormData({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (sem) => {
    setEditSem(sem);
    setFormData({
      term: sem.term || 'First Semester',
      academic_year: sem.academic_year || '',
      start_date: sem.start_date || '',
      end_date: sem.end_date || '',
      is_current: sem.is_current || false,
      status: sem.status || 'Upcoming',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.term || !formData.academic_year) {
      toast.error('Term and academic year are required');
      return;
    }

    try {
      setSaving(true);
      if (editSem) {
        await semesterService.update(editSem.id, formData);
        toast.success('Semester updated');
      } else {
        await semesterService.create(formData);
        toast.success('Semester created');
      }
      setShowModal(false);
      setEditSem(null);
      loadSemesters();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save semester');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sem) => {
    if (sem.is_current) {
      toast.error('Cannot delete the current semester');
      return;
    }
    if (!window.confirm(`Delete ${sem.name}?`)) return;
    try {
      await semesterService.delete(sem.id);
      toast.success('Semester deleted');
      loadSemesters();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  const handleSetCurrent = async (sem) => {
    if (!window.confirm(`Set "${sem.name}" as the current semester?`)) return;
    try {
      await semesterService.setCurrent(sem.id);
      toast.success(`${sem.name} is now the current semester`);
      loadSemesters();
    } catch (err) {
      toast.error('Failed to set current semester');
    }
  };

  const currentSem = semesters.find(s => s.is_current);
  const activeSems = semesters.filter(s => s.status === 'Active').length;
  const completedSems = semesters.filter(s => s.status === 'Completed').length;

  const statusBadge = (status) => {
    const map = { Active: 'green', Completed: 'blue', Upcoming: 'orange' };
    return <Badge variant={map[status] || 'blue'}>{status}</Badge>;
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Semester Management</h2>
          <p className="text-[13px] text-gray-500">
            {canManage ? 'Manage academic semesters and set the current term' : 'Read-only — the designated chairperson updates the current term for everyone.'}
          </p>
        </div>
        {canManage && <button className="btn btn-gold" onClick={openCreate}><Icons.Plus /> Add Semester</button>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Semesters" value={semesters.length} icon={<Icons.Book />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Current Semester" value={currentSem?.name?.split(' ').slice(0, 2).join(' ') || '—'} icon={<Icons.Award />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Active" value={activeSems} icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Completed" value={completedSems} icon={<Icons.Clock />} iconBg="bg-gray-50 text-gray-500" />
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="card">
          <div className="card-header"><h3 className="text-base font-semibold text-navy">All Semesters ({semesters.length})</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Semester</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Academic Year</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Duration</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Current</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Actions</th>
                </tr>
              </thead>
              <tbody>
                {semesters.map((s) => (
                  <tr key={s.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${s.is_current ? 'bg-green-50/30' : ''}`}>
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-semibold">{s.name}</p>
                      <p className="text-xs text-gray-400">{s.term}</p>
                    </td>
                    <td className="px-4 py-3.5 text-[13px] font-medium">{s.academic_year}</td>
                    <td className="px-4 py-3.5 text-xs text-gray-500">
                      {s.start_date && s.end_date ? (
                        <>{new Date(s.start_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} — {new Date(s.end_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3.5">{statusBadge(s.status)}</td>
                    <td className="px-4 py-3.5">
                      {s.is_current ? (
                        <Badge variant="green"><Icons.Check className="w-3 h-3" /> Current</Badge>
                      ) : canManage ? (
                        <button onClick={() => handleSetCurrent(s)} className="text-xs text-blue-500 hover:underline cursor-pointer bg-transparent border-none font-sans">
                          Set as Current
                        </button>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      {canManage ? (
                        <div className="flex gap-1.5">
                          <button className="btn-icon" onClick={() => openEdit(s)} title="Edit"><Icons.Edit /></button>
                          {!s.is_current && (
                            <button className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => handleDelete(s)} title="Delete"><Icons.Trash /></button>
                          )}
                        </div>
                      ) : <span className="text-xs text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
                {semesters.length === 0 && (
                  <tr><td colSpan="6" className="text-center py-12 text-gray-400 text-sm">No semesters found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <Modal title={editSem ? `Edit — ${editSem.name}` : 'Add New Semester'} onClose={() => { setShowModal(false); setEditSem(null); }} footer={
          <>
            <button className="btn btn-outline" onClick={() => { setShowModal(false); setEditSem(null); }}>Cancel</button>
            <button className="btn btn-gold" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editSem ? 'Update' : 'Create'}</button>
          </>
        }>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Term <span className="text-red-500">*</span></label>
                <select className="form-select" value={formData.term} onChange={(e) => setFormData({ ...formData, term: e.target.value })}>
                  {TERMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Academic Year <span className="text-red-500">*</span></label>
                <input className="form-input" value={formData.academic_year} onChange={(e) => setFormData({ ...formData, academic_year: e.target.value })} placeholder="e.g. 2024-2025" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Start Date</label>
                <input className="form-input" type="date" value={formData.start_date} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
              </div>
              <div>
                <label className="form-label">End Date</label>
                <input className="form-input" type="date" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Status</label>
                <select className="form-select" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                  <option>Upcoming</option>
                  <option>Active</option>
                  <option>Completed</option>
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={formData.is_current} onChange={(e) => setFormData({ ...formData, is_current: e.target.checked })} />
                  Set as current semester
                </label>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}