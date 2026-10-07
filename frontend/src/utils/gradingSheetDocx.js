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
import { remarksFor, remarksText, isLapsedInc, formatGrade } from './classRecordExcel';
import { comparePeopleNames, formatPersonNameFirstLast, formatPersonNameCapsSurname } from '../components/common';
import { getSemesterFor, yearShortOf } from './semesterLabels';

const TEMPLATE_URL = '/templates/grading-sheet-template.docx';

// The Curriculum/Program line: the program with the class's own program code,
// year and section — "BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY (IT-4D)".
const programCode = (program = '') => {
  const v = program.toLowerCase();
  if (v.includes('information technology')) return 'IT';
  if (v.includes('information systems')) return 'IS';
  if (v.includes('psychology')) return 'PSYCH';
  if (v.includes('statistics')) return 'STAT';
  return '';
};
export const programWithSection = (classData) => {
  const program = (classData?.subject?.program || '').toUpperCase();
  if (!program) return '';
  const yearSection = `${classData?.year_level || ''}${classData?.section || ''}`;
  const tag = [programCode(program), yearSection].filter(Boolean).join('-');
  return tag ? `${program} (${tag})` : program;
};
const MIN_ROWS = 25; // one page (25 rows) for a class of up to 25 students — a second page only when there are more.
// Rows per page: the form holds exactly 25. A bigger class continues on a
// second (third, ...) page that repeats the whole form — "GRADING SHEET"
// title, AY/term, program and subject details — with numbering carrying on
// (26, 27, ...) instead of spilling bare table rows onto page 2.
const ROWS_PER_PAGE = 25;

