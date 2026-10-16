import { useState, useEffect } from 'react';
import { Icons, Badge, LoadingSpinner, ProgramBadge, programShortLabel, formatPersonName, formatPersonNameCapsSurname } from '../../components/common';
import { reportService, semesterService } from '../../services';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { exportGradesMonitoringFormDocx, withFacultySpans, classSectionCode } from '../../utils/gradesMonitoringFormDocx';

// Same Grades Monitoring Form report as Admin's own Reports page
// (utils/gradesMonitoringFormDocx.js) — scoped to just this Chairperson's
// own program(s) instead of the whole college, supporting any active or archived semester.
export default function Reports() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [semesters, setSemesters] = useState([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: semData } = await semesterService.getAll();
        setSemesters(semData.semesters || []);
      } catch (err) {
        console.error(err);
      }
    })();
  }, []);

  const loadReport = async (sem) => {
    setLoading(true);
    try {
      const params = sem ? { semester: sem } : undefined;
      const { data: result } = await reportService.getChairpersonReport(params);
      setData(result);
      if (!selectedSemester && result?.current_semester) {
        setSelectedSemester(result.current_semester);
      }
    } catch (err) {
      toast.error('Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport(selectedSemester);
  }, [selectedSemester]);

  const programs = data?.programs || [];
  const totalClasses = programs.reduce((s, p) => s + (p.class_breakdown?.length || 0), 0);
  const sumAcross = (key) => programs.reduce((s, p) => s + (p.class_breakdown || []).reduce((ss, c) => ss + (c[key] || 0), 0), 0);
  const passed = sumAcross('passed');
  const failed = sumAcross('failed');
  const inc = sumAcross('inc');
  const dropped = sumAcross('dropped');

  const exportForm = async () => {
    setExporting(true);
    try {
      const title = programs.length === 1
        ? `Program Chairperson, ${programShortLabel(programs[0].program)}`
        : 'Program Chairperson';
      await exportGradesMonitoringFormDocx({
        programs,
        semester: data?.current_semester || selectedSemester || '',
        preparedByName: user?.name,
        preparedByTitle: title,
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading && !data) return <LoadingSpinner />;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Reports</h2>
          <p className="text-[13px] text-gray-500">
            Grades Monitoring — your program(s){data?.current_semester ? ` — ${data.current_semester}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <select
            className="form-select text-sm py-2 w-auto"
            value={selectedSemester}
            onChange={(e) => setSelectedSemester(e.target.value)}
          >
            {semesters.map((s) => (
              <option key={s.id || s.name} value={s.name}>
                {s.name} {s.is_current ? '(Current)' : s.status === 'Completed' ? '(Completed)' : ''}
              </option>
            ))}
          </select>
          <button className="btn btn-gold text-sm" onClick={exportForm} disabled={exporting || totalClasses === 0}>
            <Icons.FileText className="w-4 h-4" /> {exporting ? 'Exporting...' : 'Export Grades Monitoring Form'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-500">{passed}</p>
          <p className="text-xs text-gray-500 mt-1">Passed</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{failed}</p>
          <p className="text-xs text-gray-500 mt-1">Failed</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-amber-500">{inc}</p>
          <p className="text-xs text-gray-500 mt-1">Incomplete</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-500">{dropped}</p>
          <p className="text-xs text-gray-500 mt-1">Dropped</p>
        </div>
      </div>

      {totalClasses === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Icons.BarChart className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No classes running this semester yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {programs.map((p) => (
            <div key={p.program} className="card overflow-hidden">
              <div className="px-5 py-3.5 bg-navy text-white flex items-center gap-3">
                <ProgramBadge program={p.program} />
                <span className="text-xs opacity-70 ml-auto">{(p.class_breakdown || []).length} class{(p.class_breakdown || []).length !== 1 ? 'es' : ''}</span>
              </div>
              {(p.class_breakdown || []).length === 0 ? (
                <div className="card-body text-center text-gray-400 text-sm py-8">No classes this semester for this program.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] border-collapse border border-gray-200">
                    <thead>
                      <tr className="bg-gray-100/90 text-gray-700 border-b border-gray-300">
                        <th rowSpan={2} className="text-left px-3 py-2 text-[11px] font-bold uppercase tracking-wider border-r border-gray-200 align-middle">
                          Name of Faculty
                        </th>
                        <th colSpan={2} className="text-center px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider border-r border-gray-200">
                          Faculty Teaching Load
                        </th>
                        <th rowSpan={2} className="text-center px-3 py-2 text-[11px] font-bold uppercase tracking-wider border-r border-gray-200 align-middle">
                          Date Submitted to the<br />Program Chairperson
                        </th>
                        <th colSpan={5} className="text-center px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
                          No. of students with:
                        </th>
                      </tr>
                      <tr className="bg-gray-100/90 text-gray-700 border-b border-gray-300">
                        <th className="text-left px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-gray-200">
                          Course Code
                        </th>
                        <th className="text-left px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-gray-200">
                          Descriptive Title
                        </th>
                        <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-gray-200">
                          Passed
                        </th>
                        <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-gray-200">
                          Incomplete
                        </th>
                        <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-gray-200">
                          Failed
                        </th>
                        <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-r border-gray-200">
                          Dropped
                        </th>
                        <th className="text-center px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {withFacultySpans(p.class_breakdown).map(({ c, span }) => {
                        const secCode = classSectionCode(c, p.program);
                        const descriptiveTitle = `${c.subject_name || '—'}${secCode ? ` ${secCode}` : ''}`;
                        const total = (c.passed || 0) + (c.inc || 0) + (c.failed || 0) + (c.dropped || 0);
                        const dateFormatted = c.date_submitted
                          ? new Date(c.date_submitted).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                          : '—';
                        return (
                          <tr key={c.class_id} className="hover:bg-gray-50/70 transition-colors">
                            {span > 0 && (
                              <td className="px-3 py-2.5 align-top font-semibold text-navy border-r border-gray-200 bg-white whitespace-nowrap" rowSpan={span}>
                                {c.instructor_name ? formatPersonNameCapsSurname(c.instructor_name) : '—'}
                              </td>
                            )}
                            <td className="px-3 py-2 align-top font-medium text-navy border-r border-gray-200 whitespace-nowrap">
                              {c.subject_code || '—'}
                            </td>
                            <td className="px-3 py-2 align-top text-gray-800 border-r border-gray-200">
                              {descriptiveTitle}
                            </td>
                            <td className="px-3 py-2 align-top text-center text-gray-600 text-xs border-r border-gray-200 whitespace-nowrap">
                              {dateFormatted}
                            </td>
                            <td className="px-2 py-2 align-top text-center border-r border-gray-200 font-semibold text-green-600">
                              {c.passed}
                            </td>
                            <td className="px-2 py-2 align-top text-center border-r border-gray-200 font-semibold text-amber-600">
                              {c.inc}
                            </td>
                            <td className="px-2 py-2 align-top text-center border-r border-gray-200 font-semibold text-red-600">
                              {c.failed}
                            </td>
                            <td className="px-2 py-2 align-top text-center border-r border-gray-200 font-semibold text-gray-500">
                              {c.dropped}
                            </td>
                            <td className="px-2 py-2 align-top text-center font-bold text-navy bg-gray-50/50">
                              {total}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
