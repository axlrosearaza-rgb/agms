import { useEffect, useMemo, useState } from 'react';
import { Icons, Badge, Modal, ConfirmDialog, LoadingSpinner, programShortLabel, formatStudentName, compareStudentNames } from './index';
import { promotionService, semesterService } from '../../services';
import toast from 'react-hot-toast';

// Statuses a student can actually be promoted from.
const PROMOTABLE = ['Eligible', 'Eligible (Retake Required)', 'For Graduation'];

const STATUS_BADGE = {
  Eligible: 'green',
  'Eligible (Retake Required)': 'yellow',
  'For Graduation': 'purple',
  'Already Promoted': 'gray',
  'Pending Verification': 'blue',
  'Pending Release': 'orange',
  'Incomplete Subjects': 'red',
  'Missing Prerequisites': 'red',
  'No Grades': 'gray',
};

// Why a student can't be promoted yet — one short line.
const reasonFor = (s) => {
  if (s.promotion_status === 'Incomplete Subjects') return `No passing grade yet: ${s.missing_subjects.map((m) => m.code).join(', ')}`;
  if (s.promotion_status === 'Missing Prerequisites') return `Blocked by prerequisites: ${s.missing_prerequisites.map((m) => m.code).join(', ')}`;
  if (s.promotion_status === 'Pending Verification') return `Grades not yet verified/approved: ${(s.unverified_subjects || []).map((m) => m.code).join(', ')}`;
  if (s.promotion_status === 'Pending Release') return 'Approved — waiting for the Admin to release the grades to the students';
  if (s.promotion_status === 'No Grades') return 'No submitted grades this semester';
  if (s.promotion_status === 'Eligible (Retake Required)') {
    // Failed, INC/Dropped, and curriculum subjects with no grade — all carried as retakes.
    const codes = [...new Set([
      ...(s.retakable_failed_subjects || []).map((f) => f.code),
      ...(s.grades || []).filter((g) => g.status === 'INC' || g.status === 'DRP').map((g) => g.subject_code),
      ...(s.missing_subjects || []).map((m) => m.code),
    ].filter(Boolean))];
    const needsPrereq = [
      ...(s.retakable_failed_subjects || []).filter((f) => f.blocked_by_prereq).map((f) => `${f.code} (pass ${f.unmet_prerequisites.join(', ')} first)`),
      ...(s.missing_prerequisites || []).map((m) => `${m.code} (pass ${m.unmet.join(', ')} first)`),
    ];
    return `Promoted with retake: ${codes.join(', ')} — marked Irregular${needsPrereq.length ? `. Prerequisite first: ${needsPrereq.join('; ')}` : ''}`;
  }
  return s.next_step ? `Next: ${s.next_step}` : '';
};

