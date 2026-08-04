import { useState, useEffect } from 'react';
import { Icons, Badge, LoadingSpinner } from '../../components/common';
import { reportService, semesterService } from '../../services';
import toast from 'react-hot-toast';

export default function Reports() {
  const [semesters, setSemesters] = useState([]);
  const [semester, setSemester] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [sectionFilter, setSectionFilter] = useState('');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    semesterService.getAll().then(({ data }) => setSemesters(data.semesters || [])).catch(() => {});
  }, []);

  const loadReport = async (sem) => {
    try {
      setLoading(true);
      const { data } = await reportService.getGrades(sem ? { semester: sem } : {});
      setReport(data.report || []);
    } catch (err) {
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReport(semester); }, [semester]);

  const gwaColor = (gwa) => {
    if (!gwa) return '';
    const v = parseFloat(gwa);
    if (v <= 1.5) return 'text-green-600 font-bold';
    if (v <= 2.0) return 'text-green-500';
    if (v <= 2.5) return 'text-yellow-600';
    if (v <= 3.0) return 'text-orange-500';
    return 'text-red-500 font-bold';
  };

  const handleSendAll = async () => {
    if (!window.confirm('Send this grade report to your Chairperson and Admin?')) return;
    try {
      setSending(true);
      const { data } = await reportService.send(semester ? { semester } : {});
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send report');
    } finally {
      setSending(false);
    }
  };

  if (loading && !report) return <LoadingSpinner />;

  const filteredReport = (report || []).filter((r) => {
    if (yearFilter && String(r.year_level) !== yearFilter) return false;
    if (sectionFilter && r.section !== sectionFilter) return false;
    return true;
  });

  const years = [...new Set((report || []).map((r) => r.year_level).filter(Boolean))].sort();
  const sections = [...new Set((report || []).map((r) => r.section).filter(Boolean))].sort();

  const totalStudents = filteredReport.reduce((t, r) => t + r.total_students, 0);
  const totalPassed = filteredReport.reduce((t, r) => t + r.passed, 0);
  const totalFailed = filteredReport.reduce((t, r) => t + r.failed, 0);

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Grade Reports</h2>
          <p className="text-[13px] text-gray-500">Summary of grades submitted across your classes</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline text-sm" onClick={() => window.print()}>
            <Icons.FileText className="w-4 h-4" /> Print
          </button>
          <button className="btn btn-gold text-sm" onClick={handleSendAll} disabled={sending || !report?.length}>
            {sending ? 'Sending...' : <><Icons.Send className="w-4 h-4" /> Send All</>}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <select className="form-select w-auto min-w-[220px] text-sm py-2.5" value={semester} onChange={(e) => setSemester(e.target.value)}>
          <option value="">All Semesters</option>
          {semesters.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <select className="form-select w-auto text-sm py-2.5" value={yearFilter} onChange={(e) => setYearFilter(e.target.value)}>
          <option value="">All Years</option>
          {years.map((y) => <option key={y} value={y}>Year {y}</option>)}
        </select>
        <select className="form-select w-auto text-sm py-2.5" value={sectionFilter} onChange={(e) => setSectionFilter(e.target.value)}>
          <option value="">All Sections</option>
          {sections.map((s) => <option key={s} value={s}>Section {s}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-navy">{totalStudents}</p>
          <p className="text-xs text-gray-500 mt-1">Total Grades</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-500">{totalPassed}</p>
          <p className="text-xs text-gray-500 mt-1">Passed</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{totalFailed}</p>
          <p className="text-xs text-gray-500 mt-1">Failed</p>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Year</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Section</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Semester</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Students</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Avg GWA</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Passed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Failed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">INC</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Grading Sheet</th>
              </tr>
            </thead>
            <tbody>
              {filteredReport.map((r) => (
                <tr key={r.class_id} className="border-b border-gray-50">
                  <td className="px-4 py-3">
                    <span className="font-semibold">{r.subject_code}</span><br />
                    <span className="text-gray-500 text-xs">{r.subject_name}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{r.year_level ? `Year ${r.year_level}` : '—'}</td>
                  <td className="px-4 py-3">{r.section ? <Badge variant="purple">Sec {r.section}</Badge> : '—'}</td>
                  <td className="px-4 py-3 text-xs">{r.semester}</td>
                  <td className="px-4 py-3">{r.total_students}</td>
                  <td className={`px-4 py-3 ${gwaColor(r.avg_gwa)}`}>{r.avg_gwa || '—'}</td>
                  <td className="px-4 py-3 text-green-600">{r.passed}</td>
                  <td className="px-4 py-3 text-red-500">{r.failed}</td>
                  <td className="px-4 py-3 text-orange-500">{r.inc}</td>
                  <td className="px-4 py-3">
                    <a
                      href={`/grading-sheet/${r.class_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-icon inline-flex"
                      title="Open official Grading Sheet"
                    >
                      <Icons.FileText />
                    </a>
                  </td>
                </tr>
              ))}
              {filteredReport.length === 0 && (
                <tr><td colSpan="10" className="text-center py-12 text-gray-400 text-sm">No submitted grades found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
