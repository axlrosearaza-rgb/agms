import PizZip from 'pizzip';

// Reads a curriculum from a Word (.docx) file — Admin → Subjects → Import
// Subjects. Built around the university's own Curriculum Program form
// (SSU-OVPAA-FR-023), typed in Word:
//
//   BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY          ← program
//   Effective S.Y. 2023 - 2024                             ← curriculum year (2023)
//   | FIRST YEAR                                                              |
//   | First Semester                                                          |
//   | Grade | Course Code | Course Description | Lecture | Laboratory/RLE | Total | Total | Pre-      | Co-       |
//   |       |             |                    | Hrs|Units| Hrs  |  Units  | Hrs.  | Units | Requisite | Requisite |
//   |       | GE 1        | Understanding the Self | 54 | 3 | - | - | 54 | 3 |          |           |
//   |                                   Total : | 378 | 21 | 108 | 2 | 486 | 23 |                    |
//   | Second Semester … (the header repeats)                                  |
//
// The program / year / semester headings (lines above a table or rows inside
// it) apply to the rows under them. "Total" rows are skipped, "-" is blank.
export const SUBJECT_PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];
const SHORT = { BSIT: 0, BSIS: 1, BSPSYCH: 2, BSPSY: 2, BSSTAT: 3, BSS: 3 };
const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const toProgram = (v) => {
  const t = String(v || '').trim();
  if (!t) return '';
  const full = SUBJECT_PROGRAMS.find((p) => norm(t).includes(norm(p)));
  if (full) return full;
  const short = t.toUpperCase().replace(/[^A-Z]/g, '');
  return SHORT[short] !== undefined ? SUBJECT_PROGRAMS[SHORT[short]] : '';
};
const WORD_NUM = { first: 1, second: 2, third: 3, fourth: 4 };
// "FIRST YEAR", "1st Year", "Year 1", "Year I" → 1…4 (null when the text is not a year heading).
const yearIn = (text) => {
  const t = String(text || '').toLowerCase();
  let m = t.match(/\b(first|second|third|fourth)\s+year\b/); if (m) return WORD_NUM[m[1]];
  m = t.match(/\b([1-4])(st|nd|rd|th)\s+year\b/); if (m) return Number(m[1]);
  m = t.match(/\byear\s+([1-4])\b/); if (m) return Number(m[1]);
  m = t.match(/\byear\s+(iv|iii|ii|i)\b/); if (m) return { i: 1, ii: 2, iii: 3, iv: 4 }[m[1]];
  return null;
};
const semesterIn = (text) => {
  const t = String(text || '').toLowerCase();
  if (/\b(summer|mid-?year)\b/.test(t)) return 'Summer';
  if (/\b(first|1st)\s+sem/.test(t)) return '1st Semester';
  if (/\b(second|2nd)\s+sem/.test(t)) return '2nd Semester';
  return null;
};
// A cell value in a Year Level / Semester column.
const toYear = (v) => yearIn(`${v} year`) || yearIn(v) || (/^[1-4]$/.test(String(v).trim()) ? Number(v) : '');
const toSemester = (v) => semesterIn(`${v} sem`) || semesterIn(v) || (/^1$/.test(String(v).trim()) ? '1st Semester' : /^2$/.test(String(v).trim()) ? '2nd Semester' : String(v || '').trim());

