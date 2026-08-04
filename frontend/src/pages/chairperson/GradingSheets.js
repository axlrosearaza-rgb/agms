import { useState, useEffect } from 'react';
import { Icons, Badge, SearchBar, LoadingSpinner } from '../../components/common';
import { classService, reportService } from '../../services';
import toast from 'react-hot-toast';

export default function GradingSheets() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sendingId, setSendingId] = useState(null);

  const handleSendToAdmin = async (classId) => {
    if (!window.confirm('Forward this class\'s Grading Sheet to Admin for final approval?')) return;
    try {
      setSendingId(classId);
      const { data } = await reportService.forwardGradingSheetToAdmin(classId);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to forward to Admin');
    } finally {
      setSendingId(null);
    }
  };

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
        <h2 className="text-lg font-bold text-navy">Grading Sheets</h2>
        <p className="text-[13px] text-gray-500">
          Official Grading Sheets for every class in your program — open a class to view what its instructor has submitted so far.
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
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Progress</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Passed / INC / Dropped</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Grading Sheet</th>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">Send to Admin</th>
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
                    <Badge variant={c.progress >= 100 ? 'green' : c.progress > 0 ? 'yellow' : 'gray'}>
                      {c.progress ?? 0}% submitted
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      <Badge variant="green">{c.passed_count ?? 0}</Badge>
                      <Badge variant="yellow">{c.inc_count ?? 0}</Badge>
                      <Badge variant="gray">{c.dropped_count ?? 0}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/grading-sheet/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-icon inline-flex"
                      title="Open official Grading Sheet"
                    >
                      <Icons.FileText />
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleSendToAdmin(c.id)}
                      className="btn-icon inline-flex disabled:opacity-50"
                      title="Forward to Admin for approval"
                      disabled={sendingId === c.id}
                    >
                      <Icons.Send />
                    </button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="9" className="text-center py-12 text-gray-400 text-sm">
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
