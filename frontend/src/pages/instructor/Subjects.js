import { useState, useEffect, useCallback } from 'react';
import { Icons, Badge, SearchBar, Modal, LoadingSpinner } from '../../components/common';
import { subjectService } from '../../services';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const SEMESTERS = ['1st Semester', '2nd Semester', 'Summer'];

// Program → Department mapping (subjects store the short department name;
// User accounts store the full program name — same 4 programs, two spellings).
const PROGRAM_DEPARTMENT = {
  'Bachelor of Science in Information Technology': 'Information Technology',
  'Bachelor of Science in Information Systems': 'Information Systems',
  'Bachelor of Science in Psychology': 'Psychology',
  'Bachelor of Science in Statistics': 'Statistics',
};

const emptyForm = {
  code: '', name: '', units: 3, department: '', program: '', year_level: 1, semester: '1st Semester', description: '', prerequisite_ids: [],
};

export default function Subjects() {
  const { user } = useAuth();
  const myPrograms = (user?.programs || []).filter((p) => p !== 'General Education (GE)');

  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editSubject, setEditSubject] = useState(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const loadSubjects = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await subjectService.getAll();
      setSubjects(data.subjects || []);
    } catch (err) {
      toast.error('Failed to load subjects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  const openCreate = () => {
    setEditSubject(null);
    setFormData({ ...emptyForm, program: myPrograms[0] || '', department: PROGRAM_DEPARTMENT[myPrograms[0]] || '' });
    setShowModal(true);
  };

  const openEdit = (s) => {
    setEditSubject(s);
    setFormData({
      code: s.code || '',
      name: s.name || '',
      units: s.units || 3,
      department: s.department || '',
      program: s.program || '',
      year_level: s.year_level || 1,
      semester: s.semester || '1st Semester',
      description: s.description || '',
      prerequisite_ids: (s.prerequisites || []).map((p) => p.id),
    });
    setShowModal(true);
  };

  const togglePrereq = (id) => {
    setFormData((prev) => {
      const has = prev.prerequisite_ids.includes(id);
      return { ...prev, prerequisite_ids: has ? prev.prerequisite_ids.filter((x) => x !== id) : [...prev.prerequisite_ids, id] };
    });
  };

  const handleProgramChange = (program) => {
    setFormData((prev) => ({ ...prev, program, department: PROGRAM_DEPARTMENT[program] || prev.department }));
  };

  const handleSave = async () => {
    if (!formData.code || !formData.name || !formData.program) {
      toast.error('Code, name, and program are required');
      return;
    }
    try {
      setSaving(true);
      if (editSubject) {
        await subjectService.update(editSubject.id, formData);
        toast.success('Subject updated');
      } else {
        await subjectService.create(formData);
        toast.success('Subject created');
      }
      setShowModal(false);
      setEditSubject(null);
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save subject');
    } finally {
      setSaving(false);
    }
  };

  const filtered = subjects.filter((s) =>
    !search ||
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.code?.toLowerCase().includes(search.toLowerCase())
  );

  const prereqOptions = subjects.filter((s) => !editSubject || s.id !== editSubject.id);

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Subjects</h2>
          <p className="text-[13px] text-gray-500">Subjects available in your program(s) ({filtered.length})</p>
        </div>
        <button className="btn btn-gold" onClick={openCreate}>
          <Icons.Plus /> Add Subject
        </button>
      </div>

      <div className="mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or code..." />
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Units</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Year Level</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Term</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Prerequisites</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3.5 text-[13px] font-semibold">{s.code}</td>
                  <td className="px-4 py-3.5 text-[13px]">{s.name}</td>
                  <td className="px-4 py-3.5"><Badge variant="blue">{s.units} units</Badge></td>
                  <td className="px-4 py-3.5 text-[13px]">{s.year_level ? `Year ${s.year_level}` : '—'}</td>
                  <td className="px-4 py-3.5 text-[13px]">{s.semester || '—'}</td>
                  <td className="px-4 py-3.5">
                    {s.prerequisites?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {s.prerequisites.map((p) => <Badge key={p.id} variant="orange">{p.code}</Badge>)}
                      </div>
                    ) : <span className="text-gray-400 text-xs">None</span>}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex gap-1.5">
                      <button className="btn-icon" onClick={() => openEdit(s)} title="Edit"><Icons.Edit /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="7" className="text-center py-12 text-gray-400 text-sm">
                    <Icons.FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No subjects found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <Modal
          title={editSubject ? `Edit Subject — ${editSubject.code}` : 'Add New Subject'}
          onClose={() => { setShowModal(false); setEditSubject(null); }}
          size="max-w-xl"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setShowModal(false); setEditSubject(null); }}>Cancel</button>
              <button className="btn btn-gold" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editSubject ? 'Update Subject' : 'Create Subject'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Code <span className="text-red-500">*</span></label>
              <input className="form-input" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g. CS101" />
            </div>
            <div>
              <label className="form-label">Units</label>
              <input type="number" min="1" max="6" className="form-input" value={formData.units} onChange={(e) => setFormData({ ...formData, units: parseInt(e.target.value) })} />
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Subject Name <span className="text-red-500">*</span></label>
              <input className="form-input" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Introduction to Computing" />
            </div>
            <div>
              <label className="form-label">Program <span className="text-red-500">*</span></label>
              <select className="form-select" value={formData.program} onChange={(e) => handleProgramChange(e.target.value)}>
                <option value="">Select Program</option>
                {myPrograms.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Year Level</label>
              <select className="form-select" value={formData.year_level} onChange={(e) => setFormData({ ...formData, year_level: parseInt(e.target.value) })}>
                {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Normally Offered In</label>
              <select className="form-select" value={formData.semester} onChange={(e) => setFormData({ ...formData, semester: e.target.value })}>
                {SEMESTERS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Optional course description" />
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Prerequisites</label>
              <div className="grid grid-cols-2 gap-2 border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto">
                {prereqOptions.length === 0 && <span className="text-xs text-gray-400">No other subjects to choose from yet.</span>}
                {prereqOptions.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input type="checkbox" checked={formData.prerequisite_ids.includes(p.id)} onChange={() => togglePrereq(p.id)} />
                    {p.code} — {p.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
