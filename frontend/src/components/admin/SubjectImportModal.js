import { useRef, useState } from 'react';
import { Icons, Modal, ProgramBadge } from '../common';
import { subjectService } from '../../services';
import toast from 'react-hot-toast';
import { SUBJECT_PROGRAMS, parseSubjectWordDocx, downloadSubjectWordTemplate } from '../../utils/subjectWordImport';

// Admin → Subjects → Import Subjects. One Word file brings in a whole
// curriculum: every row lands in the Curriculum Year typed here (2023 unless
// changed), so importing another year later adds a second curriculum beside
// the first instead of mixing into it. A row whose Course Code is already in
// that program's curriculum updates that subject.
const PROGRAMS = SUBJECT_PROGRAMS;

// What is wrong with a row (the server checks the same things again).
const problemsOf = (r) => {
  const p = [];
  if (!r.code) p.push('no Course Code');
  if (!r.name) p.push('no Course Description');
  if (!PROGRAMS.includes(r.program)) p.push(r.program ? `unknown program "${r.program}"` : 'no Program');
  if (!(r.year_level >= 1 && r.year_level <= 4)) p.push('Year Level must be 1 to 4');
  if (!['1st Semester', '2nd Semester', 'Summer'].includes(r.semester)) p.push('Semester must be 1st, 2nd or Summer');
  if (!(parseInt(r.units, 10) >= 1 && parseInt(r.units, 10) <= 6)) p.push('Total Units must be 1 to 6');
  return p;
};

