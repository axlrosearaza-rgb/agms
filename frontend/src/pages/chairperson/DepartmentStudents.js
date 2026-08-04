import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, SearchBar, LoadingSpinner, ProgramBadge } from '../../components/common';
import { endorsementService } from '../../services';

export default function DepartmentStudents() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [yrFilter, setYrFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grouped'

  useEffect(() => {
    (async () => {
      try {
        const { data: result } = await endorsementService.getDepartmentStudents();
        setData(result);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingSpinner />;

  const allStudents = data?.students || [];

  // Derive program name from students
  const programName = allStudents[0]?.program || data?.department || 'N/A';

  // Get unique sections dynamically
  const sections = [...new Set(allStudents.map(s => s.section).filter(Boolean))].sort();

  const students = allStudents.filter((s) => {
    if (yrFilter && s.year_level !== parseInt(yrFilter)) return false;
    if (sectionFilter && s.section !== sectionFilter) return false;
    if (statusFilter === 'Endorsed' && s.endorsement?.status !== 'Endorsed') return false;
    if (statusFilter === 'Flagged' && s.endorsement?.status !== 'Flagged') return false;
    if (statusFilter === 'Pending' && s.endorsement) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.student_no?.includes(q);
    }
    return true;
  });

  // Group by section
  const grouped = {};
  students.forEach(s => {
    const sec = s.section || 'No Section';
    if (!grouped[sec]) grouped[sec] = [];
    grouped[sec].push(s);
  });

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Program Overview — {programName}</h2>
          <p className="text-[13px] text-gray-500">
            {students.length} students{sectionFilter ? ` in Section ${sectionFilter}` : ''} · Review academic standing and manage endorsements
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setViewMode('list')} className={`btn ${viewMode === 'list' ? 'btn-gold' : 'btn-outline'} text-sm`}>
            <Icons.FileText className="w-3.5 h-3.5" /> List
          </button>
          <button onClick={() => setViewMode('grouped')} className={`btn ${viewMode === 'grouped' ? 'btn-gold' : 'btn-outline'} text-sm`}>
            <Icons.Dashboard className="w-3.5 h-3.5" /> By Section
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or student number..." />
        <select className="form-select w-auto text-sm py-2.5" value={yrFilter} onChange={(e) => setYrFilter(e.target.value)}>
          <option value="">All Years</option>
          {[1,2,3,4].map((y) => <option key={y} value={y}>Year {y}</option>)}
        </select>
        <select className="form-select w-auto text-sm py-2.5" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
          <option value="">All Sections</option>
          {sections.map(s => <option key={s} value={s}>Section {s}</option>)}
        </select>
        <select className="form-select w-auto text-sm py-2.5" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          <option>Endorsed</option><option>Flagged</option><option>Pending</option>
        </select>
      </div>

      {/* List View */}
      {viewMode === 'list' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Student</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Program</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Year</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Section</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">GWA</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Regular</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Endorsement</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar letter={s.avatar || s.name?.[0]} className="bg-blue-500 text-white" size="w-8 h-8 text-xs" />
                        <div>
                          <p className="text-[13px] font-semibold">{s.name}</p>
                          <p className="text-[11px] text-gray-500">{s.student_no}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs"><ProgramBadge program={s.program} /></td>
                    <td className="px-4 py-3.5 text-sm">{s.year_level}</td>
                    <td className="px-4 py-3.5">
                      {s.section ? <Badge variant="blue">Section {s.section}</Badge> : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant={s.student_status === 'Irregular' ? 'orange' : 'gray'}>
                        {s.student_status === 'Irregular' ? 'Irreg' : 'Reg'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`font-bold text-sm ${s.gwa && parseFloat(s.gwa) >= 75 ? 'text-green-500' : 'text-red-500'}`}>
                        {s.gwa || 'N/A'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {s.is_regular ? (
                        <Badge variant="green"><Icons.Check /> Yes</Badge>
                      ) : (
                        <Badge variant="red"><Icons.AlertTriangle /> Irregular</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      {s.endorsement ? (
                        <Badge variant={s.endorsement.status === 'Endorsed' ? 'green' : 'red'}>
                          {s.endorsement.status}
                        </Badge>
                      ) : (
                        <Badge variant="yellow">Pending</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <button className="btn-icon"><Icons.Eye /></button>
                    </td>
                  </tr>
                ))}
                {students.length === 0 && (
                  <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">No students found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grouped by Section View */}
      {viewMode === 'grouped' && (
        <div className="space-y-4">
          {Object.keys(grouped).length === 0 && (
            <div className="card p-12 text-center text-gray-400">
              <Icons.Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No students found</p>
            </div>
          )}
          {Object.entries(grouped).sort().map(([sec, sectionStudents]) => (
            <div key={sec} className="card overflow-hidden">
              <div className="card-header flex items-center justify-between bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 bg-navy text-white rounded-lg flex items-center justify-center text-sm font-bold">{sec.charAt(0)}</span>
                  <div>
                    <h3 className="text-sm font-semibold text-navy">Section {sec}</h3>
                    <p className="text-[11px] text-gray-400">{sectionStudents.length} students</p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-white border-b">
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Program</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Year</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Type</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Endorsement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sectionStudents.sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                      <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <Avatar letter={s.avatar || s.name?.[0]} className="bg-blue-500 text-white" size="w-7 h-7 text-xs" />
                            <span className="text-sm font-medium">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-sm text-gray-500">{s.student_no}</td>
                        <td className="px-4 py-2.5 text-xs text-gray-500"><ProgramBadge program={s.program} /></td>
                        <td className="px-4 py-2.5 text-sm">{s.year_level}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={s.student_status === 'Irregular' ? 'orange' : 'gray'}>
                            {s.student_status === 'Irregular' ? 'Irreg' : 'Reg'}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`font-bold text-sm ${s.gwa && parseFloat(s.gwa) >= 75 ? 'text-green-500' : 'text-red-500'}`}>
                            {s.gwa || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {s.endorsement ? (
                            <Badge variant={s.endorsement.status === 'Endorsed' ? 'green' : 'red'}>{s.endorsement.status}</Badge>
                          ) : (
                            <Badge variant="yellow">Pending</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}