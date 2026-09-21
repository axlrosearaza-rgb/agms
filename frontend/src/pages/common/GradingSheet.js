import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { gradeService } from '../../services';
import { LoadingSpinner, comparePeopleNames, formatPersonName, formatPersonNameCapsSurname } from '../../components/common';
// Mirrors whatever the Class Record already has marked for this student — an
// INC there means the Grading Sheet shows INC too, automatically, not a blank
// Remarks waiting on it to be resolved first. Shared with classRecordExcel.js/
// ClassRecordView.js so this table's own Remarks column is never a different
// color/wording from the Class Record's own Passed/Failed/INC/DROP cells.
import { remarksFor, remarksStyle } from '../../utils/classRecordExcel';
import toast from 'react-hot-toast';

const TOTAL_ROWS = 25;

// Same fix as classRecordExcel.js's stripYearFromSemester — `semester`
// already bakes its own academic year into the string ("First Semester
// 2026-2027"), so printing academic_year AND the raw semester string side
// by side either leaves "AY ________" blank (when academic_year itself
// isn't set on this class) or prints the year twice. Strips whatever year
// the semester string carries back out of it once it's been used as the
// AY fallback.
const stripYearFromSemester = (semester, academicYear) => {
  const raw = semester || '';
  const withoutYear = academicYear ? raw.replace(academicYear, '') : raw.replace(/\d{4}-\d{4}/, '');
  return withoutYear.replace(/,?\s*$/, '').trim();
};

