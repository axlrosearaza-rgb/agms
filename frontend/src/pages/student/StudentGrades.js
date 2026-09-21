import { useState, useEffect, useCallback } from 'react';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, ShadingType, BorderStyle, VerticalAlign, ImageRun } from 'docx';
import { saveAs } from 'file-saver';
import { useAuth } from '../../context/AuthContext';
import { LoadingSpinner, ConfidentialityBanner, ProgramBadge, RegularityBadge, Modal, Icons, programShortLabel } from '../../components/common';
import ProspectusTable from '../../components/student/ProspectusTable';
import { exportEvaluationOfGradesDocx } from '../../utils/evaluationOfGradesDocx';
import { gradeService, semesterService } from '../../services';
import socket from '../../services/socket';
import { usePageState } from '../../hooks/usePageState';

// ── Word export helpers ──────────────────────────────────────────────────────
const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };
const HEADER_SHADE = 'F3F4F6';

function cell(text, { bold = false, shade = null, rowSpan, columnSpan, align = AlignmentType.CENTER, color } = {}) {
  return new TableCell({
    rowSpan,
    columnSpan,
    borders: CELL_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    shading: shade ? { fill: shade, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ alignment: align, children: [new TextRun({ text: String(text ?? ''), bold, size: 18, color })] })],
  });
}

function headingParagraph(text, { size = 24, underline = false, spacingBefore = 200, spacingAfter = 120 } = {}) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: spacingBefore, after: spacingAfter },
    children: [new TextRun({ text, bold: true, size, underline: underline ? {} : undefined })],
  });
}

