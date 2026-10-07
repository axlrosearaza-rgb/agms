import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icons } from '../common';
import { semesterService } from '../../services';

// Admin dashboard: once the current semester is within 14 days of its end
// date and no next semester has been created yet, a countdown banner asks the
// Admin to create it (the backend also sends a one-time notification —
// utils/semesterEndWarning.js). Disappears as soon as the next semester exists.
const WARN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const todayPH = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

export default function SemesterEndingBanner() {
  const [info, setInfo] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    semesterService.getAll()
      .then(({ data }) => {
        const rows = data?.semesters || [];
        // Same rules as the backend check (utils/semesterEndWarning.js): the
        // running semester is the current one, else the latest Active one; a
        // "next" semester is an unfinished one that starts after it.
        const current = rows.find((s) => s.is_current)
          || rows.filter((s) => s.status === 'Active').sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')) || b.id - a.id)[0];
        if (!current?.end_date || current.status === 'Completed') return;
        const days = Math.round((Date.parse(current.end_date) - Date.parse(todayPH())) / DAY_MS);
        if (days > WARN_DAYS) return;
        const hasNext = rows.some((s) => s.id !== current.id && s.status !== 'Completed' && !s.is_current
          && (s.start_date && current.start_date ? s.start_date > current.start_date : s.id > current.id));
        if (hasNext) return;
        setInfo({ current, days });
      })
      .catch(() => {});
  }, []);

  if (!info) return null;
  const { current, days } = info;
  const when = days > 1 ? `in ${days} days` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : `${-days} day${days === -1 ? '' : 's'} ago`;
  const urgent = days <= 3;

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border px-4 py-3 mb-5 ${urgent ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
      <Icons.Clock className={`w-5 h-5 flex-shrink-0 ${urgent ? 'text-red-600' : 'text-amber-600'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${urgent ? 'text-red-900' : 'text-amber-900'}`}>
          {current.name} ends {when}
          <span className="font-normal"> ({new Date(`${current.end_date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})</span>
        </p>
        <p className={`text-xs ${urgent ? 'text-red-800' : 'text-amber-800'}`}>
          No next semester has been created yet. Create it now so classes and enrollment can be set up before this one ends.
        </p>
      </div>
      <button
        type="button"
        className="btn btn-gold text-sm whitespace-nowrap flex-shrink-0"
        onClick={() => navigate('/admin/semesters')}
      >
        <Icons.Plus className="w-4 h-4" /> Create Next Semester
      </button>
    </div>
  );
}
