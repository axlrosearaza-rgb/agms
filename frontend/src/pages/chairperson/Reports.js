import { useState, useEffect } from 'react';
import { Icons, Badge, LoadingSpinner, ProgramBadge } from '../../components/common';
import { reportService } from '../../services';
import toast from 'react-hot-toast';

export default function Reports() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data: result } = await reportService.getChairpersonReport();
        setData(result);
      } catch (err) {
        toast.error('Failed to load report');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const gwaColor = (gwa) => {
    if (!gwa) return '';
    const v = parseFloat(gwa);
    if (v <= 1.5) return 'text-green-600 font-bold';
    if (v <= 2.0) return 'text-green-500';
    if (v <= 2.5) return 'text-yellow-600';
    if (v <= 3.0) return 'text-orange-500';
    return 'text-red-500 font-bold';
  };

  if (loading) return <LoadingSpinner />;

  const programs = data?.programs || [];

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Program Reports</h2>
          <p className="text-[13px] text-gray-500">
            Grade ratings and enrollment for your program(s){data?.current_semester ? ` — ${data.current_semester}` : ''}
          </p>
        </div>
        <button className="btn btn-outline text-sm" onClick={() => window.print()}>
          <Icons.FileText className="w-4 h-4" /> Print
        </button>
      </div>

      {programs.length === 0 ? (
        <div className="card p-12 text-center text-gray-400">
          <Icons.BarChart className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No program assigned yet</p>
        </div>
      ) : (
        <div className="space-y-5">
          {programs.map((p) => (
            <div key={p.program} className="card overflow-hidden">
              <div className="px-5 py-3.5 bg-navy text-white flex items-center gap-3">
                <ProgramBadge program={p.program} />
              </div>
              <div className="card-body">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-2">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-navy">{p.total_students}</p>
                    <p className="text-xs text-gray-500 mt-1">Total Students in System</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-blue-500">{p.enrolled_this_semester}</p>
                    <p className="text-xs text-gray-500 mt-1">Enrolled This Semester</p>
                  </div>
                  <div className="text-center">
                    <p className={`text-2xl font-bold ${gwaColor(p.avg_gwa)}`}>{p.avg_gwa || '—'}</p>
                    <p className="text-xs text-gray-500 mt-1">Avg GWA</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-green-500">{p.pass_rate}%</p>
                    <p className="text-xs text-gray-500 mt-1">Pass Rate</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-gray-600">{p.total_grades_submitted}</p>
                    <p className="text-xs text-gray-500 mt-1">Grades Submitted</p>
                  </div>
                </div>
                <div className="flex gap-2 justify-center mt-3">
                  <Badge variant="green">{p.passed} Passed</Badge>
                  <Badge variant="red">{p.failed} Failed</Badge>
                  <Badge variant="yellow">{p.inc} INC</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
