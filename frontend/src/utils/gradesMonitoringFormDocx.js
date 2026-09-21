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
import { programShortLabel } from '../components/common';

const TEMPLATE_URL = '/templates/grades-monitoring-form-template.docx';
const HEADER_SHADE = 'D9D9D9'; // light gray, matches the reference printout's own header row shading

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ORDINAL_NUM = { First: '1', Second: '2', Third: '3' };
const ORDINAL_SUF = { First: 'st', Second: 'nd', Third: 'rd' };

// Finds "College of Arts and Sciences / 1[st] Semester A.Y. 2026-2027" by
// its actual run boundaries (not a hardcoded literal string) — the marker
// text sits inside the SAME run as "GRADES MONITORING FORM" (joined by a
// text-wrapping <w:br/>), so the replacement can only start after the
// marker text itself, never at that run's own opening tag.
function findSubtitleRange(docXml) {
  const marker = 'College of Arts and Sciences / 1';
  const markerIdx = docXml.indexOf(marker);
  if (markerIdx === -1) return null;
  const afterMarker = markerIdx + marker.length;
  const firstTClose = docXml.indexOf('</w:t>', afterMarker) + '</w:t>'.length;
  const firstRClose = docXml.indexOf('</w:r>', firstTClose) + '</w:r>'.length; // closes the run "GRADES MONITORING FORM<br/>College of Arts and Sciences / 1" started in
  const secondRClose = docXml.indexOf('</w:r>', firstRClose) + '</w:r>'.length; // the superscript "st" run
  const thirdRClose = docXml.indexOf('</w:r>', secondRClose) + '</w:r>'.length; // the " Semester A.Y. 2026-2027" run
  if (firstRClose < 0 || secondRClose < 0 || thirdRClose < 0) return null;
  return { start: markerIdx, firstRClose, secondRClose, thirdRClose };
}

