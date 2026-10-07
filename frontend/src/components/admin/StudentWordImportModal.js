import React, { useState, useRef } from 'react';
import { Icons, Badge, LoadingSpinner, Modal, ClearSearchButton, programShortLabel } from '../common';
import StudentEntryGrid, { emptyGrid } from './StudentEntryGrid';
import {
  parseStudentWordDocx,
  parseStudentExcel,
  downloadStudentExcelTemplate,
  upperSurname,
  OFFICIAL_PROGRAMS,
  VALID_SECTIONS,
} from '../../utils/studentWordImport';
import { userService, classService } from '../../services';
import { nameKey } from '../../utils/nameMatch';
import toast from 'react-hot-toast';

// Imports the CLASS LIST of one class (`classContext`) — the Faculty member
// who teaches it brings in its students from Word files, pasted lists or the
// entry table. New students get an account; students who already have one
// are just added; everyone is enrolled in this class
// (classController.importClassList).
//
// Or, with `advisoryContext` ({ program, year_level, section }), the ADVISER
// imports their own section's class list: new students get an account and
// everyone listed is placed in that section (userController.importAdvisoryList).
export default function StudentWordImportModal({ isOpen, onClose, onSuccess, classContext, advisoryContext }) {
  const cls = classContext;
  const adv = advisoryContext;
  const classLabel = adv
    ? `${programShortLabel(adv.program)} ${adv.year_level}-${adv.section}`
    : cls ? `${cls.subject?.code || 'Class'}${cls.year_level ? ` · Year ${cls.year_level}` : ''}${cls.section ? ` · Section ${cls.section}` : ''}` : '';
  const where = adv ? 'Section' : 'Class';
  const [activeTab, setActiveTab] = useState('upload'); // 'upload' | 'paste'
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsedData, setParsedData] = useState(null); // { students, fileName, totalRows, validCount, errorCount }
  // The "Enter in Table" tab's rows — kept here so they survive going to the
  // review and back ("Start over").
  const [gridRows, setGridRows] = useState(() => emptyGrid(10));
  const [searchFilter, setSearchFilter] = useState('');
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [importSummary, setImportSummary] = useState(null);

  // Defaults that can fill in missing columns
  // Start from the class's own Program / Year / Section.
  const [defaults, setDefaults] = useState({
    program: OFFICIAL_PROGRAMS.includes(advisoryContext?.program) ? advisoryContext.program
      : OFFICIAL_PROGRAMS.includes(classContext?.subject?.program) ? classContext.subject.program : OFFICIAL_PROGRAMS[0],
    year_level: advisoryContext?.year_level || classContext?.year_level || 1,
    section: advisoryContext?.section || classContext?.section || 'A',
    student_status: 'Regular',
    student_type: 'New',
  });

  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);
  // "Add more files" reuses the same hidden input, appending instead of replacing.
  const appendNextRef = useRef(false);
  const [page, setPage] = useState(1);
  const [progress, setProgress] = useState(null); // { done, total } while importing
  // Student ID Number → the account that already has it (from the server),
  // for every ID in the review list. Those students were imported before and
  // can't be imported again — flagged and left out of the import.
  const [existingById, setExistingById] = useState(() => new Map());
  const [checkingExisting, setCheckingExisting] = useState(false);
  // Name words (nameKey) → student accounts with that name, for spotting a
  // new row that's really an existing student under a mistyped ID.
  const [sameNameByKey, setSameNameByKey] = useState(() => new Map());
  const idCheckTimer = useRef(null);
  // Student ID Numbers already looked up on the server (found or not).
  const checkedNos = useRef(new Set());

  if (!isOpen) return null;


  // Every rule, re-checked across the WHOLE list after any change (an edit
  // can create or clear a duplicate elsewhere in the list, not just in the
  // row being edited).
  const revalidate = (students, existing = existingById, sameName = sameNameByKey) => {
    const seen = new Set();
    return students.map((s) => {
      const errors = [];
      // Likely mistyped Student ID — the row's name doesn't match the account
      // that has this ID, or the name already has an account under another
      // ID. Blocks the row until fixed or confirmed (name changed / two
      // different students with the same name).
      let nameIssue = null;
      const rowNo = String(s.student_no || '').trim();
      const rowAcct = rowNo ? existing.get(rowNo) : null;
      // (An ID that already has an account is just imported as that student,
      // whatever the name on the list says.)
      if (s.name && rowNo && !rowAcct) {
        const twin = (sameName.get(nameKey(s.name)) || []).find((u) => u.student_no !== rowNo);
        if (twin) nameIssue = { kind: 'name', text: `${twin.name} already has an account under ${twin.student_no} — check the ID.` };
      }
      if (nameIssue && !s.confirmed) errors.push(nameIssue.text);
      // A faculty's class list can only add students who already have an
      // account — accounts are created by the adviser's own import.
      if (cls && rowNo && !rowAcct && checkedNos.current.has(rowNo)) {
        errors.push('No account yet — the adviser must import this student in their advisory class list first.');
      }
      const no = String(s.student_no || '').trim();
      if (!no) errors.push('Student ID Number is missing.');
      if (!String(s.name || '').trim()) errors.push('Student Name is missing.');
      if (!s.program) errors.push('Program is missing — choose one.');
      else if (!OFFICIAL_PROGRAMS.includes(s.program)) errors.push('Program not recognized — choose one.');
      if (no) {
        const acct = existing.get(no);
        if (acct && acct.role && acct.role !== 'Student') errors.push(`Student ID Number ${no} belongs to a ${acct.role} account.`);
        else if (seen.has(no)) errors.push('Duplicate Student ID Number in this list.');
        seen.add(no);
      }
      const acct = no ? existing.get(no) : null;
      const existingAccount = acct && (!acct.role || acct.role === 'Student') ? acct : null;
      // An ID that already has an account IS that student — the row shows the
      // account's own (correct, possibly adviser-edited) name, not whatever
      // spelling the class list happened to have.
      const name = existingAccount?.name || s.name;
      return { ...s, name, errors: existingAccount ? errors.filter((e) => e !== 'Student Name is missing.') : errors, nameIssue, isValid: (existingAccount ? errors.filter((e) => e !== 'Student Name is missing.') : errors).length === 0, existingAccount };
    });
  };
  const withCounts = (base, students) => ({
    ...base,
    students,
    totalRows: students.length,
    validCount: students.filter((s) => s.isValid).length,
    errorCount: students.filter((s) => !s.isValid).length,
    alreadyCount: students.filter((s) => s.existingAccount).length,
    nameIssueCount: students.filter((s) => s.nameIssue && !s.confirmed).length,
  });

  // Asks the server which of these IDs already belong to an account, then
  // re-checks the list against that.
  const checkExisting = async (data) => {
    const nos = [...new Set(data.students.map((s) => String(s.student_no || '').trim()).filter(Boolean))];
    const names = [...new Set(data.students.map((s) => String(s.name || '').trim()).filter(Boolean))];
    const next = new Map(existingById);
    const nextSame = new Map(sameNameByKey);
    setCheckingExisting(true);
    try {
      for (let i = 0; i < Math.max(nos.length, names.length); i += 5000) {
        const { data: res } = await userService.checkStudentNos(nos.slice(i, i + 5000), names.slice(i, i + 5000));
        (res.existing || []).forEach((u) => next.set(u.student_no, u));
        nos.slice(i, i + 5000).forEach((no) => checkedNos.current.add(no));
        (res.same_name || []).forEach((u) => {
          const k = nameKey(u.name);
          const list = nextSame.get(k) || [];
          if (!list.some((x) => x.student_no === u.student_no)) nextSame.set(k, [...list, u]);
        });
      }
      setExistingById(next);
      setSameNameByKey(nextSame);
      const checked = withCounts(data, revalidate(data.students, next, nextSame));
      setParsedData(checked);
      if (checked.alreadyCount > 0) {
        toast(`${checked.alreadyCount} student(s) already have an account — they'll just be added to this class.`, { icon: 'ℹ️', duration: 6000 });
      }
    } catch (err) {
      console.error('Existing-ID check failed:', err);
      toast.error('Could not check for students already in the system — duplicates will still be skipped when importing.');
    } finally {
      setCheckingExisting(false);
    }
  };

  // Combines parsed results (several files, or files added later) into one
  // review list — rows renumbered, each remembering its source file.
  const mergeResults = (base, results) => {
    const all = [...(base?.students || []), ...results.flatMap((r) => r.students.map((s) => ({ ...s, source: s.source || r.fileName })))]
      // Alphabetical by name — "SURNAME, First M." — rows with no name last.
      .sort((a, b) => (!a.name) - (!b.name) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
    const stamp = Date.now();
    const numbered = all.map((s, i) => ({ ...s, id: `student-row-${i + 1}-${stamp}`, rowNum: i + 1 }));
    const files = [...new Set(numbered.map((s) => s.source).filter(Boolean))];
    return withCounts({ fileName: files.length === 1 ? files[0] : `${files.length} files`, files }, revalidate(numbered));
  };

  // Handle file selection — any number of Word (.docx) / Excel (.xlsx) files at once.
  const handleFiles = async (fileList, append = false) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const isExcel = (f) => f.name.toLowerCase().endsWith('.xlsx');
    const docx = files.filter((f) => f.name.toLowerCase().endsWith('.docx') || isExcel(f));
    if (docx.length < files.length) {
      toast.error(`${files.length - docx.length} file(s) skipped — only Word (.docx) and Excel (.xlsx) files can be read.`);
    }
    if (docx.length === 0) return;

    setParsing(true);
    const results = [];
    const failed = [];
    for (const file of docx) {
      try {
        results.push(await (isExcel(file) ? parseStudentExcel(file, defaults) : parseStudentWordDocx(file, defaults)));
      } catch (err) {
        console.error('Word parse error:', file.name, err);
        failed.push(`${file.name}: ${err.message || 'could not be read'}`);
      }
    }
    setParsing(false);

    if (results.length > 0) {
      const merged = mergeResults(append ? parsedData : null, results);
      setParsedData(merged);
      setImportSummary(null);
      setPage(1);
      const added = results.reduce((n, r) => n + r.students.length, 0);
      toast.success(`Read ${added} student record(s) from ${results.length} file(s)${append ? ` — ${merged.totalRows} in total` : ''}.`);
      checkExisting(merged);
    }
    failed.forEach((msg) => toast.error(msg, { duration: 6000 }));
  };

  const openFilePicker = (append = false) => {
    appendNextRef.current = append;
    fileInputRef.current?.click();
  };

  // After an import finishes: back to the upload screen for the next batch —
  // the Default Program/Year/Section/Regularity choices are kept.
  const startNewImport = () => {
    setParsedData(null);
    setImportSummary(null);
    setGridRows(emptyGrid(10));
    setSearchFilter('');
    setShowIssuesOnly(false);
    setPage(1);
    setActiveTab('upload');
    setExistingById(new Map());
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files, false);
    }
  };

  // Rows typed or pasted into the entry table → the same review step (and the
  // same duplicate / already-imported checks) a Word document goes through.
  const handleGridReview = (records) => {
    const merged = mergeResults(null, [{ students: records, fileName: 'Entered in table' }]);
    setParsedData(merged);
    setImportSummary(null);
    setPage(1);
    checkExisting(merged);
  };

  // Update a single field in a row. A changed Student ID Number is checked
  // against the server again (once the admin stops typing).
  const handleRowChange = (id, field, value) => {
    if (!parsedData) return;
    // Editing the ID or name withdraws a "confirm anyway" made for the old values.
    const resetConfirm = field === 'student_no' || field === 'name' ? { confirmed: false } : {};
    const nextStudents = parsedData.students.map((s) => (s.id === id ? { ...s, [field]: value, ...resetConfirm } : s));
    const next = withCounts(parsedData, revalidate(nextStudents));
    setParsedData(next);
    if (field === 'student_no' && String(value || '').trim() && !existingById.has(String(value).trim())) {
      clearTimeout(idCheckTimer.current);
      idCheckTimer.current = setTimeout(() => {
        userService.checkStudentNos([String(value).trim()]).then(({ data: res }) => {
          checkedNos.current.add(String(value).trim());
          if (!res.existing?.length) { setParsedData((cur) => (cur ? withCounts(cur, revalidate(cur.students)) : cur)); return; }
          const m = new Map(existingById);
          res.existing.forEach((u) => m.set(u.student_no, u));
          setExistingById(m);
          setParsedData((cur) => (cur ? withCounts(cur, revalidate(cur.students, m)) : cur));
        }).catch(() => {});
      }, 500);
    }
  };

  // "Import anyway" on a row flagged as a possible mistyped Student ID.
  const setRowConfirmed = (id, confirmed) => {
    if (!parsedData) return;
    setParsedData(withCounts(parsedData, revalidate(parsedData.students.map((s) => (s.id === id ? { ...s, confirmed } : s)))));
  };

  // Delete a student row
  const handleDeleteRow = (id) => {
    if (!parsedData) return;
    setParsedData(withCounts(parsedData, revalidate(parsedData.students.filter((s) => s.id !== id))));
  };


  // Apply default program/year/section to all rows
  const handleApplyDefaultsToAll = () => {
    if (!parsedData) return;
    const nextStudents = parsedData.students.map((s) => ({
      ...s,
      program: s.program || defaults.program,
      year_level: s.year_level || defaults.year_level,
      section: s.section || defaults.section,
      student_status: s.student_status || defaults.student_status,
    }));
    setParsedData(withCounts(parsedData, revalidate(nextStudents)));
    toast.success('Default values applied to matching rows.');
  };

  // Perform import
  const handleImportSubmit = async () => {
    if (!parsedData || parsedData.students.length === 0) {
      toast.error('No student records to import.');
      return;
    }

    const validStudents = parsedData.students.filter((s) => s.isValid);
    if (validStudents.length === 0) {
      toast.error('No valid student records found. Please fix the highlighted errors before importing.');
      return;
    }

    // Sent CHUNK_SIZE at a time, so there's no practical limit on how many
    // students one import can hold (a single huge request would risk timing
    // out). Results from every chunk are added up into one summary; a chunk
    // that fails outright is reported for its own rows and the rest continue.
    const CHUNK_SIZE = 500;
    const payload = validStudents.map((s) => ({
      student_no: s.student_no,
      name: s.name,
      program: s.program,
      year_level: s.year_level,
      section: s.section,
      email: s.email,
      student_status: s.student_status,
      student_type: s.student_type,
      confirmed: !!s.confirmed,
    }));
    const summary = { createdCount: 0, enrolledCount: 0, alreadyEnrolledCount: 0, skippedCount: 0, errorCount: 0, skipped: [], errors: [] };

    setImporting(true);
    setProgress({ done: 0, total: payload.length });
    for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
      const chunk = payload.slice(i, i + CHUNK_SIZE);
      try {
        const res = adv
          ? await userService.importAdvisoryList({ program: adv.program, year_level: adv.year_level, section: adv.section }, chunk, i)
          : await classService.importClassList(cls.id, chunk, i);
        summary.createdCount += res.data.createdCount || 0;
        summary.enrolledCount += res.data.enrolledCount || 0;
        summary.alreadyEnrolledCount += res.data.alreadyEnrolledCount || 0;
        summary.skippedCount += res.data.skippedCount || 0;
        summary.errorCount += res.data.errorCount || 0;
        summary.skipped.push(...(res.data.skipped || []));
        summary.errors.push(...(res.data.errors || []));
      } catch (err) {
        console.error('Import chunk error:', err);
        const reason = err.response?.data?.message || err.message || 'Request failed';
        summary.errorCount += chunk.length;
        chunk.forEach((s, k) => summary.errors.push({ row: i + k + 1, student_no: s.student_no, name: s.name, error: reason }));
      }
      setProgress({ done: Math.min(i + CHUNK_SIZE, payload.length), total: payload.length });
    }
    summary.message = `${summary.enrolledCount} student(s) added to ${classLabel} — ${summary.createdCount} new account(s) created, ${summary.alreadyEnrolledCount} already in the ${where.toLowerCase()}, ${summary.skippedCount} skipped, ${summary.errorCount} error(s).`;
    setImportSummary(summary);
    setImporting(false);
    setProgress(null);
    if (summary.enrolledCount > 0 || summary.alreadyEnrolledCount > 0) {
      toast.success(`${summary.enrolledCount} student${summary.enrolledCount !== 1 ? 's' : ''} added to ${classLabel}.`);
      if (onSuccess) onSuccess();
    } else {
      toast.error('No students were imported — see the summary.');
    }
  };

  // Filter students for display
  const displayedStudents = (parsedData?.students || []).filter((s) => {
    if (showIssuesOnly && s.isValid) return false;
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      const matchNo = (s.student_no || '').toLowerCase().includes(q);
      const matchName = (s.name || '').toLowerCase().includes(q);
      const matchProg = (s.program || '').toLowerCase().includes(q);
      return matchNo || matchName || matchProg;
    }
    return true;
  });

  const PAGE_SIZE = 100;
  const pageCount = Math.max(1, Math.ceil(displayedStudents.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pagedStudents = displayedStudents.slice(pageStart, pageStart + PAGE_SIZE);

  return (
    <Modal
      title={
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
            <Icons.FileText className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-navy leading-tight">Import Class List</h3>
              {(cls || adv) && <Badge variant="blue" className="text-[11px] font-semibold py-0.5 px-2">{classLabel}</Badge>}
            </div>
            <p className="text-xs text-gray-500 font-normal">
              Bring in this {adv ? 'section' : 'class'}'s students — Student ID Number, Full Name, Program, Year and Section — from Word or Excel files, a pasted list, or the table
            </p>
          </div>
        </div>
      }
      onClose={onClose}
      size="max-w-7xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-gray-500 flex-1 mr-4">
            {progress ? (
              <div className="max-w-md">
                <div className="flex justify-between mb-1">
                  <span>Importing… <b>{progress.done.toLocaleString()}</b> of <b>{progress.total.toLocaleString()}</b></span>
                  <span>{Math.round((progress.done / progress.total) * 100)}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full bg-green-500 transition-all duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                </div>
              </div>
            ) : parsedData && !importSummary && (
              <span>
                <b>{parsedData.validCount.toLocaleString()}</b> ready to import · <b>{parsedData.errorCount.toLocaleString()}</b> issue(s){parsedData.alreadyCount > 0 ? <> · <b className="text-blue-700">{parsedData.alreadyCount.toLocaleString()}</b> already have accounts</> : null}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-outline" onClick={onClose} disabled={importing}>
              {importSummary ? 'Close' : 'Cancel'}
            </button>
            {importSummary && (
              <button className="btn btn-primary flex items-center gap-2" onClick={startNewImport}>
                <Icons.Upload className="w-4 h-4" /> Import More Students
              </button>
            )}
            {parsedData && !importSummary && (
              <button
                className="btn btn-gold flex items-center gap-2"
                onClick={handleImportSubmit}
                disabled={importing || parsing || parsedData.validCount === 0}
              >
                {importing ? (
                  <>
                    <LoadingSpinner size="w-4 h-4" /> Importing...
                  </>
                ) : (
                  <>
                    <Icons.Check className="w-4 h-4" /> Add {parsedData.validCount.toLocaleString()} Student{parsedData.validCount !== 1 ? 's' : ''} to Class
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Always rendered — also used by "Add more files" in the review. */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => { handleFiles(e.target.files, appendNextRef.current); e.target.value = ''; }}
          className="hidden"
        />
        {/* Straight after "Create Class": this is step 2, not optional. */}
        {cls?._justCreated && !parsedData && !importSummary && (
          <div className="rounded-xl border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-800 px-4 py-3 flex items-start gap-2.5">
            <Icons.Check className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-green-900 dark:text-green-200">Class created — step 2: import its class list</p>
              <p className="text-[11px] text-green-800 dark:text-green-300">
                Your class record, grade sheet and grades are based on this list, so add every student who's in {classLabel}. Until then the class can't be opened for encoding.
              </p>
            </div>
          </div>
        )}

        {/* A faculty's class list: students must already be in the system. */}
        {cls && (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
            <Icons.AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-900">
              <b>Only students who already have an account can be added.</b> Student accounts are created when the section's adviser imports their advisory class list — a Student ID Number that isn't in the system yet is skipped here.
            </p>
          </div>
        )}

        {/* No template — any class list works as long as each student has these. */}
        <div className="bg-blue-50/60 dark:bg-gray-800/60 border border-blue-100 dark:border-gray-700 rounded-xl p-3.5 flex flex-wrap sm:flex-nowrap items-start gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 flex items-center justify-center flex-shrink-0">
            <Icons.FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-navy">Any format works — or use the Excel template</p>
            <p className="text-[11px] text-gray-500 mb-2">
              Any Word or Excel file, copied table or typed list, in any column order or wording — as long as each student has:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {['Student ID Number', 'Full Name', 'Program', 'Year', 'Section'].map((f) => (
                <span key={f} className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 rounded-full px-2.5 py-0.5">
                  <Icons.Check className="w-3 h-3 text-green-500" /> {f}
                </span>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              The name can be in one column ("DELA CRUZ, Juan M.") or split; Program / Year / Section can be separate, combined ("BSIT 4-D"), or written once above the list.
            </p>
          </div>
          {/* Right side of the card, vertically centered. */}
          <button
            type="button"
            className="self-center flex items-center gap-2 px-5 py-3 text-sm font-bold rounded-lg cursor-pointer border-none font-sans text-white shadow-md hover:shadow-lg hover:brightness-110 transition-all flex-shrink-0 whitespace-nowrap"
            style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
            onClick={() => downloadStudentExcelTemplate(defaults, classLabel).catch(() => toast.error('Could not create the template'))}
            title="Blank Excel class list: Student ID Number, Student Full Name, Program, Year, Section"
          >
            <Icons.Download className="w-5 h-5" /> Download Excel Template
          </button>
        </div>

        {/* DEFAULT VALUES BAR: Fills missing columns */}
        <div className="bg-gray-50 dark:bg-gray-800/40 border border-gray-200 dark:border-gray-700/80 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-navy flex items-center gap-1.5">
              <Icons.Settings className="w-3.5 h-3.5 text-gray-500" />
              Default Values for Missing Fields
            </span>
            {parsedData && (
              <button
                type="button"
                onClick={handleApplyDefaultsToAll}
                className="text-[11px] text-blue-600 hover:text-blue-700 font-medium cursor-pointer underline bg-transparent border-none p-0"
              >
                Apply defaults to all rows missing them
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Default Program</label>
              <select
                className="form-select py-1.5 text-xs w-full"
                value={defaults.program}
                onChange={(e) => setDefaults({ ...defaults, program: e.target.value })}
              >
                {OFFICIAL_PROGRAMS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Default Year Level</label>
              <select
                className="form-select py-1.5 text-xs w-full"
                value={defaults.year_level}
                onChange={(e) => setDefaults({ ...defaults, year_level: parseInt(e.target.value, 10) })}
              >
                {[1, 2, 3, 4].map((y) => (
                  <option key={y} value={y}>Year {y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Default Section</label>
              <select
                className="form-select py-1.5 text-xs w-full"
                value={defaults.section}
                onChange={(e) => setDefaults({ ...defaults, section: e.target.value })}
              >
                {VALID_SECTIONS.map((s) => (
                  <option key={s} value={s}>Section {s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Default Regularity</label>
              <select
                className="form-select py-1.5 text-xs w-full"
                value={defaults.student_status}
                onChange={(e) => setDefaults({ ...defaults, student_status: e.target.value })}
              >
                <option value="Regular">Regular</option>
                <option value="Irregular">Irregular</option>
              </select>
            </div>
          </div>
        </div>

        {/* INPUT TABS: Upload vs Paste */}
        {!parsedData && (
          <div>
            <div className="flex border-b border-gray-200 dark:border-gray-700 mb-3">
              <button
                type="button"
                className={`py-2 px-4 text-xs font-semibold border-b-2 font-sans transition-colors cursor-pointer bg-transparent border-none ${
                  activeTab === 'upload'
                    ? 'border-blue-600 text-blue-600 border-solid'
                    : 'text-gray-500 hover:text-gray-700 border-transparent'
                }`}
                onClick={() => setActiveTab('upload')}
              >
                <span className="flex items-center gap-1.5">
                  <Icons.Upload className="w-3.5 h-3.5" /> Upload Word / Excel File
                </span>
              </button>
              <button
                type="button"
                className={`py-2 px-4 text-xs font-semibold border-b-2 font-sans transition-colors cursor-pointer bg-transparent border-none ${
                  activeTab === 'paste'
                    ? 'border-blue-600 text-blue-600 border-solid'
                    : 'text-gray-500 hover:text-gray-700 border-transparent'
                }`}
                onClick={() => setActiveTab('paste')}
              >
                <span className="flex items-center gap-1.5">
                  <Icons.Clipboard className="w-3.5 h-3.5" /> Enter in Table (type or paste)
                </span>
              </button>
            </div>

            {activeTab === 'upload' ? (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => openFilePicker(false)}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  dragOver
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 shadow-md scale-[1.005]'
                    : 'border-gray-300 dark:border-gray-700 hover:border-blue-400 bg-gray-50/40 dark:bg-gray-800/30'
                }`}
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-600 mx-auto flex items-center justify-center mb-3 shadow-inner">
                  {parsing ? <LoadingSpinner size="w-7 h-7" /> : <Icons.FileText className="w-7 h-7" />}
                </div>
                <p className="text-sm font-bold text-navy mb-1">
                  {parsing ? 'Reading files...' : 'Click to browse or drag & drop Word (.docx) or Excel (.xlsx) files — as many as you need'}
                </p>
                <p className="text-xs text-gray-500 max-w-md mx-auto">
                  Any layout: a table with headers, a table without headers, separate Surname / First Name / M.I. columns, a combined "Course, Year & Section" column, or plain lines of text. Every row is shown for review before importing.
                </p>
                <div className="mt-4 flex items-center justify-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                    <Icons.Check className="w-3 h-3 text-green-500" /> Automatic Table Detection
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                    <Icons.Check className="w-3 h-3 text-green-500" /> Smart Column Mapping
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700">
                    <Icons.Check className="w-3 h-3 text-green-500" /> Multiple Files · No Row Limit
                  </span>
                </div>
              </div>
            ) : (
              <StudentEntryGrid rows={gridRows} setRows={setGridRows} defaults={defaults} onReview={handleGridReview} existingOnly={!!cls} />
            )}
          </div>
        )}

        {/* IMPORT RESULTS SUMMARY (When backend finished processing) */}
        {importSummary && (
          <div className="bg-green-50/70 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
                <Icons.Check className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-green-900 dark:text-green-200">Class List Imported</h4>
                <p className="text-xs text-green-700 dark:text-green-300">
                  {importSummary.message}
                </p>
              </div>
              <button type="button" className="btn btn-primary btn-sm flex items-center gap-1.5 flex-shrink-0" onClick={startNewImport}>
                <Icons.Upload className="w-3.5 h-3.5" /> Import More
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 border-t border-green-200 dark:border-green-800 text-center">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-green-100 dark:border-green-900">
                <span className="text-xl font-bold text-green-600">{importSummary.enrolledCount || 0}</span>
                <p className="text-[11px] text-gray-500">Added to {where}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-blue-100 dark:border-blue-900">
                <span className="text-xl font-bold text-blue-600">{importSummary.createdCount || 0}</span>
                <p className="text-[11px] text-gray-500">New Accounts</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-700">
                <span className="text-xl font-bold text-gray-600">{importSummary.alreadyEnrolledCount || 0}</span>
                <p className="text-[11px] text-gray-500">Already in {where}</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-amber-100 dark:border-amber-900">
                <span className="text-xl font-bold text-amber-600">{importSummary.skippedCount || 0}</span>
                <p className="text-[11px] text-gray-500">Skipped</p>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-red-100 dark:border-red-900">
                <span className="text-xl font-bold text-red-600">{importSummary.errorCount || 0}</span>
                <p className="text-[11px] text-gray-500">Errors</p>
              </div>
            </div>

            {importSummary.errors && importSummary.errors.length > 0 && (
              <div className="mt-2 text-xs bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-2.5">
                <p className="font-semibold text-red-800 dark:text-red-300 mb-1">Not imported:</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {importSummary.errors.map((er, idx) => (
                    <p key={idx} className="text-[11px] text-red-700 dark:text-red-400">
                      • Row {er.row}: {er.name} ({er.student_no}) — {er.error}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* List skipped duplicates if any */}
            {importSummary.skipped && importSummary.skipped.length > 0 && (
              <div className="mt-2 text-xs bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5">
                <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1">Skipped:</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {importSummary.skipped.map((sk, idx) => (
                    <p key={idx} className="text-[11px] text-amber-700 dark:text-amber-400">
                      • {sk.name} ({sk.student_no}) — {sk.reason}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* PARSED DATA PREVIEW & EDIT TABLE */}
        {parsedData && !importSummary && (
          <div className="space-y-3">
            {/* Header controls */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-navy flex items-center gap-1.5" title={(parsedData.files || []).join(', ')}>
                  <Icons.FileText className="w-3.5 h-3.5 text-blue-600" />
                  Source: <b>{parsedData.fileName}</b> ({parsedData.totalRows.toLocaleString()} students)
                </span>
                <button
                  type="button"
                  onClick={() => openFilePicker(true)}
                  disabled={parsing}
                  className="btn btn-outline btn-sm text-[11px] py-1 px-2.5 flex items-center gap-1 text-blue-700 border-blue-300"
                >
                  {parsing ? <LoadingSpinner size="w-3 h-3" /> : <Icons.Plus className="w-3 h-3" />} Add more files
                </button>
                <button
                  type="button"
                  onClick={() => { setParsedData(null); setPage(1); }}
                  className="text-[11px] text-gray-400 hover:text-red-500 underline bg-transparent border-none cursor-pointer"
                >
                  Start over
                </button>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative w-44">
                  <input
                    type="text"
                    placeholder="Filter preview..."
                    className="form-input py-1 text-xs w-full pr-8"
                    value={searchFilter}
                    onChange={(e) => { setSearchFilter(e.target.value); setPage(1); }}
                  />
                  <ClearSearchButton value={searchFilter} onClear={() => { setSearchFilter(''); setPage(1); }} />
                </div>
                <button
                  type="button"
                  onClick={() => { setShowIssuesOnly(!showIssuesOnly); setPage(1); }}
                  className={`btn btn-sm text-xs py-1 px-2.5 flex items-center gap-1 ${
                    showIssuesOnly ? 'btn-danger' : 'btn-outline'
                  }`}
                >
                  <Icons.AlertCircle className="w-3 h-3" />
                  {showIssuesOnly ? 'Show All' : `Issues (${parsedData.errorCount})`}
                </button>
              </div>
            </div>

            {/* Table */}
            {/* Students imported before can't be imported again — said up
                front, before importing. */}
            {checkingExisting && (
              <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <LoadingSpinner size="w-3 h-3" /> Checking which students are already in the system…
              </p>
            )}
            {parsedData.nameIssueCount > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800 px-4 py-3">
                <Icons.AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    {parsedData.nameIssueCount.toLocaleString()} row{parsedData.nameIssueCount !== 1 ? 's' : ''} may have a mistyped Student ID Number
                  </p>
                  <p className="text-[11px] text-amber-800 dark:text-amber-300">
                    The name doesn't match the account with that ID, or that name already has an account under a different ID.
                    Fix the ID — or, if it's correct, confirm the row. Until then those rows won't be imported.
                  </p>
                </div>
              </div>
            )}
            {parsedData.alreadyCount > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-800 px-4 py-3">
                <Icons.AlertCircle className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-blue-900 dark:text-blue-200">
                    {parsedData.alreadyCount.toLocaleString()} student{parsedData.alreadyCount !== 1 ? 's already have' : ' already has'} an account
                  </p>
                  <p className="text-[11px] text-blue-800 dark:text-blue-300">
                    They won't be created again — they'll just be added to this class. Check that the name on their account (shown under each) is the right student.
                  </p>
                </div>
              </div>
            )}

            {/* Fixed column widths sized to their content, scrolling sideways
                inside this box when the pop-up is narrower — never squeezed
                (a squeezed column cut off the program and hid "Yr 4" / the
                section letter under its own dropdown arrow). */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-xl max-h-[28rem] overflow-auto shadow-inner bg-white dark:bg-gray-800">
              <table className="text-left text-xs border-collapse table-fixed" style={{ width: 1400, minWidth: '100%' }}>
                <colgroup>
                  <col style={{ width: 48 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 270 }} />
                  <col style={{ width: 330 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 220 }} />
                  <col style={{ width: 130 }} />
                  <col style={{ width: 62 }} />
                </colgroup>
                <thead className="sticky top-0 bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 z-10 text-gray-600 dark:text-gray-300">
                  <tr>
                    <th className="py-2.5 px-3 text-center">#</th>
                    <th className="py-2.5 px-2">Student No *</th>
                    <th className="py-2.5 px-2">Full Name *</th>
                    <th className="py-2.5 px-2">Program *</th>
                    <th className="py-2.5 px-2">Year</th>
                    <th className="py-2.5 px-2">Section</th>
                    <th className="py-2.5 px-2">Email (Optional)</th>
                    <th className="py-2.5 px-2">Status</th>
                    <th className="py-2.5 px-2 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {pagedStudents.map((s, idx) => (
                    <tr
                      key={s.id}
                      className={`hover:bg-gray-50/80 dark:hover:bg-gray-750 transition-colors ${
                        !s.isValid
                          ? 'bg-red-50/40 dark:bg-red-950/20'
                          : s.existingAccount ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                      }`}
                    >
                      <td className="py-1.5 px-3 text-center text-gray-400 text-[11px] font-mono">
                        {s.rowNum || (pageStart + idx + 1)}
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          className={`form-input py-1.5 px-2 text-xs w-full font-mono ${
                            !s.student_no ? 'border-red-400 bg-red-50/30' : ''
                          }`}
                          value={s.student_no}
                          onChange={(e) => handleRowChange(s.id, 'student_no', e.target.value)}
                          placeholder="e.g. 240001"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="text"
                          className={`form-input py-1.5 px-2 text-xs w-full ${
                            !s.name ? 'border-red-400 bg-red-50/30' : ''
                          }`}
                          value={s.name}
                          onChange={(e) => handleRowChange(s.id, 'name', upperSurname(e.target.value))}
                          placeholder="e.g. DELA CRUZ, Juan"
                        />
                        {!s.isValid && (
                          <p className="text-[10px] mt-0.5 leading-tight text-red-600">{s.errors.join(' · ')}</p>
                        )}
                        {s.nameIssue && !s.confirmed && (
                          <button
                            type="button"
                            className="mt-1 text-[10px] font-semibold text-amber-700 underline bg-transparent border-none cursor-pointer p-0"
                            onClick={() => setRowConfirmed(s.id, true)}
                            title={s.nameIssue.kind === 'id'
                              ? 'Use this only if it really is the same student (e.g. their name changed)'
                              : 'Use this only if this is a different student who happens to have the same name'}
                          >
                            {s.nameIssue.kind === 'id' ? 'It’s the same student — import anyway' : 'It’s a different student — import anyway'}
                          </button>
                        )}
                        {s.nameIssue && s.confirmed && (
                          <p className="text-[10px] mt-0.5 leading-tight text-amber-700">
                            Confirmed: {s.nameIssue.kind === 'id' ? 'same student' : 'different student'}{' '}
                            <button type="button" className="underline bg-transparent border-none cursor-pointer p-0 text-amber-700" onClick={() => setRowConfirmed(s.id, false)}>Undo</button>
                          </p>
                        )}
                        {s.isValid && s.existingAccount && (
                          <p className="text-[10px] mt-0.5 leading-tight text-blue-700">
                            Already has an account — will be added to this class
                          </p>
                        )}
                      </td>
                      <td className="py-1 px-2">
                        <select
                          className={`form-select py-1.5 pl-2 pr-8 text-xs w-full ${!s.program ? 'border-red-400 bg-red-50/30' : ''}`}
                          value={s.program || ''}
                          onChange={(e) => handleRowChange(s.id, 'program', e.target.value)}
                          title={s.program}
                        >
                          {!s.program && <option value="">Choose program…</option>}
                          {OFFICIAL_PROGRAMS.map((p) => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-2">
                        <select
                          className="form-select py-1.5 pl-2 pr-8 text-xs w-full"
                          value={s.year_level}
                          onChange={(e) => handleRowChange(s.id, 'year_level', parseInt(e.target.value, 10))}
                        >
                          {[1, 2, 3, 4].map((y) => (
                            <option key={y} value={y}>Year {y}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-2">
                        <select
                          className="form-select py-1.5 pl-2 pr-8 text-xs w-full"
                          value={s.section || ''}
                          onChange={(e) => handleRowChange(s.id, 'section', e.target.value)}
                        >
                          <option value="">—</option>
                          {VALID_SECTIONS.map((sec) => (
                            <option key={sec} value={sec}>{sec}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-2">
                        <input
                          type="email"
                          className="form-input py-1.5 px-2 text-xs w-full"
                          value={s.email || ''}
                          onChange={(e) => handleRowChange(s.id, 'email', e.target.value)}
                          placeholder="Optional"
                        />
                      </td>
                      <td className="py-1 px-2">
                        <select
                          className="form-select py-1.5 pl-2 pr-8 text-xs w-full"
                          value={s.student_status}
                          onChange={(e) => handleRowChange(s.id, 'student_status', e.target.value)}
                        >
                          <option value="Regular">Regular</option>
                          <option value="Irregular">Irregular</option>
                        </select>
                      </td>
                      <td className="py-1 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(s.id)}
                          title="Delete row"
                          className="text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors border-none bg-transparent cursor-pointer"
                        >
                          <Icons.Trash className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {displayedStudents.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-gray-400 text-xs">
                        No students match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pages of PAGE_SIZE rows — thousands of editable rows at once
                would make the pop-up sluggish. */}
            {pageCount > 1 && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  Showing {(pageStart + 1).toLocaleString()}–{Math.min(pageStart + PAGE_SIZE, displayedStudents.length).toLocaleString()} of {displayedStudents.length.toLocaleString()}
                </span>
                <div className="flex items-center gap-1.5">
                  <button type="button" className="btn btn-outline btn-sm py-1 px-2.5" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹ Prev</button>
                  <span className="px-2">Page <b>{currentPage}</b> of {pageCount}</span>
                  <button type="button" className="btn btn-outline btn-sm py-1 px-2.5" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next ›</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
