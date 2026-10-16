// ── SSU Grades Monitoring Form — Admin/Chairperson .docx export ────────────
// Fills a template built directly from the actual official Google Doc
// (fetched, unzipped, and edited by targeted string/XML substitution —
// public/templates/grades-monitoring-form-template.docx) so every visual
// detail — the real letterhead, accreditation badges, the "Prepared
// By"/"Noted By" footer signature block, landscape layout, fonts, borders,
// the merged-header table — comes from the source file itself instead of
// being manually reconstructed. This code only ever touches: the title
// paragraph's semester/AY (moved to sit right before the table — the
// template's own raw XML order has it AFTER, since the table there is a
// floating element positioned independently of document flow), the table
// (repeated once per program, each with its own bold heading and a gray
// header row — the template itself only has ONE program's worth, and no
// shading), and the footer's "Prepared By" name/title — everything else in
// the package is untouched.
//
// Shared by both the Admin Reports page (every program, one document) and
// the Chairperson Reports page (their own program(s) only) — same shape,
// just a shorter `programs` array and a different `preparedByTitle`.
import PizZip from 'pizzip';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { programShortLabel, formatPersonNameFirstLast, formatPersonNameCapsSurname, comparePeopleNames } from '../components/common';
import { getSemesterFor, yearAbbrOf } from './semesterLabels';

export function classSectionCode(c, fallbackProgram) {
  const prog = c?.program || fallbackProgram || '';
  const pLower = prog.toLowerCase();
  let pCode = '';
  if (pLower.includes('information technology')) pCode = 'IT';
  else if (pLower.includes('information systems')) pCode = 'IS';
  else if (pLower.includes('psychology')) pCode = 'BSPSY';
  else if (pLower.includes('statistics')) pCode = 'BSS';
  else if (pLower.includes('computer science')) pCode = 'CS';
  else pCode = programShortLabel(prog).replace(/^BS\s*/i, '') || '';

  const y = c?.year_level || '';
  const s = c?.section || '';
  if (!y && !s) return '';
  return `${pCode ? `${pCode} ` : ''}${y}${s}`.trim();
}

const TEMPLATE_URL = '/templates/grades-monitoring-form-template.docx';
const HEADER_SHADE = 'D9D9D9'; // light gray, matches the reference printout's own header row shading

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ORDINAL_NUM = { First: '1', Second: '2', Third: '3' };
const ORDINAL_SUF = { First: 'st', Second: 'nd', Third: 'rd' };

// Finds "College of Arts and Sciences / 1[st] Semester A.Y. 2026-2027" by
// its actual run boundaries (not a hardcoded literal string).
function findSubtitleRange(docXml) {
  const marker = 'College of ';
  const markerIdx = docXml.indexOf(marker);
  if (markerIdx === -1) return null;
  const afterMarker = markerIdx + marker.length;
  const firstTClose = docXml.indexOf('</w:t>', afterMarker) + '</w:t>'.length;
  const firstRClose = docXml.indexOf('</w:r>', firstTClose) + '</w:r>'.length;
  const secondRClose = docXml.indexOf('</w:r>', firstRClose) + '</w:r>'.length;
  const thirdRClose = docXml.indexOf('</w:r>', secondRClose) + '</w:r>'.length;
  if (firstRClose < 0 || secondRClose < 0 || thirdRClose < 0) return null;
  return { start: markerIdx, firstRClose, secondRClose, thirdRClose };
}

