import { useState, useEffect, useCallback } from 'react';
import { Icons, Badge, Modal, LoadingSpinner, StatCard, ConfirmDialog, ProgramDot, programShortLabel } from '../../components/common';
import { semesterService, classService } from '../../services';
import { useAuth } from '../../context/AuthContext';
import { usePageState } from '../../hooks/usePageState';
import toast from 'react-hot-toast';

const TERMS = ['First Semester', 'Second Semester', 'Summer'];

// Academic Year → Semester (term) — collapsible browsing instead of one flat
// table, same Program/Year/Section-style nesting used elsewhere in the app.
// Newest year first (a fresh year is what's actually being worked with),
// terms in their real calendar order within it.
function groupByYearTerm(list) {
  const byYear = {};
  list.forEach((s) => {
    const year = s.academic_year || 'No Academic Year';
    const term = s.term || 'No Term';
    if (!byYear[year]) byYear[year] = {};
    if (!byYear[year][term]) byYear[year][term] = [];
    byYear[year][term].push(s);
  });
  return byYear;
}

// A free-text "type the academic year yourself" field let through anything
// — "2024-25", "2024 - 2025", a stray typo — which then silently fails to
// match anywhere this exact string gets compared against later (Class.semester
// string matching, the Semester lookup archiving keys off of, etc.). A
// generated, always-consistent "YYYY-YYYY" list removes the chance of that
// entirely. Starts at 2026-2027 (this system's own starting term) and runs
// eight years ahead — no past years before it, since nothing before that
// point exists for this system to ever need — regenerated fresh each load
// so the far end never goes stale.
const ACADEMIC_YEAR_START = 2026;
const academicYearOptions = (() => {
  const years = [];
  for (let y = ACADEMIC_YEAR_START; y <= ACADEMIC_YEAR_START + 8; y++) years.push(`${y}-${y + 1}`);
  return years;
})();
// Defaults a fresh "Add Semester" straight to the year actually in progress
// right now, instead of an empty dropdown every single time — one less
// click for the overwhelmingly common case (creating THIS academic year's
// next term), while still fully editable for anything else. Clamped to
// never default earlier than the dropdown's own starting year.
const defaultYear = Math.max(ACADEMIC_YEAR_START, new Date().getFullYear());
const currentAcademicYear = `${defaultYear}-${defaultYear + 1}`;
// No `is_current` here anymore — "current" is now derived from status
// (Active ⇒ current) at save time rather than a separate manual checkbox,
// so there's nothing to default it to; see handleSave.
const emptyForm = { term: 'First Semester', academic_year: currentAcademicYear, start_date: '', end_date: '', status: 'Upcoming' };

