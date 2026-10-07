import { useEffect, useState } from 'react';
import { Icons } from '../common';
import { semesterService } from '../../services';

// Faculty dashboard: from 30 days before the running semester ends, a
// countdown reminds the instructor to submit the classes they haven't sent to
// their Chairperson yet (the backend also sends a one-time notification —
// utils/semesterEndWarning.js). Gone once every class is submitted.
const WARN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const todayPH = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

export default function GradeDeadlineBanner({ classes = [], onOpenClasses }) {
  const [semester, setSemester] = useState(null);

  useEffect(() => {
    semesterService.getAll()
      .then(({ data }) => {
        const rows = data?.semesters || [];
        // Same "running semester" rule as the backend check.
        const current = rows.find((s) => s.is_current)
          || rows.filter((s) => s.status === 'Active').sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')) || b.id - a.id)[0];
        if (current?.end_date && current.status !== 'Completed') setSemester(current);
      })
      .catch(() => {});
  }, []);

  if (!semester) return null;
  const days = Math.round((Date.parse(semester.end_date) - Date.parse(todayPH())) / DAY_MS);
  if (days > WARN_DAYS) return null;
  const pending = classes.filter((c) => c.semester === semester.name && (c.status || 'Active') === 'Active' &&!c.sent_to_chairperson);
  if (pending.length === 0) return null;

  const when = days > 1 ? `in ${days} days` : days === 1 ? 'tomorrow' : days === 0 ? 'today' : `${-days} day${days === -1 ? '' : 's'} ago`;
  const urgent = days <= 7;

  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border px-4 py-3 mb-5 ${urgent ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
      <Icons.Clock className={`w-5 h-5 flex-shrink-0 ${urgent ? 'text-red-600' : 'text-amber-600'}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-bold ${urgent ? 'text-red-900' : 'text-amber-900'}`}>
          {semester.name} {days < 0 ? 'ended' : 'ends'} {when}
          <span className="font-normal"> ({new Date(`${semester.end_date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })})</span>
        </p>
        <p className={`text-xs ${urgent ? 'text-red-800' : 'text-amber-800'}`}>
          You still have {pending.length} class{pending.length !== 1 ? 'es' : ''} to submit to your Chairperson
          ({pending.slice(0, 4).map((c) => `${c.subject?.code || 'Class'}${c.section ? ` ${c.year_level || ''}-${c.section}` : ''}`).join(', ')}{pending.length > 4 ? ', …' : ''}).
          Finish encoding and submit the grades before the semester ends.
        </p>
      </div>
      {onOpenClasses && (
        <button type="button" className="btn btn-gold text-sm whitespace-nowrap flex-shrink-0" onClick={onOpenClasses}>
          <Icons.Book className="w-4 h-4" /> Go to My Classes
        </button>
      )}
    </div>
  );
}