// My Grades — the full curriculum checklist ("prospectus") for the student's
// program, Year 1 through 4, so they can see at a glance which subjects
// they've already passed, which are in progress, and which are still ahead —
// not just the classes they happen to be enrolled in this term.
export default function StudentGrades() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = usePageState('StudentGrades.search', '');

  const fetchProspectus = useCallback(async () => {
    try {
      setLoading(true);
      const { data: result } = await gradeService.getStudentProspectus(user.id);
      setData(result);
    } catch (err) {
      console.error('Error fetching prospectus:', err);
    } finally {
      setLoading(false);
    }
  }, [user.id]);

  useEffect(() => { fetchProspectus(); }, [fetchProspectus]);

  useEffect(() => {
    socket.on('gradesUpdated', () => fetchProspectus());
    return () => socket.off('gradesUpdated');
  }, [fetchProspectus]);

  // Grade Slip — a per-semester export (unlike Evaluation of Grades above,
  // which is the whole curriculum at once), so it needs its own semester
  // picker: which term to pull Subject/Faculty/Remarks for.
  const [semesters, setSemesters] = useState([]);
  const [showSlipModal, setShowSlipModal] = useState(false);
  const [slipSemester, setSlipSemester] = useState('');
  // An Irregular student can carry classes from more than one Year Level
  // within the very same Semester (a back subject alongside their current
  // load) — this narrows the slip to just one Year's worth of subjects.
  // 'all' keeps the previous behavior (every class that term, any Year).
  const [slipYear, setSlipYear] = useState('all');
  const [exportingSlip, setExportingSlip] = useState(false);

  useEffect(() => {
    semesterService.getAll()
      .then(({ data: result }) => {
        const rows = result?.semesters || [];
        setSemesters(rows);
        // Default to the current semester if there is one, else the most
        // recent — one less click for the common case.
        const current = rows.find((s) => s.is_current);
        setSlipSemester(current?.name || rows[0]?.name || '');
      })
      .catch((err) => console.error('Error loading semesters:', err));
  }, []);

  const exportGradeSlip = async () => {
    if (!slipSemester) return;
    setExportingSlip(true);
    try {
      const { data: result } = await gradeService.getStudentGrades(user.id, { semester: slipSemester });
      const student = result.student || user;
      // Only classes with a released grade belong on a Grade Slip — an
      // ungraded/unreleased enrollment has no Remarks to put on it yet.
      // Narrowed further to the picked Year Level, unless "All Years" —
      // relevant for an Irregular student with classes from more than one
      // Year in the same Semester.
      const rows = (result.grades || [])
        .filter((r) => r.grade && r.grade.released)
        .filter((r) => slipYear === 'all' || String(r.class?.year_level) === slipYear);

      const children = [];
      try {
        // Both seals side by side — same pairing Login/Register already show
        // on screen (SSU on the left, the college's own CAS seal on the
        // right), not just the university seal alone.
        const [sealBuf, casBuf] = await Promise.all([
          fetch('/assets/logos/ssu-logo.png').then((r) => r.arrayBuffer()),
          fetch('/assets/logos/cas-logo.png').then((r) => r.arrayBuffer()),
        ]);
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({ type: 'png', data: sealBuf, transformation: { width: 60, height: 60 } }),
            new TextRun({ text: '   ' }),
            new ImageRun({ type: 'png', data: casBuf, transformation: { width: 60, height: 60 } }),
          ],
        }));
      } catch (imgErr) {
        console.error('Seal image(s) failed to load — continuing without them:', imgErr);
      }
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'SAMAR STATE UNIVERSITY', bold: true, size: 28 })] }));
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Arteche Blvd., Catbalogan City, Philippines 6700', size: 18 })] }));
      children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'College of Arts and Sciences', size: 18 })] }));
      children.push(headingParagraph('OFFICIAL GRADE SLIP', { size: 30, spacingBefore: 300 }));

      // Each field its own line (not paired up via tabs). Year Level prefers
      // the actual CLASS's own year_level for this term over the student's
      // blanket current one — for an Irregular student those can genuinely
      // differ (e.g. exporting a past/back-subject semester while they're
      // now primarily a higher Year), so this keeps the slip accurate to
      // what term is actually being exported, not just "where they are now".
      // Falls back to the student record only when there are zero classes
      // this term to read it from. `class.academic_year` is an optional
      // column that's often just never set — falls back to pulling the
      // YYYY-YYYY straight out of the semester string itself (which always
      // has it) rather than printing a blank "ACADEMIC YEAR:" line. Semester
      // itself has that same YYYY-YYYY stripped back out before display —
      // it's already its own field right below, showing it twice was redundant.
      const firstClass = rows[0]?.class;
      const academicYear = firstClass?.academic_year || (slipSemester.match(/\d{4}-\d{4}/) || [])[0] || '';
      const semesterName = slipSemester.replace(/\s*\d{4}-\d{4}\s*/, '').trim();
      const infoField = (label, value, after = 60) => children.push(new Paragraph({
        spacing: { after },
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 20 }),
          new TextRun({ text: value, size: 20 }),
        ],
      }));
      infoField('NAME', (student.name || '').toUpperCase());
      infoField('STUDENT ID NUMBER', student.student_no || '—');
      infoField('YEAR LEVEL', firstClass?.year_level ? `Year ${firstClass.year_level}` : (student.year_level ? `Year ${student.year_level}` : '—'));
      infoField('SECTION', firstClass?.section || student.section || '—');
      infoField('SEMESTER', semesterName);
      infoField('ACADEMIC YEAR', academicYear, 200);

      if (rows.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'No released grades for this semester yet.', italics: true, size: 20 })] }));
      } else {
        const headerRow = new TableRow({
          tableHeader: true,
          children: [
            cell('Subject Code', { bold: true, shade: HEADER_SHADE, align: AlignmentType.LEFT }),
            cell('Subject Description', { bold: true, shade: HEADER_SHADE, align: AlignmentType.LEFT }),
            cell('Faculty', { bold: true, shade: HEADER_SHADE, align: AlignmentType.LEFT }),
            cell('Grade', { bold: true, shade: HEADER_SHADE }),
            cell('Remarks', { bold: true, shade: HEADER_SHADE }),
          ],
        });
        const dataRows = rows.map((r) => new TableRow({
          children: [
            cell(r.class?.subject?.code || '—', { align: AlignmentType.LEFT }),
            cell(r.class?.subject?.name || '—', { align: AlignmentType.LEFT }),
            cell(r.class?.instructor?.name || '—', { align: AlignmentType.LEFT }),
            cell(r.grade?.average != null ? parseFloat(r.grade.average).toFixed(1) : '—', { bold: true }),
            cell(r.grade?.status || '—', { bold: true }),
          ],
        }));
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }));
      }

      // Signature — just the one space asked for, not the two-signatory
      // Registrar block Evaluation of Grades uses (this is the student's own
      // copy, not an official transcript).
      children.push(new Paragraph({ text: '', spacing: { before: 500 } }));
      children.push(new Paragraph({
        border: { top: { style: BorderStyle.SINGLE, size: 4, color: '333333' } },
        // A paragraph border spans its full line width by default — the
        // whole page's content width, which read as a stray line running
        // edge to edge. Indenting both sides shrinks just the border (and
        // the centered text riding on top of it) down to a normal
        // signature-line length instead.
        indent: { left: 2600, right: 2600 },
        spacing: { before: 500 },
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: 'Signature Over Printed Name', size: 18 })],
      }));

      const doc = new Document({ sections: [{ children }] });
      const blob = await Packer.toBlob(doc);
      const yearSuffix = slipYear === 'all' ? '' : `_Year${slipYear}`;
      saveAs(blob, `${(student.student_no || student.name || 'GradeSlip').replace(/\s+/g, '_')}_GradeSlip_${slipSemester.replace(/\s+/g, '_')}${yearSuffix}.docx`);
      setShowSlipModal(false);
    } catch (err) {
      console.error('Failed to export Grade Slip to Word:', err);
    } finally {
      setExportingSlip(false);
    }
  };

  const [exporting, setExporting] = useState(false);
  // Fills the actual source .docx template (public/templates/evaluation-of-
  // grades-template.docx — the real letterhead, badges, borders, and
  // signature block byte-for-byte) instead of hand-reconstructing the layout
  // with the docx library — see utils/evaluationOfGradesDocx.js.
  const exportEvaluationOfGrades = async () => {
    if (!data) return;
    setExporting(true);
    try {
      await exportEvaluationOfGradesDocx({ student: data.student || user, years: data.years || {}, chairperson: data.chairperson });
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  const summary = data?.summary || {};
  const student = data?.student || user;

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
        }
      `}</style>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3 no-print">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg font-bold text-navy">My Grades</h2>
            <RegularityBadge status={user?.student_status} />
          </div>
          <p className="text-[13px] text-gray-500 flex items-center gap-1.5 flex-wrap">
            <ProgramBadge program={user?.program} bs /> · Prospectus{summary.gwa && <span className="ml-2 font-semibold text-navy">· GWA: {summary.gwa}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowSlipModal(true)}
            className="px-4 py-2 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans text-white disabled:opacity-60"
            style={{ background: '#b8860b' }}
          >
            Export Grade Slip (Word)
          </button>
          <button
            onClick={exportEvaluationOfGrades}
            disabled={exporting}
            className="px-4 py-2 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans text-white disabled:opacity-60"
            style={{ background: '#1a3a5c' }}
          >
            {exporting ? 'Exporting…' : 'Export Evaluation of Grades (Word)'}
          </button>
        </div>
      </div>

      <div className="no-print">
        <ConfidentialityBanner />
      </div>

      {/* Search */}
      <div className="flex flex-wrap gap-3 mb-5 no-print">
        <input
          type="text"
          placeholder="Search subject by code or name..."
          className="form-input text-sm flex-1 min-w-[240px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6 no-print">
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-navy">{summary.total_subjects || 0}</p>
          <p className="text-xs text-gray-500 mt-1">Curriculum Subjects</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-green-500">{summary.passed || 0}</p>
          <p className="text-xs text-gray-500 mt-1">Passed</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-red-500">{summary.failed || 0}</p>
          <p className="text-xs text-gray-500 mt-1">Failed</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-blue-500">{summary.in_progress || 0}</p>
          <p className="text-xs text-gray-500 mt-1">In Progress</p>
        </div>
        <div className="card p-4 text-center">
          <p className="text-2xl font-bold text-gray-400">{summary.not_taken || 0}</p>
          <p className="text-xs text-gray-500 mt-1">Not Taken Yet</p>
        </div>
      </div>

      {summary.total_curriculum_units > 0 && (
        <div className="card p-4 mb-6 flex items-center justify-between no-print">
          <span className="text-sm text-gray-600">Units Earned</span>
          <span className="text-sm font-bold text-navy">{summary.units_earned || 0} / {summary.total_curriculum_units} units</span>
        </div>
      )}

      {/* ── Evaluation of Grades — official-form letterhead, printable ── */}
      <div className="card p-6">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <img src="/assets/logos/ssu-logo.png" alt="SSU" style={{ width: 52, height: 52, flexShrink: 0 }} />
          <div>
            <p style={{ fontWeight: 700, fontSize: 14, margin: 0 }}>SAMAR STATE UNIVERSITY</p>
            <p style={{ fontSize: 11, margin: 0 }}>Arteche Blvd., Catbalogan City, Philippines 6700</p>
            {/* This is the College's own self-service copy, not something
                issued by the Registrar — the letterhead and the disclaimer
                below both need to say so honestly. */}
            <p style={{ fontSize: 11, margin: 0 }}>College of Arts and Sciences</p>
          </div>
        </div>
        <div style={{ borderBottom: '3px solid #000', marginBottom: 14 }} />

        <div style={{ background: '#FFF3B0', padding: '8px 12px', fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
          {(student.program || '').toUpperCase()}{student.program ? ` (${programShortLabel(student.program).toUpperCase()})` : ''}
        </div>

        <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, margin: '10px 0 2px' }}>EVALUATION OF GRADES</h2>
        <p style={{ textAlign: 'center', fontSize: 11, margin: '0 0 16px' }}>Revised 2023</p>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 20 }}>
          <p style={{ margin: 0 }}><b style={{ textDecoration: 'underline' }}>NAME:</b> <span style={{ textDecoration: 'underline' }}>{student.name?.toUpperCase()}</span></p>
          <p style={{ margin: 0, fontWeight: 700, textDecoration: 'underline' }}>{student.student_no}</p>
        </div>

        <ProspectusTable years={data?.years || {}} studentId={user.id} search={search} collapsible={false} />

        {/* Matches the Word export exactly: Evaluated By (Adviser, blank)
            and Noted By (the named Dean signatory) side by side with a
            visible gap, then Verified By (the student's own program's
            actual Chairperson, looked up server-side) on its own row
            below, separated by a clear gap. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, fontSize: 12, marginTop: 50 }}>
          <div>
            <p style={{ margin: '0 0 24px', fontWeight: 700 }}>Evaluated By:</p>
            <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, fontWeight: 700, minHeight: '1em' }}>&nbsp;</p>
            <p style={{ fontSize: 10, margin: '4px 0 0' }}>Adviser</p>
          </div>
          <div>
            <p style={{ margin: '0 0 24px', fontWeight: 700 }}>Noted By:</p>
            <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, fontWeight: 700 }}>SWEET MERCY F. PACOLOR, DIT</p>
            <p style={{ fontSize: 10, margin: '4px 0 0' }}>Dean, College of Arts and Sciences</p>
          </div>
        </div>

        <div style={{ fontSize: 12, marginTop: 36 }}>
          <p style={{ margin: '0 0 24px', fontWeight: 700 }}>Verified By:</p>
          <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, fontWeight: 700, maxWidth: 260, minHeight: '1em' }}>{data?.chairperson?.name?.toUpperCase() || ' '}</p>
          <p style={{ fontSize: 10, margin: '4px 0 0' }}>Chairperson{student.program ? `, ${programShortLabel(student.program)}` : ''}</p>
        </div>

        {/* Verbatim wording from the source form's own disclaimer. */}
        <p style={{ fontSize: 10, marginTop: 30, color: '#666', fontStyle: 'italic' }}>
          Note: This is a student's copy generated from the Academic Grade Management System of the College of Arts and Sciences.
          It is unofficial and not valid for any legal purpose. For official records, request a Evaluation of grades from
          the Office of the University Registrar.
        </p>
      </div>

      {showSlipModal && (
        <Modal title="Export Grade Slip" onClose={() => setShowSlipModal(false)} size="max-w-md">
          <p className="text-sm text-gray-500 mb-4">
            Choose the semester — the slip lists that term's subjects, faculty, and remarks, with a space for your signature.
          </p>
          <label className="form-label">Semester</label>
          <select className="form-select" value={slipSemester} onChange={(e) => setSlipSemester(e.target.value)}>
            {semesters.length === 0 && <option value="">No semesters found</option>}
            {semesters.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
          <label className="form-label mt-3">Year Level</label>
          <select className="form-select" value={slipYear} onChange={(e) => setSlipYear(e.target.value)}>
            <option value="all">All Years</option>
            {[1, 2, 3, 4].map((yr) => <option key={yr} value={String(yr)}>Year {yr}</option>)}
          </select>
          <div className="flex justify-end gap-2 mt-6">
            <button className="btn btn-outline" onClick={() => setShowSlipModal(false)} disabled={exportingSlip}>Cancel</button>
            <button className="btn btn-gold" onClick={exportGradeSlip} disabled={exportingSlip || !slipSemester}>
              <Icons.FileText className="w-4 h-4" /> {exportingSlip ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