export default function GradingSheet() {
  const { classId } = useParams();
  // Removed from every role's on-screen preview (Chairperson/Admin reviewing
  // on their own Grade Approval pages, and now Faculty's own preview too) —
  // the signatory block (Verified Correct / Submitted by / Received by /
  // Approved, Registrar & VPAA names) and footer stay in the actual exported
  // .docx (a separate backend-generated file, untouched by this flag), just
  // not shown in this in-app preview screen.
  const showSignatureBlock = false;
  // Embedded as an iframe preview (Admin's Grade Approval list) instead of
  // opened in its own tab — auto-print would pop a print dialog inside that
  // preview otherwise, same reasoning as ClassRecordView's isPreview.
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('preview') === '1';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const hasAutoPrinted = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: result } = await gradeService.getByClass(classId);
        setData(result);
      } catch (err) {
        toast.error('Failed to load grading sheet');
      } finally {
        setLoading(false);
      }
    })();
  }, [classId]);

  // No "Export" step — this page IS the deliverable. Print automatically
  // once the data has actually rendered, instead of requiring an extra click.
  useEffect(() => {
    if (isPreview || loading || !data || hasAutoPrinted.current) return;
    hasAutoPrinted.current = true;
    const timer = setTimeout(() => window.print(), 500);
    return () => clearTimeout(timer);
  }, [isPreview, loading, data]);

  if (loading) return <LoadingSpinner />;
  if (!data) return <p className="p-10 text-center text-gray-400">Class not found.</p>;

  const cls = data.class;
  const subject = cls.subject || {};
  const academicYear = cls.academic_year || (cls.semester || '').match(/\d{4}-\d{4}/)?.[0] || '';
  const semesterLabel = stripYearFromSemester(cls.semester, academicYear);
  const rows = (data.student_grades || [])
    .slice()
    .sort((a, b) => comparePeopleNames(a.student, b.student));
  const padded = [...rows, ...Array(Math.max(0, TOTAL_ROWS - rows.length)).fill(null)].slice(0, Math.max(TOTAL_ROWS, rows.length));

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', color: '#111', maxWidth: 900, margin: '0 auto', padding: '24px' }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { margin: 0; }
          /* This page auto-prints itself — there's no separate "export" step,
             printing IS the export — so the Remarks coloring below (handy for
             a quick on-screen scan) never reaches the actual exported/printed
             sheet, which stays plain text like the real official form. */
          .gs-remarks { background: none !important; color: #111 !important; }
        }
        .gs-table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .gs-table th, .gs-table td { border: 1px solid #333; padding: 4px 6px; }
        .gs-table th { background: #f0f0f0; font-weight: 600; text-align: center; }
        .gs-table td { height: 22px; }
      `}</style>

      {/* Hidden in preview mode (embedded inside Admin's Grade Approval
          modal) — same reasoning as ClassRecordView's isPreview toggle. */}
      {!isPreview && (
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <p style={{ fontSize: 12, color: '#888', margin: 0 }}>Print dialog opens automatically — use this if it didn't, or to print again.</p>
          <button onClick={() => window.print()} style={{ padding: '8px 16px', background: '#c9a84c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
            Print
          </button>
        </div>
      )}

      <h2 style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, margin: '18px 0 14px' }}>GRADING SHEET</h2>

      <p style={{ fontSize: 12, margin: '4px 0' }}>
        {/* cls.semester already bakes its own academic year in ("First
            Semester 2026-2027"), and cls.academic_year is frequently unset
            on older classes — showing both as-is left "AY ________" blank
            right next to a semester string that already had the real year
            sitting in it. Falls back to pulling the year out of the
            semester string when academic_year itself isn't set, then strips
            that same year back out of the semester text so it isn't shown
            twice ("AY 2026-2027, First Semester" instead of "AY ________,
            First Semester 2026-2027"). */}
        AY <b>{academicYear || '________'}</b>, <b>{semesterLabel || '________'}</b>
      </p>
      <p style={{ fontSize: 12, margin: '4px 0 2px' }}><b>{subject.program || '________________________'}</b></p>
      <p style={{ fontSize: 10, margin: '0 0 14px', fontStyle: 'italic' }}>(Curriculum/Program)</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 12, marginBottom: 14 }}>
        <p style={{ margin: 0 }}><b>Subject Code:</b> {subject.code}</p>
        <p style={{ margin: 0 }}><b>Units:</b> {subject.units}</p>
        <p style={{ margin: 0 }}><b>Course Description:</b> {subject.name}</p>
        <p style={{ margin: 0 }}><b>Faculty/Professor:</b> {formatPersonName(cls.instructor?.name)}</p>
      </div>

      <div style={{ overflowX: 'auto' }}>
      <table className="gs-table">
        <thead>
          <tr>
            <th style={{ width: 32 }}>No</th>
            <th style={{ width: 130 }}>Student ID Number</th>
            <th>Name</th>
            <th style={{ width: 70 }}>Midterm</th>
            <th style={{ width: 70 }}>Final Grade</th>
            <th style={{ width: 80 }}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {padded.map((row, i) => {
            // Same green/red (Passed/Failed) + amber/red (INC/DROP) coloring
            // as the Class Record's own Remarks cell (remarksStyle), instead
            // of plain uncolored text — a glance at this sheet should read
            // the outcome exactly as fast as the Class Record already does.
            const rStyle = row?.grade ? remarksStyle(row.grade.status) : null;
            return (
              <tr key={i}>
                <td style={{ textAlign: 'center' }}>{i + 1}</td>
                <td>{row?.student?.student_no || ''}</td>
                <td>{row?.student?.name ? formatPersonNameCapsSurname(row.student.name) : ''}</td>
                {/* An INC or a DRP both clear midterm/finals/average to null at
                    the source (Grade model's beforeSave hook), so both number
                    columns show the literal "INC"/"DRP" text here — same as
                    the Class Record's own INC/DRP cells — instead of just
                    going blank and leaving only Remarks to explain why. */}
                <td style={{ textAlign: 'center' }}>
                  {row?.grade?.status === 'INC' ? 'INC' : row?.grade?.status === 'DRP' ? 'DROP' : (row?.grade?.midterm != null && row.grade.midterm !== '' ? parseFloat(row.grade.midterm).toFixed(1) : '')}
                </td>
                {/* Final Grade — not the raw Finals-term score, but the same
                    computed average shown on the Class Record's "Final Grade"
                    column (grade.average, backend-computed as (midterm + finals) / 2
                    in the Grade model's beforeSave hook), so the two documents
                    never disagree on what a student's final grade is. */}
                <td style={{ textAlign: 'center' }}>
                  {row?.grade?.status === 'INC' ? 'INC' : row?.grade?.status === 'DRP' ? 'DROP' : (row?.grade?.average != null && row.grade.average !== '' ? parseFloat(row.grade.average).toFixed(1) : '')}
                </td>
                <td className="gs-remarks" style={rStyle ? { textAlign: 'center', background: rStyle.bg, color: rStyle.color, fontWeight: 700 } : { textAlign: 'center' }}>
                  {row?.grade ? remarksFor(row.grade.status) : ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>

      <p style={{ fontSize: 10, marginTop: 10 }}>
        <b>Note:</b> This form should be submitted within Ten (10) working days after the Midterm/Final Exam. (As per Board Res. No. 32 s. 2002).
      </p>

      {showSignatureBlock && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12, marginTop: 40 }}>
            <div>
              <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center' }}>Verified Correct</p>
              <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>Dean, College of {subject.department || 'Arts and Sciences'}</p>
            </div>
            <div>
              <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center' }}>Submitted by</p>
              <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>Faculty/Professor</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12, marginTop: 40 }}>
            <div>
              <p style={{ margin: '0 0 24px' }}>Received by:</p>
              <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center', fontWeight: 700 }}>IMELDA O. VELASCO</p>
              <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>University Registrar</p>
            </div>
            <div>
              <p style={{ margin: '0 0 24px' }}>Approved:</p>
              <p style={{ borderTop: '1px solid #333', paddingTop: 4, margin: 0, textAlign: 'center', fontWeight: 700 }}>GINA U. ESPAÑO, Ph.D.</p>
              <p style={{ fontSize: 10, textAlign: 'center', margin: 0 }}>Vice President for Academic Affairs</p>
            </div>
          </div>

          <p style={{ fontSize: 9, textAlign: 'center', marginTop: 30, color: '#666' }}>
            Website: www.ssu.edu.ph | Contact us: (055) 530-0629 | info@ssu.edu.ph | Page 1 of 1
          </p>
        </>
      )}
    </div>
  );
}
