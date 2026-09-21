import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Icons, Avatar, Badge, StatCard, LoadingSpinner, ConfidentialityBanner, CurrentSemesterTag, StudentTypeBadge, RegularityBadge, studentYearSectionsLabel, studentCurrentYearSectionLabel, ConfirmDialog } from '../../components/common';
import ProspectusTable, { YEAR_LABEL, SEM_LABEL } from '../../components/student/ProspectusTable';
import { gradeService, subjectService, userService } from '../../services';
import API from '../../services/api';
import socket from '../../services/socket';
import toast from 'react-hot-toast';

// Semester.term ("First Semester"/"Second Semester"/"Summer") vs. the format
// Subject.semester actually stores ("1st Semester"/"2nd Semester"/"Summer") —
// same mismatch ProspectusTable's own SEM_LABEL works around, just the
// reverse direction here (term -> subject label instead of label -> display text).
const TERM_TO_SUBJECT_SEMESTER = { 'First Semester': '1st Semester', 'Second Semester': '2nd Semester', 'Summer': 'Summer' };

// Irregular students only — offers every subject in the student's back Years
// (irregular_sections minus whichever pair is marked `is_current` — that
// one's their normal, already-on-track coursework, not a back subject) from
// the program's subject catalog, for the CURRENT semester. NOT scoped to only
// subjects with a 'Failed' grade already on file — an Irregular student very
// often doesn't start at 1st Year at all (transferee/shifter credits, back
// subjects never taken in this system in the first place), so there's
// frequently no prospectus record to filter against. The student instead
// picks for themselves which of these they've actually failed and still need
// to clear — a PARTIAL pick is expected and fine, since not every subject
// listed was necessarily failed; only at least one subject needs to be
// checked to save. Grouped into per-Year dropdown/expand sections (same
// accordion pattern as ProspectusTable). The backend
// (userController.setRegularizationSubjects) stamps regularization_locked_at
// on that first save and rejects any save after, so what's shown becomes
// read-only once saved. Once every subject on the (now-locked) list has a
// released Passed grade, gradeController.checkAndRegularizeStudent flips
// student_status back to Regular on its own — nothing left to confirm then.
function RegularizationSubjectsPanel({ user, prospectusYears, onSaved }) {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);
  // Only the CURRENT semester's subjects are offered — same current-semester
  // record CurrentSemesterTag surfaces elsewhere (Semester.is_current) — one
  // semester at a time, not both 1st and 2nd lumped together.
  const [currentSemesterLabel, setCurrentSemesterLabel] = useState(null);

  const isLocked = !!user.regularization_locked_at;

  // Every Year+Section pair the student is actually enrolled under. One of
  // them is marked `is_current` at registration — the Year they're normally
  // progressing through, as opposed to a back subject they're retaking — so
  // it's excluded here: Path to Regular Status is only about clearing the
  // back subjects, not the student's already-on-track current coursework.
  // Older accounts registered before this distinction existed have no
  // `is_current` on any pair — fall back to treating every checked Year as a
  // back subject for those, same as this panel always did.
  const myPairs = user.irregular_sections || [];
  const hasCurrentMarked = myPairs.some((p) => p.is_current);
  const backPairs = hasCurrentMarked ? myPairs.filter((p) => !p.is_current) : myPairs;
  const myYears = [...new Set(backPairs.map((p) => p.year_level))].sort((a, b) => a - b);

  const [selected, setSelected] = useState(new Set(user.regularization_subjects || []));
  // Collapsed by default on open — the student expands whichever Year they
  // want to review instead of the panel dumping every subject on load.
  const [expandedYears, setExpandedYears] = useState(() => new Set());
  const toggleYearOpen = (yr) => setExpandedYears((prev) => {
    const next = new Set(prev);
    next.has(yr) ? next.delete(yr) : next.add(yr);
    return next;
  });

  useEffect(() => {
    Promise.all([
      subjectService.getAll({ program: user.program }),
      API.get('/semesters/public/current'),
    ])
      .then(([{ data: subjectData }, { data: semData }]) => {
        setSubjects(subjectData.subjects || []);
        setCurrentSemesterLabel(TERM_TO_SUBJECT_SEMESTER[semData.semester?.term] || null);
      })
      .catch(() => toast.error('Failed to load subjects'))
      .finally(() => setLoading(false));
  }, [user.program]);

  const toggle = (id) => {
    if (isLocked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Scope the catalog to the student's own back Year(s), AND — while still
  // unlocked — to the CURRENT semester only, one at a time instead of both
  // 1st and 2nd Semester lumped together.
  const pickableSubjects = subjects.filter((s) =>
    myYears.includes(s.year_level) &&
    (!currentSemesterLabel || s.semester === currentSemesterLabel),
  );
  // A partial pick is the expected case — the student only checks the
  // subjects they've actually failed, not everything listed — so the only
  // requirement is picking at least one.
  // Just opens the confirm step — the real save (doSave below) only runs
  // once the student explicitly confirms, since this locks permanently
  // (isLocked/regularization_locked_at) the moment it succeeds.
  const handleSave = () => {
    if (selected.size === 0) {
      toast.error('Please select at least one subject you\'ve failed before saving.');
      return;
    }
    setConfirmSave(true);
  };

  const doSave = async () => {
    setConfirmSave(false);
    setSaving(true);
    try {
      const ids = Array.from(selected);
      await userService.setRegularizationSubjects(user.id, ids);
      toast.success('Subject selection saved — this can no longer be changed.');
      onSaved(ids);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save regularization subjects');
    } finally {
      setSaving(false);
    }
  };

  // Once locked, ignore the semester filter (whatever was actually saved
  // stays visible even after the term rolls over) and show exactly the
  // subjects the student committed to — not the full back-Year catalog —
  // each cross-referenced against their own live prospectus (same source
  // ProspectusTable/My Grades reads) so a subject they've since passed shows
  // as cleared instead of sitting there looking unfinished forever.
  const gradeStatusBySubject = {};
  Object.values(prospectusYears || {}).forEach((semesters) => {
    Object.values(semesters).forEach((rows) => {
      rows.forEach((r) => { gradeStatusBySubject[r.subject.id] = r.status; });
    });
  });
  const lockedSubjects = isLocked
    ? subjects.filter((s) => (user.regularization_subjects || []).includes(s.id))
    : [];
  const clearedCount = lockedSubjects.filter((s) => gradeStatusBySubject[s.id] === 'Passed').length;

  const scopedSubjects = isLocked ? lockedSubjects : pickableSubjects;

  const byYear = {};
  scopedSubjects.forEach((s) => {
    const yr = s.year_level;
    const sem = s.semester || 'Other';
    byYear[yr] = byYear[yr] || {};
    byYear[yr][sem] = byYear[yr][sem] || [];
    byYear[yr][sem].push(s);
  });

  return (
    <div className="card mb-6">
      <div className="card-header">
        <h3 className="text-base font-semibold text-navy">Path to Regular Status</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          {isLocked
            ? 'Saved — once you have a released Passed grade in every checked subject, you\'ll automatically return to Regular status.'
            : `Only check off the subjects you've actually failed in your back Year(s)${currentSemesterLabel ? ` for ${currentSemesterLabel}` : ''} — the rest don't need to be selected. Save once, it can't be changed afterward.`}
        </p>
      </div>
      <div className="card-body">
        {loading ? (
          <LoadingSpinner />
        ) : myPairs.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">No Year/Section on file yet — contact your Chairperson.</p>
        ) : backPairs.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">You have no back subjects to clear — just your current Year's normal coursework.</p>
        ) : scopedSubjects.length === 0 ? (
          <p className="text-center py-8 text-gray-400 text-sm">
            {currentSemesterLabel
              ? `No subjects found for your back Year(s) this ${currentSemesterLabel}.`
              : 'No subjects found for your back Year(s).'}
          </p>
        ) : (
          <>
            {isLocked && (
              <div className="flex items-center gap-2 mb-3 text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                <Icons.Lock className="w-3.5 h-3.5 flex-shrink-0" />
                {clearedCount === lockedSubjects.length
                  ? `All ${lockedSubjects.length} subject(s) cleared — you'll return to Regular status shortly.`
                  : `${clearedCount}/${lockedSubjects.length} cleared — locked in on ${new Date(user.regularization_locked_at).toLocaleDateString()}, can't be changed.`}
              </div>
            )}
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {myYears.filter((yr) => byYear[yr]).map((yr) => {
                const semesters = Object.keys(byYear[yr] || {}).sort();
                const yearSubjects = semesters.flatMap((sem) => byYear[yr][sem]);
                const yearCount = isLocked
                  ? yearSubjects.filter((s) => gradeStatusBySubject[s.id] === 'Passed').length
                  : yearSubjects.filter((s) => selected.has(s.id)).length;
                const isOpen = expandedYears.has(yr);
                return (
                  <div key={yr} className="border border-gray-100 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleYearOpen(yr)}
                      className="w-full px-4 py-2.5 bg-navy text-white flex items-center justify-between border-none font-sans cursor-pointer"
                    >
                      <h4 className="text-xs font-bold tracking-wide">YEAR {yr}</h4>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] opacity-70">{yearCount}/{yearSubjects.length} {isLocked ? 'cleared' : 'selected'}</span>
                        {isOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
                      </div>
                    </button>
                    {isOpen && (
                      <div className="p-2 space-y-3">
                        {semesters.map((sem) => (
                          <div key={sem}>
                            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide px-2 mb-1">{sem}</p>
                            <div className="space-y-0.5">
                              {byYear[yr][sem].map((sub) => {
                                if (isLocked) {
                                  const isCleared = gradeStatusBySubject[sub.id] === 'Passed';
                                  return (
                                    <div key={sub.id} className="flex items-center gap-3 p-2 rounded-lg">
                                      {isCleared
                                        ? <Icons.Check className="w-4 h-4 flex-shrink-0 text-emerald-500" />
                                        : <Icons.Clock className="w-4 h-4 flex-shrink-0 text-amber-500" />}
                                      <span className={`text-sm truncate ${isCleared ? 'text-gray-400 line-through' : 'text-navy'}`}>
                                        <span className="font-semibold">{sub.code}</span> — {sub.name}
                                      </span>
                                      {isCleared && <Badge variant="green" className="flex-shrink-0 ml-auto">Cleared</Badge>}
                                    </div>
                                  );
                                }
                                const isChecked = selected.has(sub.id);
                                return (
                                  <label
                                    key={sub.id}
                                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      className="w-4 h-4 flex-shrink-0"
                                      checked={isChecked}
                                      onChange={() => toggle(sub.id)}
                                    />
                                    <span className="text-sm truncate text-navy">
                                      <span className="font-semibold">{sub.code}</span> — {sub.name}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!isLocked && (
              <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
                <p className="text-xs text-gray-400">
                  {selected.size} subject{selected.size !== 1 ? 's' : ''} selected — only check the ones you've actually failed.
                </p>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : <><Icons.Save className="w-4 h-4" /> Save — Can't Be Undone</>}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {confirmSave && (
        <ConfirmDialog
          title="Save subject selection?"
          message={`You're marking ${selected.size} subject${selected.size !== 1 ? 's' : ''} as failed back subjects. Once saved, this selection can no longer be changed — double check it's correct before confirming.`}
          confirmText="Save"
          variant="red"
          confirmDisabled={saving}
          onConfirm={doSave}
          onCancel={() => setConfirmSave(false)}
        />
      )}
    </div>
  );
}

// Dashboard shows the prospectus version of the student's grades — the full
// curriculum, collapsed by Year, with their own year opened by default so the
// most relevant section is visible without digging. Full detail + search
// lives on My Grades (StudentGrades.js), which reuses the same ProspectusTable.
//
// Promotion itself is Admin's call (Promotion Management) — a self-service
// "Promote Me" version of this page was tried and then deliberately
// reverted, so there's nothing promotion-related here anymore.
export default function StudentDashboard() {
  const { user, updateUser, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // The Dashboard only ever shows the ONE year+semester the student is
  // actually taking right now — the full multi-year curriculum (with
  // search) lives on My Grades (StudentGrades.js), which reuses this same
  // ProspectusTable unfiltered. Fetched the same way CurrentSemesterTag
  // gets its own term, converted through the same Semester.term ("First
  // Semester") -> Subject.semester ("1st Semester") mapping
  // RegularizationSubjectsPanel below already uses.
  const [currentSemesterLabel, setCurrentSemesterLabel] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const { data: result } = await gradeService.getStudentProspectus(user.id);
      setData(result);
    } catch (err) {
      console.error('Error loading student prospectus:', err);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    API.get('/semesters/public/current')
      .then(({ data: semData }) => {
        setCurrentSemesterLabel(TERM_TO_SUBJECT_SEMESTER[semData.semester?.term] || null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // A grade release can be the exact moment gradeController.checkAndRegularizeStudent
    // auto-flips an Irregular student back to Regular server-side — refreshUser()
    // re-pulls the account so that shows up here (hero badge, Path to Regular
    // Status disappearing) without the student needing to log out and back in.
    const handler = () => { fetchData(); refreshUser(); };
    socket.on('gradesUpdated', handler);
    return () => socket.off('gradesUpdated', handler);
  }, [fetchData, refreshUser]);

  if (loading) return <LoadingSpinner />;

  const summary = data?.summary || {};

  // Same "where the student is right now" pair studentCurrentYearSectionLabel
  // shows in the hero above (the is_current-marked pair for an Irregular
  // student, else their plain year_level) — just the bare year number here,
  // for filtering the prospectus down to it.
  const currentYear = (user?.student_status === 'Irregular' && user?.irregular_sections?.length)
    ? (user.irregular_sections.find((p) => p.is_current) || user.irregular_sections[0]).year_level
    : user?.year_level;
  const currentYearSemesters = data?.years?.[currentYear];
  const currentSemesterRows = currentSemesterLabel ? currentYearSemesters?.[currentSemesterLabel] : null;
  // Only ever the current year/semester leaf — never the whole `years` tree —
  // so ProspectusTable renders exactly one Year container with exactly one
  // semester's subjects, not all four years collapsed underneath it.
  const currentYearOnly = currentYear && currentSemesterRows?.length
    ? { [currentYear]: { [currentSemesterLabel]: currentSemesterRows } }
    : {};

  return (
    <>
      {/* HERO */}
      <div className="bg-gradient-to-r from-navy-dark via-navy to-navy-light rounded-xl p-7 text-white flex flex-col md:flex-row items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-5">
          <Avatar
            letter={user?.avatar || user?.name?.[0]}
            className="bg-gold text-white border-[3px] border-white/30 flex-none"
            size="w-16 h-16 text-2xl"
          />
          <div className="flex flex-col">
            {/* The badges' own default palette (light bg + dark text) is
                meant for a white card background — on this dark navy hero it
                needs an explicit override, same as CurrentSemesterTag below,
                or it renders unreadable/invisible against the gradient. */}
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-2xl font-bold leading-none">{user?.name}</h2>
              <RegularityBadge status={user?.student_status} className="!bg-white/15 !text-white !border !border-white/25" />
              <StudentTypeBadge status={user?.student_type} className="!bg-white/15 !text-white !border !border-white/25" />
            </div>
            <p className="text-sm opacity-80 mt-1.5">{user?.student_no}</p>
            {/* Current Year + Section front and center — this is "where the
                student is right now" (studentCurrentYearSectionLabel), the
                one thing every student, Regular or Irregular, actually wants
                to see at a glance. An Irregular student's other Year+Section
                pairs (their back subjects) are still there too, just as
                smaller secondary text underneath instead of competing with
                this for top billing. */}
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <span className="inline-flex items-center gap-1 text-xs font-semibold bg-white/15 px-2.5 py-1 rounded-full">
                <Icons.Book className="w-3 h-3" />
                {studentCurrentYearSectionLabel(user)}
              </span>
              <CurrentSemesterTag className="!bg-white/10 !text-white" />
            </div>
            {user?.student_status === 'Irregular' && user?.irregular_sections?.length > 1 && (() => {
              // Same fallback studentCurrentYearSectionLabel uses — legacy
              // accounts with no is_current on any pair treat the first as
              // "current" too, so it's excluded here the same way.
              const hasCurrentMarked = user.irregular_sections.some((p) => p.is_current);
              const others = hasCurrentMarked
                ? user.irregular_sections.filter((p) => !p.is_current)
                : user.irregular_sections.slice(1);
              if (others.length === 0) return null;
              const label = others
                .slice()
                .sort((a, b) => (a.year_level || 0) - (b.year_level || 0))
                .map((p) => `Year ${p.year_level}${p.section ? ` · Sec ${p.section}` : ''}`)
                .join(', ');
              return <p className="text-[11px] opacity-60 mt-1">Back subjects: {label}</p>;
            })()}
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 flex-none self-center">
          <div className="w-20 h-20 rounded-full bg-gold flex items-center justify-center flex-none">
            <span className="text-xl font-bold">{summary.gwa || '—'}</span>
          </div>
          <p className="text-xs">Overall GWA</p>
        </div>
      </div>

      <ConfidentialityBanner />

      {user?.student_status === 'Irregular' && (
        <RegularizationSubjectsPanel
          user={user}
          prospectusYears={data?.years}
          onSaved={(ids) => updateUser({ regularization_subjects: ids, regularization_locked_at: new Date().toISOString() })}
        />
      )}

      {/* STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Passed" value={summary.passed || 0} valueClass="text-green-500" />
        <StatCard label="Failed" value={summary.failed || 0} valueClass="text-red-500" />
        <StatCard label="In Progress" value={summary.in_progress || 0} valueClass="text-blue-500" />
        <StatCard label="Not Taken Yet" value={summary.not_taken || 0} valueClass="text-gray-400" />
      </div>

      {/* PROSPECTUS — just the one year+semester the student is actually
          taking right now, not the whole four-year curriculum (that stays
          on My Grades, reachable from the link below). */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-navy">My Prospectus</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            {currentSemesterLabel ? `${SEM_LABEL[currentSemesterLabel] || currentSemesterLabel} · ` : ''}
            {YEAR_LABEL[currentYear] || `Year ${currentYear ?? '—'}`}
          </p>
        </div>
        <button
          className="text-sm text-gold font-medium cursor-pointer bg-transparent border-none"
          onClick={() => navigate('/student/grades')}
        >
          View Full Prospectus →
        </button>
      </div>
      <ProspectusTable
        years={currentYearOnly}
        studentId={user.id}
      />
    </>
  );
}
