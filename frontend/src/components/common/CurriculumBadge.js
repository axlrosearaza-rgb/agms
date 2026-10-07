// Which curriculum a subject belongs to — "2023 Curriculum · New" / "2018
// Curriculum · Old". Subject.curriculum_year holds the year; New vs Old is
// worked out here: within a program, the latest curriculum year is New and
// every earlier one is Old (so a newer curriculum retires the previous one
// without anyone editing the old subjects).

const yearOf = (cy) => parseInt(String(cy || '').slice(0, 4), 10) || 0;

// program → its latest curriculum year, from a list of subjects.
export const latestCurriculumByProgram = (subjects = []) => {
  const latest = {};
  subjects.forEach((s) => {
    if (!s.curriculum_year) return;
    const key = s.program || '';
    if (!latest[key] || yearOf(s.curriculum_year) > yearOf(latest[key])) latest[key] = s.curriculum_year;
  });
  return latest;
};

export const curriculumStatus = (subject, latestByProgram) => {
  if (!subject?.curriculum_year) return null;
  const latest = latestByProgram?.[subject.program || ''];
  return latest && yearOf(subject.curriculum_year) >= yearOf(latest) ? 'New' : 'Old';
};

// Every curriculum year present, newest first (for filters and suggestions).
export const curriculumYears = (subjects = []) => [...new Set(subjects.map((s) => s.curriculum_year).filter(Boolean))]
  .sort((a, b) => yearOf(b) - yearOf(a) || String(b).localeCompare(String(a)));

export default function CurriculumBadge({ subject, latestByProgram, className = '' }) {
  if (!subject?.curriculum_year) {
    return <span className={`inline-flex items-center text-[10px] font-medium text-gray-400 border border-dashed border-gray-300 rounded-full px-2 py-0.5 whitespace-nowrap ${className}`}>No curriculum set</span>;
  }
  const status = curriculumStatus(subject, latestByProgram);
  const isNew = status === 'New';
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap border ${isNew ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'} ${className}`}
      title={isNew ? 'Current curriculum for this program' : 'An earlier curriculum for this program'}
    >
      {subject.curriculum_year} Curriculum · {status}
    </span>
  );
}