// Rebuilds the subtitle to match official SSU format:
// "College of Arts and Sciences / Second Semester S.Y. 2025 - 2026" (with "Arts and Sciences" and the term underlined).
function buildSubtitleReplacement(docXml, range, semesterName, yearAbbr = 'S.Y.') {
  const raw = semesterName || '';
  const ayMatch = raw.match(/\d{4}\s*-\s*\d{4}/)?.[0] || '';
  const ayFormatted = ayMatch ? ayMatch.replace(/\s*-\s*/, ' - ') : '';
  const isSummer = /summer/i.test(raw);
  const isSecond = /second|2nd/i.test(raw);
  const termWord = isSummer ? 'Summer' : isSecond ? 'Second' : 'First';

  const uRun = (text) => `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b w:val="1"/><w:bCs w:val="1"/><w:u w:val="single"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  const plainRun = (text) => `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b w:val="1"/><w:bCs w:val="1"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

  if (isSummer) {
    return `College of </w:t></w:r>${uRun('Arts and Sciences')}${plainRun(' / ')}${uRun('Summer')}${plainRun(` ${yearAbbr} ${ayFormatted}`)}`;
  }

  return `College of </w:t></w:r>${uRun('Arts and Sciences')}${plainRun(' / ')}${uRun(termWord)}${plainRun(` Semester ${yearAbbr} ${ayFormatted}`)}`;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—');

// Injects a light-gray fill, compacts row height and paragraph spacing,
// removes empty spacer paragraphs, and applies bold italic 8.5pt styling.
function styleHeaderRows(rowsXml) {
  let out = rowsXml;

  // 1. Remove forced trHeight constraints so rows fit tightly to content
  out = out.replace(/<w:trHeight[^>]*\/>/g, '<w:trHeight w:val="0" w:hRule="auto"/>');

  // 2. Remove empty spacer paragraphs inside header cells (e.g. before "Name of Faculty")
  out = out.replace(/<w:p\b[^>]*>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?\s*(?:<w:r\b[^>]*>(?:<w:rPr>[\s\S]*?<\/w:rPr>)?\s*<\/w:r>)?\s*<\/w:p>(?=<w:p)/g, '');

  // 3. Ultra-compact paragraph spacing: 0 before, 0 after, tight 180 line height
  const compactSpacing = '<w:spacing w:before="0" w:after="0" w:line="180" w:lineRule="auto"/>';
  out = out.replace(/<w:spacing\b[^>]*\/>/g, compactSpacing);

  // 4. Shading & vertical center on every header cell tcPr
  out = out.replace(/<w:tcPr(\/?)>/g, (_m, selfClosed) => (
    selfClosed
      ? `<w:tcPr><w:vAlign w:val="center"/><w:shd w:val="clear" w:fill="${HEADER_SHADE}"/></w:tcPr>`
      : `<w:tcPr><w:vAlign w:val="center"/><w:shd w:val="clear" w:fill="${HEADER_SHADE}"/>`
  ));

  // 5. Apply 8.5pt font size (17 half-pts) + bold + italic to all header runs
  out = out.replace(/<w:rPr>([\s\S]*?)<\/w:rPr>/g, (_m, rPrInner) => {
    const clean = rPrInner
      .replace(/<w:sz\b[^>]*\/>/g, '')
      .replace(/<w:szCs\b[^>]*\/>/g, '')
      .replace(/<w:b\b[^>]*\/>/g, '')
      .replace(/<w:bCs\b[^>]*\/>/g, '')
      .replace(/<w:i\b[^>]*\/>/g, '')
      .replace(/<w:iCs\b[^>]*\/>/g, '')
      .replace(/<w:rFonts\b[^>]*\/>/g, '');
    return `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b w:val="1"/><w:bCs w:val="1"/><w:i w:val="1"/><w:iCs w:val="1"/><w:sz w:val="17"/><w:szCs w:val="17"/>${clean}</w:rPr>`;
  });

  return out;
}

// Precise column widths (total 15345 dxa):
// Col 0: Name of Faculty (3000 dxa)
// Col 1: Course Code (1000 dxa)
// Col 2: Descriptive Title (4100 dxa)
// Col 3: Date Submitted (2250 dxa) — wide enough so "Date Submitted to the" stays on 1 line
// Col 4-8: Passed (950), Incomplete (1350), Failed (900), Dropped (950), Total (845)
const NEW_GRID_COLS = [3000, 1000, 4100, 2250, 950, 1350, 900, 950, 845];

// Column indices whose DATA should stay left-aligned like real body text
// (Name of Faculty, Descriptive Title) — every other column (Course Code,
// Date Submitted, and the five counts) centers, matching its own header
// above it. The template's blank row left every cell's alignment unset
// (Word's default, left), which visually mismatched the centered headers
// on every numeric/date column.
const LEFT_ALIGN_COLS = new Set([0, 2]);

// Splits a <w:tr>...</w:tr> block into its individual <w:tc>...</w:tc> cells
// and drops a text run into each one's trailing paragraph. Supports w:vMerge
// on Column 0 (Name of Faculty) so multi-class instructors span rows in Word.
function fillRowCells(rowXml, values, vMerge = null) {
  const cells = rowXml.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
  const filledCells = cells.map((cellXml, i) => {
    const text = values[i];
    let cell = cellXml;
    const colWidth = NEW_GRID_COLS[i] || 1000;

    // Handle vertical merge and explicit cell width on Column 0 (Name of Faculty) & other columns
    let tcPrContent = `<w:tcW w:w="${colWidth}" w:type="dxa"/><w:vAlign w:val="top"/>`;
    if (i === 0) {
      if (vMerge === 'restart') {
        tcPrContent = `<w:vMerge w:val="restart"/><w:tcW w:w="${colWidth}" w:type="dxa"/><w:vAlign w:val="top"/>`;
      } else if (vMerge === 'continue') {
        tcPrContent = `<w:vMerge/><w:tcW w:w="${colWidth}" w:type="dxa"/><w:vAlign w:val="top"/>`;
      }
    }

    if (/<w:tcPr\/>/.test(cell)) {
      cell = cell.replace(/<w:tcPr\/>/, `<w:tcPr>${tcPrContent}</w:tcPr>`);
    } else if (/<w:tcPr>/.test(cell)) {
      cell = cell.replace(/<w:tcPr>[\s\S]*?<\/w:tcPr>/, `<w:tcPr>${tcPrContent}</w:tcPr>`);
    } else {
      cell = `<w:tc><w:tcPr>${tcPrContent}</w:tcPr>${cell.slice('<w:tc>'.length)}`;
    }

    if (text == null || text === '') {
      if (i === 0 && vMerge === 'continue') {
        return cell.replace(/<w:p[\s\S]*?<\/w:p>/, '<w:p><w:pPr><w:jc w:val="left"/></w:pPr></w:p>');
      }
      return cell;
    }

    // Set this cell's own paragraph alignment explicitly and reset any awkward line/after spacing
    const align = LEFT_ALIGN_COLS.has(i) ? 'left' : 'center';
    const spacingXml = '<w:spacing w:before="0" w:after="0" w:line="220" w:lineRule="auto"/>';
    const newPPr = `<w:pPr>${spacingXml}<w:jc w:val="${align}"/></w:pPr>`;
    if (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(cell)) {
      cell = cell.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, newPPr);
    } else {
      cell = cell.replace('<w:p>', `<w:p>${newPPr}`);
    }

    const runXml = `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
    const lastPClose = cell.lastIndexOf('</w:p>');
    return cell.slice(0, lastPClose) + runXml + cell.slice(lastPClose);
  });

  const firstTcIdx = rowXml.indexOf('<w:tc');
  const lastTcEndIdx = rowXml.lastIndexOf('</w:tc>') + '</w:tc>'.length;
  return rowXml.slice(0, firstTcIdx) + filledCells.join('') + rowXml.slice(lastTcEndIdx);
}

// A plain bold paragraph naming the program — printed once above each
// program's own copy of the table so a multi-program export (Admin's
// whole-college one) still reads as clearly sectioned, not one
// undifferentiated table.
function programHeadingXml(program) {
  return `<w:p><w:pPr><w:spacing w:before="240" w:after="80"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/><w:sz w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(program)}</w:t></w:r></w:p>`;
}

// One merged cell spanning every column (not just sitting in "Name of
// Faculty" with the other 8 cells empty beside it), italic and centered —
// reads as a genuine "nothing to show" placeholder row instead of data that
// looks like it went missing from most of the columns.
function emptyStateRowXml(columnCount, message) {
  return `<w:tr><w:tc><w:tcPr><w:gridSpan w:val="${columnCount}"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:iCs/></w:rPr><w:t xml:space="preserve">${esc(message)}</w:t></w:r></w:p></w:tc></w:tr>`;
}

// A program's classes, alphabetical by faculty surname (then year, section, code),
// each with `span`: how many rows that faculty member's name covers on their
// FIRST row, 0 on the rows after it — a faculty member with several classes
// is named once. Shared by the Reports pages and this export.
export function withFacultySpans(rows = []) {
  const sorted = [...rows].sort((a, b) =>
    comparePeopleNames(a.instructor_name || '', b.instructor_name || '') ||
    (a.year_level || 0) - (b.year_level || 0) ||
    String(a.section || '').localeCompare(String(b.section || '')) ||
    String(a.subject_code || '').localeCompare(String(b.subject_code || ''))
  );
  const who = (c) => c.instructor_id ?? c.instructor_name ?? '';
  return sorted.map((c, i) => {
    if (i > 0 && who(sorted[i - 1]) === who(c)) return { c, span: 0 };
    let span = 1;
    while (i + span < sorted.length && who(sorted[i + span]) === who(c)) span += 1;
    return { c, span };
  });
}

// The rule line under the letterhead — the same line the Grade Sheet's header
// has (1.5pt, the full width of the page), added to this form's header. It
// hangs from the header's last paragraph, just below everything in it.
const HEADER_RULE_XML = (pageWidthEmu) => '<w:r><w:drawing>'
  + '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251670000" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
  + '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH>'
  + '<wp:positionV relativeFrom="paragraph"><wp:posOffset>440000</wp:posOffset></wp:positionV>'
  + `<wp:extent cx="${pageWidthEmu}" cy="0"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>`
  + '<wp:docPr id="990001" name="Header Rule"/><wp:cNvGraphicFramePr/>'
  + '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">'
  + '<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvCnPr/><wps:spPr>'
  + `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${pageWidthEmu}" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:noFill/>`
  + '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="000000"/></a:solidFill><a:prstDash val="solid"/></a:ln>'
  + '</wps:spPr><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';

function addHeaderRule(zip, docXml) {
  const file = zip.file('word/header1.xml');
  if (!file) return;
  const xml = file.asText();
  if (xml.includes('name="Header Rule"')) return;
  const end = xml.lastIndexOf('</w:p>');
  if (end < 0) return;
  // Page width in twentieths of a point → EMU (635 per twip).
  const pageW = Number((docXml.match(/<w:pgSz[^>]*w:w="(\d+)"/) || [])[1] || 18720) * 635;
  zip.file('word/header1.xml', xml.slice(0, end) + HEADER_RULE_XML(pageW) + xml.slice(end));
}

function buildProgramTableXml(tblOpenXml, headerRowsXml, blankRowTemplate, columnCount, rows, program) {
  const dataRowsXml = (rows && rows.length > 0)
    // Alphabetical by surname (same order as the Reports page), printed
    // SURNAME, First M., vertically merged for faculty with multiple classes.
    ? withFacultySpans(rows).map(({ c: r, span }) => {
      const total = (r.passed || 0) + (r.inc || 0) + (r.failed || 0) + (r.dropped || 0);
      const secCode = classSectionCode(r, program);
      const descriptiveTitle = `${r.subject_name || '—'}${secCode ? ` ${secCode}` : ''}`;
      const vMerge = span > 1 ? 'restart' : span === 0 ? 'continue' : null;
      return fillRowCells(blankRowTemplate, [
        span === 0 ? '' : r.instructor_name ? formatPersonNameCapsSurname(r.instructor_name) : '—',
        r.subject_code || '—',
        descriptiveTitle,
        fmtDate(r.date_submitted),
        String(r.passed || 0),
        String(r.inc || 0),
        String(r.failed || 0),
        String(r.dropped || 0),
        String(total),
      ], vMerge);
    }).join('')
    : emptyStateRowXml(columnCount, 'No classes this semester for this program.');
  return `${tblOpenXml}${headerRowsXml}${dataRowsXml}</w:tbl>`;
}

// `programs` — [{ program, class_breakdown: [...] }]. `preparedByName` — the
// logged-in user's name. `preparedByTitle` — what to print under that name
// on the "Prepared By" line ("Admin" for the whole-college export,
// "Program Chairperson, BSIT" for a Chairperson's own program-scoped one).
export async function exportGradesMonitoringFormDocx({ programs, semester, preparedByName, preparedByTitle = 'Admin' }) {
  try {
    const templateBuf = await fetch(TEMPLATE_URL).then((r) => {
      if (!r.ok) throw new Error(`Template fetch failed: ${r.status}`);
      return r.arrayBuffer();
    });
    const zip = new PizZip(templateBuf);
    let docXml = zip.file('word/document.xml').asText();

    // ── Title/subtitle: pull the whole paragraph out (by its real run
    // boundaries, not a hardcoded literal), swap in the real semester/AY,
    // and remember it — it gets re-inserted right before the table(s)
    // below, since the template's own raw XML order has it AFTER the table
    // (the table there is a floating element, positioned independently of
    // normal document flow; re-flowing it here needs an explicit order).
    let titleParaXml = '';
    const subtitleRange = findSubtitleRange(docXml);
    if (!subtitleRange) {
      console.warn('Grades Monitoring Form template: title/subtitle run sequence not found as expected.');
    } else {
      const titleParaStart = docXml.lastIndexOf('<w:p ', subtitleRange.start);
      const titleParaEndTag = docXml.indexOf('</w:p>', subtitleRange.thirdRClose);
      const titleParaEnd = titleParaEndTag + '</w:p>'.length;
      // "A.Y." or "S.Y." — this semester's own label (Semester Management).
      const yearAbbr = yearAbbrOf(await getSemesterFor(semester));
      const subtitleReplacement = buildSubtitleReplacement(docXml, subtitleRange, semester, yearAbbr);
      titleParaXml = docXml.slice(titleParaStart, subtitleRange.start) + subtitleReplacement + docXml.slice(subtitleRange.thirdRClose, titleParaEnd);
      docXml = docXml.slice(0, titleParaStart) + docXml.slice(titleParaEnd);
    }

    // ── The template's own last paragraph (right before </w:body>) is a
    // leftover empty floating shape/picture placeholder — no visible text,
    // shows up in Word as a bare selectable box with a broken-image icon.
    // Removed entirely rather than exported as-is. The shape's own
    // <wps:txbx><w:txbxContent> wraps ANOTHER, nested <w:p>...</w:p> for its
    // own (empty) text — the first </w:p> after <mc:AlternateContent> is
    // THAT inner one, not the outer paragraph's real closing tag, so it has
    // to be found a different way: <w:sectPr> always immediately follows
    // the body's true last paragraph, so the </w:p> right before it is the
    // one that actually closes the outer paragraph.
    const floatingShapeIdx = docXml.indexOf('<mc:AlternateContent>');
    if (floatingShapeIdx !== -1) {
      const shapeParaStart = docXml.lastIndexOf('<w:p ', floatingShapeIdx);
      const sectPrIdx = docXml.indexOf('<w:sectPr', floatingShapeIdx);
      const shapeParaEnd = sectPrIdx !== -1 ? docXml.lastIndexOf('</w:p>', sectPrIdx) + '</w:p>'.length : -1;
      if (shapeParaStart !== -1 && shapeParaEnd > shapeParaStart) {
        docXml = docXml.slice(0, shapeParaStart) + docXml.slice(shapeParaEnd);
      } else {
        console.warn('Grades Monitoring Form template: trailing floating shape paragraph boundary not found as expected — leaving it in place.');
      }
    }

    // "Faculty Teaching Load" and "No. of students with:" stay one line
    // each (a forced 2-line break here was tried and reverted — the
    // reference form keeps these single-line; only "Date Submitted to the
    // / Program Chairperson", which the template itself already wraps,
    // stays 2-line).

    // ── Table: the template ships with exactly ONE (a 2-row merged header
    // plus one blank, mostly-empty data row meant for pen-and-paper
    // filling) — everything up to its first <w:tr> is the tblPr/tblGrid
    // preamble (kept as-is except its floating tblpPr, stripped so cloned
    // copies stack in normal reading order instead of all floating at the
    // same fixed page position and overlapping each other). Repeated once
    // per program, each under its own heading, to build the whole-college
    // version.
    const tblStart = docXml.indexOf('<w:tbl>');
    const tblCloseIdx = docXml.indexOf('</w:tbl>');
    const firstTrStart = tblStart >= 0 ? docXml.indexOf('<w:tr', tblStart) : -1;

    if (tblStart < 0 || tblCloseIdx < 0 || firstTrStart < 0) {
      console.warn('Grades Monitoring Form template: table not found as expected — leaving the template default in place.');
    } else {
      let tblOpenXml = docXml.slice(tblStart, firstTrStart).replace(/<w:tblpPr\b[^>]*\/>/, '');
      const tblPrEnd = tblOpenXml.indexOf('</w:tblPr>') + '</w:tblPr>'.length;
      const newGridXml = `<w:tblGrid>${NEW_GRID_COLS.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

      if (!/<w:tblCellMar\b/.test(tblOpenXml)) {
        tblOpenXml = tblOpenXml.slice(0, tblPrEnd - '</w:tblPr>'.length) + '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>' + newGridXml;
      } else {
        tblOpenXml = tblOpenXml.replace(/<w:tblCellMar>[\s\S]*?<\/w:tblCellMar>/, '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar>');
        tblOpenXml = tblOpenXml.slice(0, tblPrEnd) + newGridXml;
      }

      const firstTrCloseIdx = docXml.indexOf('</w:tr>', firstTrStart) + '</w:tr>'.length;
      const secondTrCloseIdx = docXml.indexOf('</w:tr>', firstTrCloseIdx) + '</w:tr>'.length;
      const headerRowsXml = styleHeaderRows(docXml.slice(firstTrStart, secondTrCloseIdx));
      const blankRowStart = docXml.indexOf('<w:tr', secondTrCloseIdx);
      const blankRowXml = docXml.slice(blankRowStart, tblCloseIdx);
      const blankRowTemplate = blankRowXml
        .replace(/<w:tblPrEx>[\s\S]*?<\/w:tblPrEx>/, '')
        .replace(/<w:trPr>[\s\S]*?<\/w:trPr>/, '');
      const columnCount = NEW_GRID_COLS.length;

      const list = programs && programs.length > 0 ? programs : [];
      const sectionsXml = list.map(({ program, class_breakdown }) => (
        (list.length > 1 ? programHeadingXml(program) : '') +
        buildProgramTableXml(tblOpenXml, headerRowsXml, blankRowTemplate, columnCount, class_breakdown || [], program)
      )).join('');

      if (sectionsXml) {
        docXml = docXml.slice(0, tblStart) + titleParaXml + sectionsXml + docXml.slice(tblCloseIdx + '</w:tbl>'.length);
      }
    }

    zip.file('word/document.xml', docXml);

    addHeaderRule(zip, docXml);

    // ── Footer: "Prepared By" name/title — "Noted By" (the Dean) stays
    // fixed, matching this app's own org chart (no separate Dean role).
    const footerFile = zip.file('word/footer1.xml');
    if (footerFile) {
      let footerXml = footerFile.asText();
      footerXml = footerXml
        .split('MARK B. ESCALANTE').join(esc((preparedByName ? formatPersonNameFirstLast(preparedByName) : '').toUpperCase()))
        .split('Program Chairperson, BSIT').join(esc(preparedByTitle));
      zip.file('word/footer1.xml', footerXml);
    }

    const blob = zip.generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const scopeLabel = (programs || []).length === 1 ? programShortLabel(programs[0].program) : 'AllPrograms';
    saveAs(blob, `GradesMonitoringForm_${scopeLabel}_${(semester || '').replace(/\s+/g, '_')}.docx`);
    toast.success('Exported the Grades Monitoring Form!');
  } catch (err) {
    console.error(err);
    toast.error('Failed to export the Grades Monitoring Form');
  }
}
