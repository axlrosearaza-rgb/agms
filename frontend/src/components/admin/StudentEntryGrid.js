import { useEffect, useState } from 'react';
import { Icons } from '../common';
import toast from 'react-hot-toast';
import { userService } from '../../services';
import {
  OFFICIAL_PROGRAMS,
  VALID_SECTIONS,
  normalizeProgram,
  normalizeYearLevel,
  normalizeSection,
  composeName,
  splitPersonName,
  upperSurname,
  clipboardToRows,
  pastedRowsForGrid,
} from '../../utils/studentWordImport';

// Spreadsheet-style entry table for the student import — one row per student:
// Student ID Number | Student Full Name | Program | Year | Section. Type row by row, or paste a block copied from Excel / Word / Google
// Sheets into any cell and it fills across and down from there (adding rows
// as needed). "Review Students" hands the filled rows to the same review step
// a Word document goes through (StudentWordImportModal).

export const GRID_COLUMNS = [
  { key: 'student_no', label: 'Student ID Number', width: 150, placeholder: 'e.g. 240001' },
  { key: 'name', label: 'Student Full Name', width: 410, placeholder: 'DELA CRUZ, Juan M.' },
  { key: 'program', label: 'Program', width: 300 },
  { key: 'year_level', label: 'Year', width: 140 },
  { key: 'section', label: 'Section', width: 140 },
];

export const emptyGridRow = () => ({
  key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  student_no: '', name: '', program: '', year_level: '', section: '',
});
export const emptyGrid = (n = 10) => Array.from({ length: n }, emptyGridRow);

const isFilled = (r) => GRID_COLUMNS.some((c) => String(r[c.key] || '').trim());

// A pasted value landing in the Program/Year/Section columns is read the same
// forgiving way a Word document is ("BSIT", "4th year", "Sec. D", ...).
const cleanValue = (key, value) => {
  const v = String(value ?? '').trim();
  if (key === 'name') return fullName(v);
  if (key === 'program') return normalizeProgram(v) || '';
  if (key === 'year_level') return v ? String(normalizeYearLevel(v) || '') : '';
  if (key === 'section') return normalizeSection(v) || '';
  return v;
};

// Any way a name is written — "Juan M. Dela Cruz", "dela cruz, juan m." —
// becomes "DELA CRUZ, Juan M.", the way names read everywhere in the system.
const fullName = (value) => {
  const v = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!v) return '';
  if (v.includes(',')) return upperSurname(v);
  if (v.split(' ').length < 2) return v;
  const p = splitPersonName(v);
  return composeName(p.surname, p.first_name, p.middle_initial);
};

// A block copied from a sheet that keeps the name in separate columns
// (ID | Surname | First Name | M.I. | Program | Year | Section).
const SPLIT_NAME_KEYS = ['student_no', 'surname', 'first_name', 'middle_initial', 'program', 'year_level', 'section'];

// Students are kept A–Z by name (surname first); rows with a name come first,
// then rows with only an ID, and the blank rows stay at the bottom for adding
// more.
const sortRows = (rows) => {
  const named = rows.filter((r) => String(r.name || '').trim());
  const unnamed = rows.filter((r) => !String(r.name || '').trim() && isFilled(r));
  const blank = rows.filter((r) => !isFilled(r));
  named.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base' }));
  return [...named, ...unnamed, ...blank];
};

const looksLikeHeader = (cells) => cells.some((c) => /student|surname|last\s*name|first\s*name|middle|program|course|section/i.test(c));