const getAverage = (g) => {
  if (g.status === 'INC' || g.status === 'DRP') return null;
  if (g.midterm === '' || g.finals === '' || g.midterm == null || g.finals == null) return null;
  const mid = parseFloat(g.midterm);
  const fin = parseFloat(g.finals);
  if (isNaN(mid) || isNaN(fin)) return null;
  // 1 decimal, epsilon-corrected — same reason classRecordExcel.js's
  // finalGradeAverage needs it. Feeds isPassed's own threshold check below,
  // not just the display (formatGrade re-rounds it again for that, but the
  // Passed/Failed verdict has to be right off this exact value too).
  return Math.round(((mid + fin) / 2) * 10 + 1e-9) / 10;
};
// <=3.01, not 3.0 — matches the real official spreadsheet's own Remarks
// formula exactly.
const isPassed = (avg) => avg !== null && avg >= 1.0 && avg <= 3.01;

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
    // One 25-row page for up to 25 students; a bigger class adds pages of 25,
    // the last one padded out to a full page.
    const rowCount = Math.max(MIN_ROWS, Math.ceil(sorted.length / ROWS_PER_PAGE) * ROWS_PER_PAGE);
    const pageCount = rowCount / ROWS_PER_PAGE;
    if (pageCount > 1) {
      toast(`${sorted.length} students — the grading sheet runs to ${pageCount} pages (25 per page, each with its own header).`, { icon: 'ℹ️' });
    }

    // "*** NOTHING FOLLOWS ***" on the row right after the last student (the
    // official form's convention) whenever the table has room for it; the
    // numbering runs on continuously through it and the blank rows after it.
    const markerRow = sorted.length > 0 && sorted.length < rowCount ? 1 : 0;
    const students = Array.from({ length: rowCount }, (_, i) => {
      if (markerRow && i === sorted.length) {
        return { no: i + 1, student_id: '', name: '*** NOTHING FOLLOWS ***', midterm: '', finals: '', remarks: '' };
      }
      const g = sorted[i];
      if (!g) return { no: i + 1, student_id: '', name: '', midterm: '', finals: '', remarks: '' };
      // INC not completed by its deadline → the recorded 5.0.
      const avg = isLapsedInc(g) ? 5.0 : getAverage(g);
      // Mirrors whatever the Class Record already has marked for this
      // student — an INC/DRP there shows the same here automatically.
      // INC only in the Midterm with the Finals complete: the FINALS column
      // below still shows that real Finals number (it's genuinely done), but
      // Remarks stays INC — the student is still INC overall until the
      // Midterm resolves too, so it never judges Passed/Failed off a number
      // that's still provisional. Exactly what the Class Record's Finals tab
      // shows for that student.
      const midtermOnlyInc = g.status === 'INC' && !!g.inc_midterm && !g.inc_finals && g.finals != null && g.finals !== '';
      const finalsOwn = midtermOnlyInc ? parseFloat(g.finals) : null;
      const remarksStatus = (g.status === 'INC' || g.status === 'DRP') ? g.status : (avg !== null ? (isPassed(avg) ? 'Passed' : 'Failed') : '');
      return {
        no: i + 1,
        student_id: g.student?.student_no || '',
        // SURNAME (capitalized), First name Middle initial — same "Last,
        // First" order every other roster in the app follows, plus the
        // Grading Sheet's own convention of capitalizing just the surname
        // to set it apart from the given/middle names.
        name: g.student?.name ? formatPersonNameCapsSurname(g.student.name) : '',
        // INC is per period, same as the Class Record: only the flagged
        // period reads INC — a student INC in the Finals keeps their real
        // Midterm Grade (rows from before the flags existed fall back to
        // "INC where no grade is stored").
        midterm: g.status === 'DRP'
          ? 'DROP'
          : (g.status === 'INC' && ((g.inc_midterm || g.inc_finals) ? g.inc_midterm : (g.midterm == null || g.midterm === '')))
            ? 'INC'
            : (g.midterm != null && g.midterm !== '') ? g.midterm : '',
        // The form's "FINALS" column is the Final Grade for the whole term —
        // the (Midterm + Finals) / 2 average already computed above as `avg`
        // — not the raw Finals-period score, matching the Class Record's own
        // "Final Grade" column and the on-screen Grade Sheet's "Average"
        // column so all three never disagree on what a student's grade is
        // (same half-up rounding, formatGrade, everywhere).
        finals: g.status === 'INC' ? 'INC' : g.status === 'DRP' ? 'DROP' : formatGrade(avg),
        remarks: remarksStatus ? remarksText(remarksStatus, g) : '',
      };
    });

    const { term, ay } = splitSemester(classData);
    const templateBuf = await fetch(TEMPLATE_URL).then((r) => {
      if (!r.ok) throw new Error(`Template fetch failed: ${r.status}`);
      return r.arrayBuffer();
    });
    const zip = new PizZip(templateBuf);
    // The template's own "AY" word before {ay} is literal text — swapped for
    // a merge field so it follows this semester's label ("AY" or "SY").
    let docXml = zip.file('word/document.xml').asText().replace('<w:t>AY</w:t>', '<w:t>{ay_label}</w:t>');
    // A long instructor name shrinks a little so it stays on one line in the
    // header's Instructor/Professor blank (11pt by default, down to 7pt).
    const instructorName = formatPersonNameFirstLast(classData?.instructor?.name).toUpperCase();
    const INSTRUCTOR_FIELD_PT = 140; // usable width of that blank, in points
    const instructorSize = [22, 20, 18, 16, 14].find((halfPt) => instructorName.length * 0.68 * (halfPt / 2) <= INSTRUCTOR_FIELD_PT) || 14;
    if (instructorSize < 22) {
      docXml = docXml.replace(/(<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*?)(<\/w:rPr><w:t>\{instructor\}<\/w:t>)/,
        (m, rpr, rest) => `${rpr.replace(/<w:sz(Cs)? [^>]*\/>/g, '')}<w:sz w:val="${instructorSize}"/><w:szCs w:val="${instructorSize}"/>${rest}`);
    }
    // One copy of the whole form body per page, each with its own roster loop
    // (students_0, students_1, ...). Every copy after the first starts with a
    // tiny empty paragraph set to "page break before" — it both starts the new
    // page and keeps Word from merging the two forms' tables into one.
    const bodyStart = docXml.indexOf('<w:body>') + '<w:body>'.length;
    const sectStart = docXml.lastIndexOf('<w:sectPr');
    const formBody = docXml.slice(bodyStart, sectStart);
    const pageBreak = '<w:p><w:pPr><w:pageBreakBefore/><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';
    const pagesXml = Array.from({ length: pageCount }, (_, p) => (p > 0 ? pageBreak : '')
      + formBody.split('{#students}').join(`{#students_${p}}`).split('{/students}').join(`{/students_${p}}`)).join('');
    docXml = docXml.slice(0, bodyStart) + pagesXml + docXml.slice(sectStart);
    zip.file('word/document.xml', docXml);
    const pageRosters = {};
    for (let p = 0; p < pageCount; p += 1) pageRosters[`students_${p}`] = students.slice(p * ROWS_PER_PAGE, (p + 1) * ROWS_PER_PAGE);
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
    doc.render({
      ay_label: yearShortOf(await getSemesterFor(classData?.semester)),
      ay: ay || '______________',
      term: term || '________',
      program: programWithSection(classData) || '____________________________________________________',
      subject_code: classData?.subject?.code || '',
      // Header values (code, description, units, instructor, program) are
      // bold and ruled/underlined in the template; AY and term underlined.
      course_description: (classData?.subject?.name || '').toUpperCase(),
      // Always one decimal place on the form: 3 -> "3.0".
      units: Number.isFinite(parseFloat(classData?.subject?.units)) ? parseFloat(classData.subject.units).toFixed(1) : '',
      // Bold in the header row; the footer's "Submitted by" signature (a
      // separate {instructor} occurrence) is plain, like the Dean's name.
      instructor: instructorName,
      ...pageRosters,
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
    midterm: sg.grade?.midterm ? formatGrade(sg.grade.midterm) : '',
    finals: sg.grade?.finals ? formatGrade(sg.grade.finals) : '',
    status: sg.grade?.status || 'Pending',
    // INC is per period (marked/resolved independently).
    inc_midterm: !!sg.grade?.inc_midterm,
    inc_finals: !!sg.grade?.inc_finals,
    inc_remarks: sg.grade?.inc_remarks || '',
    inc_lapsed_at: sg.grade?.inc_lapsed_at || null,
  }));
}
