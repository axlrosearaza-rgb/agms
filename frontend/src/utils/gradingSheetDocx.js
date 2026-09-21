// ── SSU Grading Sheet (SSU-UNREG-FR-017, Rev. 8) — shared .docx export ──────
// Fills a template built directly from the actual official Google Doc
// (fetched, unzipped, and tagged with docxtemplater merge fields —
// public/templates/grading-sheet-template.docx) so every visual detail —
// the real letterhead banner, accreditation badges, footer signature block,
// award list, fonts, borders, page size — comes from the source file itself
// instead of being manually reconstructed and eyeballed against
// screenshots. The only things this code fills in are the blanks: AY/term,
// program, subject/course/units/instructor, the student roster, and the
// Dean/Instructor signature line.
//
// The physical form has exactly 25 numbered rows, but a class can have
// more students than that — the roster is a docxtemplater table-row loop,
// so it simply grows past 25 (spilling onto a second page for very large
// classes) rather than truncating anyone off the sheet.
//
// Shared between pages/instructor/GradeEncoding.js's own Export button and
// pages/instructor/InstructorClasses.js's inline Export buttons, so both
// produce the exact same file.
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { remarksFor } from './classRecordExcel';
import { comparePeopleNames, formatPersonNameCapsSurname } from '../components/common';

const TEMPLATE_URL = '/templates/grading-sheet-template.docx';
const MIN_ROWS = 25; // the physical form's own fixed row count — padded out to this even for a small class, so an empty roster still prints a usable blank form.

const getAverage = (g) => {
  if (g.status === 'INC' || g.status === 'DRP') return null;
  if (g.midterm === '' || g.finals === '' || g.midterm == null || g.finals == null) return null;
  const mid = parseFloat(g.midterm);
  const fin = parseFloat(g.finals);
  if (isNaN(mid) || isNaN(fin)) return null;
  return Math.round(((mid + fin) / 2) * 100) / 100;
};
const isPassed = (avg) => avg !== null && avg >= 1.0 && avg <= 3.0;

// `classData.semester` bakes AY into the string ("First Semester
// 2026-2027") — split back apart into "Term" + "AY" for the form's own two
// separate blanks, preferring classData.academic_year when it's set. The
// form's own blank is followed by a literal " Semester/Summer" label, so
// "First Semester" would otherwise print as "First Semester Semester/
// Summer" — strip the trailing "Semester"/"Summer" word class.semester
// already carries so only the ordinal ("First") fills the blank.
function splitSemester(classData) {
  const semesterName = classData?.semester || '';
  const ayFromName = semesterName.match(/\d{4}-\d{4}/)?.[0] || '';
  const ay = classData?.academic_year || ayFromName || '';
  const term = (ay ? semesterName.replace(ay, '') : semesterName)
    .replace(/,?\s*$/, '')
    .replace(/\s*(Semester|Summer)\s*$/i, '')
    .trim();
  return { term, ay };
}

// `studentGrades` — same shape GradeEncoding's own loadData() builds:
// [{ student: {student_no, name}, midterm, finals, status }, ...]
export async function exportGradingSheetDocx({ classData, studentGrades }) {
  try {
    // Alphabetical by LAST name (comparePeopleNames — Last, First order),
    // same as the Class Record roster (GradeEncoding.js/ClassRecordView.js),
    // not the raw "First Last" string — so the two documents never disagree
    // on what order the roster is in.
    const sorted = [...(studentGrades || [])].sort((a, b) => comparePeopleNames(a.student, b.student));
    if (sorted.length > MIN_ROWS) {
      toast(`${sorted.length} students — the roster now runs past the form's own 25 rows onto a second page.`, { icon: 'ℹ️' });
    }

    const rowCount = Math.max(MIN_ROWS, sorted.length);
    const students = Array.from({ length: rowCount }, (_, i) => {
      const g = sorted[i];
      if (!g) return { no: i + 1, student_id: '', name: '', midterm: '', finals: '', remarks: '' };
      const avg = getAverage(g);
      // Mirrors whatever the Class Record already has marked for this
      // student — an INC/DRP there shows the same here automatically.
      const remarksStatus = (g.status === 'INC' || g.status === 'DRP') ? g.status : (avg !== null ? (isPassed(avg) ? 'Passed' : 'Failed') : '');
      return {
        no: i + 1,
        student_id: g.student?.student_no || '',
        // SURNAME (capitalized), First name Middle initial — same "Last,
        // First" order every other roster in the app follows, plus the
        // Grading Sheet's own convention of capitalizing just the surname
        // to set it apart from the given/middle names.
        name: g.student?.name ? formatPersonNameCapsSurname(g.student.name) : '',
        midterm: g.status === 'INC' ? 'INC' : g.status === 'DRP' ? 'DROP' : (g.midterm != null && g.midterm !== '' ? g.midterm : ''),
        // The form's "FINALS" column is the Final Grade for the whole term —
        // the (Midterm + Finals) / 2 average already computed above as `avg`
        // — not the raw Finals-period score, matching the Class Record's own
        // "Final Grade" column and the on-screen Grade Sheet's "Average"
        // column so all three never disagree on what a student's grade is.
        finals: g.status === 'INC' ? 'INC' : g.status === 'DRP' ? 'DROP' : (avg !== null ? avg.toFixed(1) : ''),
        remarks: remarksStatus ? remarksFor(remarksStatus) : '',
      };
    });

    const { term, ay } = splitSemester(classData);
    const templateBuf = await fetch(TEMPLATE_URL).then((r) => {
      if (!r.ok) throw new Error(`Template fetch failed: ${r.status}`);
      return r.arrayBuffer();
    });
    const zip = new PizZip(templateBuf);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render({
      ay: ay || '______________',
      term: term || '________',
      program: (classData?.subject?.program || '').toUpperCase() || '____________________________________________________',
      subject_code: classData?.subject?.code || '',
      // Capitalized, NOT bold — same header-row treatment as `instructor`
      // right beside it (see that field's own comment below).
      course_description: (classData?.subject?.name || '').toUpperCase(),
      units: String(classData?.subject?.units ?? ''),
      // Capitalized here in the header row too, but this run stays plain —
      // only the "Submitted by" signature run further down (a SEPARATE
      // {instructor} occurrence in the template, edited to carry <w:b/>)
      // is bold, matching that line's neighboring Dean signatory text.
      instructor: (classData?.instructor?.name || '').toUpperCase(),
      students,
    });

    const blob = doc.getZip().generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    saveAs(blob, `${classData?.subject?.code || 'class'}_GradingSheet.docx`);
    toast.success('Exported using the official SSU Grading Sheet format!');
  } catch (err) {
    console.error(err);
    toast.error('Failed to export the Grading Sheet');
  }
}

// `studentGrades` shape here matches gradeService.getByClass's raw
// `student_grades` rows ({ student, grade }), not GradeEncoding's own mapped
// version — this normalizes either shape into what the function above needs.
export function normalizeStudentGrades(rawStudentGrades) {
  return (rawStudentGrades || []).map((sg) => ({
    student: sg.student,
    midterm: sg.grade?.midterm ? parseFloat(sg.grade.midterm).toFixed(1) : '',
    finals: sg.grade?.finals ? parseFloat(sg.grade.finals).toFixed(1) : '',
    status: sg.grade?.status || 'Pending',
  }));
}
