// ── SSU Evaluation of Grades — Student .docx export ─────────────────────────
// Fills a template built directly from the actual source Google Doc (fetched,
// unzipped, and edited by targeted string/XML substitution —
// public/templates/evaluation-of-grades-template.docx) so every visual
// detail — the real letterhead, accreditation badges, program banner,
// column widths/fonts/borders, and the "Evaluated By"/"Noted By" footer —
// comes from the source file itself instead of being hand-reconstructed with
// the `docx` library. This code only ever touches: the program banner text,
// the NAME/Student No. line, and the eight Year/Semester table slots
// (cloned from the template's own single real table, once per Year 1-4 ×
// 1st/2nd Semester that actually has subjects) — everything else in the
// package (letterhead, title, signature block, disclaimer) is untouched.
import PizZip from 'pizzip';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';
import { docxBlobToPdf } from './docxToPdf';
import { programShortLabel, formatPersonName, formatPersonNameFirstLast } from '../components/common';
import { gradeCellText, gradeCellColor, hrsOrDash, requisiteText, semesterSums } from '../components/student/ProspectusTable';

const TEMPLATE_URL = '/templates/evaluation-of-grades-template.docx';

const NAME_LINE_PLACEHOLDER = '<w:p><w:r><w:t>@@AGMS_NAME_LINE@@</w:t></w:r></w:p>';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Every <w:t ...>...</w:t> run's text, in document order, within one XML
// fragment — used to address the NAME/ID paragraph's runs positionally
// (the template gives them no distinguishing marker of their own; only
// their position among the paragraph's runs tells them apart).
function replaceNthRunText(fragmentXml, n, newText) {
  let i = -1;
  return fragmentXml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/g, (whole, open, _old, close) => {
    i += 1;
    return i === n ? `${open}${esc(newText)}${close}` : whole;
  });
}

// Swaps the FIRST <w:t>'s text inside one <w:tc>...</w:tc> cell, leaving
// every formatting attribute (bold, size, alignment, underline, color)
// exactly as the template already has it. A cell with no text run at all
// (padding cells) is returned untouched.
function setCellText(cellXml, text) {
  if (!/<w:t[^>]*>/.test(cellXml)) return cellXml;
  let done = false;
  return cellXml.replace(/(<w:t[^>]*>)([^<]*)(<\/w:t>)/, (whole, open, _old, close) => {
    if (done) return whole;
    done = true;
    return `${open}${esc(text)}${close}`;
  });
}

// Same as setCellText, but also injects a <w:color> right after the cell's
// existing <w:u .../> (the Grade column is the only one that's ever colored
// — green/red for Passed/Failed, matching the on-screen ProspectusTable).
function setGradeCell(cellXml, text, colorHex) {
  let out = setCellText(cellXml, text);
  if (colorHex) out = out.replace('<w:u w:val="single"/>', `<w:u w:val="single"/><w:color w:val="${colorHex}"/>`);
  return out;
}

function cellsOf(rowXml) {
  return rowXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
}

function rebuildRow(rowTemplateXml, filledCells) {
  const prefix = rowTemplateXml.slice(0, rowTemplateXml.indexOf('<w:tc>'));
  const suffix = rowTemplateXml.slice(rowTemplateXml.lastIndexOf('</w:tc>') + '</w:tc>'.length);
  return prefix + filledCells.join('') + suffix;
}

