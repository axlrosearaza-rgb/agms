import ProspectusTable from './ProspectusTable';

// "My Subjects Taking" on the student dashboard. Students don't declare or
// add/drop subjects themselves — they're in a class because the Faculty
// member teaching it imported the class list — so this just shows those
// classes (studentEnrollmentController.getMyEnrollment), in the same table
// as the prospectus so grades fill in as they're released.

// The prospectus rows (gradeService.getStudentProspectus's `years`) narrowed
// to just the given subjects — same Year → Semester → rows shape, so
// ProspectusTable renders it exactly like the full prospectus.
export const filterProspectusYears = (years, subjectIds) => {
  const out = {};
  Object.entries(years || {}).forEach(([yr, sems]) => {
    Object.entries(sems).forEach(([sem, rows]) => {
      const kept = rows.filter((r) => subjectIds.has(r.subject?.id));
      if (kept.length) {
        out[yr] = out[yr] || {};
        out[yr][sem] = kept;
      }
    });
  });
  return out;
};

export function SubjectsTakingSection({ enrollment, prospectusYears, headerRight = null }) {
  if (!enrollment?.semester) return null;

  const enrolled = enrollment.enrolled || [];
  const years = filterProspectusYears(prospectusYears, new Set(enrolled.map((c) => c.subject_id)));

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-navy flex items-center gap-2">
            My Subjects Taking
          </h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {enrollment.semester.name}
            {enrolled.length > 0 && ` · ${enrolled.length} subject${enrolled.length !== 1 ? 's' : ''} · ${enrollment.units} units`}
          </p>
        </div>
        {headerRight}
      </div>

      {enrolled.length === 0 ? (
        <div className="card p-6 text-center text-[13px] text-gray-400">
          You're not in any class yet this semester — you'll appear here as soon as your faculty import their class lists.
        </div>
      ) : (
        <ProspectusTable years={years} />
      )}
    </div>
  );
}