export default function SubjectImportModal({ onClose, onImported, existingYears = [] }) {
  const [curriculumYear, setCurriculumYear] = useState('2023');
  const [program, setProgram] = useState('');
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);
  const [yearFromFile, setYearFromFile] = useState('');
  const fileRef = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) { toast.error('Choose a Word (.docx) file.'); return; }
    try {
      setBusy(true); setServerErrors([]);
      const { subjects: parsed, curriculumYear: yearInFile } = await parseSubjectWordDocx(file, program);
      if (parsed.length === 0) { toast.error('No subjects were found in that file.'); return; }
      setRows(parsed); setFileName(file.name);
      // "Effective S.Y. 2023 - 2024" in the file fills in the Curriculum Year.
      if (yearInFile) { setCurriculumYear(yearInFile); setYearFromFile(yearInFile); }
    } catch (err) {
      toast.error(err.message || 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  // A program picked here fills in rows whose own Program cell is blank.
  const shown = (rows || []).map((r) => ({ ...r, program: r.program || program }));
  const withProblems = shown.map((r) => ({ ...r, problems: problemsOf(r) }));
  const bad = withProblems.filter((r) => r.problems.length > 0);
  const yearOk = /^\d{4}(-\d{4})?$/.test(curriculumYear.trim());
  const isNewYear = yearOk && !existingYears.includes(curriculumYear.trim());
  const byProgram = withProblems.reduce((acc, r) => { if (r.program) acc[r.program] = (acc[r.program] || 0) + 1; return acc; }, {});

  const doImport = async () => {
    try {
      setBusy(true); setServerErrors([]);
      const { data } = await subjectService.importMany({ curriculum_year: curriculumYear.trim(), subjects: shown });
      toast.success(data.message);
      (data.warnings || []).slice(0, 3).forEach((w) => toast(w, { icon: '⚠️', duration: 7000 }));
      onImported();
      onClose();
    } catch (err) {
      setServerErrors(err.response?.data?.errors || []);
      toast.error(err.response?.data?.message || 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import Subjects"
      onClose={onClose}
      size="max-w-4xl"
      footer={(
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-gold" onClick={doImport} disabled={busy || !rows || bad.length > 0 || !yearOk}>
            {busy ? 'Working…' : rows ? `Import ${shown.length} Subject${shown.length !== 1 ? 's' : ''}` : 'Import'}
          </button>
        </>
      )}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="form-label">Curriculum Year <span className="text-red-500">*</span></label>
          <input className="form-input" value={curriculumYear} onChange={(e) => setCurriculumYear(e.target.value)} placeholder="2023" />
          <p className={`text-[12px] mt-1 ${yearOk ? 'text-gray-500' : 'text-red-500'}`}>
            {yearFromFile && yearFromFile === curriculumYear.trim() ? `Read from the file ("Effective S.Y. ${yearFromFile}…"). ` : ''}
            {!yearOk ? 'Type a year like 2023 (or 2023-2024).'
              : isNewYear ? `Every subject in the file will be added as a new ${curriculumYear.trim()} Curriculum, beside the existing one.`
                : `Every subject in the file goes into the ${curriculumYear.trim()} Curriculum. A Course Code already there is updated.`}
          </p>
        </div>
        <div>
          <label className="form-label">Program</label>
          <select className="form-select" value={program} onChange={(e) => setProgram(e.target.value)}>
            <option value="">Use the program named in the file</option>
            {PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <p className="text-[12px] text-gray-500 mt-1">Pick one only if the file is for a single program and does not name it.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 mb-4">
        <input ref={fileRef} type="file" accept=".docx" className="hidden" onChange={onFile} />
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Icons.Upload className="w-4 h-4" /> {rows ? 'Choose another file' : 'Choose Word file'}
        </button>
        <button className="btn btn-outline bg-white" onClick={() => downloadSubjectWordTemplate().catch(() => toast.error('Could not make the template.'))}>
          <Icons.Download className="w-4 h-4" /> Download template
        </button>
        <span className="text-[13px] text-gray-500 truncate">{fileName || 'The Curriculum Program form typed in Word (.docx), not a scanned picture.'}</span>
      </div>

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-[13px]">
            <span className="font-semibold text-navy">{shown.length} subject{shown.length !== 1 ? 's' : ''} found</span>
            {Object.entries(byProgram).map(([p, n]) => (
              <span key={p} className="inline-flex items-center gap-1">{PROGRAMS.includes(p) ? <ProgramBadge program={p} /> : <span className="text-red-600">{p}</span>}<span className="text-gray-500">{n}</span></span>
            ))}
            {bad.length > 0 && <span className="text-red-600 font-semibold">· {bad.length} row{bad.length !== 1 ? 's' : ''} to fix in the file</span>}
          </div>
          <div className="overflow-auto max-h-[42vh] border border-gray-200 rounded-lg">
            <table className="w-full text-[12.5px]">
              <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left">No.</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-left">Program</th>
                  <th className="px-3 py-2 text-center">Year · Sem</th>
                  <th className="px-3 py-2 text-center">Units</th>
                  <th className="px-3 py-2 text-left">Pre-Requisite</th>
                  <th className="px-3 py-2 text-left">Check</th>
                </tr>
              </thead>
              <tbody>
                {withProblems.map((r) => (
                  <tr key={r.line} className={`border-t border-gray-100 ${r.problems.length ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-1.5 text-gray-400">{r.line}</td>
                    <td className="px-3 py-1.5 font-semibold whitespace-nowrap">{r.code || '—'}</td>
                    <td className="px-3 py-1.5">{r.name || '—'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{PROGRAMS.includes(r.program) ? <ProgramBadge program={r.program} /> : (r.program || '—')}</td>
                    <td className="px-3 py-1.5 text-center whitespace-nowrap">{r.year_level || '—'} · {r.semester || '—'}</td>
                    <td className="px-3 py-1.5 text-center">{r.units || '—'}</td>
                    <td className="px-3 py-1.5">{r.prerequisites || '—'}</td>
                    <td className={`px-3 py-1.5 ${r.problems.length ? 'text-red-600' : 'text-green-600'}`}>{r.problems.length ? r.problems.join('; ') : 'OK'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {serverErrors.length > 0 && (
        <ul className="mt-3 text-[12.5px] text-red-600 list-disc pl-5">
          {serverErrors.slice(0, 8).map((e, i) => <li key={i}>Subject {e.row}: {e.message}</li>)}
        </ul>
      )}
    </Modal>
  );
}