// One subject row — column order matches the template's own <w:tblGrid>
// exactly: Grade, Subject Code, Description, Lecture Hrs/Units, Laboratory
// Hrs/Units, Total Hrs/Units, Pre-Requisite, Co-Requisite.
function buildDataRowXml(dataRowTemplateXml, r) {
  const s = r.subject;
  const values = [
    gradeCellText(r) || '_______',
    s.code || '',
    s.name || '',
    hrsOrDash(s.lecture_hours),
    hrsOrDash(s.lecture_units),
    hrsOrDash(s.lab_hours),
    hrsOrDash(s.lab_units),
    hrsOrDash((s.total_hours ?? ((s.lecture_hours || 0) + (s.lab_hours || 0))) || null),
    String(s.units ?? ''),
    requisiteText(s, 'pre') || '—',
    requisiteText(s, 'co') || '—',
  ];
  const color = gradeCellColor(r);
  const filled = cellsOf(dataRowTemplateXml).map((c, i) => (
    i === 0 ? setGradeCell(c, values[0], color?.replace('#', '')) : setCellText(c, values[i])
  ));
  return rebuildRow(dataRowTemplateXml, filled);
}

// The Totals row — 10 <w:tc> cells for 11 grid columns (Subject Code +
// Description are merged under one gridSpan="2" "Total:" cell): blank Grade,
// "Total:", the six Lecture/Laboratory/Total Hrs-Units sums, blank Pre/Co-Requisite.
function buildTotalsRowXml(totalsRowTemplateXml, rows) {
  const sums = semesterSums(rows);
  const values = ['', 'Total:', sums.lecHrs || '', sums.lecUnits || '', sums.labHrs || '', sums.labUnits || '', sums.totalHrs || '', sums.totalUnits || '', '', ''];
  const filled = cellsOf(totalsRowTemplateXml).map((c, i) => setCellText(c, values[i]));
  return rebuildRow(totalsRowTemplateXml, filled);
}

function buildSemesterTableXml(tblOpenXml, headerRowsXml, dataRowTemplateXml, totalsRowTemplateXml, rows) {
  const dataRowsXml = rows.map((r) => buildDataRowXml(dataRowTemplateXml, r)).join('');
  const totalsXml = buildTotalsRowXml(totalsRowTemplateXml, rows);
  return `${tblOpenXml}${headerRowsXml}${dataRowsXml}${totalsXml}</w:tbl>`;
}

// Finds the <w:p ...>...</w:p> that contains `text`, searching forward from
// `fromIdx`. Returns null if not found (so a caller can fail loud instead of
// silently corrupting the document with a bad slice).
function findParagraph(xml, text, fromIdx = 0) {
  const textIdx = xml.indexOf(text, fromIdx);
  if (textIdx === -1) return null;
  const start = xml.lastIndexOf('<w:p ', textIdx);
  const end = xml.indexOf('</w:p>', textIdx) + '</w:p>'.length;
  if (start === -1 || end < '</w:p>'.length) return null;
  return { start, end, textIdx };
}

// The template has a handful of leftover blank paragraphs sitting between
// some headings (formatting artifacts from however the source Google Doc
// was originally edited) — most transitions have one, but Year 3's Second
// Semester → Fourth Year has SIX of them, each sized for a 16pt heading,
// which is what actually produces a near-empty page in between. Rather than
// trust the template to be consistent, every following blank paragraph is
// stripped uniformly right before a table (or the next heading) gets
// spliced in, so the gap is only ever as big as the real content wants it
// to be — never an accident of how many stray empty lines happened to be
// left in the source file at that particular spot.
function stripFollowingEmptyParagraphs(xml, fromIdx) {
  let idx = fromIdx;
  for (;;) {
    if (!xml.startsWith('<w:p', idx)) break;
    const end = xml.indexOf('</w:p>', idx) + '</w:p>'.length;
    if (end < '</w:p>'.length) break;
    const paraXml = xml.slice(idx, end);
    const hasVisibleText = /<w:t[^>]*>[^<]*\S[^<]*<\/w:t>/.test(paraXml);
    if (hasVisibleText) break;
    xml = xml.slice(0, idx) + xml.slice(end);
  }
  return { xml, idx };
}

