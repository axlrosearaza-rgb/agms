import { useState, useEffect } from 'react';
import { Icons, Avatar, Badge, SearchBar, LoadingSpinner, ProgramDot } from '../../components/common';
import { userService } from '../../services';
import toast from 'react-hot-toast';

export default function StudentDirectory() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedSections, setExpandedSections] = useState({});
  const [programFilter, setProgramFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  useEffect(() => { loadStudents(); }, []);

  const loadStudents = async () => {
    try {
      setLoading(true);
      const { data } = await userService.getAll({ role: 'Student', all: true });
      setStudents(data.users || []);
    } catch (err) {
      toast.error('Failed to load students');
    } finally {
      setLoading(false);
    }
  };

  // Filter students
  const filtered = students.filter(s => {
    if (programFilter && s.program !== programFilter) return false;
    if (yearFilter && s.year_level !== parseInt(yearFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name?.toLowerCase().includes(q) || s.student_no?.includes(q) || s.email?.toLowerCase().includes(q);
    }
    return true;
  });

  // Get unique programs and years from data
  const programs = [...new Set(students.map(s => s.program).filter(Boolean))].sort();
  const allYears = [...new Set(students.map(s => s.year_level).filter(Boolean))].sort();

  // Group students: Program > Year > Section
  const grouped = {};
  filtered.forEach(s => {
    const prog = s.program || 'No Program';
    const year = s.year_level ? `Year ${s.year_level}` : 'No Year';
    const sec = s.section || 'No Section';

    if (!grouped[prog]) grouped[prog] = {};
    if (!grouped[prog][year]) grouped[prog][year] = {};
    if (!grouped[prog][year][sec]) grouped[prog][year][sec] = [];
    grouped[prog][year][sec].push(s);
  });

  const toggleSection = (key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAll = () => {
    const all = {};
    Object.keys(grouped).forEach(prog => {
      Object.keys(grouped[prog]).forEach(year => {
        Object.keys(grouped[prog][year]).forEach(sec => {
          all[`${prog}-${year}-${sec}`] = true;
        });
        all[`${prog}-${year}`] = true;
      });
      all[prog] = true;
    });
    setExpandedSections(all);
  };

  const collapseAll = () => setExpandedSections({});

  const statusBadge = (status) => {
    if (status === 'Active') return <Badge variant="green"><span className="w-1.5 h-1.5 rounded-full inline-block bg-green-500" /> Active</Badge>;
    if (status === 'Pending') return <Badge variant="yellow"><span className="w-1.5 h-1.5 rounded-full inline-block bg-yellow-500" /> Pending</Badge>;
    return <Badge variant="red"><span className="w-1.5 h-1.5 rounded-full inline-block bg-red-500" /> {status}</Badge>;
  };

  const totalSections = Object.values(grouped).reduce((t, prog) =>
    t + Object.values(prog).reduce((t2, year) =>
      t2 + Object.keys(year).length, 0), 0);

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Student Directory</h2>
          <p className="text-[13px] text-gray-500">{filtered.length} students across {totalSections} sections</p>
        </div>
        <div className="flex gap-2">
          <button onClick={expandAll} className="btn btn-outline text-sm"><Icons.ChevronDown className="w-3 h-3" /> Expand All</button>
          <button onClick={collapseAll} className="btn btn-outline text-sm"><Icons.ChevronUp className="w-3 h-3" /> Collapse All</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name, student no, or email..." />
        <select className="form-select w-auto min-w-[320px] text-sm py-2.5" value={programFilter} onChange={(e) => setProgramFilter(e.target.value)}>
          <option value="">All Programs</option>
          {programs.map(p => <option key={p}>{p}</option>)}
        </select>
        <select className="form-select w-auto min-w-[130px] text-sm py-2.5" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="">All Years</option>
          {allYears.map(y => <option key={y} value={y}>Year {y}</option>)}
        </select>
      </div>

      {/* Grouped View */}
      {Object.keys(grouped).length === 0 && (
        <div className="card p-12 text-center text-gray-400">
          <Icons.Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No students found</p>
          <p className="text-sm mt-1">Try adjusting your filters</p>
        </div>
      )}

      {Object.entries(grouped).sort().map(([prog, years]) => (
        <div key={prog} className="mb-4">
          {/* Program Header */}
          <button
            onClick={() => toggleSection(prog)}
            className="w-full flex items-center justify-between p-4 bg-navy text-white rounded-t-xl cursor-pointer border-none font-sans hover:bg-opacity-90 transition-colors"
          >
            <div className="flex items-center gap-3">
              <ProgramDot program={prog} />
              <div className="text-left">
                <h3 className="text-[15px] font-semibold">{prog}</h3>
                <p className="text-[11px] opacity-60">
                  {Object.values(years).reduce((t, year) =>
                    t + Object.values(year).reduce((t2, students) => t2 + students.length, 0), 0)} students
                </p>
              </div>
            </div>
            {expandedSections[prog] ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
          </button>

          {expandedSections[prog] && (
            <div className="border border-t-0 border-gray-200 rounded-b-xl overflow-hidden">
              {Object.entries(years).sort().map(([year, sections]) => (
                <div key={year}>
                  {/* Year Header */}
                  <button
                    onClick={() => toggleSection(`${prog}-${year}`)}
                    className="w-full flex items-center justify-between px-6 py-2.5 bg-blue-50/50 cursor-pointer border-none border-b border-gray-100 font-sans hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Icons.Flag className="w-3.5 h-3.5 text-blue-500" />
                      <span className="text-sm font-medium text-blue-700">{year}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">
                        {Object.values(sections).reduce((t, students) => t + students.length, 0)} students · {Object.keys(sections).length} sections
                      </span>
                      {expandedSections[`${prog}-${year}`] ? <Icons.ChevronUp className="w-3 h-3 text-gray-400" /> : <Icons.ChevronDown className="w-3 h-3 text-gray-400" />}
                    </div>
                  </button>

                  {expandedSections[`${prog}-${year}`] && Object.entries(sections).sort().map(([sec, sectionStudents]) => (
                    <div key={sec}>
                      {/* Section Header */}
                      <button
                        onClick={() => toggleSection(`${prog}-${year}-${sec}`)}
                        className="w-full flex items-center justify-between px-8 py-2 cursor-pointer border-none border-b border-gray-100 font-sans hover:bg-green-50/50 transition-colors bg-white"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 bg-gold/20 text-gold rounded-md flex items-center justify-center text-xs font-bold">{sec.charAt(0)}</span>
                          <span className="text-sm font-medium text-gray-700">Section {sec}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="blue">{sectionStudents.length} students</Badge>
                          {expandedSections[`${prog}-${year}-${sec}`] ? <Icons.ChevronUp className="w-3 h-3 text-gray-400" /> : <Icons.ChevronDown className="w-3 h-3 text-gray-400" />}
                        </div>
                      </button>

                      {/* Student List */}
                      {expandedSections[`${prog}-${year}-${sec}`] && (
                        <div className="bg-white">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-gray-50">
                                <th className="text-left px-8 py-2 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Email</th>
                                <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sectionStudents.sort((a, b) => a.name.localeCompare(b.name)).map(student => (
                                <tr key={student.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                                  <td className="px-8 py-2.5">
                                    <div className="flex items-center gap-2.5">
                                      <Avatar letter={student.avatar || student.name?.[0]} className="bg-blue-500 text-white" size="w-7 h-7 text-xs" />
                                      <span className="text-sm font-medium">{student.name}</span>
                                      <Badge variant={student.student_status === 'Irregular' ? 'orange' : 'gray'}>
                                        {student.student_status === 'Irregular' ? 'Irreg' : 'Reg'}
                                      </Badge>
                                    </div>
                                  </td>
                                  <td className="px-4 py-2.5 text-sm text-gray-500">{student.student_no || '—'}</td>
                                  <td className="px-4 py-2.5 text-sm text-gray-500">{student.email}</td>
                                  <td className="px-4 py-2.5">{statusBadge(student.status)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}