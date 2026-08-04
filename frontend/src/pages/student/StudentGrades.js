import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icons, Badge, LoadingSpinner } from '../../components/common';
import { gradeService } from '../../services';
import API from '../../services/api';
import socket from '../../services/socket';
import toast from 'react-hot-toast';

// Mirrors the backend's SSU Class Record formula so item-level "Rate" matches
// what the instructor/chairperson see — score/maxScore linearly mapped to 50-95.
const itemRate = (score, maxScore) => {
  const s = parseFloat(score);
  const m = parseFloat(maxScore) || 100;
  if (isNaN(s)) return null;
  return (s / m) * 45 + 50;
};

function ClassRecordDetail({ classId, studentId }) {
  const [loading, setLoading] = useState(true);
  const [components, setComponents] = useState([]);
  const [scores, setScores] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const [compRes, scoreRes] = await Promise.all([
          API.get(`/grade-components/${classId}/components`),
          API.get(`/grade-components/${classId}/scores`),
        ]);
        setComponents(compRes.data.components || []);
        setScores(scoreRes.data.scores?.[studentId] || {});
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to load class record');
      } finally {
        setLoading(false);
      }
    })();
  }, [classId, studentId]);

  if (loading) return <div className="py-6 text-center text-sm text-gray-400">Loading class record...</div>;
  if (components.length === 0) return <div className="py-6 text-center text-sm text-gray-400">No class record breakdown available yet.</div>;

  const periods = ['Midterm', 'Finals'];

  return (
    <div className="p-4 bg-gray-50/60 space-y-4">
      {periods.map((period) => {
        const periodComps = components.filter((c) => c.period === period);
        if (periodComps.length === 0) return null;
        return (
          <div key={period}>
            <p className="text-xs font-bold text-navy uppercase mb-2">{period}</p>
            <div className="space-y-2">
              {periodComps.map((comp) => (
                <div key={comp.id} className="bg-white rounded-lg border border-gray-100 overflow-hidden">
                  <div className="px-3 py-2 bg-gray-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">{comp.name}</span>
                    <span className="text-[11px] text-gray-400">{comp.weight}%</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-50">
                        <th className="text-left px-3 py-1.5 font-medium">Item</th>
                        <th className="text-center px-3 py-1.5 font-medium">Score</th>
                        <th className="text-center px-3 py-1.5 font-medium">Max</th>
                        <th className="text-center px-3 py-1.5 font-medium">Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(comp.items || []).map((item) => {
                        const raw = scores[item.id];
                        const rate = raw !== null && raw !== undefined ? itemRate(raw, item.max_score) : null;
                        return (
                          <tr key={item.id} className="border-b border-gray-50 last:border-0">
                            <td className="px-3 py-1.5">{item.name}</td>
                            <td className="px-3 py-1.5 text-center">{raw !== null && raw !== undefined ? raw : '—'}</td>
                            <td className="px-3 py-1.5 text-center text-gray-400">{item.max_score}</td>
                            <td className="px-3 py-1.5 text-center font-medium">{rate !== null ? rate.toFixed(1) : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function StudentGrades() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [semester, setSemester] = useState('');
  const [search, setSearch] = useState('');
  const [expandedClassId, setExpandedClassId] = useState(null);

  useEffect(() => { fetchGrades(); }, [user.id, semester]);

  useEffect(() => {
    socket.on('gradesUpdated', () => fetchGrades());
    return () => socket.off('gradesUpdated');
  }, []);

  const fetchGrades = async () => {
    try {
      setLoading(true);
      const params = {};
      if (semester) params.semester = semester;
      const { data: result } = await gradeService.getStudentGrades(user.id, params);
      setData(result);
    } catch (err) {
      console.error('Error fetching grades:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const grades = data?.grades?.filter((i) => i.grade?.submitted && i.grade?.released) || [];
  const semesters = [...new Set(data?.grades?.map(i => i.class?.semester).filter(Boolean))];

  const filteredGrades = grades.filter((item) =>
    item.class?.subject?.name?.toLowerCase().includes(search.toLowerCase()) ||
    item.class?.subject?.code?.toLowerCase().includes(search.toLowerCase())
  );

  // Compute GWA from filtered grades
  const submittedGrades = filteredGrades.filter(i => i.grade?.average !== null);
  const semesterGWA = submittedGrades.length > 0
    ? (submittedGrades.reduce((sum, i) => sum + parseFloat(i.grade?.average || 0), 0) / submittedGrades.length).toFixed(2)
    : null;

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">My Grades</h2>
          <p className="text-[13px] text-gray-500">
            {semester ? semester : 'All Semesters'} · {filteredGrades.length} subjects
            {semesterGWA && <span className="ml-2 font-semibold text-navy">· GWA: {semesterGWA}</span>}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <select
          className="form-select text-sm py-2.5 min-w-[200px]"
          value={semester}
          onChange={(e) => setSemester(e.target.value)}
        >
          <option value="">All Semesters</option>
          {semesters.map((sem, i) => <option key={i} value={sem}>{sem}</option>)}
        </select>
        <input
          type="text"
          placeholder="Search subject..."
          className="form-input text-sm flex-1 min-w-[200px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-navy">{filteredGrades.length}</p>
          <p className="text-xs text-gray-500 mt-1">Total Subjects</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-500">
            {filteredGrades.filter(i => i.grade?.status === 'Passed').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Passed</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-500">
            {filteredGrades.filter(i => i.grade?.status === 'Failed').length}
          </p>
          <p className="text-xs text-gray-500 mt-1">Failed</p>
        </div>
      </div>

      {/* Grades Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Schedule</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Semester</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Midterm</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Finals</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Average</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Class Record</th>
              </tr>
            </thead>
            <tbody>
              {filteredGrades.map((item) => {
                const g = item.grade;
                const subj = item.class?.subject;
                const passed = g?.status === 'Passed';
                const isExpanded = expandedClassId === item.class?.id;
                return (
                <>
                  <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3.5">
                      <p className="text-[13px] font-semibold">{subj?.code} — {subj?.name}</p>
                      <p className="text-[11px] text-gray-400">{subj?.units} units</p>
                    </td>
                    <td className="px-4 py-3.5 text-[13px] text-gray-600">
                      <div className="flex items-center gap-1">
                        <Icons.Clock className="w-3.5 h-3.5 text-gray-400" />
                        {item.class?.schedule || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant="blue">{item.class?.semester?.split(' ').slice(0,2).join(' ')}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="font-semibold text-sm">
                        {g?.midterm ? parseFloat(g.midterm).toFixed(2) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className="font-semibold text-sm">
                        {g?.finals ? parseFloat(g.finals).toFixed(2) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <span className={`font-bold text-base ${passed ? 'text-green-500' : 'text-red-500'}`}>
                        {g?.average ? parseFloat(g.average).toFixed(2) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={passed ? 'green' : 'red'}>{g?.status}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <button
                        className="btn-icon inline-flex"
                        title={isExpanded ? 'Hide class record' : 'View class record'}
                        onClick={() => setExpandedClassId(isExpanded ? null : item.class?.id)}
                      >
                        {isExpanded ? <Icons.ChevronUp /> : <Icons.ChevronDown />}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan="8" className="p-0">
                        <ClassRecordDetail classId={item.class.id} studentId={user.id} />
                      </td>
                    </tr>
                  )}
                </>
                );
              })}
              {filteredGrades.length === 0 && (
                <tr>
                  <td colSpan="8" className="text-center py-12 text-gray-400 text-sm">
                    {search ? `No subjects found for "${search}"` : 'No grades available yet.'}
                  </td>
                </tr>
              )}
            </tbody>
            {filteredGrades.length > 0 && semesterGWA && (
              <tfoot>
                <tr className="bg-gray-50 border-t border-gray-200">
                  <td colSpan="5" className="px-4 py-3 text-sm font-semibold text-right text-gray-600">
                    Semester GWA:
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-base font-bold ${parseFloat(semesterGWA) <= 3.0 ? 'text-green-600' : 'text-red-500'}`}>
                      {semesterGWA}
                    </span>
                  </td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}