// Mirror of stripFollowingEmptyParagraphs, but walking BACKWARD from
// `beforeIdx` (a paragraph's own start index) — removes whichever empty
// paragraphs sit immediately before it. Same source-file leftovers, just on
// the other side: a Year heading preceded by a pile of stray blank
// paragraphs reads as a ragged half-empty gap above it instead of a clean
// break. Returns the updated xml plus that paragraph's own new start index
// (shifted left by however much was actually removed).
function stripPrecedingEmptyParagraphs(xml, beforeIdx) {
  let idx = beforeIdx;
  for (;;) {
    if (xml.slice(Math.max(0, idx - '</w:p>'.length), idx) !== '</w:p>') break;
    const closeEnd = idx;
    // Matches a real paragraph-open tag only ("<w:p " with attributes, or
    // bare "<w:p>") — plain lastIndexOf('<w:p', ...) would also match
    // "<w:pPr>"/"<w:pStyle>"/etc., since they share that same 4-char
    // prefix, and walk the boundary into the middle of the wrong paragraph.
    const openStart = Math.max(xml.lastIndexOf('<w:p ', closeEnd - 1), xml.lastIndexOf('<w:p>', closeEnd - 1));
    if (openStart === -1) break;
    const paraXml = xml.slice(openStart, closeEnd);
    const hasVisibleText = /<w:t[^>]*>[^<]*\S[^<]*<\/w:t>/.test(paraXml);
    if (hasVisibleText) break;
    xml = xml.slice(0, openStart) + xml.slice(closeEnd);
    idx = openStart;
  }
  return { xml, start: idx };
}

// Forces a real page break into a "SECOND YEAR" / "THIRD YEAR" / "FOURTH
// YEAR" heading paragraph — the template itself is inconsistent about this:
// some of these headings carry only a soft <w:br w:type="textWrapping"/>
// (a plain line break, which does nothing to start a new page) and "FOURTH
// YEAR" has no break at all, relying purely on the leftover blank
// paragraphs stripPrecedingEmptyParagraphs cleans up above to accidentally
// land it near the top of a new page. Every Year now starts its own
// deliberate page instead of it being however much content the previous
// Year's tables happened to fill.
function forcePageBreakInHeading(paraXml) {
  if (paraXml.includes('<w:br w:type="textWrapping"/>')) {
    return paraXml.replace('<w:br w:type="textWrapping"/>', '<w:br w:type="page"/>');
  }
  return paraXml.replace(/(<\/w:rPr>)(<w:t)/, '$1<w:br w:type="page"/>$2');
}