// Rebuilds the subtitle in place using the ORIGINAL run 2 ("st" superscript)
// and run 3 (" Semester A.Y. ...") XML verbatim — preserves their exact
// formatting attributes automatically — with only their actual text content
// swapped out, rather than hand-reconstructing the run XML from scratch.
function buildSubtitleReplacement(docXml, range, semesterName) {
  const raw = semesterName || '';
  const ay = raw.match(/\d{4}-\d{4}/)?.[0] || '';
  const term = raw.replace(ay, '').replace(/,?\s*$/, '').replace(/\s*(Semester|Summer)\s*$/i, '').trim();
  const isSummer = /summer/i.test(raw);
  const num = ORDINAL_NUM[term] || '1';
  const suf = ORDINAL_SUF[term] || 'st';

  const run2Xml = docXml.slice(range.firstRClose, range.secondRClose);
  const run3Xml = docXml.slice(range.secondRClose, range.thirdRClose);

  if (isSummer) {
    // No ordinal suffix for Summer — drop run 2 entirely, adjust run 3's
    // own text (still reusing its real formatting attributes).
    const newRun3 = run3Xml.replace(/<w:t[^>]*>[^<]*<\/w:t>/, `<w:t xml:space="preserve"> Summer A.Y. ${esc(ay)}</w:t>`);
    return `College of Arts and Sciences / Summer</w:t></w:r>${newRun3}`;
  }
  const newRun2 = run2Xml.replace(/<w:t[^>]*>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${esc(suf)}</w:t>`);
  const newRun3 = run3Xml.replace(/<w:t[^>]*>[^<]*<\/w:t>/, `<w:t xml:space="preserve"> Semester A.Y. ${esc(ay)}</w:t>`);
  return `College of Arts and Sciences / ${num}</w:t></w:r>${newRun2}${newRun3}`;
}

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) : '—');

// Injects a light-gray fill AND italic into every header cell — the
// data rows underneath stay upright (regular, not italic); it's the column
// headers themselves (Name of Faculty, Program, ... Total) that are meant
// to read italic here.
function styleHeaderRows(rowsXml) {
  let out = rowsXml.replace(/<w:tcPr(\/?)>/g, (_m, selfClosed) => (
    selfClosed
      ? `<w:tcPr><w:vAlign w:val="center"/><w:shd w:val="clear" w:fill="${HEADER_SHADE}"/></w:tcPr>`
      : `<w:tcPr><w:vAlign w:val="center"/><w:shd w:val="clear" w:fill="${HEADER_SHADE}"/>`
  ));
  // Every header run already carries <w:b/><w:bCs/> (bold) from the
  // template itself — add italic right alongside it.
  out = out.replace(/<w:b w:val="1"\/><w:bCs w:val="1"\/>/g, '<w:b w:val="1"/><w:bCs w:val="1"/><w:i w:val="1"/><w:iCs w:val="1"/>');
  return out;
}

// Column indices whose DATA should stay left-aligned like real body text
// (Name of Faculty, Descriptive Title) — every other column (Course Code,
// Date Submitted, and the five counts) centers, matching its own header
// above it. The template's blank row left every cell's alignment unset
// (Word's default, left), which visually mismatched the centered headers
// on every numeric/date column.
const LEFT_ALIGN_COLS = new Set([0, 2]);

// Splits a <w:tr>...</w:tr> block into its individual <w:tc>...</w:tc> cells
// and drops a text run into each one's trailing paragraph (a paragraph with
// no runs closes right after its <w:pPr>, so the run just needs inserting
// before that paragraph's own </w:p>).
function fillRowCells(rowXml, values) {
  const cells = rowXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  const filledCells = cells.map((cellXml, i) => {
    const text = values[i];
    let cell = cellXml;

    // Vertically center every cell — otherwise a wrapped multi-line cell
    // (Descriptive Title) sits top-anchored while its single-line
    // neighbors in the same row don't, throwing the row's alignment off.
    cell = cell.replace(/<w:tcPr\/>/, '<w:tcPr><w:vAlign w:val="center"/></w:tcPr>')
      .replace(/<w:tcPr>(?!<w:vAlign)/, '<w:tcPr><w:vAlign w:val="center"/>');

    if (text == null || text === '') return cell;

    // Set this cell's own paragraph alignment explicitly — inserted right
    // before <w:rPr> specifically, since CT_PPr's schema order requires
    // <w:jc> to precede <w:rPr> (the paragraph mark's own run properties,
    // always last); getting that order wrong is exactly the kind of thing
    // that's syntactically fine but semantically off, like the <w:tr>
    // stripping bug from earlier.
    const align = LEFT_ALIGN_COLS.has(i) ? 'left' : 'center';
    const pPrMatch = cell.match(/<w:pPr>[\s\S]*?<\/w:pPr>/);
    if (pPrMatch) {
      const pPrXml = pPrMatch[0];
      const newPPr = /<w:jc\b/.test(pPrXml)
        ? pPrXml.replace(/<w:jc w:val="[^"]*"\/>/, `<w:jc w:val="${align}"/>`)
        : /<w:rPr/.test(pPrXml)
          ? pPrXml.replace(/<w:rPr/, `<w:jc w:val="${align}"/><w:rPr`)
          : pPrXml.replace('</w:pPr>', `<w:jc w:val="${align}"/></w:pPr>`);
      cell = cell.replace(pPrXml, newPPr);
    }

    const runXml = `<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
    const lastPClose = cell.lastIndexOf('</w:p>');
    return cell.slice(0, lastPClose) + runXml + cell.slice(lastPClose);
  });
  // The row's own <w:tr ...>/<w:trPr>...</w:trPr> opening and </w:tr>
  // closing tags were being dropped here before — only the <w:tc> cells got
  // returned, leaving them as bare cells with no <w:tr> parent once
  // inserted into the table. That's syntactically valid XML (so it passed
  // well-formedness checks) but invalid OOXML — Word can't place a <w:tc>
  // outside a row, so it silently dumped the "cell" content as loose
  // paragraphs below the table instead of inside it. Preserving the row's
  // real open/close tags here and only swapping the cells in between fixes
  // that.
  const firstTcIdx = rowXml.indexOf('<w:tc>');
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