export default function SemesterManagement() {
  const { user } = useAuth();
  // Only Admin manages semesters now — Chairpersons no longer have this page at all.
  const canManage = user?.role === 'Admin';
  const [semesters, setSemesters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editSem, setEditSem] = useState(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  // Shared confirm-warning for Delete/Set Current — same styled ConfirmDialog
  // pattern used elsewhere in the app, instead of the browser's own plain
  // window.confirm() popup.
  // "View" on a semester (Done ones especially) — everything that got
  // archived under it, pulled fresh from GET /classes?semester=<name>
  // (same endpoint the ongoing Grade Approval/Grading Sheets pages already
  // use), so this is always the live truth rather than a separate snapshot
  // that could drift from what actually got archived.
  const [viewingSemester, setViewingSemester] = useState(null);
  const [viewClasses, setViewClasses] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);
  const openView = async (sem) => {
    setViewingSemester(sem);
    setViewClasses([]);
    setViewLoading(true);
    try {
      const { data } = await classService.getAll({ semester: sem.name, limit: 200 });
      setViewClasses(data.classes || []);
    } catch (err) {
      toast.error('Failed to load this semester\'s classes');
    } finally {
      setViewLoading(false);
    }
  };

  const [confirmAction, setConfirmAction] = useState(null);
  const requestConfirm = (config) => setConfirmAction(config);
  const runConfirmedAction = async () => {
    const cfg = confirmAction;
    setConfirmAction(null);
    if (cfg?.action) await cfg.action();
  };

  const loadSemesters = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await semesterService.getAll();
      setSemesters(data.semesters || []);
    } catch (err) {
      toast.error('Failed to load semesters');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSemesters(); }, [loadSemesters]);

  const openCreate = () => {
    setEditSem(null);
    setFormData({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (sem) => {
    setEditSem(sem);
    setFormData({
      term: sem.term || 'First Semester',
      academic_year: sem.academic_year || '',
      start_date: sem.start_date || '',
      end_date: sem.end_date || '',
      status: sem.status || 'Upcoming',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.term || !formData.academic_year) {
      toast.error('Term and academic year are required');
      return;
    }
    // Nothing previously stopped an End Date sitting before the Start Date
    // from being saved — the Duration column would then just show a
    // backwards range with no indication anything was wrong. Only checked
    // when both are actually set (either can be left blank).
    if (formData.start_date && formData.end_date && new Date(formData.end_date) < new Date(formData.start_date)) {
      toast.error('End Date cannot be before Start Date');
      return;
    }

    // "Current" is no longer a separate manual checkbox — it's derived
    // straight from Status: Active IS the one in progress right now, so
    // marking a semester Active automatically makes it current (and the
    // backend's own supersession logic — see semesterController.endSemester
    // — handles retiring/archiving whichever one was current before, same
    // as it always did). Upcoming never starts out current; a Completed
    // semester being edited stays exactly whatever it already was — it's
    // not reachable from this dropdown anymore either way (see Status
    // below), so there's nothing new to derive for it here.
    const payload = { ...formData, is_current: formData.status === 'Active' };

    try {
      setSaving(true);
      if (editSem) {
        await semesterService.update(editSem.id, payload);
        toast.success('Semester updated');
      } else {
        await semesterService.create(payload);
        toast.success('Semester created');
      }
      setShowModal(false);
      setEditSem(null);
      loadSemesters();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save semester');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (sem) => {
    if (sem.is_current) {
      toast.error('Cannot delete the current semester');
      return;
    }
    requestConfirm({
      title: 'Delete Semester',
      message: `Delete ${sem.name}? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'red',
      action: async () => {
        try {
          await semesterService.delete(sem.id);
          toast.success('Semester deleted');
          loadSemesters();
        } catch (err) {
          toast.error(err.response?.data?.message || 'Failed to delete');
        }
      },
    });
  };

  const handleSetCurrent = (sem) => {
    requestConfirm({
      title: 'Set Current Semester',
      message: `Set "${sem.name}" as the current semester?`,
      confirmText: 'Set as Current',
      variant: 'gold',
      action: async () => {
        try {
          await semesterService.setCurrent(sem.id);
          toast.success(`${sem.name} is now the current semester`);
          loadSemesters();
        } catch (err) {
          toast.error('Failed to set current semester');
        }
      },
    });
  };

  const currentSem = semesters.find(s => s.is_current);
  const activeSems = semesters.filter(s => s.status === 'Active').length;
  const completedSems = semesters.filter(s => s.status === 'Completed').length;

  // Done (Completed) semesters get pulled into their own collapsible
  // container, out of the main table — same "nothing left to act on, so
  // tuck it away" treatment Chairperson's Grade Approval already gives its
  // own "Done" stage, instead of a finished semester from years ago sitting
  // mixed in with the ones still Upcoming/Active. Defaults collapsed, same
  // as every other "Done" container in this app.
  const ongoingSemesters = semesters.filter(s => s.status !== 'Completed');
  const doneSemesters = semesters.filter(s => s.status === 'Completed');
  const [doneOpen, setDoneOpen] = usePageState('SemesterManagement.doneOpen', false);
  // Academic Year / Semester collapsible groups — namespaced by idPrefix
  // ('ongoing'/'done') so the two trees toggle independently of each other.
  // Every group starts collapsed, same as every other collapsible container
  // in this app.
  const [openGroups, setOpenGroups] = usePageState('SemesterManagement.openGroups', {});
  // Takes the NEXT value explicitly rather than inverting the raw stored
  // value — the Academic Year level defaults an unset key to `true` for the
  // current year specifically (see yearOpen below), so `!prev[key]` on an
  // untouched key would invert `undefined` to `true` — the same value the
  // read side was already defaulting to — meaning the very first click on
  // that year silently did nothing.
  const toggleGroup = (key, next) => setOpenGroups((prev) => ({ ...prev, [key]: next }));

  const statusBadge = (status) => {
    const map = { Active: 'green', Completed: 'blue', Upcoming: 'orange' };
    return <Badge variant={map[status] || 'blue'}>{status}</Badge>;
  };

  // Shared between the main tree and the Done tree below — same row shape
  // either way, just a different bucket of semesters feeding it. Semester/
  // Academic Year columns dropped — they're now the group headers above
  // each row, so repeating them again per row would just be redundant.
  const renderRow = (s) => (
    <tr
      key={s.id}
      className={`border-b border-gray-50 transition-colors duration-150 ${
        s.is_current ? 'bg-green-50/30' : 'hover:bg-gray-50/50'
      }`}
    >
      <td className="px-4 py-3.5 text-xs text-gray-500">
        {s.start_date && s.end_date ? (
          <>{new Date(s.start_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })} — {new Date(s.end_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}</>
        ) : '—'}
      </td>
      <td className="px-4 py-3.5">{statusBadge(s.status)}</td>
      <td className="px-4 py-3.5">
        {s.is_current ? (
          <Badge variant="green"><Icons.Check className="w-3 h-3" /> Current</Badge>
        ) : canManage ? (
          <button onClick={() => handleSetCurrent(s)} className="text-xs text-blue-500 hover:underline cursor-pointer bg-transparent border-none font-sans">
            Set as Current
          </button>
        ) : <span className="text-xs text-gray-400">—</span>}
      </td>
      <td className="px-4 py-3.5">
        <div className="flex gap-1.5">
          {/* Everyone can look — View is read-only, not a management action,
              so it's not gated behind canManage the way Edit/Delete are. */}
          <button className="btn-icon" onClick={() => openView(s)} title="View classes & data"><Icons.Eye /></button>
          {canManage && (
            <>
              <button className="btn-icon" onClick={() => openEdit(s)} title="Edit"><Icons.Edit /></button>
              {!s.is_current && (
                <button className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => handleDelete(s)} title="Delete"><Icons.Trash /></button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );

  // Academic Year → Semester nested collapsible tree — shared by the main
  // Semesters section and the Done section below, just fed a different
  // bucket of semesters and a different idPrefix so their toggle state never
  // collides.
  const renderYearTermTree = (list, idPrefix) => {
    const byYear = groupByYearTerm(list);
    const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a));
    return years.map((year) => {
      const terms = byYear[year];
      const yearTotal = Object.values(terms).reduce((s, arr) => s + arr.length, 0);
      const yearKey = `${idPrefix}|${year}`;
      const yearOpen = !!openGroups[yearKey];
      return (
        <div key={year} className="border-b border-gray-100 last:border-0">
          <button
            onClick={() => toggleGroup(yearKey, !yearOpen)}
            className="w-full px-4 py-2.5 flex items-center justify-between border-none cursor-pointer font-sans bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-navy">Academic Year {year}</span>
              <span className="text-xs text-gray-400">{yearTotal} semester{yearTotal !== 1 ? 's' : ''}</span>
            </div>
            {yearOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
          </button>

          {yearOpen && TERMS.filter((t) => terms[t]?.length > 0).map((term) => {
            const termSemesters = terms[term];
            const termKey = `${yearKey}|${term}`;
            const termOpen = !!openGroups[termKey];
            return (
              <div key={term} className="border-t border-gray-50">
                <button
                  onClick={() => toggleGroup(termKey, !termOpen)}
                  className="w-full pl-8 pr-4 py-2 flex items-center justify-between border-none cursor-pointer font-sans bg-blue-50/30 hover:bg-blue-50/60 transition-colors"
                >
                  <span className="text-[13px] font-semibold text-blue-700">{term}</span>
                  {termOpen ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
                </button>
                {termOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500">
                          <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Duration</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Status</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Current</th>
                          <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wide">Actions</th>
                        </tr>
                      </thead>
                      <tbody>{termSemesters.map(renderRow)}</tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    });
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Semester Management</h2>
          <p className="text-[13px] text-gray-500">
            {canManage ? 'Manage academic semesters and set the current term' : 'Read-only — only the Administrator manages semesters.'}
          </p>
        </div>
        {canManage && <button className="btn btn-gold" onClick={openCreate}><Icons.Plus /> Add Semester</button>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Semesters" value={semesters.length} icon={<Icons.Book />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Current Semester" value={currentSem?.name?.split(' ').slice(0, 2).join(' ') || '—'} icon={<Icons.Award />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Active" value={activeSems} icon={<Icons.Check />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Completed" value={completedSems} icon={<Icons.Clock />} iconBg="bg-gray-50 text-gray-500" />
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          <div className="card overflow-hidden mb-5">
            <div className="card-header"><h3 className="text-base font-semibold text-navy">Semesters ({ongoingSemesters.length})</h3></div>
            {ongoingSemesters.length === 0 ? (
              <p className="text-center py-12 text-gray-400 text-sm">No Upcoming/Active semesters — see Done below.</p>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto">
                {renderYearTermTree(ongoingSemesters, 'ongoing')}
              </div>
            )}
          </div>

          {/* Done (Completed) — same collapsible "nothing left to act on"
              container Chairperson's Grade Approval already uses for its own
              Done stage, tucked away by default instead of piling up mixed
              in with Upcoming/Active semesters as more terms finish. Hidden
              entirely once there's nothing Completed yet, same as every
              other stage container that skips rendering when empty. */}
          {doneSemesters.length > 0 && (
            <div className="card overflow-hidden">
              <button
                onClick={() => setDoneOpen((o) => !o)}
                className="w-full px-5 py-3.5 flex items-center justify-between border-none cursor-pointer font-sans text-white transition-colors bg-green-500 hover:bg-green-600"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold bg-white/20 rounded-full min-w-[26px] h-[26px] px-2 flex items-center justify-center">{doneSemesters.length}</span>
                  <div className="text-left">
                    <p className="text-sm font-bold">Done</p>
                    <p className="text-[11px] text-white/75">Completed semesters — nothing left to manage here.</p>
                  </div>
                </div>
                {doneOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
              </button>

              {doneOpen && (
                <div className="max-h-[70vh] overflow-y-auto border-t border-gray-100">
                  {renderYearTermTree(doneSemesters, 'done')}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <Modal title={editSem ? `Edit — ${editSem.name}` : 'Add New Semester'} onClose={() => { setShowModal(false); setEditSem(null); }} footer={
          <>
            <button className="btn btn-outline" onClick={() => { setShowModal(false); setEditSem(null); }}>Cancel</button>
            <button className="btn btn-gold" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editSem ? 'Update' : 'Create'}</button>
          </>
        }>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Term <span className="text-red-500">*</span></label>
                <select className="form-select" value={formData.term} onChange={(e) => setFormData({ ...formData, term: e.target.value })}>
                  {TERMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Academic Year <span className="text-red-500">*</span></label>
                <select
                  className="form-select"
                  value={formData.academic_year}
                  onChange={(e) => setFormData({ ...formData, academic_year: e.target.value })}
                >
                  <option value="" disabled>Select academic year...</option>
                  {/* A semester already saved under a year outside the
                      generated range (an old data-entry typo, or just one
                      further back than the usual window) still gets its own
                      option here — editing it should never silently wipe out
                      what it actually says just because the dropdown's own
                      default range doesn't happen to cover it. */}
                  {[...new Set([...(formData.academic_year ? [formData.academic_year] : []), ...academicYearOptions])].map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Start Date</label>
                {/* `max` mirrors the toast validation in handleSave — stops
                    picking a Start Date past whatever End Date is already
                    set, instead of only catching it after Save is clicked. */}
                <input className="form-input" type="date" value={formData.start_date} max={formData.end_date || undefined} onChange={(e) => setFormData({ ...formData, start_date: e.target.value })} />
              </div>
              <div>
                <label className="form-label">End Date</label>
                <input className="form-input" type="date" value={formData.end_date} min={formData.start_date || undefined} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />
              </div>
            </div>
            <div>
              {/* Completed is deliberately not a pickable option — it's
                  never something to set by hand anymore, only something
                  that happens automatically when a semester gets superseded
                  or explicitly ended (see semesterController.endSemester,
                  which also archives its classes and notifies everyone —
                  a manual dropdown pick here would skip all of that). If a
                  Completed semester is being edited anyway, its own value
                  still shows correctly rather than snapping to Upcoming. */}
              <label className="form-label">Status</label>
              <select className="form-select" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })}>
                <option>Upcoming</option>
                <option>Active</option>
                {formData.status === 'Completed' && <option>Completed</option>}
              </select>
              {/* "Current" used to be its own checkbox here — now it's just
                  a direct consequence of Status, explained inline instead
                  of asked for separately. */}
              <p className="text-xs text-gray-400 mt-1.5">
                {formData.status === 'Active'
                  ? 'Active semesters automatically become the current one — the previous current semester ends and its classes archive.'
                  : 'Only an Active semester can be current.'}
              </p>
            </div>
          </div>
        </Modal>
      )}

      {/* VIEW — a summary of everything under one semester, grouped by
          Program → Year → Section, pulled fresh from GET
          /classes?semester=<name> rather than a separate snapshot. Counts
          only, not a full class-by-class listing — this is meant to answer
          "how much was there and where," not stand in for the actual
          per-class Archived tabs (My Classes/Grading Sheets/Grade Approval)
          that already exist for opening a specific class's own records. */}
      {viewingSemester && (() => {
        const byProgram = {};
        viewClasses.forEach((c) => {
          const program = c.subject?.program || 'No Program';
          const year = c.year_level ?? '—';
          const section = c.section || 'No Section';
          if (!byProgram[program]) byProgram[program] = {};
          if (!byProgram[program][year]) byProgram[program][year] = {};
          if (!byProgram[program][year][section]) byProgram[program][year][section] = 0;
          byProgram[program][year][section] += 1;
        });
        const programs = Object.keys(byProgram).sort((a, b) => a.localeCompare(b));
        const totalStudents = viewClasses.reduce((s, c) => s + (c.student_count || 0), 0);
        // "Archived" only actually describes a Completed semester — an
        // Upcoming/Active one still showing here (View is open to all
        // semesters, not just Done ones) gets the plain, accurate label
        // instead of implying it's been retired when it hasn't.
        const isArchived = viewingSemester.status === 'Completed';
        return (
          <Modal
            title={`${isArchived ? 'Archived' : 'Classes'} — ${viewingSemester.name}`}
            onClose={() => { setViewingSemester(null); setViewClasses([]); }}
            size="max-w-2xl"
          >
            {viewLoading ? (
              <LoadingSpinner />
            ) : viewClasses.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">No classes were ever created under this semester.</p>
            ) : (
              <div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                  <StatCard label="Classes" value={viewClasses.length} icon={<Icons.Book />} iconBg="bg-blue-50 text-blue-500" />
                  <StatCard label="Total Enrollments" value={totalStudents} icon={<Icons.Users />} iconBg="bg-green-50 text-green-500" />
                  <StatCard label="Programs" value={programs.length} icon={<Icons.Award />} iconBg="bg-purple-50 text-purple-500" />
                </div>

                <div className="border border-gray-100 rounded-lg overflow-hidden">
                  {programs.map((program) => {
                    const years = byProgram[program];
                    const yearKeys = Object.keys(years).sort((a, b) => (a === '—' ? 1 : b === '—' ? -1 : a - b));
                    const programTotal = Object.values(years).reduce((s, secs) => s + Object.values(secs).reduce((s2, n) => s2 + n, 0), 0);
                    return (
                      <div key={program} className="border-b border-gray-100 last:border-0">
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-50">
                          {program !== 'No Program' && <ProgramDot program={program} />}
                          <h4 className="text-xs font-bold text-navy uppercase tracking-wide">
                            {program === 'No Program' ? program : programShortLabel(program)}
                          </h4>
                          <span className="text-[11px] text-gray-400">{programTotal} class{programTotal !== 1 ? 'es' : ''}</span>
                        </div>
                        {yearKeys.map((year) => {
                          const sections = years[year];
                          const sectionKeys = Object.keys(sections).sort();
                          return (
                            <div key={year} className="px-3 py-1.5 pl-8 flex items-center justify-between text-xs border-t border-gray-50">
                              <span className="font-medium text-blue-700">{year === '—' ? 'No Year Level' : `Year ${year}`}</span>
                              <span className="text-gray-400">
                                {sectionKeys.map((s) => `${s === 'No Section' ? s : `Sec ${s}`} (${sections[s]})`).join(' · ')}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Modal>
        );
      })()}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.title}
          message={confirmAction.message}
          confirmText={confirmAction.confirmText}
          variant={confirmAction.variant}
          onConfirm={runConfirmedAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}