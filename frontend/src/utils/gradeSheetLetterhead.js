// The student's exports (Grade Slip, Evaluation of Grades) carry the SAME
// page header and footer as the faculty's Grade Sheet: both parts are lifted
// straight out of the Grade Sheet's own Word template
// (public/templates/grading-sheet-template.docx) — the letterhead strip, form
// and office line on top (without the form number); the awards strip, website / contact line and
// page number at the bottom — and put into the document being exported.
//
// One thing is left behind: the signature table that sits in the Grade
// Sheet's footer (Verified Correct / Submitted by the faculty / Received by /
// Approved). Those are the Grade Sheet's own signatories; the student
// documents keep their own signature lines in the body.
import PizZip from 'pizzip';

const TEMPLATE_URL = '/templates/grading-sheet-template.docx';
const HEADER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FOOTER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// Page margins the Grade Sheet uses so its header and footer have room.
const MARGINS = { top: 1635, bottom: 1710, header: 706, footer: 706 };

let cache = null;
async function gradeSheetParts() {
  if (cache) return cache;
  const buf = await fetch(TEMPLATE_URL).then((r) => {
    if (!r.ok) throw new Error('Could not load the Grade Sheet template for the header and footer.');
    return r.arrayBuffer();
  });
  const zip = new PizZip(buf);
  const text = (name) => zip.file(name)?.asText() || '';
  let footer = text('word/footer1.xml');
  // Drop the Grade Sheet's own signature table from the footer.
  const a = footer.indexOf('<w:tbl>'); const b = footer.indexOf('</w:tbl>');
  if (a >= 0 && b > a) footer = footer.slice(0, a) + footer.slice(b + '</w:tbl>'.length);
  // Pictures the two parts use, copied under their own names so they can never
  // collide with a picture already in the document.
  const media = {};
  const withOwnMedia = (rels) => rels.replace(/Target="media\/([^"]+)"/g, (m, file) => {
    media[`gs_${file}`] = zip.file(`word/media/${file}`)?.asUint8Array();
    return `Target="media/gs_${file}"`;
  });
  // The form-number box ("SSU-UNREG-FR-017 / 12-JAN-2026 REV 8") is the Grade
  // Sheet's own form number — it does not go on the student's documents.
  const header = text('word/header1.xml').replace(/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g, (block) => (/SSU-UNREG-FR/.test(block) ? '' : block))
    // The student's documents come from the college, not the Registrar's office.
    .split('Office of the University Registrar | Main Campus').join('College of Arts and Sciences');
  cache = {
    header,
    footer,
    headerRels: withOwnMedia(text('word/_rels/header1.xml.rels')),
    footerRels: withOwnMedia(text('word/_rels/footer1.xml.rels')),
    media,
  };
  return cache;
}

// Puts the Grade Sheet header and footer into an opened .docx (a PizZip),
// replacing whatever header and footer it had.
export async function applyGradeSheetHeaderFooter(zip) {
  const parts = await gradeSheetParts();

  // Out with the document's own header / footer parts.
  Object.keys(zip.files)
    .filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n) || /^word\/_rels\/(header|footer)\d*\.xml\.rels$/.test(n))
    .forEach((n) => zip.remove(n));
  zip.file('word/header1.xml', parts.header);
  zip.file('word/footer1.xml', parts.footer);
  if (parts.headerRels) zip.file('word/_rels/header1.xml.rels', parts.headerRels);
  if (parts.footerRels) zip.file('word/_rels/footer1.xml.rels', parts.footerRels);
  Object.entries(parts.media).forEach(([name, bytes]) => { if (bytes) zip.file(`word/media/${name}`, bytes); });

  // [Content_Types].xml — the two parts, and the picture types they use.
  let types = zip.file('[Content_Types].xml').asText();
  types = types.replace(/<Override PartName="\/word\/(header|footer)\d*\.xml"[^>]*\/>/g, '');
  const add = [`<Override PartName="/word/header1.xml" ContentType="${HEADER_TYPE}"/>`, `<Override PartName="/word/footer1.xml" ContentType="${FOOTER_TYPE}"/>`];
  if (!/Extension="jpeg"/i.test(types)) add.unshift('<Default Extension="jpeg" ContentType="image/jpeg"/>');
  if (!/Extension="png"/i.test(types)) add.unshift('<Default Extension="png" ContentType="image/png"/>');
  // Defaults must come before Overrides.
  const defaults = add.filter((x) => x.startsWith('<Default')).join('');
  const overrides = add.filter((x) => x.startsWith('<Override')).join('');
  types = types.replace(/(<Types[^>]*>)/, `$1${defaults}`).replace('</Types>', `${overrides}</Types>`);
  zip.file('[Content_Types].xml', types);

  // word/_rels/document.xml.rels — point at the two parts.
  let rels = zip.file('word/_rels/document.xml.rels').asText();
  rels = rels.replace(/<Relationship [^>]*Type="[^"]*\/(header|footer)"[^>]*\/>/g, '');
  rels = rels.replace('</Relationships>', `<Relationship Id="rIdGsHeader" Type="${REL}/header" Target="header1.xml"/><Relationship Id="rIdGsFooter" Type="${REL}/footer" Target="footer1.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', rels);

  // word/document.xml — every section uses them, with room for both.
  let doc = zip.file('word/document.xml').asText();
  if (!/xmlns:r="/.test(doc.slice(0, 4000))) doc = doc.replace(/<w:document /, `<w:document xmlns:r="${REL}" `);
  doc = doc.replace(/<w:(header|footer)Reference [^>]*\/>/g, '');
  const refs = '<w:headerReference w:type="default" r:id="rIdGsHeader"/><w:footerReference w:type="default" r:id="rIdGsFooter"/>';
  doc = doc.replace(/<w:sectPr\/>/g, `<w:sectPr>${refs}</w:sectPr>`).replace(/<w:sectPr( [^>]*)?>/g, (m) => `${m}${refs}`);
  doc = doc.replace(/<w:pgMar [^>]*\/>/g, (pg) => Object.entries(MARGINS).reduce((s, [k, v]) => {
    const re = new RegExp(`w:${k}="-?\\d+"`);
    // Only ever widen: a document that already leaves more room keeps it.
    const now = Number((s.match(new RegExp(`w:${k}="(-?\\d+)"`)) || [])[1]);
    if (Number.isFinite(now)) return now >= v ? s : s.replace(re, `w:${k}="${v}"`);
    return s.replace('<w:pgMar ', `<w:pgMar w:${k}="${v}" `);
  }, pg));
  zip.file('word/document.xml', doc);
  return zip;
}

// Same, for a finished .docx Blob.
export async function withGradeSheetHeaderFooter(blob) {
  const zip = new PizZip(await blob.arrayBuffer());
  await applyGradeSheetHeaderFooter(zip);
  return zip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}