// existingOnly — a faculty's class list: only IDs that already have an account
// can be added (accounts are created by the adviser's import).
export default function StudentEntryGrid({ rows, setRows, defaults, onReview, existingOnly = false }) {
  const filled = rows.filter(isFilled);

  // Student ID Number → the student account that already has it (null = looked
  // up, no account). Typing or pasting an existing ID fills in that student's
  // name automatically; a new ID needs the full name typed in.
  const [accounts, setAccounts] = useState(() => new Map());
  const accountOf = (r) => accounts.get(String(r.student_no || '').trim()) || null;
  const idsKey = rows.map((r) => String(r.student_no || '').trim()).join('|');
  useEffect(() => {
    const pending = [...new Set(idsKey.split('|').filter((no) => no.length >= 3 && !accounts.has(no)))];
    if (pending.length === 0) return undefined;
    const timer = setTimeout(async () => {
      try {
        const { data } = await userService.checkStudentNos(pending);
        const found = new Map((data.existing || []).filter((u) => !u.role || u.role === 'Student').map((u) => [String(u.student_no).trim(), u]));
        setAccounts((prev) => { const next = new Map(prev); pending.forEach((no) => next.set(no, found.get(no) || null)); return next; });
        if (found.size) {
          setRows((prev) => sortRows(prev.map((r) => { const a = found.get(String(r.student_no || '').trim()); return a && r.name !== a.name ? { ...r, name: a.name } : r; })));
        }
      } catch (err) { /* lookup is a convenience — the review step checks again */ }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line
  }, [idsKey]);

  const setCell = (rowIdx, key, value) => {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r)));
  };

  // One paste handler for the whole table (paste bubbles up from whichever
  // cell has focus — dropdown cells included, which have no paste of their
  // own). data-row/data-col on each cell say where the paste landed.
  const handlePaste = (e) => {
    const cell = e.target.closest?.('[data-row]');
    const rowIdx = cell ? Number(cell.dataset.row) : rows.findIndex((r) => !isFilled(r));
    const colIdx = cell ? Number(cell.dataset.col) : 0;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    const matrix = clipboardToRows(html, text);
    if (matrix.length === 0) return;

    // A single value (one cell of one row) pastes normally into the input —
    // unless it's a whole student on one line ("240001 Dela Cruz, Juan BSIT 4-D").
    const single = matrix.length === 1 && matrix[0].length === 1;
    const plan = pastedRowsForGrid(matrix, colIdx);
    if (single && plan.mode === 'cells') return;
    e.preventDefault();

    const start = rowIdx < 0 ? rows.length : rowIdx;
    if (plan.mode === 'cells') {
      // Spreadsheet-style: cell-for-cell from where it was pasted.
      const block = plan.rows.length > 1 && looksLikeHeader(plan.rows[0]) ? plan.rows.slice(1) : plan.rows;
      setRows((prev) => {
        const next = [...prev];
        while (next.length < start + block.length) next.push(emptyGridRow());
        // Pasted at the first column with the name split over several
        // columns (plain surname right after the ID) → joined into one name.
        const splitNames = colIdx === 0 && block.every((cells) => cells.length >= 3)
          && block.filter((cells) => cells[1] && !cells[1].includes(',') && cells[1].trim().split(/\s+/).length <= 3).length >= block.length * 0.6;
        block.forEach((cells, r) => {
          const row = { ...next[start + r] };
          if (splitNames) {
            const v = {};
            cells.forEach((value, c) => { if (SPLIT_NAME_KEYS[c]) v[SPLIT_NAME_KEYS[c]] = String(value ?? '').trim(); });
            row.student_no = v.student_no || '';
            row.name = composeName(v.surname, v.first_name, v.middle_initial);
            ['program', 'year_level', 'section'].forEach((k) => { if (v[k] !== undefined) row[k] = cleanValue(k, v[k]); });
          } else {
            cells.forEach((value, c) => {
              const col = GRID_COLUMNS[colIdx + c];
              if (col) row[col.key] = cleanValue(col.key, value);
            });
          }
          next[start + r] = row;
        });
        return sortRows(next);
      });
      toast.success(`Pasted ${block.length} row${block.length !== 1 ? 's' : ''}.`);
      return;
    }

    // A whole class list: every student becomes a full row, filling the next
    // EMPTY rows from where it was pasted — rows already typed are never
    // overwritten.
    setRows((prev) => {
      const next = [...prev];
      let cursor = start;
      plan.rows.forEach((student) => {
        while (cursor < next.length && isFilled(next[cursor])) cursor += 1;
        const values = {
          student_no: student.student_no,
          name: composeName(student.surname, student.first_name, student.middle_initial),
          program: cleanValue('program', student.program),
          year_level: student.year_level,
          section: cleanValue('section', student.section),
        };
        if (cursor >= next.length) next.push({ ...emptyGridRow(), ...values });
        else next[cursor] = { ...next[cursor], ...values };
        cursor += 1;
      });
      return sortRows(next);
    });
    toast.success(`Pasted ${plan.rows.length} student${plan.rows.length !== 1 ? 's' : ''} from the list.`);
  };

  const addRows = (n) => setRows((prev) => [...prev, ...Array.from({ length: n }, emptyGridRow)]);
  const removeRow = (idx) => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : [emptyGridRow()]));
  const clearAll = () => setRows(emptyGrid(10));

  const review = () => {
    if (existingOnly) {
      const unknown = filled.filter((r) => !accountOf(r));
      if (unknown.length) {
        toast.error(`${unknown.length} Student ID Number${unknown.length !== 1 ? 's have' : ' has'} no account yet — the adviser must import ${unknown.length !== 1 ? 'those students' : 'that student'} first. Remove ${unknown.length !== 1 ? 'those rows' : 'that row'} to continue.`, { duration: 6000 });
        return;
      }
    }
    const nameless = filled.filter((r) => !String(r.name || '').trim() && !accountOf(r));
    if (nameless.length) {
      toast.error(`${nameless.length} row${nameless.length !== 1 ? 's need' : ' needs'} the student's full name — that Student ID Number has no account yet.`);
      return;
    }
    const records = filled.map((r, i) => {
      const program = r.program || defaults.program || '';
      const year = parseInt(r.year_level, 10) || defaults.year_level || 1;
      const section = r.section || defaults.section || '';
      return {
        id: `grid-row-${i + 1}`,
        rowNum: i + 1,
        student_no: String(r.student_no || '').trim().replace(/\s+/g, ''),
        name: fullName(r.name),
        program,
        year_level: year,
        section: String(section).toUpperCase(),
        email: null,
        student_status: defaults.student_status || 'Regular',
        student_type: defaults.student_type || 'New',
        source: 'Entered in table',
        fromDefaults: [!r.program && 'program', !r.year_level && 'year_level', !r.section && 'section'].filter(Boolean),
        errors: [],
        isValid: true,
      };
    });
    onReview(records);
  };

  const inputCls = 'w-full border-none bg-transparent px-2 py-2 text-[13px] focus:outline-none focus:bg-blue-50/60 dark:focus:bg-blue-900/20';
  const selectCls = 'w-full border-none bg-transparent pl-2 pr-6 py-2 text-[13px] cursor-pointer focus:outline-none focus:bg-blue-50/60';

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-gray-500">
        Type each student on a row, or copy your class list (from Word, Excel, Google Docs/Sheets — a table or plain lines, any column order) and paste it into any cell with Ctrl+V — every student fills its own row. Type the Student ID Number first — if the student already has an account, the name fills in by itself; if not, type the full name ("DELA CRUZ, Juan M." or "Juan M. Dela Cruz"). The list sorts itself alphabetically.
        Leave Program, Year or Section blank to use the defaults above.
      </p>

      <div className="border border-gray-200 dark:border-gray-700 rounded-xl max-h-[26rem] overflow-auto bg-white dark:bg-gray-800" onPaste={handlePaste}>
        <table className="text-left border-collapse table-fixed" style={{ width: 1200, minWidth: '100%' }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {GRID_COLUMNS.map((c) => <col key={c.key} style={{ width: c.width }} />)}
            <col style={{ width: 44 }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-navy text-white">
            <tr>
              <th className="py-2.5 px-2 text-[11px] font-semibold text-center">#</th>
              {GRID_COLUMNS.map((c) => (
                <th key={c.key} className="py-2.5 px-2 text-[11px] font-semibold uppercase tracking-wide border-l border-white/10">{c.label}</th>
              ))}
              <th className="py-2.5 px-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, rowIdx) => (
              <tr key={r.key} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50/60 dark:hover:bg-gray-750">
                <td className="text-center text-[11px] text-gray-400 font-mono">{rowIdx + 1}</td>
                {GRID_COLUMNS.map((c, colIdx) => (
                  <td key={c.key} data-row={rowIdx} data-col={colIdx} className="border-l border-gray-100 dark:border-gray-700 p-0">
                    {c.key === 'program' ? (
                      <select className={`${selectCls} ${!r.program ? 'text-gray-400' : ''}`} value={r.program} onChange={(e) => setCell(rowIdx, 'program', e.target.value)}>
                        <option value="">{`Default (${(defaults.program || '').replace('Bachelor of Science in ', 'BS ')})`}</option>
                        {OFFICIAL_PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    ) : c.key === 'year_level' ? (
                      <select className={`${selectCls} ${!r.year_level ? 'text-gray-400' : ''}`} value={r.year_level} onChange={(e) => setCell(rowIdx, 'year_level', e.target.value)}>
                        <option value="">{`Default (${defaults.year_level || 1})`}</option>
                        {[1, 2, 3, 4].map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
                      </select>
                    ) : c.key === 'section' ? (
                      <select className={`${selectCls} ${!r.section ? 'text-gray-400' : ''}`} value={r.section} onChange={(e) => setCell(rowIdx, 'section', e.target.value)}>
                        <option value="">{`Default (${defaults.section || '—'})`}</option>
                        {VALID_SECTIONS.map((s) => <option key={s} value={s}>Section {s}</option>)}
                      </select>
                    ) : c.key === 'name' && accountOf(r) ? (
                      // Existing account — its own name, filled in automatically.
                      <div className="flex items-center gap-2 px-2 py-2 text-[13px]" title="This Student ID Number already has an account — the name comes from it">
                        <span className="truncate">{accountOf(r).name}</span>
                        <span className="flex-shrink-0 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">Has an account</span>
                      </div>
                    ) : (
                      <input
                        className={`${inputCls} ${c.key === 'student_no' ? 'font-mono' : ''} ${c.key === 'name' && String(r.student_no || '').trim() && !String(r.name || '').trim() && accounts.get(String(r.student_no).trim()) === null ? 'placeholder:text-red-400 bg-red-50/40' : ''}`}
                        value={r[c.key]}
                        placeholder={c.key === 'name' && String(r.student_no || '').trim() && accounts.get(String(r.student_no).trim()) === null ? (existingOnly ? 'No account yet — the adviser must import this student first' : 'New student — type the full name') : rowIdx === 0 ? c.placeholder : ''}
                        onChange={(e) => setCell(rowIdx, c.key, e.target.value)}
                        onBlur={c.key === 'name' ? (e) => { const v = fullName(e.target.value); setRows((prev) => sortRows(prev.map((r, i) => (i === rowIdx ? { ...r, name: v } : r)))); } : undefined}
                      />
                    )}
                  </td>
                ))}
                <td className="text-center">
                  <button type="button" onClick={() => removeRow(rowIdx)} title="Remove row" className="text-gray-300 hover:text-red-500 bg-transparent border-none cursor-pointer p-1">
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-outline btn-sm flex items-center gap-1" onClick={() => addRows(1)}>
            <Icons.Plus className="w-3.5 h-3.5" /> Add row
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => addRows(10)}>+ 10 rows</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => addRows(50)}>+ 50 rows</button>
          <button type="button" className="text-[11px] text-gray-400 hover:text-red-500 underline bg-transparent border-none cursor-pointer ml-1" onClick={clearAll}>
            Clear table
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500"><b>{filled.length.toLocaleString()}</b> student{filled.length !== 1 ? 's' : ''} entered</span>
          <button type="button" className="btn btn-primary btn-sm flex items-center gap-1.5" disabled={filled.length === 0} onClick={review}>
            <Icons.Check className="w-3.5 h-3.5" /> Review Students
          </button>
        </div>
      </div>
    </div>
  );
}
