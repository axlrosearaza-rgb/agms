import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner } from '../../components/common';
import { gradeService } from '../../services';
import socket from '../../services/socket';

export default function StudentDashboard() {
  const { user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [semester, setSemester] = useState('');

  useEffect(() => {
    fetchData();
  }, [user.id, semester]);

  // 🔥 REAL-TIME LISTENER
  useEffect(() => {
    socket.on('gradesUpdated', () => {
      console.log('⚡ Real-time update received');
      fetchData();
    });

    return () => socket.off('gradesUpdated');
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      const params = {};
      if (semester) params.semester = semester;

      const { data: result } = await gradeService.getStudentGrades(user.id, params);
      setData(result);
    } catch (err) {
      console.error('Error loading student data:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const grades = data?.grades?.filter((g) => g.grade?.submitted && g.grade?.released) || [];

  // ✅ Dynamic semesters
  const semesters = [...new Set(data?.grades?.map(g => g.class?.semester).filter(Boolean))];

  return (
    <>
      {/* HERO */}
      <div className="bg-gradient-to-r from-navy-dark via-navy to-navy-light rounded-xl p-7 text-white flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-5">
          <Avatar
            letter={user?.avatar || user?.name?.[0]}
            className="bg-gold text-white border-[3px] border-white/30"
            size="w-16 h-16 text-2xl"
          />

          <div>
            <h2 className="text-2xl font-bold">{user?.name}</h2>
            <p className="text-sm opacity-80">{user?.student_no}</p>
            <p className="text-xs opacity-70">{user?.program}</p>
            <p className="text-xs opacity-70">Year Level: {user?.year_level}</p>
          </div>
        </div>

        <div className="text-center">
          <div className="w-20 h-20 rounded-full bg-gold flex items-center justify-center">
            <span className="text-xl font-bold">
              {data?.summary?.gwa || '0.00'}
            </span>
          </div>
          <p className="text-xs mt-1">Overall GWA</p>
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="Subjects" value={data?.summary?.total_subjects || 0} />
        <StatCard label="Passed" value={data?.summary?.passed || 0} valueClass="text-green-500" />
        <StatCard label="Failed" value={data?.summary?.failed || 0} valueClass="text-red-500" />
      </div>

      {/* FILTER */}
      <div className="flex justify-between items-center mb-4">
        <select
          className="form-select text-sm"
          value={semester}
          onChange={(e) => setSemester(e.target.value)}
        >
          <option value="">All Semesters</option>
          {semesters.map((sem, i) => (
            <option key={i} value={sem}>{sem}</option>
          ))}
        </select>
      </div>

      {/* GRADES */}
      <h3 className="text-base font-semibold text-navy mb-4">My Grades</h3>

      {grades.map((item) => {
        const g = item.grade;
        const cls = item.class;
        const subj = cls?.subject;
        const isExpanded = expandedId === g?.id;

        return (
          <div key={g.id} className="card mb-3">
            <button
              className="w-full px-5 py-4 flex items-center justify-between"
              onClick={() => setExpandedId(isExpanded ? null : g.id)}
            >
              <div>
                <p className="font-semibold">
                  {subj?.code} - {subj?.name}
                </p>
                <p className="text-xs text-gray-500">
                  {cls?.schedule}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`font-bold ${g.status === 'Passed' ? 'text-green-500' : 'text-red-500'}`}>
                  {parseFloat(g.average || 0).toFixed(2)}
                </span>

                <Badge variant={g.status === 'Passed' ? 'green' : 'red'}>
                  {g.status}
                </Badge>

                {isExpanded ? <Icons.ChevronUp /> : <Icons.ChevronDown />}
              </div>
            </button>

            {isExpanded && (
              <div className="px-5 pb-4 grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-xs text-gray-500">Midterm</p>
                  <p className="text-lg font-bold">
                    {parseFloat(g.midterm || 0)}
                  </p>
                </div>

                <div className="text-center">
                  <p className="text-xs text-gray-500">Finals</p>
                  <p className="text-lg font-bold">
                    {parseFloat(g.finals || 0)}
                  </p>
                </div>

                <div className="text-center">
                  <p className="text-xs text-gray-500">Average</p>
                  <p className="text-lg font-bold">
                    {parseFloat(g.average || 0).toFixed(2)}
                  </p>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {grades.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">
          No grades available.
        </div>
      )}
    </>
  );
}