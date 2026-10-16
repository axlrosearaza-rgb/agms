import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icons, Badge, Modal, programShortLabel, formatPersonNameFirstLast, formatPersonName } from '../common';
import { userService } from '../../services';
import { parseAdviserLines, docxToLines, matchAdviser } from '../../utils/adviserImport';
import toast from 'react-hot-toast';

const ADVISER_ROLES = ['Faculty', 'Chairperson'];
const keyOf = (r) => `${r.program}|${r.year_level}|${r.section}`;

// Admin → "Manage Advisory": set every section's adviser at once from the
// Dean's Room Assignment sheet (or any list in that shape) — Curricular Year &
// Section + Adviser per line, under program headings. The Room Assignment
// column is ignored. A new list is uploaded over the current one: the review
// step shows, section by section, what would change. Nothing is cleared
// wholesale, and an adviser who loses a section is kept under Past Advisers
// together with the advisees they had.
export default function AdviserImportModal({ users: initialUsers = [], onClose, onImported }) {
  const [step, setStep] = useState('input'); // input | review | archive
  const [pasted, setPasted] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('upload'); // upload | paste
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const fileRef = useRef(null);

  // Every account (the page's own list may be narrowed by its search box).
  const [users, setUsers] = useState(initialUsers);
  const loadUsers = useCallback(
    () => userService.getAll({ all: true }).then(({ data }) => setUsers(data.users || [])).catch(() => {}),
    []
  );
  useEffect(() => { loadUsers(); }, [loadUsers]);

  // What is assigned right now.
  const holders = useMemo(
    () => users.filter((u) => ADVISER_ROLES.includes(u.role) && Array.isArray(u.advisories) && u.advisories.length > 0),
    [users]
  );
  const sectionCount = holders.reduce((n, u) => n + u.advisories.length, 0);
  const sectionsText = `${sectionCount} section${sectionCount !== 1 ? 's' : ''}`;
  const advisersText = `${holders.length} adviser${holders.length !== 1 ? 's' : ''}`;
  // section → the adviser who has it now.
  const currentAdviserOf = useMemo(() => {
    const m = new Map();
    holders.forEach((u) => u.advisories.forEach((a) => m.set(keyOf(a), u)));
    return m;
  }, [holders]);

  // Past advisers (kept by the server whenever a section changes hands).
  const [archive, setArchive] = useState(null);
  const [openArchive, setOpenArchive] = useState({});
  const showArchive = async () => {
    setStep('archive');
    try {
      const { data } = await userService.getAdviserArchive();
      setArchive(data.archive || []);
    } catch (err) {
      setArchive([]);
      toast.error('Could not load the past advisers');
    }
  };

  const candidates = useMemo(() => users
    .filter((u) => ADVISER_ROLES.includes(u.role) && u.status === 'Active')
    .sort((a, b) => formatPersonNameFirstLast(a.name).localeCompare(formatPersonNameFirstLast(b.name))), [users]);

  const review = (lines) => {
    const parsed = parseAdviserLines(lines);
    if (!parsed.length) {
      toast.error('No sections found. Each line needs a Year & Section (e.g. 1A) and the adviser\'s name, under a program heading (BSIT, BSIS, BS Psych, BSS).');
      return;
    }
    setRows(parsed.map((r) => {
      const m = matchAdviser(r.adviser_name, candidates);
      return { ...r, user_id: m.user ? String(m.user.id) : '', ambiguous: m.ambiguous };
    }));
    setStep('review');
  };

  const readFile = async (file) => {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { toast.error('Choose a Word (.docx) file, or paste the list instead.'); return; }
    setReading(true);
    try {
      review(await docxToLines(file));
    } catch (err) {
      toast.error(err.message || 'Could not read that file.');
    } finally {
      setReading(false);
    }
  };
  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    readFile(file);
  };

  // A section listed twice: only its last line counts.
  const lastIndexByKey = useMemo(() => {
    const m = new Map();
    rows.forEach((r, i) => m.set(keyOf(r), i));
    return m;
  }, [rows]);

  const statusOf = (r, i) => {
    if (!r.program) return { ok: false, badge: <Badge variant="red">No program heading</Badge> };
    if (lastIndexByKey.get(keyOf(r)) !== i) return { ok: false, badge: <Badge variant="gray">Listed again below</Badge> };
    if (!r.user_id) return { ok: false, badge: <Badge variant="yellow">{r.ambiguous ? 'Several matches — choose' : 'No account found — choose'}</Badge> };
    return { ok: true, badge: <Badge variant="green">Ready</Badge> };
  };

  // What importing a ready row would do, compared with who has the section now.
  const changeOf = (r) => {
    const now = currentAdviserOf.get(keyOf(r));
    if (!now) return { kind: 'new', badge: <Badge variant="blue">New adviser</Badge> };
    if (String(now.id) === String(r.user_id)) return { kind: 'same', badge: <Badge variant="gray">No change</Badge> };
    return { kind: 'changed', badge: <Badge variant="yellow">Replaces {formatPersonNameFirstLast(now.name)}</Badge> };
  };

  const ready = rows.filter((r, i) => statusOf(r, i).ok);
  const changeCount = (kind) => ready.filter((r) => changeOf(r).kind === kind).length;
  const listedKeys = new Set(ready.map(keyOf));
  const untouched = [...currentAdviserOf.keys()].filter((k) => !listedKeys.has(k)).length;
  const skipped = rows.length - ready.length;
  const adviserCount = new Set(ready.map((r) => r.user_id)).size;

  const setUser = (idx, userId) => setRows((list) => list.map((r, i) => (i === idx ? { ...r, user_id: userId } : r)));

  const doImport = async () => {
    setBusy(true);
    try {
      const { data } = await userService.importAdvisories({
        assignments: ready.map((r) => ({ user_id: Number(r.user_id), program: r.program, year_level: r.year_level, section: r.section })),
      });
      toast.success(data.message || 'Advisers imported');
      onImported?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to import advisers');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Modal
      title="Manage Advisory"
      onClose={onClose}
      size="max-w-4xl"
      footer={step === 'archive' ? (
        <button className="btn btn-outline" onClick={() => setStep('input')}>Back</button>
      ) : step === 'input' ? (
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          {tab === 'paste' && (
            <button className="btn btn-primary" onClick={() => review(pasted.split(/\r?\n/))} disabled={!pasted.trim()}>
              <Icons.Check className="w-4 h-4" /> Review List
            </button>
          )}
        </>
      ) : (
        <>
          <button className="btn btn-outline mr-auto" onClick={() => setStep('input')} disabled={busy}>Back</button>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={doImport} disabled={busy || ready.length === 0}>
            {busy ? 'Updating...' : `Update ${ready.length} Section${ready.length !== 1 ? 's' : ''}`}
          </button>
        </>
      )}
    >
      {step === 'archive' ? (
        <div>
          <p className="text-[13px] text-gray-600 dark:text-gray-300 mb-3">
            Each time a section moves to another adviser, the earlier adviser and the advisees they had are kept here. Nothing in this list is ever removed.
          </p>
          {archive === null ? (
            <p className="text-center text-sm text-gray-400 py-8">Loading…</p>
          ) : archive.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">No past advisers yet. An adviser appears here once one of their sections is given to someone else.</p>
          ) : (
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-auto max-h-[50vh]">
              <table className="w-full min-w-[650px] text-[13px]">
                <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                  <tr className="text-left text-[11px] uppercase text-gray-500 bg-gray-50 dark:bg-gray-800">
                    <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Past adviser</th>
                    <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Section</th>
                    <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Advisees</th>
                    <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Until</th>
                    <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Replaced by</th>
                  </tr>
                </thead>
                <tbody>
                  {archive.map((a) => (
                    <FragmentRow key={a.id} a={a} open={!!openArchive[a.id]} onToggle={() => setOpenArchive((o) => ({ ...o, [a.id]: !o[a.id] }))} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : step === 'input' ? (
        <div className="space-y-4">
          {/* What is assigned right now, and the record of earlier advisers. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
            <p className="text-[13px] text-gray-600 dark:text-gray-300">
              {sectionCount > 0
                ? <>Right now: <b>{sectionsText}</b> assigned to <b>{advisersText}</b>.</>
                : 'Right now: no section has an adviser.'}
            </p>
            <button
              type="button"
              className="btn !bg-white !text-navy !border !border-solid !border-gray-300 hover:!bg-gray-50"
              onClick={showArchive}
              title="Earlier advisers and the advisees they had"
            >
              <Icons.Archive className="w-4 h-4" /> Past Advisers
            </button>
          </div>

          {/* What the list should look like */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
              <Icons.AlertCircle className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <p className="text-[13px] text-gray-600 dark:text-gray-300">
                Each line needs the <b>Program</b>, <b>Year &amp; Section</b> and <b>Adviser</b>.
              </p>
            </div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="px-4 pt-2 pb-1 font-semibold">Program</th>
                  <th className="px-2 pt-2 pb-1 font-semibold">Year &amp; Section</th>
                  <th className="px-2 pt-2 pb-1 font-semibold">Adviser</th>
                </tr>
              </thead>
              <tbody className="text-gray-700 dark:text-gray-300">
                {[['BSIT', '1A', 'Ms. Celeste J. Reyes'], ['', '1B', 'Ms. Celeste J. Reyes'], ['BSIS', '1A', 'Dr. Maryjes G. Calades']].map(([p, ys, name], i) => (
                  <tr key={i}>
                    <td className="px-4 py-1 font-bold text-navy dark:text-blue-300">{p}</td>
                    <td className="px-2 py-1 font-semibold">{ys}</td>
                    <td className="px-2 py-1">{name}</td>
                  </tr>
                ))}
                <tr><td colSpan={3} className="px-4 pb-2 pt-1 text-[11px] text-gray-400">Program headings: BSIT, BSIS, BS Psych, BSS</td></tr>
              </tbody>
            </table>
          </div>

          {/* Upload | Paste */}
          <div className="flex border-b border-gray-200 dark:border-gray-700">
            {[['upload', 'Upload Word File', Icons.Upload], ['paste', 'Paste List', Icons.Clipboard]].map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`-mb-px py-2 px-4 text-xs font-semibold font-sans bg-transparent cursor-pointer border-0 border-b-2 border-solid transition-colors ${
                  tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" /> {label}</span>
              </button>
            ))}
          </div>

          {tab === 'upload' ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); readFile(e.dataTransfer.files?.[0]); }}
              onClick={() => !reading && fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragOver
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 shadow-md'
                  : 'border-gray-300 dark:border-gray-700 hover:border-blue-400 bg-gray-50/40 dark:bg-gray-800/30'
              }`}
            >
              <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={onFile} />
              <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 mx-auto flex items-center justify-center mb-3 shadow-inner">
                <Icons.FileText className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-navy dark:text-blue-200 mb-1">
                {reading ? 'Reading the document...' : 'Click to browse or drag & drop the Word (.docx) file'}
              </p>
              <p className="text-xs text-gray-500">Upload the new list over the current one. Every section is shown for review, with what would change, before anything is saved.</p>
            </div>
          ) : (
            <div>
              <textarea
                className="form-input font-mono text-[12px] leading-relaxed"
                rows={8}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={'Copy the list from Word or Excel and paste it here, e.g.\n\nBSIT   1A   Ms. Celeste J. Reyes\n       1B   Ms. Celeste J. Reyes\nBSIS   1A   Dr. Maryjes G. Calades'}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <p className="text-[13px] text-gray-600">
              <b>{ready.length}</b> section{ready.length !== 1 ? 's' : ''} ready for <b>{adviserCount}</b> adviser{adviserCount !== 1 ? 's' : ''}
              {skipped > 0 && <span className="text-amber-600"> · {skipped} will be skipped</span>}
            </p>
            <p className="text-[13px] text-gray-600">
              <b className="text-amber-600">{changeCount('changed')}</b> change adviser · <b className="text-blue-600">{changeCount('new')}</b> new · <b>{changeCount('same')}</b> no change
            </p>
          </div>
          <p className="text-[11px] text-gray-400 mb-3">
            Only the sections in this list are updated. A section that moves to another adviser keeps its earlier adviser under Past Advisers, with the advisees they had.
            {untouched > 0 && <> <b>{untouched}</b> section{untouched !== 1 ? 's' : ''} not in this list keep{untouched === 1 ? 's' : ''} the current adviser.</>}
          </p>
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-auto max-h-[50vh]">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead className="bg-gray-50 dark:bg-gray-800 sticky top-0 z-10">
                <tr className="text-left text-[11px] uppercase text-gray-500 bg-gray-50 dark:bg-gray-800">
                  <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Program</th>
                  <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Yr &amp; Sec</th>
                  <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Adviser (in file)</th>
                  <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">Account</th>
                  <th className="px-3 py-2 whitespace-nowrap bg-gray-50 dark:bg-gray-800">What changes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = statusOf(r, i);
                  return (
                    <tr key={i} className={`border-t border-gray-100 dark:border-gray-700 ${st.ok ? '' : 'bg-amber-50/40'}`}>
                      <td className="px-3 py-1.5 font-semibold text-navy dark:text-blue-300">{r.program ? programShortLabel(r.program) : '—'}</td>
                      <td className="px-3 py-1.5">{r.year_level}{r.section}</td>
                      <td className="px-3 py-1.5 text-gray-600 dark:text-gray-300">{r.adviser_name}</td>
                      <td className="px-3 py-1.5">
                        <select className="form-select py-1 text-[13px]" value={r.user_id} onChange={(e) => setUser(i, e.target.value)}>
                          <option value="">— Choose account —</option>
                          {candidates.map((u) => (
                            <option key={u.id} value={u.id}>{formatPersonNameFirstLast(u.name)}{u.role === 'Chairperson' ? ' (Chairperson)' : ''}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">{st.ok ? changeOf(r).badge : st.badge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
    </>
  );
}

// One past advisory; click to list the advisees the adviser had.
function FragmentRow({ a, open, onToggle }) {
  const students = Array.isArray(a.students) ? a.students : [];
  return (
    <>
      <tr className="border-t border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-50/60 dark:hover:bg-gray-800/50" onClick={onToggle}>
        <td className="px-3 py-2 font-semibold text-navy dark:text-blue-300 whitespace-nowrap">{formatPersonNameFirstLast(a.adviser_name)}</td>
        <td className="px-3 py-2 whitespace-nowrap">{programShortLabel(a.program)} {a.year_level}-{a.section}</td>
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="inline-flex items-center gap-1 font-medium">{a.student_count} {open ? <Icons.ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <Icons.ChevronDown className="w-3.5 h-3.5 text-gray-400" />}</span>
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{new Date(a.ended_at).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}{a.semester ? <span className="text-gray-400"> · {a.semester}</span> : null}</td>
        <td className="px-3 py-2 whitespace-nowrap">{a.replaced_by_name ? formatPersonNameFirstLast(a.replaced_by_name) : <span className="text-gray-400">No one yet</span>}</td>
      </tr>
      {open && (
        <tr className="bg-gray-50/70 dark:bg-gray-800/60">
          <td colSpan={5} className="px-4 py-3">
            {students.length === 0 ? (
              <span className="text-[12px] text-gray-400">This section had no students yet.</span>
            ) : (
              <div className="max-h-48 overflow-y-auto pr-1">
                <ol className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 text-[12px] text-gray-700 dark:text-gray-300 list-decimal pl-5 m-0">
                  {students.map((s) => <li key={s.id}>{formatPersonName(s.name)} <span className="text-gray-400 font-mono text-[11px]">{s.student_no}</span></li>)}
                </ol>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
