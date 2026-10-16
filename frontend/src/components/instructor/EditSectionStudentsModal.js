import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, Icons, SearchBar, ConfirmDialog, compareStudentNames } from '../common';
import { userService } from '../../services';

// The adviser double-checks the students imported into one advisory section
// and corrects them in one place — name, Student ID Number, Regular/Irregular
// and student type, or moves a student imported into the wrong section to
// another of their own advisory sections, or removes a student who doesn't
// belong in it (taken out of the section only — the account, grades and class
// enrollments stay). Only the rows that changed are saved. The email stays the
// student's own (they verify it themselves).
const STUDENT_TYPES = [
  { value: 'New', label: 'New Student' },
  { value: 'Old', label: 'Old Student' },
  { value: 'Shifter', label: 'Shifter' },
  { value: 'Transferee', label: 'Transferee' },
  { value: 'Quitter', label: 'Returnee' },
];

const sectionKey = (a) => `${a.program}|${a.year_level}|${a.section}`;
const rowOf = (s) => ({
  name: s.name || '',
  student_no: s.student_no || '',
  student_status: s.student_status === 'Irregular' ? 'Irregular' : 'Regular',
  student_type: s.student_type || 'New',
  advisory: sectionKey(s),
  remove: false,
});
const FIELDS = ['name', 'student_no', 'student_status', 'student_type', 'advisory', 'remove'];
const plural = (n, word) => `${n} ${word}${n !== 1 ? 's' : ''}`;

