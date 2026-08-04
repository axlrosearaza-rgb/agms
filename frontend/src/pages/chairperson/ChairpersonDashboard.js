import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner, ProgramBadge } from '../../components/common';
import { endorsementService, dashboardService } from '../../services';
import toast from 'react-hot-toast';

export default function ChairpersonDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [facultyReview, setFacultyReview] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [{ data: result }, { data: reviewResult }] = await Promise.all([
        endorsementService.getDepartmentStudents(),
        dashboardService.getChairpersonFacultyReview(),
      ]);
      setData(result);
      setFacultyReview(reviewResult.faculty || []);
    } catch (err) {
      toast.error('Failed to load program data');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const endorsed = data?.students?.filter((s) => s.endorsement?.status === 'Endorsed') || [];
  const flagged = data?.students?.filter((s) => s.endorsement?.status === 'Flagged') || [];
  const irregularStudents = data?.students?.filter((s) => s.student_status === 'Irregular') || [];

  // Derive the program name from the first student (all under the same program)
  const programName = data?.students?.[0]?.program || data?.department || 'N/A';

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="font-display text-2xl font-bold text-navy">Welcome back, {user?.name?.split(' ')[0]}!</h2>
          <ProgramBadge program={programName} size="lg" short />
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Academic standing validation and endorsement</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Program Students" value={data?.summary?.total || 0} icon={<Icons.Users />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Endorsed" value={data?.summary?.endorsed || 0} valueClass="text-green-500" icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Flagged" value={data?.summary?.flagged || 0} valueClass="text-red-500" icon={<Icons.Flag />} iconBg="bg-red-50 text-red-500" />
        <StatCard label="Pending Review" value={data?.summary?.pending || 0} icon={<Icons.Clock />} iconBg="bg-amber-50 text-amber-500" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
        {/* Faculty Pending Review */}
        <div>
          <div className="card">
            <div className="card-header">
              <h3 className="text-base font-semibold text-navy">Faculty Pending Review</h3>
              <p className="text-xs text-gray-400 mt-0.5">Grade submission status per instructor in your program(s)</p>
            </div>
            <div className="card-body space-y-3">
              {facultyReview.length === 0 && (
                <p className="text-center py-8 text-gray-400 text-sm">No active classes found for your program(s).</p>
              )}
              {facultyReview.map((f) => {
                const allSent = f.classes.length > 0 && f.classes.every((c) => c.sent);
                return (
                  <div key={f.instructor.id} className="border border-gray-100 rounded-xl p-5 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <Avatar letter={f.instructor.avatar || f.instructor.name?.[0]} className="bg-purple-500 text-white" />
                        <div>
                          <p className="text-sm font-semibold">{f.instructor.name}</p>
                          <p className="text-xs text-gray-500">{f.classes.length} class{f.classes.length !== 1 ? 'es' : ''}</p>
                        </div>
                      </div>
                      <Badge variant={allSent ? 'green' : 'yellow'}>
                        {allSent ? <><Icons.Check className="w-3 h-3" /> Grades Sent</> : <><Icons.Clock className="w-3 h-3" /> Pending</>}
                      </Badge>
                    </div>

                    <div className="border-t border-gray-50 pt-3 mt-3 space-y-2">
                      {f.classes.map((c) => (
                        <div key={c.class_id} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">
                            {c.subject_code}{c.section ? ` · Sec ${c.section}` : ''}
                          </span>
                          {c.sent ? (
                            <div className="flex gap-1.5">
                              <Badge variant="green">{c.passed} Passed</Badge>
                              <Badge variant="yellow">{c.inc} INC</Badge>
                              <Badge variant="gray">{c.dropped} Dropped</Badge>
                            </div>
                          ) : (
                            <span className="text-gray-400">{c.submitted_count}/{c.total_students} submitted</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <div className="card">
            <div className="card-header"><h3 className="text-base font-semibold text-navy">Endorsement Summary</h3></div>
            <div className="card-body space-y-0">
              {[...endorsed, ...flagged].map((s) => (
                <div key={s.id} className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
                  <Avatar letter={s.avatar || s.name?.[0]} className={s.endorsement?.status === 'Endorsed' ? 'bg-green-500 text-white' : 'bg-gold text-white'} size="w-8 h-8 text-xs" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">{s.name}</p>
                    <p className="text-xs text-gray-500 truncate">{s.endorsement?.notes || s.endorsement?.flagged_reason}</p>
                  </div>
                  <Badge variant={s.endorsement?.status === 'Endorsed' ? 'green' : 'red'}>
                    {s.endorsement?.status === 'Endorsed' ? <><Icons.Check /> Endorsed</> : <><Icons.Flag /> Flagged</>}
                  </Badge>
                </div>
              ))}
              {endorsed.length === 0 && flagged.length === 0 && (
                <p className="text-center py-6 text-gray-400 text-sm">No endorsements yet</p>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3 className="text-base font-semibold text-navy">Program Overview</h3></div>
            <div className="card-body">
              <p className="text-sm mb-3 flex items-center gap-1.5"><strong>Program:</strong> <ProgramBadge program={programName} /></p>
              {[1, 2, 3, 4].map((yr) => {
                const count = data?.students?.filter((s) => s.year_level === yr).length || 0;
                return (
                  <div key={yr} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <span className="text-[13px]">Year {yr}</span>
                    <Badge variant="blue">{count} students</Badge>
                  </div>
                );
              })}
              {irregularStudents.length > 0 && (
                <div className="pt-3 mt-1">
                  <p className="text-xs font-semibold text-gray-500 mb-2">Irregular Students ({irregularStudents.length})</p>
                  <div className="space-y-1.5">
                    {irregularStudents.map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-xs">
                        <span className="text-gray-600 truncate">{s.name}</span>
                        <span className="text-gray-400">Yr {s.year_level}{s.section ? ` · ${s.section}` : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}