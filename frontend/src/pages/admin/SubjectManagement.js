import { useState, useEffect, useCallback } from 'react';
import { Icons, Badge, SearchBar, Modal, LoadingSpinner, StatCard, ProgramBadge } from '../../components/common';
import { subjectService } from '../../services';
import toast from 'react-hot-toast';

const DEPARTMENTS = ['Information Technology', 'Information Systems', 'Psychology', 'Statistics'];

export default function SubjectManagement() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [viewSubject, setViewSubject] = useState(null);

  const loadSubjects = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (search) params.search = search;
      if (deptFilter) params.department = deptFilter;
      const { data } = await subjectService.getAll(params);
      setSubjects(data.subjects || []);
    } catch (err) {
      toast.error('Failed to load subjects');
    } finally {
      setLoading(false);
    }
  }, [search, deptFilter]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  const handleDelete = async (sub) => {
    if (!window.confirm(`Delete ${sub.code} — ${sub.name}? This will also remove all prerequisite links.`)) return;
    try {
      await subjectService.delete(sub.id);
      toast.success('Subject deleted');
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete subject');
    }
  };

  const totalUnits = subjects.reduce((s, sub) => s + (sub.units || 0), 0);
  const departments = [...new Set(subjects.map(s => s.department))];

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Subject Management</h2>
          <p className="text-[13px] text-gray-500">Read-only — Faculty and Chairpersons create and maintain their own program's subjects.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Subjects" value={subjects.length} icon={<Icons.FileText />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Total Units" value={totalUnits} icon={<Icons.Book />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Departments" value={departments.length} icon={<Icons.Users />} iconBg="bg-purple-50 text-purple-500" />
        <StatCard label="With Prerequisites" value={subjects.filter(s => s.prerequisites?.length > 0).length} icon={<Icons.Flag />} iconBg="bg-orange-50 text-orange-500" />
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by code or name..." />
        <select className="form-select w-auto text-sm py-2.5" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">All Departments</option>
          {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="card">
          <div className="card-header"><h3 className="text-base font-semibold text-navy">All Subjects ({subjects.length})</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Code</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Subject Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Department</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Program</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Units</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Year / Term</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Prerequisites</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Actions</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3.5 text-[13px] font-bold text-navy">{s.code}</td>
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-medium">{s.name}</p>
                      {s.description && <p className="text-xs text-gray-400 truncate max-w-xs">{s.description}</p>}
                    </td>
                    <td className="px-4 py-3.5 text-[13px]">{s.department}</td>
                    <td className="px-4 py-3.5 text-xs">{s.program ? <ProgramBadge program={s.program} /> : <span className="text-red-400">Not set</span>}</td>
                    <td className="px-4 py-3.5"><Badge variant="blue">{s.units}</Badge></td>
                    <td className="px-4 py-3.5 text-xs">
                      {s.year_level ? `Year ${s.year_level}` : '—'} / {s.semester || '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      {s.prerequisites?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {s.prerequisites.map(p => <Badge key={p.id} variant="orange">{p.code}</Badge>)}
                        </div>
                      ) : <span className="text-gray-400 text-xs">None</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex gap-1.5">
                        <button className="btn-icon" onClick={() => setViewSubject(s)} title="View"><Icons.Eye /></button>
                        <button className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => handleDelete(s)} title="Delete (cleanup only)"><Icons.Trash /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {subjects.length === 0 && (
                  <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">No subjects found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VIEW MODAL */}
      {viewSubject && (
        <Modal title={`${viewSubject.code} — ${viewSubject.name}`} onClose={() => setViewSubject(null)} footer={
          <button className="btn btn-outline" onClick={() => setViewSubject(null)}>Close</button>
        }>
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><span className="text-gray-500">Code:</span> <span className="font-bold ml-1">{viewSubject.code}</span></div>
            <div><span className="text-gray-500">Units:</span> <span className="font-medium ml-1">{viewSubject.units}</span></div>
            <div><span className="text-gray-500">Department:</span> <span className="font-medium ml-1">{viewSubject.department}</span></div>
            <div className="col-span-2"><span className="text-gray-500">Program:</span> <span className="ml-1">{viewSubject.program ? <ProgramBadge program={viewSubject.program} /> : '—'}</span></div>
            <div><span className="text-gray-500">Year Level:</span> <span className="font-medium ml-1">{viewSubject.year_level ? `Year ${viewSubject.year_level}` : '—'}</span></div>
            <div><span className="text-gray-500">Normally Offered In:</span> <span className="font-medium ml-1">{viewSubject.semester || '—'}</span></div>
          </div>
          {viewSubject.description && (
            <div className="mb-4">
              <span className="text-gray-500 text-sm">Description:</span>
              <p className="text-sm mt-1">{viewSubject.description}</p>
            </div>
          )}
          <div>
            <span className="text-gray-500 text-sm">Prerequisites:</span>
            {viewSubject.prerequisites?.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-2">
                {viewSubject.prerequisites.map(p => <Badge key={p.id} variant="orange">{p.code} — {p.name}</Badge>)}
              </div>
            ) : <p className="text-sm text-gray-400 mt-1">None</p>}
          </div>
        </Modal>
      )}
    </>
  );
}