export default function EditSectionStudentsModal({ section, students, advisories = [], sectionLabel, onClose, onSaved }) {
  const sortedStudents = useMemo(() => students.slice().sort(compareStudentNames), [students]);
  const original = useMemo(() => Object.fromEntries(sortedStudents.map((s) => [s.id, rowOf(s)])), [sortedStudents]);
  const [rows, setRows] = useState(original);
  const [errors, setErrors] = useState({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const canMove = advisories.length > 1;

  const isChanged = (id) => FIELDS.some((f) => rows[id][f] !== original[id][f]);
  const changedIds = sortedStudents.map((s) => s.id).filter(isChanged);
  const set = (id, key) => (e) => {
    const value = e.target.value;
    setRows((r) => ({ ...r, [id]: { ...r[id], [key]: value } }));
    setErrors((er) => { if (!er[id]) return er; const { [id]: _, ...rest } = er; return rest; });
  };
  const undo = (id) => setRows((r) => ({ ...r, [id]: original[id] }));
  const markRemoved = (id) => setRows((r) => ({ ...r, [id]: { ...original[id], remove: true } }));
  const removeIds = changedIds.filter((id) => rows[id].remove);
  const editIds = changedIds.filter((id) => !rows[id].remove);

  const q = search.trim().toLowerCase();
  const visible = sortedStudents.filter((s) => !q || rows[s.id].name.toLowerCase().includes(q) || rows[s.id].student_no.includes(q));

  const save = async (confirmed = false) => {
    const missing = editIds.find((id) => !rows[id].name.trim() || !rows[id].student_no.trim());
    if (missing) return toast.error('Every student needs a name and a Student ID Number.');
    if (removeIds.length && !confirmed) return setConfirmRemove(true);
    setConfirmRemove(false);
    setSaving(true);
    const failed = {};
    let saved = 0;
    // One at a time, so a duplicate Student ID Number is reported on its own row.
    for (const id of changedIds) {
      const { advisory, remove, ...changes } = rows[id];
      if (remove) {
        try {
          await userService.updateAdvisee(id, { remove_from_section: true });
          saved += 1;
        } catch (err) {
          failed[id] = err.response?.data?.message || 'Could not be removed';
        }
        continue;
      }
      if (canMove && advisory !== original[id].advisory) {
        const [program, year_level, sec] = advisory.split('|');
        Object.assign(changes, { program, year_level: Number(year_level), section: sec });
      }
      try {
        await userService.updateAdvisee(id, changes);
        saved += 1;
      } catch (err) {
        failed[id] = err.response?.data?.message || 'Could not be saved';
      }
    }
    setSaving(false);
    if (saved) onSaved?.();
    if (Object.keys(failed).length) {
      setErrors(failed);
      toast.error(`${Object.keys(failed).length} student${Object.keys(failed).length !== 1 ? 's' : ''} could not be saved — see the rows marked in red.`);
      return;
    }
    const parts = [editIds.length && `${plural(editIds.length, 'student')} updated`, removeIds.length && `${plural(removeIds.length, 'student')} removed from the section`].filter(Boolean);
    toast.success(parts.length ? `${parts.join(', ')}.` : 'Nothing to change.');
    onClose();
  };

  return (
    <Modal
      title={`Edit Students — ${sectionLabel}`}
      onClose={saving ? undefined : onClose}
      size="max-w-6xl"
      closeOnBackdropClick={false}
      footer={(
        <>
          <span className="mr-auto text-xs text-gray-500">
            {changedIds.length === 0 ? 'No changes yet' : (
              <>
                {editIds.length > 0 && plural(editIds.length, 'student') + ' changed'}
                {editIds.length > 0 && removeIds.length > 0 && ' · '}
                {removeIds.length > 0 && <span className="text-red-600 font-semibold">{plural(removeIds.length, 'student')} to remove</span>}
              </>
            )}
          </span>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => save()} disabled={saving || changedIds.length === 0}>
            <Icons.Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-[12px] text-gray-500 max-w-xl">
          Check the {sortedStudents.length} imported student{sortedStudents.length !== 1 ? 's' : ''} against the class list and correct anything that is wrong. Changed rows are highlighted; only those are saved and recorded in the section's history. Use Remove for a student who doesn't belong in this section — they are only taken out of the section; their account and grades are kept. Only the student can change their email.
        </p>
        <div className="w-full sm:w-64 flex">
          <SearchBar value={search} onChange={setSearch} placeholder="Search name or student no..." />
        </div>
      </div>
      <div className="overflow-auto max-h-[60vh] border border-gray-100 rounded-lg">
        <table className="w-full min-w-[900px]">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr className="text-gray-500 text-[11px] font-semibold uppercase tracking-wider">
              <th className="pl-3 pr-1 py-2 text-right w-10">#</th>
              <th className="px-2 py-2 text-left">Student Full Name</th>
              <th className="px-2 py-2 text-left w-[140px]">Student ID No.</th>
              <th className="px-2 py-2 text-left w-[130px]">Status</th>
              <th className="px-2 py-2 text-left w-[150px]">Student Type</th>
              {canMove && <th className="px-2 py-2 text-left w-[170px]">Section</th>}
              <th className="px-2 py-2 w-[120px]" />
            </tr>
          </thead>
          <tbody>
            {visible.map((s, idx) => {
              const r = rows[s.id];
              const changed = isChanged(s.id);
              const error = errors[s.id];
              const off = r.remove || saving;
              return (
                <tr key={s.id} className={`border-t border-gray-100 align-top ${error ? 'bg-red-50/70' : r.remove ? 'bg-red-50/60 [&_input]:line-through [&_input]:text-gray-400 [&_select]:text-gray-400' : changed ? 'bg-amber-50/70' : ''}`}>
                  <td className="pl-3 pr-1 py-2 text-xs text-gray-400 text-right pt-3.5">{idx + 1}.</td>
                  <td className="px-2 py-2">
                    <input disabled={off} className="form-input !py-1.5 text-[13px]" value={r.name} onChange={set(s.id, 'name')} placeholder="DELA CRUZ, Juan M." />
                    {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
                  </td>
                  <td className="px-2 py-2">
                    <input disabled={off} className="form-input !py-1.5 text-[13px] font-mono" value={r.student_no} onChange={set(s.id, 'student_no')} />
                  </td>
                  <td className="px-2 py-2">
                    <select disabled={off} className="form-select !py-1.5 text-[13px]" value={r.student_status} onChange={set(s.id, 'student_status')}>
                      <option value="Regular">Regular</option>
                      <option value="Irregular">Irregular</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select disabled={off} className="form-select !py-1.5 text-[13px]" value={r.student_type} onChange={set(s.id, 'student_type')}>
                      {STUDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </td>
                  {canMove && (
                    <td className="px-2 py-2">
                      <select disabled={off} className="form-select !py-1.5 text-[13px]" value={r.advisory} onChange={set(s.id, 'advisory')}>
                        {advisories.map((a) => (
                          <option key={sectionKey(a)} value={sectionKey(a)}>Year {a.year_level} · Section {a.section}</option>
                        ))}
                      </select>
                    </td>
                  )}
                  <td className="px-2 py-2 pt-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {r.remove ? (
                        <>
                          <span className="text-[11px] font-semibold text-red-600 whitespace-nowrap">To remove</span>
                          <button type="button" className="btn-icon" onClick={() => undo(s.id)} title="Keep this student in the section" disabled={saving}>
                            <Icons.X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          {changed && (
                            <button type="button" className="btn-icon" onClick={() => undo(s.id)} title="Undo this row's changes" disabled={saving}>
                              <Icons.X className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button type="button" className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => markRemoved(s.id)} title="Remove this student from the section" disabled={saving}>
                            <Icons.Trash className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={canMove ? 7 : 6} className="text-center text-[13px] text-gray-400 py-6">No matching students.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title={`Remove ${plural(removeIds.length, 'student')} from ${sectionLabel}?`}
          message={`${removeIds.map((id) => rows[id].name).slice(0, 5).join('; ')}${removeIds.length > 5 ? ` and ${removeIds.length - 5} more` : ''} will be taken out of this section. Nothing is deleted — their accounts, grades and classes are kept, and re-importing the class list brings them back.${editIds.length ? ` Your other ${plural(editIds.length, 'change')} will be saved too.` : ''}`}
          confirmText="Remove and Save"
          variant="red"
          onConfirm={() => save(true)}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </Modal>
  );
}