// Header title (normalised) → field.
const HEADER_FIELDS = [
  ['code', ['coursecode', 'code', 'subjectcode', 'courseno', 'coursenumber']],
  ['name', ['coursedescription', 'description', 'descriptivetitle', 'coursetitle', 'subjectdescription', 'subjecttitle', 'title', 'name']],
  ['program', ['program']],
  ['year_level', ['yearlevel', 'year']],
  ['semester', ['semester', 'sem']],
  ['subject_type', ['subjecttype', 'type']],
  ['lecture_hours', ['lecturehrs', 'lecturehours', 'lechrs', 'lechours', 'lecturehr']],
  ['lecture_units', ['lectureunits', 'lecunits', 'lectureunit']],
  ['lab_hours', ['labhrs', 'labhours', 'laboratoryhrs', 'laboratoryhours', 'labrlehrs', 'labrlehours', 'laboratoryrlehrs', 'laboratoryrlehours']],
  ['lab_units', ['labunits', 'laboratoryunits', 'labrleunits', 'laboratoryrleunits']],
  ['total_hours', ['totalhrs', 'totalhours']],
  ['units', ['totalunits', 'units', 'unit', 'creditunits']],
  ['prerequisites', ['prerequisite', 'prerequisites', 'prereq']],
  ['co_requisites', ['corequisite', 'corequisites', 'coreq']],
];
// No Subject Type column on the form: general-education style codes (GE, GE E,
// NSTP, NSE, PE, OE) are Minor, everything else Major. The Admin can edit it after.
const typeFromCode = (code) => (/^(GE|GEE|NSTP|NSE|PE|OE)(?![A-Za-z])/i.test(String(code).trim().replace(/\s+/g, '').replace(/^GEE/i, 'GEE')) ? 'Minor' : 'Major');
// "Effective S.Y. 2023 - 2024" / "2023 Curriculum" → "2023".
const curriculumYearIn = (text) => {
  const t = String(text || '');
  const m = t.match(/effective\s+(?:s\.?\s*y\.?|a\.?\s*y\.?|school year|academic year)?\s*[:.]?\s*(\d{4})/i) || t.match(/\b(\d{4})\s+curriculum\b/i) || t.match(/\bcurriculum\s+(?:year\s*)?[:.]?\s*(\d{4})\b/i);
  return m ? m[1] : '';
};
const fieldOf = (title) => (HEADER_FIELDS.find(([, names]) => names.includes(norm(title))) || [])[0];