function buildProgramTableXml(tblOpenXml, headerRowsXml, blankRowTemplate, columnCount, rows) {
  const dataRowsXml = (rows && rows.length > 0)
    ? rows.map((r) => {
      const total = (r.passed || 0) + (r.inc || 0) + (r.failed || 0) + (r.dropped || 0);
      return fillRowCells(blankRowTemplate, [
        r.instructor_name || '—',
        r.subject_code || '—',
        r.subject_name || '—',
        fmtDate(r.date_submitted),
        String(r.passed || 0),
        String(r.inc || 0),
        String(r.failed || 0),
        String(r.dropped || 0),
        String(total),
      ]);
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
      const subtitleReplacement = buildSubtitleReplacement(docXml, subtitleRange, semester);
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
      // Descriptive Title (the widest text this table ever holds — full
      // subject names) was cramped at the template's own default width,
      // wrapping awkwardly. Widened, funded by shrinking the five
      // Passed/Incomplete/Failed/Dropped/Total columns, which only ever
      // hold a 1-2 digit number. Incomplete/Dropped need more than
      // Passed/Failed since "Incomplete" is the longest header word in that
      // group — an earlier pass under-provisioned it and it started
      // wrapping onto two lines ("Incompl" / "ete"); given more room here,
      // taken back from Descriptive Title.
      const COLUMN_WIDTH_REMAP = { 3402: 4380, 1134: 900, 1276: 1300, 1458: 1000 };
      let tblOpenXml = docXml.slice(tblStart, firstTrStart).replace(/<w:tblpPr\b[^>]*\/>/, '');
      Object.entries(COLUMN_WIDTH_REMAP).forEach(([oldW, newW]) => {
        tblOpenXml = tblOpenXml.split(`<w:gridCol w:w="${oldW}"/>`).join(`<w:gridCol w:w="${newW}"/>`);
      });

      const firstTrCloseIdx = docXml.indexOf('</w:tr>', firstTrStart) + '</w:tr>'.length;
      const secondTrCloseIdx = docXml.indexOf('</w:tr>', firstTrCloseIdx) + '</w:tr>'.length;
      const headerRowsXml = styleHeaderRows(docXml.slice(firstTrStart, secondTrCloseIdx));
      const blankRowStart = docXml.indexOf('<w:tr', secondTrCloseIdx);
      const blankRowXml = docXml.slice(blankRowStart, tblCloseIdx);
      const blankRowTemplate = blankRowXml
        .replace(/<w:tblPrEx>[\s\S]*?<\/w:tblPrEx>/, '')
        .replace(/<w:trPr>[\s\S]*?<\/w:trPr>/, '');
      // Only the OUTER <w:tblGrid>'s own gridCols — tblOpenXml also
      // contains a duplicate nested copy inside <w:tblGridChange>, which
      // would double this count if not excluded.
      const columnCount = (tblOpenXml.split('<w:tblGridChange')[0].match(/<w:gridCol/g) || []).length;

      const list = programs && programs.length > 0 ? programs : [];
      const sectionsXml = list.map(({ program, class_breakdown }) => (
        (list.length > 1 ? programHeadingXml(program) : '') +
        buildProgramTableXml(tblOpenXml, headerRowsXml, blankRowTemplate, columnCount, class_breakdown || [])
      )).join('');

      if (sectionsXml) {
        docXml = docXml.slice(0, tblStart) + titleParaXml + sectionsXml + docXml.slice(tblCloseIdx + '</w:tbl>'.length);
      }
    }

    zip.file('word/document.xml', docXml);

    // ── Footer: "Prepared By" name/title — "Noted By" (the Dean) stays
    // fixed, matching this app's own org chart (no separate Dean role).
    const footerFile = zip.file('word/footer1.xml');
    if (footerFile) {
      let footerXml = footerFile.asText();
      footerXml = footerXml
        .split('MARK B. ESCALANTE').join(esc((preparedByName || '').toUpperCase()))
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
