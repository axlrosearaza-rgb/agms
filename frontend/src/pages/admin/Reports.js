import { useState, useEffect } from 'react';
import { Icons, Badge, LoadingSpinner, ProgramBadge } from '../../components/common';
import { gradeService, semesterService } from '../../services';
import toast from 'react-hot-toast';

const REPORTS = [
  { id: 'grade-summary', title: 'Grade Summary Report', desc: 'GWA overview by subject', color: 'bg-blue-500', icon: <Icons.BarChart /> },
  { id: 'student-perf', title: 'Student Performance', desc: 'Individual student GWA analysis', color: 'bg-green-500', icon: <Icons.Users /> },
  { id: 'faculty-workload', title: 'Faculty Workload', desc: 'Teaching load by instructor', color: 'bg-purple-500', icon: <Icons.User /> },
  { id: 'pass-fail', title: 'Pass/Fail Rates', desc: 'Success rates by subject (GWA ≤ 3.0)', color: 'bg-red-500', icon: <Icons.Award /> },
];

const DEPARTMENTS = ['Information Technology', 'Information Systems', 'Psychology', 'Statistics'];

export default function Reports() {
  const [selected, setSelected] = useState(null);
  const [semester, setSemester] = useState('');
  const [department, setDepartment] = useState('');
  const [yearLevel, setYearLevel] = useState('');
  const [semesters, setSemesters] = useState([]);
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    semesterService.getAll().then(({ data }) => setSemesters(data.semesters || [])).catch(() => {});
  }, []);

  const generateReport = async () => {
    if (!selected) { toast.error('Select a report type first'); return; }
    try {
      setLoading(true);
      setReportData(null);
      const params = { type: selected };
      if (semester) params.semester = semester;
      if (department) params.department = department;
      if (yearLevel) params.year_level = yearLevel;
      const { data } = await gradeService.getReport(params);
      setReportData(data);
    } catch (err) {
      toast.error('Failed to generate report');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const gwaColor = (gwa) => {
    if (!gwa) return '';
    const v = parseFloat(gwa);
    if (v <= 1.5) return 'text-green-600 font-bold';
    if (v <= 2.0) return 'text-green-500';
    if (v <= 2.5) return 'text-yellow-600';
    if (v <= 3.0) return 'text-orange-500';
    return 'text-red-500 font-bold';
  };

  // Export report to CSV
  const exportReport = () => {
    if (!reportData) return;
    let headers = [];
    let rows = [];
    const type = reportData.type;

    if (type === 'grade-summary') {
      headers = ['Subject Code', 'Subject Name', 'Faculty', 'Students', 'Avg GWA', 'Passed', 'Failed', 'Pass Rate'];
      rows = (reportData.data.subjects || []).map(s => [s.code, s.name, s.instructor || '', s.total_students, s.avg_gwa, s.passed, s.failed, `${s.pass_rate}%`]);
    } else if (type === 'student-perf') {
      headers = ['Name', 'Student No', 'Program', 'Department', 'Year', 'GWA', 'Subjects', 'Passed', 'Failed'];
      rows = (reportData.data.students || []).map(s => [s.name, s.student_no, s.program || '', s.department || '', s.year_level || '', s.gwa || '', s.total_subjects, s.passed, s.failed]);
    } else if (type === 'faculty-workload') {
      headers = ['Faculty', 'Department', 'Classes', 'Total Units', 'Total Students', 'Subjects'];
      rows = (reportData.data.instructors || []).map(i => [i.name, i.department, i.total_classes, i.total_units, i.total_students, (i.classes || []).map(c => c.subject_code).join(', ')]);
    } else if (type === 'pass-fail') {
      headers = ['Subject Code', 'Subject Name', 'Department', 'Total', 'Passed', 'Failed', 'Pass Rate', 'Fail Rate'];
      rows = (reportData.data.subjects || []).map(s => [s.code, s.name, s.department, s.total, s.passed, s.failed, `${s.pass_rate}%`, `${s.fail_rate}%`]);
    } else if (type === 'enrollment') {
      headers = ['Category', 'Label', 'Count'];
      rows = [
        ...(reportData.data.by_department || []).map(d => ['Department', d.department || 'Unassigned', d.count]),
        ...(reportData.data.by_year_level || []).map(d => ['Year Level', `Year ${d.year_level || '—'}`, d.count]),
        ...(reportData.data.by_program || []).map(d => ['Program', d.program || 'Unassigned', d.count]),
      ];
    }

    const csvContent = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${type}_report.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported to CSV!');
  };

  // Print report
  const printReport = () => {
    window.print();
  };

  const selectedReport = REPORTS.find(r => r.id === selected);

  return (
    <>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-navy">Generate Reports</h2>
        <p className="text-[13px] text-gray-500">Create and preview academic reports with real data (GWA 1.0–5.0 scale)</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {REPORTS.map((r) => (
          <button key={r.id} onClick={() => { setSelected(r.id); setReportData(null); }}
            className={`text-left p-5 border-2 rounded-xl cursor-pointer bg-white hover:shadow-md transition-all font-sans ${selected === r.id ? 'border-navy bg-blue-50/50' : 'border-gray-100 hover:border-gold'}`}>
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white mb-3 ${r.color}`}>{r.icon}</div>
            <h4 className="text-[14px] font-semibold mb-0.5">{r.title}</h4>
            <p className="text-[11px] text-gray-500">{r.desc}</p>
          </button>
        ))}
      </div>

      <div className="card mb-6">
        <div className="card-header"><h3 className="text-base font-semibold text-navy">Report Filters</h3></div>
        <div className="card-body">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="form-label">Semester</label>
              <select className="form-select" value={semester} onChange={(e) => setSemester(e.target.value)}>
                <option value="">All Semesters</option>
                {semesters.map(s => <option key={s.id} value={s.name}>{s.name} {s.academic_year ? `(${s.academic_year})` : ''}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="form-label">Department</label>
              <select className="form-select" value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">All Departments</option>
                {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[120px]">
              <label className="form-label">Year Level</label>
              <select className="form-select" value={yearLevel} onChange={(e) => setYearLevel(e.target.value)}>
                <option value="">All Years</option>
                {[1, 2, 3, 4].map(y => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <button className="btn btn-gold mb-0.5" onClick={generateReport} disabled={!selected || loading}>
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>
      </div>

      {/* REPORT RESULTS */}
      {loading && <LoadingSpinner text="Generating report..." />}

      {/* Report action buttons */}
      {reportData && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-navy">{selectedReport?.title}</h3>
          <div className="flex gap-2">
            <button className="btn btn-outline text-sm" onClick={printReport}>
              <Icons.FileText className="w-4 h-4" /> Print
            </button>
            <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white" style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }} onClick={exportReport}>
              <Icons.FileText className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>
      )}

      {reportData && reportData.type === 'grade-summary' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Faculty</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Students</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Avg GWA</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Passed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Failed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Pass Rate</th>
              </tr></thead>
              <tbody>
                {(reportData.data.subjects || []).map((s, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-3"><span className="font-semibold">{s.code}</span><br /><span className="text-gray-500 text-xs">{s.name}</span></td>
                    <td className="px-4 py-3">{s.instructor || '—'}</td>
                    <td className="px-4 py-3">{s.total_students}</td>
                    <td className={`px-4 py-3 ${gwaColor(s.avg_gwa)}`}>{s.avg_gwa}</td>
                    <td className="px-4 py-3 text-green-600">{s.passed}</td>
                    <td className="px-4 py-3 text-red-500">{s.failed}</td>
                    <td className="px-4 py-3"><Badge variant={s.pass_rate >= 80 ? 'green' : s.pass_rate >= 50 ? 'orange' : 'red'}>{s.pass_rate}%</Badge></td>
                  </tr>
                ))}
                {(!reportData.data.subjects || reportData.data.subjects.length === 0) && (
                  <tr><td colSpan="7" className="text-center py-8 text-gray-400">No data for selected filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportData && reportData.type === 'student-perf' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Student No</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Program</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Year</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">GWA</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Subjects</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Passed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Failed</th>
              </tr></thead>
              <tbody>
                {(reportData.data.students || []).map((s, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-gray-500">{s.student_no || '—'}</td>
                    <td className="px-4 py-3 text-xs">{s.program ? <ProgramBadge program={s.program} /> : '—'}</td>
                    <td className="px-4 py-3">{s.year_level || '—'}</td>
                    <td className={`px-4 py-3 ${gwaColor(s.gwa)}`}>{s.gwa || '—'}</td>
                    <td className="px-4 py-3">{s.total_subjects}</td>
                    <td className="px-4 py-3 text-green-600">{s.passed}</td>
                    <td className="px-4 py-3 text-red-500">{s.failed}</td>
                  </tr>
                ))}
                {(!reportData.data.students || reportData.data.students.length === 0) && (
                  <tr><td colSpan="8" className="text-center py-8 text-gray-400">No data for selected filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportData && reportData.type === 'faculty-workload' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Faculty</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Department</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Classes</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Total Units</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Total Students</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Subjects</th>
              </tr></thead>
              <tbody>
                {(reportData.data.instructors || []).map((instr, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium">{instr.name}</td>
                    <td className="px-4 py-3">{instr.department}</td>
                    <td className="px-4 py-3"><Badge variant="blue">{instr.total_classes}</Badge></td>
                    <td className="px-4 py-3 font-semibold">{instr.total_units}</td>
                    <td className="px-4 py-3">{instr.total_students}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{instr.classes?.map(c => c.subject_code).join(', ')}</td>
                  </tr>
                ))}
                {(!reportData.data.instructors || reportData.data.instructors.length === 0) && (
                  <tr><td colSpan="6" className="text-center py-8 text-gray-400">No data for selected filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportData && reportData.type === 'pass-fail' && (
        <div className="card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Department</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Total</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Passed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Failed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Pass Rate</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Visual</th>
              </tr></thead>
              <tbody>
                {(reportData.data.subjects || []).map((s, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td className="px-4 py-3"><span className="font-semibold">{s.code}</span><br /><span className="text-xs text-gray-500">{s.name}</span></td>
                    <td className="px-4 py-3 text-xs">{s.department}</td>
                    <td className="px-4 py-3">{s.total}</td>
                    <td className="px-4 py-3 text-green-600 font-medium">{s.passed}</td>
                    <td className="px-4 py-3 text-red-500 font-medium">{s.failed}</td>
                    <td className="px-4 py-3"><Badge variant={s.pass_rate >= 80 ? 'green' : s.pass_rate >= 50 ? 'orange' : 'red'}>{s.pass_rate}%</Badge></td>
                    <td className="px-4 py-3">
                      <div className="w-24 h-2 bg-red-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${s.pass_rate}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
                {(!reportData.data.subjects || reportData.data.subjects.length === 0) && (
                  <tr><td colSpan="7" className="text-center py-8 text-gray-400">No data for selected filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {reportData && reportData.type === 'enrollment' && (
        <div className="card">
          <div className="card-header"><h3 className="text-base font-semibold text-navy">Total Students: {reportData.data.total}</h3></div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h4 className="font-semibold text-sm text-navy mb-3">By Department</h4>
              {(reportData.data.by_department || []).length === 0 && <p className="text-sm text-gray-400">No data</p>}
              {(reportData.data.by_department || []).map((d, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50">
                  <span className="text-sm">{d.department || 'Unassigned'}</span>
                  <Badge variant="blue">{d.count}</Badge>
                </div>
              ))}
            </div>
            <div>
              <h4 className="font-semibold text-sm text-navy mb-3">By Year Level</h4>
              {(reportData.data.by_year_level || []).length === 0 && <p className="text-sm text-gray-400">No data</p>}
              {(reportData.data.by_year_level || []).map((d, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50">
                  <span className="text-sm">Year {d.year_level || '—'}</span>
                  <Badge variant="green">{d.count}</Badge>
                </div>
              ))}
            </div>
            <div>
              <h4 className="font-semibold text-sm text-navy mb-3">By Program</h4>
              {(reportData.data.by_program || []).length === 0 && <p className="text-sm text-gray-400">No data</p>}
              {(reportData.data.by_program || []).map((d, i) => (
                <div key={i} className="flex justify-between items-center py-2 border-b border-gray-50">
                  {d.program ? <ProgramBadge program={d.program} /> : <span className="text-xs">Unassigned</span>}
                  <Badge variant="purple">{d.count}</Badge>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}