const textOf = (el) => {
  // A paragraph is its own single line; a cell may hold several paragraphs.
  const paras = el.tagName === 'w:p' ? [el] : el.getElementsByTagName('w:p');
  const out = [];
  for (let i = 0; i < paras.length; i += 1) {
    const ts = paras[i].getElementsByTagName('w:t');
    let line = '';
    for (let j = 0; j < ts.length; j += 1) line += ts[j].textContent;
    if (line.trim()) out.push(line.trim());
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
};
// One table row as a flat list of cell texts, a merged cell repeated across the columns it spans.
const rowCells = (tr) => {
  const cells = [];
  for (let i = 0; i < tr.childNodes.length; i += 1) {
    const tc = tr.childNodes[i];
    if (tc.tagName !== 'w:tc') continue;
    const span = parseInt(tc.getElementsByTagName('w:gridSpan')[0]?.getAttribute('w:val') || '1', 10) || 1;
    const text = textOf(tc);
    for (let s = 0; s < span; s += 1) cells.push(text);
  }
  return cells;
};

export async function parseSubjectWordDocx(file, fallbackProgram = '') {
  const zip = new PizZip(await file.arrayBuffer());
  const xml = zip.file('word/document.xml')?.asText();
  if (!xml) throw new Error('This is not a readable Word (.docx) file.');
  const doc = new window.DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw new Error('This Word file has no content.');

  const ctx = { program: '', year: '', semester: '' };
  let curriculumYear = '';
  const note = (text) => {
    if (!curriculumYear) curriculumYear = curriculumYearIn(text);
    const p = toProgram(text); if (p) ctx.program = p;
    const y = yearIn(text); if (y) ctx.year = y;
    const s = semesterIn(text); if (s) ctx.semester = s;
  };
  const subjects = [];
  let tables = 0;

  for (let i = 0; i < body.childNodes.length; i += 1) {
    const el = body.childNodes[i];
    if (el.tagName === 'w:p') { note(textOf(el)); continue; }
    if (el.tagName !== 'w:tbl') continue;
    tables += 1;
    const trs = [];
    for (let r = 0; r < el.childNodes.length; r += 1) if (el.childNodes[r].tagName === 'w:tr') trs.push(rowCells(el.childNodes[r]));

    let cols = null; // field → column index, once a header row was seen
    for (let r = 0; r < trs.length; r += 1) {
      const cells = trs[r];
      const filled = [...new Set(cells.filter(Boolean))];
      // A header row: has both a code column and a description column.
      const fields = cells.map(fieldOf);
      if (fields.includes('code') && fields.includes('name')) {
        // Two-row header ("Lecture" over "Hrs | Units"): join each column's two titles.
        const next = trs[r + 1] || [];
        const twoRows = next.some((c) => /^(hrs?|hours?|units?)\.?$/i.test(c)) && !next.some((c, k) => fields[k] === 'code' && c && !fieldOf(c));
        cols = {};
        cells.forEach((top, k) => {
          const bottom = twoRows ? (next[k] || '') : '';
          const f = fieldOf(bottom && bottom !== top ? `${top} ${bottom}` : top) || fieldOf(top);
          if (f && cols[f] === undefined) cols[f] = k;
        });
        if (twoRows) r += 1;
        continue;
      }
      // A heading row inside the table ("FIRST YEAR — First Semester", a program name).
      if (filled.length <= 2 && (yearIn(filled.join(' ')) || semesterIn(filled.join(' ')) || toProgram(filled.join(' ')))) { note(filled.join(' ')); continue; }
      if (!cols) continue;
      const get = (f) => (cols[f] !== undefined ? (cells[cols[f]] || '').trim() : '');
      // A code broken across lines at a hyphen ("NSTP-" / "NROTC 1") is one word.
      const code = get('code').replace(/(\S)-\s+/g, '$1-'); const name = get('name');
      if (!code || !name || /^(total|sub-?total|grand total)/i.test(code) || /^(total|sub-?total|grand total)/i.test(name)) continue;
      subjects.push({
        line: subjects.length + 1, code, name,
        program: toProgram(get('program')) || ctx.program || fallbackProgram || get('program'),
        year_level: toYear(get('year_level')) || ctx.year || '',
        semester: get('semester') ? toSemester(get('semester')) : (ctx.semester || ''),
        subject_type: cols.subject_type !== undefined ? (/minor/i.test(get('subject_type')) ? 'Minor' : 'Major') : typeFromCode(code),
        lecture_hours: get('lecture_hours'), lecture_units: get('lecture_units'), lab_hours: get('lab_hours'), lab_units: get('lab_units'),
        total_hours: get('total_hours'), units: get('units'),
        // "None" / "-" in a requisite cell means there is none.
        prerequisites: /^(none|n\/?a|-+|—)?$/i.test(get('prerequisites')) ? '' : get('prerequisites'),
        co_requisites: /^(none|n\/?a|-+|—)?$/i.test(get('co_requisites')) ? '' : get('co_requisites'),
      });
    }
  }
  if (tables === 0) {
    const pictures = doc.getElementsByTagName('w:drawing').length + doc.getElementsByTagName('w:pict').length;
    throw new Error(pictures > 0
      ? 'This Word file only has scanned pictures of the curriculum, so there is no text to read. Type the subjects into the template (Download template) and import that.'
      : 'No table was found in this Word file. The subjects must be in a table — use the template.');
  }
  if (subjects.length === 0) throw new Error('No subjects were found. The table needs "Course Code" and "Course Description" columns — use the template.');
  return { subjects, curriculumYear };
}

// The template: the Curriculum Program form itself, with sample rows to replace.
export async function downloadSubjectWordTemplate() {
  const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType, VerticalMergeType, ShadingType } = await import('docx');
  const { saveAs } = await import('file-saver');
  const COLS = 11;
  const para = (text, o = {}) => new Paragraph({ alignment: o.align || AlignmentType.CENTER, spacing: { before: o.before ?? 0, after: o.after ?? 0 }, children: [new TextRun({ text: String(text), bold: !!o.bold, underline: o.underline ? {} : undefined, size: o.size || 18, italics: !!o.italics })] });
  const cell = (text, o = {}) => new TableCell({
    children: [para(text, { bold: o.bold, underline: o.underline, size: o.size, align: o.left ? AlignmentType.LEFT : AlignmentType.CENTER })],
    columnSpan: o.span, verticalMerge: o.vmerge,
    shading: o.shade ? { type: ShadingType.CLEAR, fill: 'F3E3C3', color: 'auto' } : undefined,
  });
  const header = () => [
    new TableRow({ children: [
      cell('Grade', { vmerge: VerticalMergeType.RESTART }), cell('Course Code', { vmerge: VerticalMergeType.RESTART }), cell('Course Description', { vmerge: VerticalMergeType.RESTART }),
      cell('Lecture', { span: 2 }), cell('Laboratory/ RLE', { span: 2 }), cell('Total'), cell('Total'),
      cell('Pre-Requisite', { vmerge: VerticalMergeType.RESTART }), cell('Co-Requisite', { vmerge: VerticalMergeType.RESTART }),
    ] }),
    new TableRow({ children: [
      cell('', { vmerge: VerticalMergeType.CONTINUE }), cell('', { vmerge: VerticalMergeType.CONTINUE }), cell('', { vmerge: VerticalMergeType.CONTINUE }),
      cell('Hrs.'), cell('Units'), cell('Hrs.'), cell('Units'), cell('Hrs.'), cell('Units'),
      cell('', { vmerge: VerticalMergeType.CONTINUE }), cell('', { vmerge: VerticalMergeType.CONTINUE }),
    ] }),
  ];
  const subject = (v) => new TableRow({ children: ['', ...v].map((x, i) => cell(x, { left: i === 2 })) });
  const total = (v) => new TableRow({ children: [cell('Total :', { span: 3, bold: true, shade: true }), ...v.map((x) => cell(x, { bold: true, shade: true })), cell('', { span: 2, shade: true })] });
  const yearRow = (text) => new TableRow({ children: [cell(text, { span: COLS, bold: true, underline: true, size: 24, shade: true })] });
  const semRow = (text) => new TableRow({ children: [cell(text, { span: COLS, bold: true, underline: true, left: true })] });
  const table = (rows) => new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows });
  const doc = new Document({
    sections: [{
      children: [
        para('BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY', { bold: true, underline: true, size: 24 }),
        para('(Curriculum Program)', { size: 20 }),
        para('Effective S.Y. 2023 - 2024', { size: 20, after: 120 }),
        para('How to use: type the program name and the effective school year above. Keep the FIRST YEAR / First Semester rows and the column titles; replace the sample subjects with your own, one row each. Use "-" where there are no hours or units. Pre-Requisite and Co-Requisite take Course Codes. Delete this note.', { italics: true, size: 16, after: 200, align: AlignmentType.LEFT }),
        table([
          yearRow('FIRST YEAR'),
          semRow('First Semester'), ...header(),
          subject(['GE 1', 'Understanding the Self', 54, 3, '-', '-', 54, 3, '', '']),
          subject(['CC101', 'Introduction to Computing', 36, 2, 54, 1, 90, 3, '', '']),
          total([90, 5, 54, 1, 144, 6]),
          semRow('Second Semester'), ...header(),
          subject(['GE 4', 'Purposive Communication', 54, 3, '-', '-', 54, 3, '-', '']),
          subject(['MS101', 'Discrete Mathematics', 54, 3, '-', '-', 54, 3, 'CC101', '']),
          total([108, 6, '-', '-', 108, 6]),
        ]),
        para('', { after: 200 }),
        table([
          yearRow('SECOND YEAR'),
          semRow('First Semester'), ...header(),
          subject(['CC104', 'Data Structures and Algorithms', 36, 2, 54, 1, 90, 3, 'MS101', '']),
          total([36, 2, 54, 1, 90, 3]),
        ]),
      ],
    }],
  });
  saveAs(await Packer.toBlob(doc), 'Curriculum-Program-Template.docx');
}
