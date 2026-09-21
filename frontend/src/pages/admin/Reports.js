import { useState, useEffect } from 'react';
import { Icons, Badge, LoadingSpinner, ProgramBadge } from '../../components/common';
import { reportService } from '../../services';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { exportGradesMonitoringFormDocx } from '../../utils/gradesMonitoringFormDocx';

export default function Reports() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: result } = await reportService.getAdminGradesReport();
        setData(result);
      } catch (err) {
        toast.error('Failed to load report');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const exportForm = async () => {
    setExporting(true);
    try {
      await exportGradesMonitoringFormDocx({
        programs: data?.programs || [],
        semester: data?.current_semester || '',
        preparedByName: user?.name,
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const programs = data?.programs || [];
  const totalClasses = programs.reduce((s, p) => s + (p.class_breakdown?.length || 0), 0);
  const sumAcross = (key) => programs.reduce((s, p) => s + (p.class_breakdown || []).reduce((ss, c) => ss + (c[key] || 0), 0), 0);
  const passed = sumAcross('passed');
  const failed = sumAcross('failed');
  const inc = sumAcross('inc');
  const dropped = sumAcross('dropped');

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Reports</h2>
          <p className="text-[13px] text-gray-500">
            Grades Monitoring — every program{data?.current_semester ? ` — ${data.current_semester}` : ''}
          </p>
        </div>
        <button className="btn btn-gold text-sm" onClick={exportForm} disabled={exporting || totalClasses === 0}>
          <Icons.FileText className="w-4 h-4" /> {exporting ? 'Exporting...' : 'Export Grades Monitoring Form'}
        </button>
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
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-500">Faculty</th>
                        <th className="text-left px-2 py-2 text-[11px] font-semibold uppercase text-gray-500">Subject</th>
                        <th className="text-center px-2 py-2 text-[11px] font-semibold uppercase text-gray-500">Passed</th>
                        <th className="text-center px-2 py-2 text-[11px] font-semibold uppercase text-gray-500">Incomplete</th>
                        <th className="text-center px-2 py-2 text-[11px] font-semibold uppercase text-gray-500">Failed</th>
                        <th className="text-center px-2 py-2 text-[11px] font-semibold uppercase text-gray-500">Dropped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.class_breakdown.map((c) => (
                        <tr key={c.class_id} className="border-b border-gray-50">
                          <td className="px-4 py-2.5">{c.instructor_name || '—'}</td>
                          <td className="px-2 py-2.5">
                            <span className="font-semibold">{c.subject_code}</span>
                            <span className="text-gray-400"> — {c.subject_name}</span>
                          </td>
                          <td className="px-2 py-2.5 text-center"><Badge variant="green">{c.passed}</Badge></td>
                          <td className="px-2 py-2.5 text-center"><Badge variant="yellow">{c.inc}</Badge></td>
                          <td className="px-2 py-2.5 text-center"><Badge variant="red">{c.failed}</Badge></td>
                          <td className="px-2 py-2.5 text-center"><Badge variant="gray">{c.dropped}</Badge></td>
                        </tr>
                      ))}
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
