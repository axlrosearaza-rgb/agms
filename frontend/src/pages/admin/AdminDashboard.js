import { useState, useEffect } from 'react';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner, ProgramBadge, ProgramDot } from '../../components/common';
import { GradeDistributionChart } from '../../components/charts/GradeCharts';
import { dashboardService, gradeService } from '../../services';
import { useNavigate } from 'react-router-dom';

const ACTIVITY_BOXES = [
  { role: 'Instructor', label: 'Faculty', icon: 'User', header: 'bg-purple-600' },
  { role: 'Student', label: 'Students', icon: 'Users', header: 'bg-blue-600' },
  { role: 'Chairperson', label: 'Chairpersons', icon: 'Award', header: 'bg-orange-500' },
];

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [activities, setActivities] = useState([]);
  const [programBreakdown, setProgramBreakdown] = useState([]);
  const [currentSemester, setCurrentSemester] = useState(null);
  const [distribution, setDistribution] = useState(null);
  const [loading, setLoading] = useState(true);
  const [semester, setSemester] = useState('');
  const navigate = useNavigate();

  useEffect(() => { loadDashboard(); }, []);
  useEffect(() => { loadDistribution(); }, [semester]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const { data } = await dashboardService.getAdmin();
      setStats(data?.stats || {});
      setActivities(data?.recent_activities || []);
      setProgramBreakdown(data?.program_breakdown || []);
      setCurrentSemester(data?.current_semester || null);
    } catch (err) {
      console.error('Dashboard error:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDistribution = async () => {
    try {
      const params = {};
      if (semester) params.semester = semester;
      const { data } = await gradeService.getDistribution(params);
      setDistribution(data);
    } catch (err) {
      console.error('Distribution error:', err);
    }
  };

  const semesters = distribution?.semesters || [];

  const timeSince = (date) => {
    if (!date) return '—';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const formatDateTime = (date) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const roleBadge = (role) => {
    const map = { Student: 'blue', Instructor: 'purple', Chairperson: 'orange', Admin: 'green' };
    return <Badge variant={map[role] || 'blue'}>{role}</Badge>;
  };

  if (loading) return <LoadingSpinner />;

  const loginActivities = activities.filter(a => a.action?.toLowerCase().includes('logged in'));
  const systemActivities = activities.filter(a => !a.action?.toLowerCase().includes('logged in'));
  const activitiesByRole = (role) => systemActivities.filter(a => a.user?.role === role).slice(0, 8);

  const quickActions = [
    { label: 'Add New User', icon: <Icons.Users />, path: '/admin/users' },
    { label: 'Manage Subjects', icon: <Icons.FileText />, path: '/admin/subjects' },
    { label: 'Generate Report', icon: <Icons.BarChart />, path: '/admin/reports' },
    { label: 'Semester Settings', icon: <Icons.Settings />, path: '/admin/semesters' },
  ];

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-navy">Welcome back, Administrator!</h2>
        <p className="text-sm text-gray-500">Here's what's happening in your academic system today.</p>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-[160px]"><StatCard label="Total Students Verified" value={stats?.total_students || 0} icon={<Icons.Users />} /></div>
        <div className="flex-1 min-w-[160px]"><StatCard label="Total Faculty" value={stats?.total_faculty || 0} icon={<Icons.User />} /></div>
        <div className="flex-1 min-w-[160px]"><StatCard label="Total Grades Passed by Faculty" value={stats?.total_grades_passed_by_faculty || 0} icon={<Icons.Book />} /></div>
        <div className="flex-1 min-w-[160px]"><StatCard label="Pass Rate" value={`${stats?.pass_rate || 0}%`} icon={<Icons.Award />} /></div>
        <div className="flex-1 min-w-[160px]">
          <StatCard label="Avg. GWA" value={stats?.avg_gwa || '—'} icon={<Icons.BarChart />}
            valueClass={stats?.avg_gwa && parseFloat(stats.avg_gwa) <= 2.0 ? 'text-green-600' : ''} />
        </div>
      </div>

      {/* Per-program breakdown */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="font-semibold text-navy">Program Breakdown</h3>
        </div>
        <div className="card-body grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {programBreakdown.map((p) => (
            <div key={p.program} className="border border-gray-100 rounded-xl p-4">
              <ProgramBadge program={p.program} short />
              <div className="mt-3 space-y-1.5 text-[13px]">
                <div className="flex justify-between"><span className="text-gray-500">Students</span><span className="font-semibold">{p.students}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Faculty</span><span className="font-semibold">{p.faculty}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Active Classes</span><span className="font-semibold">{p.active_classes}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Pass Rate</span><span className="font-semibold">{p.pass_rate}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Avg. GWA</span><span className="font-semibold">{p.avg_gwa || '—'}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* System Activities + Quick Actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
        <div className="xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-navy">System Activities</h3>
            {currentSemester && (
              <span className="text-xs text-gray-500">
                {currentSemester.name} · S.Y. {currentSemester.academic_year}
              </span>
            )}
          </div>
          <div className="space-y-4">
            {ACTIVITY_BOXES.map((box) => {
              const boxActivities = activitiesByRole(box.role);
              const BoxIcon = Icons[box.icon];
              return (
                <div key={box.role} className="card overflow-hidden">
                  <div className={`px-4 py-2.5 ${box.header} text-white flex items-center gap-2`}>
                    <BoxIcon className="w-4 h-4" />
                    <h4 className="text-sm font-semibold">{box.label}</h4>
                  </div>
                  <div className="card-body">
                    {boxActivities.length === 0 ? (
                      <p className="text-sm text-gray-400 text-center py-4">No recent {box.label.toLowerCase()} activity</p>
                    ) : boxActivities.map((a) => (
                      <div key={a.id} className="flex gap-3 py-2.5 border-b last:border-none">
                        <div className="flex-1">
                          <p className="text-sm">
                            <span className="font-semibold">{a.user?.name}</span>{' '}
                            <span className="text-gray-500">{a.action}</span>
                          </p>
                        </div>
                        <span className="text-xs text-gray-400 flex-shrink-0">{timeSince(a.created_at || a.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-navy">Quick Actions</h3>
          </div>
          <div className="card-body space-y-2">
            {quickActions.map((qa, i) => (
              <button key={i} onClick={() => navigate(qa.path)}
                className="w-full flex justify-between items-center p-3.5 border border-gray-100 rounded-lg hover:bg-gray-50 cursor-pointer bg-white font-sans transition-all">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400">{qa.icon}</span>
                  <span className="text-sm text-gray-700">{qa.label}</span>
                </div>
                <Icons.ChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ====== LOGIN HISTORY ====== */}
      <div className="card mb-6">
        <div className="card-header">
          <h3 className="font-semibold text-navy">Login History</h3>
        </div>

        {loginActivities.length === 0 ? (
          <div className="card-body text-center py-10 text-gray-400">
            <Icons.Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No login history yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide rounded-tl-lg">User</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide">Role</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide">Date & Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide rounded-tr-lg">When</th>
                </tr>
              </thead>
              <tbody>
                {loginActivities.map((a) => (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar
                          letter={a.user?.avatar || a.user?.name?.[0]}
                          className="bg-blue-500 text-white"
                          size="w-8 h-8 text-xs"
                        />
                        <div>
                          <p className="text-[13px] font-semibold">{a.user?.name}</p>
                          <p className="text-xs text-gray-500">{a.user?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">{roleBadge(a.user?.role)}</td>
                    <td className="px-4 py-3.5 text-[13px] text-gray-700">{formatDateTime(a.created_at || a.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <span className="text-[12px] text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full font-medium">
                        {timeSince(a.created_at || a.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GWA Distribution */}
      <div className="card">
        <div className="card-header flex justify-between items-center">
          <h3 className="font-semibold text-navy">GWA Distribution</h3>
          <select className="form-select w-auto text-sm" value={semester} onChange={(e) => setSemester(e.target.value)}>
            <option value="">All Semesters</option>
            {semesters.map((sem, i) => <option key={i} value={sem}>{sem}</option>)}
          </select>
        </div>
        <div className="p-6">
          {distribution ? (
            <GradeDistributionChart distribution={distribution.distribution} />
          ) : (
            <LoadingSpinner />
          )}
        </div>
      </div>
    </>
  );
}