// The adviser promotes their own section, based on the students' grades for
// the chosen semester (promotionController.evaluateStudents / promoteStudents).
export default function PromoteSectionModal({ section, onClose, onDone }) {
  const label = `${programShortLabel(section.program)} ${section.year_level}-${section.section}`;
  const [semesters, setSemesters] = useState([]);
  const [semester, setSemester] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    semesterService.getAll().then(({ data }) => {
      const list = data.semesters || [];
      setSemesters(list);
      setSemester((list.find((s) => s.is_current) || list[0])?.name || '');
    }).catch(() => toast.error('Failed to load semesters'));
  }, []);

  const evaluate = async (sem = semester) => {
    if (!sem) return;
    setLoading(true);
    try {
      const { data } = await promotionService.evaluate({ semester: sem, program: section.program, year_level: section.year_level, section: section.section });
      setResult(data);
      setSelected(new Set((data.students || []).filter((s) => PROMOTABLE.includes(s.promotion_status)).map((s) => s.id)));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to evaluate the section');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  // Re-checked whenever the chosen semester changes.
  useEffect(() => { if (semester) evaluate(semester); }, [semester]);

  const students = useMemo(() => (result?.students || []).slice().sort(compareStudentNames), [result]);
  const promotable = students.filter((s) => PROMOTABLE.includes(s.promotion_status));
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = promotable.length > 0 && promotable.every((s) => selected.has(s.id));

  const [confirming, setConfirming] = useState(false);

  const promote = async () => {
    setConfirming(false);
    setPromoting(true);
    try {
      const { data } = await promotionService.promote({ student_ids: [...selected], semester });
      toast.success(data.message || 'Students promoted', { duration: 6000 });
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to promote');
    } finally {
      setPromoting(false);
    }
  };

  const secondSem = result?.semester_order === '2nd';
  const actionWord = secondSem ? (Number(section.year_level) >= 4 ? 'Graduate' : `Promote to Year ${Number(section.year_level) + 1}`) : 'Clear for 2nd Semester';
  // What the warning spells out before anything is changed.
  const effect = secondSem
    ? Number(section.year_level) >= 4
      ? 'Students who passed everything will be marked Graduated and archived.'
      : `They will move up to Year ${Number(section.year_level) + 1} — Section ${section.section}.`
    : 'They will be cleared for the 2nd Semester.';

  return (
    <Modal
      title={`Promotion — ${label}`}
      onClose={onClose}
      size="max-w-4xl"
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={promoting}>Cancel</button>
          <button className="btn btn-primary" onClick={() => setConfirming(true)} disabled={promoting || loading || selected.size === 0}>
            <Icons.Award className="w-4 h-4" /> {promoting ? 'Promoting...' : `${actionWord} now (${selected.size})`}
          </button>
        </>
      }
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex-1 min-w-[220px]">
          <label className="form-label">Based on the grades of</label>
          <select className="form-select" value={semester} onChange={(e) => setSemester(e.target.value)}>
            {semesters.map((s) => <option key={s.id} value={s.name}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
          </select>
        </div>
        <button className="btn btn-outline" onClick={() => evaluate()} disabled={loading || !semester}>
          <Icons.RotateCw className="w-4 h-4" /> Re-check
        </button>
      </div>

      <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 mb-3 text-[12px] text-blue-800 flex gap-2">
        <Icons.Sparkles className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          <b>Only you, the adviser, promote your students.</b> A student can be promoted once their grades are verified, approved and
          released by the Admin. Failed, INC, Dropped or missing subjects don't hold them back — they're promoted as <b>Irregular</b> and
          retake the subject, but a subject that is a prerequisite must be passed before its next subject can be taken. Select the students
          below and click the button to promote them.
        </span>
      </div>
      <p className="text-[12px] text-gray-500 mb-3">
        {secondSem
          ? Number(section.year_level) >= 4
            ? 'After the 2nd Semester, 4th-year students who passed everything graduate; anyone with a retake stays until it is passed.'
            : `After the 2nd Semester, students move up to Year ${Number(section.year_level) + 1} (same section letter) — they'll then show under that section's adviser.`
          : 'After the 1st Semester, students stay in this year and are cleared for the 2nd Semester.'}
        {' '}Only grades still waiting for verification or approval hold a student back.
      </p>

      {loading ? <LoadingSpinner text="Checking grades..." /> : students.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-10">No students in {label} yet.</p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[50vh] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="text-left text-[11px] uppercase text-gray-500">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={allOn} disabled={!promotable.length}
                    onChange={() => setSelected(allOn ? new Set() : new Set(promotable.map((s) => s.id)))} />
                </th>
                <th className="px-3 py-2 w-1/3">Student</th>
                <th className="px-3 py-2">GWA</th>
                <th className="px-3 py-2 w-1/4">Status</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const can = PROMOTABLE.includes(s.promotion_status);
                return (
                  <tr key={s.id} className={`border-t border-gray-100 ${can ? '' : 'bg-gray-50/60'}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" disabled={!can} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{formatStudentName(s.name)}</p>
                      <p className="text-[11px] text-gray-400">{s.student_no}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {(!s.account_setup_at || s.gwa == null || !s.already_released) ? '—' : Number(s.gwa).toFixed(3)}
                    </td>
                    <td className="px-3 py-2"><Badge variant={STATUS_BADGE[s.promotion_status] || 'gray'}>{s.promotion_status}</Badge></td>
                    <td className="px-3 py-2 text-[12px] text-gray-500">{reasonFor(s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          title={`${actionWord}?`}
          warning
          variant="primary"
          confirmText={`Yes, ${actionWord.charAt(0).toLowerCase()}${actionWord.slice(1)} (${selected.size})`}
          message={`You are about to ${actionWord.charAt(0).toLowerCase()}${actionWord.slice(1)} ${selected.size} student(s) of ${label} based on ${semester}. ${effect} The students and the Admin will be notified. This cannot be undone from the system — please double-check before continuing.`}
          onConfirm={promote}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Modal>
  );
}