export async function exportEvaluationOfGradesDocx({ student, years, chairperson, adviser, format = 'docx' }) {
  try {
    const templateBuf = await fetch(TEMPLATE_URL).then((r) => {
      if (!r.ok) throw new Error(`Template fetch failed: ${r.status}`);
      return r.arrayBuffer();
    });
    const zip = new PizZip(templateBuf);
    let docXml = zip.file('word/document.xml').asText();
    let pdfNameTableXml = null;

    // ── Header on the first page only — the template's own SSU letterhead
    // is set as the "default" header, which Word repeats on every page. A
    // seven-semester, multi-page export otherwise reprints the seal and
    // accreditation badges on every single page. `w:titlePg` turns on
    // Word's "Different First Page" behavior, and retyping the existing
    // header reference from "default" to "first" makes it apply to page 1
    // only — with no "default" reference left, Word leaves every later page
    // blank up top instead.
    const headerRefBefore = '<w:headerReference r:id="rId8" w:type="default"/>';
    const headerRefAfter = '<w:headerReference r:id="rId8" w:type="first"/>';
    if (docXml.includes(headerRefBefore)) {
      docXml = docXml.replace(headerRefBefore, headerRefAfter);
    } else {
      console.warn('Evaluation of Grades template: header reference not found in the expected form — header may still repeat on every page.');
    }
    const pgNumBefore = '<w:pgNumType w:start="1"/></w:sectPr>';
    const pgNumAfter = '<w:pgNumType w:start="1"/><w:titlePg/></w:sectPr>';
    if (docXml.includes(pgNumBefore)) {
      docXml = docXml.replace(pgNumBefore, pgNumAfter);
    } else {
      console.warn('Evaluation of Grades template: sectPr end not found in the expected form — <w:titlePg/> not added.');
    }

    // ── Program banner — the template's own sample text lives inside a
    // floating text box, found and swapped by its literal (unique) content
    // rather than by structural position.
    const programText = `${(student.program || '').toUpperCase()}${student.program ? ` (${programShortLabel(student.program).toUpperCase()})` : ''}`;
    docXml = docXml.replace('BACHELOR OF SCIENCE IN INFORMATION TECHNOLOGY (BSINFOTECH)', esc(programText));

    // ── NAME / Student No. / "FIRST YEAR" — the template packs all three
    // into ONE centered paragraph (name/ID padded apart with literal spaces,
    // then a line-break, then "FIRST YEAR"). Centering that whole block
    // means the ID's horizontal position drifts with however long the name
    // happens to be, instead of sitting flush at the page's right margin
    // like a real "Name ____________________ No. ____" form field. Split
    // into two real paragraphs instead: the NAME/ID line goes left-aligned
    // with a right tab stop planted at the page's own right margin (pulled
    // from this doc's actual <w:pgSz>/<w:pgMar>, not a guessed number), and
    // "FIRST YEAR" keeps the original paragraph's own centered formatting
    // untouched on its own line.
    const nameParaBounds = findParagraph(docXml, 'NAME:');
    if (nameParaBounds) {
      const nameParaXml = docXml.slice(nameParaBounds.start, nameParaBounds.end);
      const runs = nameParaXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [];
      // runs[0]="NAME:"+spaces, [1]=name field, [2]=" <ID>"+spaces,
      // [3]="  "+<w:br/> (the line break to "FIRST YEAR"), [4]="FIRST YEAR",
      // [5]=trailing empty run — matches the structure dumped from the
      // actual template; if that ever changes, fail loud instead of
      // silently mangling the header.
      if (runs.length < 5) {
        console.warn('Evaluation of Grades template: NAME paragraph run count not as expected — leaving it untouched.');
      } else {
        const rPr = (r) => (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
        const stripUnderline = (s) => s.replace(/<w:u\b[^/]*\/>/, '');
        // Both the "NAME:" label and the ID run ship bold + underline in the
        // template — dropped on both here. On the label, that underline was
        // drawing under "NAME:" itself; on the ID run, the tab now sits
        // inside that same run (to reach the right margin), so its
        // underline drew one continuous line under the entire gap, not just
        // under the digits.
        const labelRunRPr = stripUnderline(rPr(runs[0])); // bold, no underline
        const nameRunRPr = rPr(runs[1]); // bold, no underline
        const idRunRPr = stripUnderline(rPr(runs[2]));
        const yearHeadingRuns = runs.slice(4).join('');

        // Right margin in twips, straight from this document's own page
        // setup — usable width = page width - left margin - right margin.
        const pgSzMatch = docXml.match(/<w:pgSz\b[^>]*\/>/);
        const pgMarMatch = docXml.match(/<w:pgMar\b[^>]*\/>/);
        const pageW = pgSzMatch ? Number(pgSzMatch[0].match(/w:w="(\d+)"/)?.[1]) : 12240;
        const marLeft = pgMarMatch ? Number(pgMarMatch[0].match(/w:left="(\d+)"/)?.[1]) : 284;
        const marRight = pgMarMatch ? Number(pgMarMatch[0].match(/w:right="(\d+)"/)?.[1]) : 284;
        const rightTabPos = pageW - marLeft - marRight;

        // The PDF renderer doesn't honor right-aligned tab stops, so for a
        // PDF the same line is a borderless two-cell table (name left, ID
        // flush right) — identical on the page.
        const noBorders = '<w:tblBorders><w:top w:val="none" w:sz="0" w:space="0"/><w:left w:val="none" w:sz="0" w:space="0"/><w:bottom w:val="none" w:sz="0" w:space="0"/><w:right w:val="none" w:sz="0" w:space="0"/><w:insideH w:val="none" w:sz="0" w:space="0"/><w:insideV w:val="none" w:sz="0" w:space="0"/></w:tblBorders>';
        const tightP = (jc) => `<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="${jc}"/></w:pPr>`;
        // A placeholder paragraph stands in until the end: the semester-table
        // code below finds the template's own table as the FIRST <w:tbl>.
        if (format === 'pdf') pdfNameTableXml = `<w:tbl><w:tblPr><w:tblW w:w="${rightTabPos}" w:type="dxa"/>${noBorders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
            `<w:tblGrid><w:gridCol w:w="${rightTabPos - 2400}"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>` +
            `<w:tc><w:tcPr><w:tcW w:w="${rightTabPos - 2400}" w:type="dxa"/></w:tcPr><w:p>${tightP('left')}` +
            `<w:r>${labelRunRPr}<w:t xml:space="preserve">NAME: </w:t></w:r>` +
            `<w:r>${nameRunRPr}<w:t xml:space="preserve">${esc(formatPersonName(student.name).toUpperCase())}</w:t></w:r></w:p></w:tc>` +
            `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p>${tightP('right')}` +
            `<w:r>${idRunRPr}<w:t xml:space="preserve">${esc(student.student_no || '')}</w:t></w:r></w:p></w:tc>` +
            `</w:tr></w:tbl>`;
        const nameLineXml = pdfNameTableXml
          ? NAME_LINE_PLACEHOLDER
          : `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="none" w:pos="${rightTabPos}"/></w:tabs>` +
          `<w:spacing w:line="240" w:lineRule="auto"/><w:ind w:left="5" w:firstLine="0"/><w:jc w:val="left"/></w:pPr>` +
          `<w:r>${labelRunRPr}<w:t xml:space="preserve">NAME: </w:t></w:r>` +
          `<w:r>${nameRunRPr}<w:t xml:space="preserve">${esc(formatPersonName(student.name).toUpperCase())}</w:t></w:r>` +
          `<w:r>${idRunRPr}<w:tab/><w:t xml:space="preserve">${esc(student.student_no || '')}</w:t></w:r>` +
          `</w:p>`;
        const yearHeadingXml = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${yearHeadingRuns}</w:p>`;

        docXml = docXml.slice(0, nameParaBounds.start) + nameLineXml + yearHeadingXml + docXml.slice(nameParaBounds.end);
      }
    } else {
      console.warn('Evaluation of Grades template: NAME paragraph not found as expected.');
    }

    // ── Signature block — the template packs "Noted By:"/"Evaluated By:",
    // the name, and both role labels into ONE paragraph, positioned purely
    // with literal space-padding and natural word-wrap (only one explicit
    // <w:br/> — the other two visual "rows" are just where that space
    // happens to overflow the page width). Any edit to the text lengths
    // here risks reflowing which line things land on, not just their
    // horizontal spot — exactly what broke the Adviser/Dean pairing before.
    // Rebuilt as a real 3-column borderless table instead: Evaluated By/
    // Adviser (blank) first, Noted By/Dean (with the named signatory)
    // second, Verified By/Chairperson (the student's own program's actual
    // Chairperson, looked up server-side — not a hardcoded name) third,
    // each cell keeping the exact formatting harvested from its own
    // original run.
    const sigParaBounds = findParagraph(docXml, 'Noted By');
    if (sigParaBounds) {
      const sigParaXml = docXml.slice(sigParaBounds.start, sigParaBounds.end);
      const sigRuns = sigParaXml.match(/<w:r\b[\s\S]*?<\/w:r>/g) || [];
      const rPr = (r) => (r.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      const notedByLabelRPr = rPr(sigRuns[1]); // bold
      const evaluatedByLabelRPr = rPr(sigRuns[3]); // bold
      const blankLineRPr = rPr(sigRuns[4]); // underline (signature line)
      const nameRPr = rPr(sigRuns[7]); // bold, underline, Arial 10pt — the named signatory
      const adviserRPr = rPr(sigRuns[10]); // italic
      const deanRPr = rPr(sigRuns[12]); // italic, Arial 10pt
      if (sigRuns.length < 13) {
        console.warn('Evaluation of Grades template: signature paragraph run count not as expected — leaving it untouched.');
      } else {
        const pgSzMatch2 = docXml.match(/<w:pgSz\b[^>]*\/>/);
        const pgMarMatch2 = docXml.match(/<w:pgMar\b[^>]*\/>/);
        const usableW = (pgSzMatch2 ? Number(pgSzMatch2[0].match(/w:w="(\d+)"/)?.[1]) : 12240)
          - (pgMarMatch2 ? Number(pgMarMatch2[0].match(/w:left="(\d+)"/)?.[1]) : 284)
          - (pgMarMatch2 ? Number(pgMarMatch2[0].match(/w:right="(\d+)"/)?.[1]) : 284);
        const gapW = 500; // dead column between Evaluated By/Noted By, purely for breathing room
        const colW = Math.floor((usableW - gapW) / 2);

        // Vertical spacing between the label/name/role lines within a cell,
        // plus a bit of cell padding — the template's own rows had none,
        // which read as cramped once pulled out of the old space-padded line.
        // The document's own default paragraph style (styles.xml docDefaults)
        // adds ~10pt of "space after" to every paragraph with no explicit
        // override — left alone, that stacks on top of this cell padding on
        // every row of every signature cell, which is what was blowing the
        // label/name/role rows apart. Zeroed here so the only vertical gap
        // between rows is the cell padding actually asked for above.
        const cellPr = '<w:tcPr><w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tcMar></w:tcPr>';
        const tightPPr = '<w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>';
        const cell = (children) => `<w:tc>${cellPr}<w:p>${tightPPr}${children}</w:p></w:tc>`;
        const run = (r, t) => (t ? `<w:r>${r}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>` : '');
        const gapCell = '<w:tc><w:tcPr><w:tcW w:w="' + gapW + '" w:type="dxa"/></w:tcPr><w:p>' + tightPPr + '</w:p></w:tc>';
        const chairpersonName = chairperson?.name ? formatPersonNameFirstLast(chairperson.name).toUpperCase() : '';
        const chairpersonRole = `Chairperson${student.program ? `, ${programShortLabel(student.program)}` : ''}`;
        // The student's adviser (assigned to their Program / Year / Section).
        const adviserName = adviser?.name ? formatPersonNameFirstLast(adviser.name).toUpperCase() : '';

        // Evaluated By (left) / Noted By (right), side by side, with a
        // deliberate gap column between them and top/bottom cell padding on
        // every row for spacing that doesn't depend on font line-height alone.
        const topTableXml =
          `<w:tbl><w:tblPr><w:tblW w:w="${usableW}" w:type="dxa"/><w:tblBorders>` +
          `<w:top w:val="none" w:sz="0" w:space="0"/><w:left w:val="none" w:sz="0" w:space="0"/>` +
          `<w:bottom w:val="none" w:sz="0" w:space="0"/><w:right w:val="none" w:sz="0" w:space="0"/>` +
          `<w:insideH w:val="none" w:sz="0" w:space="0"/><w:insideV w:val="none" w:sz="0" w:space="0"/>` +
          `</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
          `<w:tblGrid><w:gridCol w:w="${colW}"/><w:gridCol w:w="${gapW}"/><w:gridCol w:w="${colW}"/></w:tblGrid>` +
          `<w:tr>${cell(run(evaluatedByLabelRPr, 'Evaluated By:'))}${gapCell}${cell(run(notedByLabelRPr, 'Noted By:'))}</w:tr>` +
          `<w:tr>${cell(adviserName ? run(nameRPr, adviserName) : run(blankLineRPr, '            '))}${gapCell}${cell(run(nameRPr, 'SWEET MERCY F. PACOLOR, DIT'))}</w:tr>` +
          `<w:tr>${cell(run(adviserRPr, 'Adviser'))}${gapCell}${cell(run(deanRPr, 'Dean, College of Arts and Sciences'))}</w:tr>` +
          `</w:tbl>`;

        // Verified By sits on its own row below, left-aligned like the other
        // two, with a clear gap above separating it from the pair.
        const spacerXml = '<w:p><w:pPr><w:spacing w:before="360" w:after="0"/></w:pPr></w:p>';
        const bottomTableXml =
          `<w:tbl><w:tblPr><w:tblW w:w="${usableW}" w:type="dxa"/><w:tblBorders>` +
          `<w:top w:val="none" w:sz="0" w:space="0"/><w:left w:val="none" w:sz="0" w:space="0"/>` +
          `<w:bottom w:val="none" w:sz="0" w:space="0"/><w:right w:val="none" w:sz="0" w:space="0"/>` +
          `<w:insideH w:val="none" w:sz="0" w:space="0"/><w:insideV w:val="none" w:sz="0" w:space="0"/>` +
          `</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
          `<w:tblGrid><w:gridCol w:w="${colW}"/></w:tblGrid>` +
          `<w:tr>${cell(run(notedByLabelRPr, 'Verified By:'))}</w:tr>` +
          `<w:tr>${cell(chairpersonName ? run(nameRPr, chairpersonName) : run(blankLineRPr, '            '))}</w:tr>` +
          `<w:tr>${cell(run(deanRPr, chairpersonRole))}</w:tr>` +
          `</w:tbl>`;

        docXml = docXml.slice(0, sigParaBounds.start) + topTableXml + spacerXml + bottomTableXml + docXml.slice(sigParaBounds.end);
      }
    } else {
      console.warn('Evaluation of Grades template: signature paragraph not found as expected.');
    }

    // ── The template ships with exactly ONE table — Year 1, First
    // Semester's own real subject rows — everything up to its first <w:tr>
    // is the tblPr/tblGrid preamble (column widths, borders, style), reused
    // as-is for every semester's own clone. Row 0-1 are the two-row merged
    // header (kept verbatim), one data row is the reusable per-subject
    // template, and the last row is the Totals-row template.
    const tblStart = docXml.indexOf('<w:tbl>');
    const tblCloseIdx = docXml.indexOf('</w:tbl>') + '</w:tbl>'.length;
    if (tblStart === -1 || tblCloseIdx < '</w:tbl>'.length) {
      throw new Error('Evaluation of Grades template: source table not found.');
    }
    const templateTableXml = docXml.slice(tblStart, tblCloseIdx);
    const trMatches = templateTableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) || [];
    if (trMatches.length < 4) throw new Error('Evaluation of Grades template: source table has fewer rows than expected.');
    const firstTrStart = templateTableXml.indexOf('<w:tr');
    const tblOpenXml = templateTableXml.slice(0, firstTrStart);
    // The template's own two header rows ship with `tblHeader="0"` and
    // `cantSplit="0"` — meaning Word doesn't repeat them when a table spans
    // a page break, AND is free to split a header row itself right across
    // that break (the "Grade / Subject Code / ... " row ending up cut in
    // half, continuing on the next page). Flipped to "1" on both: the
    // header now always repeats intact at the top of a continuation page
    // instead of being torn apart by wherever the page happened to end.
    const headerRowsXml = (trMatches[0] + trMatches[1])
      .split('<w:tblHeader w:val="0"/>').join('<w:tblHeader w:val="1"/>')
      .split('<w:cantSplit w:val="0"/>').join('<w:cantSplit w:val="1"/>');
    const dataRowTemplateXml = trMatches[2];
    const totalsRowTemplateXml = trMatches[trMatches.length - 1];

    // Remove the template's own hardcoded Year 1/First Semester table
    // entirely — every semester's table (including this one) gets rebuilt
    // fresh from the logged-in student's actual data in the loop below, so
    // the sample subjects never leak into a real export.
    docXml = docXml.slice(0, tblStart) + docXml.slice(tblCloseIdx);

    // ── Walk the eight Year/Semester heading paragraphs in document order
    // (they're identical text across years — "FIRST SEMESTER"/"SECOND
    // SEMESTER" each appear 4 times — so each is found positionally, always
    // searching forward from where the previous one left off) and splice
    // that semester's own table in right after its heading paragraph closes,
    // only when the student actually has subjects listed for it.
    const SEM_MARKERS = [
      { key: '1st Semester', marker: 'FIRST SEMESTER' },
      { key: '2nd Semester', marker: 'SECOND SEMESTER' },
    ];
    // Year 1 needs nothing here — it's already page 1, right under the
    // NAME/ID line. Years 2-4 each get forced onto their own fresh page
    // below, instead of landing wherever the previous Year's content
    // happened to end.
    const YEAR_MARKERS = { 2: 'SECOND YEAR', 3: 'THIRD YEAR', 4: 'FOURTH YEAR' };
    let cursor = 0;
    for (let yr = 1; yr <= 4; yr += 1) {
      const yearMarker = YEAR_MARKERS[yr];
      if (yearMarker) {
        const yearPara = findParagraph(docXml, yearMarker, cursor);
        if (!yearPara) {
          console.warn(`Evaluation of Grades template: "${yearMarker}" heading not found — page break skipped.`);
        } else {
          const before = stripPrecedingEmptyParagraphs(docXml, yearPara.start);
          docXml = before.xml;
          const headingStart = before.start;
          const headingLen = yearPara.end - yearPara.start;
          const headingEnd = headingStart + headingLen;
          const fixedHeadingXml = forcePageBreakInHeading(docXml.slice(headingStart, headingEnd));
          docXml = docXml.slice(0, headingStart) + fixedHeadingXml + docXml.slice(headingEnd);
          const after = stripFollowingEmptyParagraphs(docXml, headingStart + fixedHeadingXml.length);
          docXml = after.xml;
          cursor = after.idx;
        }
      }
      for (const { key, marker } of SEM_MARKERS) {
        const para = findParagraph(docXml, marker, cursor);
        if (!para) {
          console.warn(`Evaluation of Grades template: "${marker}" heading not found for Year ${yr} — skipping.`);
          continue;
        }
        const stripped = stripFollowingEmptyParagraphs(docXml, para.end);
        docXml = stripped.xml;
        const insertAt = stripped.idx;

        const rows = years?.[yr]?.[key] || [];
        const insertXml = rows.length > 0
          ? buildSemesterTableXml(tblOpenXml, headerRowsXml, dataRowTemplateXml, totalsRowTemplateXml, rows)
          : '';
        docXml = docXml.slice(0, insertAt) + insertXml + docXml.slice(insertAt);
        cursor = insertAt + insertXml.length;
      }
    }

    if (pdfNameTableXml) docXml = docXml.replace(NAME_LINE_PLACEHOLDER, pdfNameTableXml);
    zip.file('word/document.xml', docXml);

    const blob = zip.generate({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const baseName = `${(student.student_no || student.name || 'Evaluation').replace(/\s+/g, '_')}_EvaluationOfGrades`;
    if (format === 'pdf') await docxBlobToPdf(blob, `${baseName}.pdf`);
    else saveAs(blob, `${baseName}.docx`);
    toast.success('Exported the Evaluation of Grades!');
  } catch (err) {
    console.error('Failed to export Evaluation of Grades from template:', err);
    toast.error('Failed to export the Evaluation of Grades');
  }
}
