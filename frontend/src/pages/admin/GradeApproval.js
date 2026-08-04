import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons, Badge, SearchBar, LoadingSpinner } from '../../components/common';
import { classService } from '../../services';
import toast from 'react-hot-toast';

export default function GradeApproval() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const { data } = await classService.getAll({ limit: 200 });
        setClasses(data.classes || []);
      } catch (err) {
        toast.error('Failed to load classes');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = classes.filter((c) =>
    !search ||
    c.subject?.code?.toLowerCase().includes(search.toLowerCase()) ||
    c.subject?.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.instructor?.name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingSpinner />;

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Grade Approval</h2>
        <p className="text-[13px] text-gray-500">
          Verify and approve Passed students for each class before their grades are finalized on record.
        </p>
      </div>

      <div className="mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by subject, course title, or instructor..." />
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-navy text-white">
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Section</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Semester</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Faculty</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Students</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Review</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <span className="font-semibold text-[13px]">{c.subject?.code}</span><br />
                    <span className="text-gray-500 text-xs">{c.subject?.name}</span>
                  </td>
                  <td className="px-4 py-3 text-[13px]">{c.section ? <Badge variant="purple">Sec {c.section}</Badge> : '—'}</td>
                  <td className="px-4 py-3 text-xs">{c.semester} {c.academic_year}</td>
                  <td className="px-4 py-3 text-[13px]">{c.instructor?.name || '—'}</td>
                  <td className="px-4 py-3 text-[13px]">{c.student_count ?? 0}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/admin/grade-approval/${c.id}`)}
                      className="btn-icon inline-flex"
                      title="Review and approve grades"
                    >
                      <Icons.FileText />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="6" className="text-center py-12 text-gray-400 text-sm">
                    <Icons.FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No classes found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
