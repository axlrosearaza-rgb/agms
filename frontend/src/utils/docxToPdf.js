// ── .docx → .pdf, entirely in the browser ───────────────────────────────────
// The student exports are still BUILT as Word documents (same templates and
// layout as before); this renders that .docx off-screen with docx-preview,
// snapshots each page with the browser's own renderer (html-to-image), and
// stitches the pages into a PDF.
//
// Two docx-preview gaps are patched here:
//  • Text boxes (Word "shapes" — the letterhead text and the yellow program
//    banner on the Evaluation of Grades) only reach docx-preview as their
//    fallback: a 1×1 transparent placeholder image. docx-preview still sizes
//    and positions that placeholder correctly, so each one is swapped for a
//    box holding the text box's real text, fill, and font.
//  • docx-preview only splits pages at explicit page breaks, so a page whose
//    content runs past one sheet is sliced here — at a table-row or
//    paragraph boundary, never through the middle of a line.
import PizZip from 'pizzip';
import { renderAsync } from 'docx-preview';
import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';

const SCALE = 2; // render at 2× for crisp text when printed
const EMU_PER_PT = 12700;

const attr = (xml, re) => (xml.match(re) || [])[1];

// Every mc:AlternateContent in a part, in document order — the order
// docx-preview emits their fallback placeholders. Text boxes carry their
// paragraphs; anything else (lines, plain shapes) is null and left alone.
function textBoxesIn(xml) {
  const blocks = xml.match(/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g) || [];
  return blocks.map((block) => {
    const choice = (block.match(/<mc:Choice[\s\S]*?<\/mc:Choice>/) || [''])[0];
    const content = (choice.match(/<w:txbxContent>([\s\S]*?)<\/w:txbxContent>/) || [])[1];
    if (!content) return null;
    const spPrFull = (choice.match(/<wps:spPr[\s\S]*?<\/wps:spPr>/) || [''])[0];
    const ln = (spPrFull.match(/<a:ln[\s\S]*?<\/a:ln>/) || [''])[0];
    // (The fill is read only from an attribute-less <wps:spPr>, as before, so
    // the PDF exports' letterhead boxes stay see-through.)
    const spPr = (choice.match(/<wps:spPr>[\s\S]*?<\/wps:spPr>/) || [''])[0].replace(/<a:ln[\s\S]*?<\/a:ln>/, '');
    const bodyPr = (choice.match(/<wps:bodyPr[^>]*>/) || [''])[0];
    const inset = (name, dflt) => Number(attr(bodyPr, new RegExp(`${name}="(\\d+)"`)) ?? dflt) / EMU_PER_PT;
    const paragraphs = (content.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((p) => ({
      align: attr(p, /<w:jc w:val="(\w+)"/) || 'left',
      runs: (p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || []).map((r) => ({
        text: (r.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\t/g, ' '),
        font: attr(r, /w:ascii="([^"]+)"/),
        sizePt: Number(attr(r, /<w:sz w:val="(\d+)"/) || 22) / 2,
        bold: /<w:b(?: w:val="(?:1|true)")?\/>/.test(r),
        italic: /<w:i(?: w:val="(?:1|true)")?\/>/.test(r),
        color: attr(r, /<w:color w:val="([0-9A-Fa-f]{6})"/),
      })).filter((run) => run.text),
    }));
    const anchor = (choice.match(/<wp:anchor[^>]*>/) || [''])[0];
    return {
      // Square / top-and-bottom wrapping pushes the surrounding text aside in
      // Word; docx-preview overlays it instead, so those reserve their space.
      wraps: /<wp:wrap(Square|TopAndBottom)\b/.test(choice),
      distB: Number(attr(anchor, /distB="(\d+)"/) || 0) / EMU_PER_PT,
      offsetH: Number(attr(choice, /<wp:positionH[^>]*>\s*<wp:posOffset>(-?\d+)</) || 0) / EMU_PER_PT,
      offsetV: Number(attr(choice, /<wp:positionV[^>]*>\s*<wp:posOffset>(-?\d+)</) || 0) / EMU_PER_PT,
      fill: attr(spPr, /<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"/),
      // The box's outline, when it has one: width in points and colour.
      line: /<a:solidFill>/.test(ln) ? { weight: Number(attr(ln, /<a:ln[^>]*\bw="(\d+)"/) || 9525) / EMU_PER_PT, color: attr(ln, /<a:srgbClr val="([0-9A-Fa-f]{6})"/) || '000000' } : null,
      inset: { l: inset('lIns', 91440), t: inset('tIns', 45720), r: inset('rIns', 91440), b: inset('bIns', 45720) },
      paragraphs,
    };
  });
}

// Text boxes in docx-preview's rendering order: page headers first (that's
// where the letterhead lives), then the body, then page footers.
// Straight lines drawn in the page header (the rule under the letterhead):
// how far below their paragraph they sit and how thick they are, in points.
function headerLines(zip) {
  return Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).sort().flatMap((name) => {
    const blocks = (zip.file(name)?.asText() || '').match(/<mc:Choice[\s\S]*?<\/mc:Choice>/g) || [];
    return blocks.filter((b) => /prst="line"/.test(b)).map((b) => ({
      top: Number(attr(b, /<wp:positionV[^>]*>\s*<wp:posOffset>(-?\d+)</) || 0) / EMU_PER_PT,
      weight: Number(attr(b, /<a:ln w="(\d+)"/) || 12700) / EMU_PER_PT,
    }));
  });
}

function collectTextBoxes(zip) {
  const partsOf = (kind) => Object.keys(zip.files).filter((n) => new RegExp(`^word/${kind}\\d*\\.xml$`).test(n)).sort();
  const boxesOf = (names) => names.flatMap((name) => textBoxesIn(zip.file(name)?.asText() || ''));
  // Kept apart: a header whose text boxes docx-preview draws by itself (no
  // placeholders) must not shift the body's boxes onto the wrong placeholders.
  return { header: boxesOf(partsOf('header')), article: boxesOf(['word/document.xml']), footer: boxesOf(partsOf('footer')) };
}

function isPlaceholder(img) {
  return img.naturalWidth <= 1 && img.naturalHeight <= 1;
}

// Swap each fallback placeholder <img> for its text box's real content.
function fillTextBoxes(host, boxesByRegion) {
  Object.entries(boxesByRegion).forEach(([region, boxes]) => fillRegion([...host.querySelectorAll(`section.docx ${region} img`)].filter(isPlaceholder), boxes));
}
function fillRegion(placeholders, boxes) {
  // Every page repeats its header / footer, so the list of boxes repeats too.
  placeholders.forEach((img, i) => {
    const box = boxes.length ? boxes[i % boxes.length] : null;
    if (!box) return;
    const div = document.createElement('div');
    div.style.cssText = img.style.cssText;
    Object.assign(div.style, {
      boxSizing: 'border-box',
      overflow: 'visible',
      background: box.fill ? `#${box.fill}` : 'transparent',
      padding: `${box.inset.t}pt ${box.inset.r}pt ${box.inset.b}pt ${box.inset.l}pt`,
      lineHeight: '1.15',
      whiteSpace: 'pre-wrap',
    });
    box.paragraphs.forEach((p) => {
      const line = document.createElement('div');
      line.style.textAlign = p.align === 'both' ? 'justify' : p.align;
      p.runs.forEach((r) => {
        const span = document.createElement('span');
        span.textContent = r.text;
        Object.assign(span.style, {
          fontFamily: r.font ? `"${r.font}", sans-serif` : 'inherit',
          fontSize: `${r.sizePt}pt`,
          fontWeight: r.bold ? '700' : '400',
          fontStyle: r.italic ? 'italic' : 'normal',
          color: r.color ? `#${r.color}` : '#000',
        });
        line.appendChild(span);
      });
      if (!p.runs.length) line.innerHTML = '&nbsp;';
      div.appendChild(line);
    });
    const wrapper = img.parentElement;
    img.replaceWith(div);
    const para = wrapper && wrapper.closest('p');
    if (box.wraps && wrapper && para) {
      // Word places a wrapping box at its offset below the TOP of its
      // paragraph and flows that paragraph's text underneath it;
      // docx-preview floats it mid-line instead. Re-seat it as a block at
      // the start of the paragraph.
      para.insertBefore(wrapper, para.firstChild);
      Object.assign(wrapper.style, {
        float: 'none', display: 'block', position: 'relative', top: '0', left: '0',
        marginTop: `${box.offsetV}pt`, marginBottom: `${box.distB}pt`, height: 'auto',
      });
      Object.assign(div.style, { position: 'relative', top: '0', left: `${box.offsetH}pt` });
    }
  });
}

// docx-preview anchors floating pictures as zero-size inline-blocks offset
// with position:relative, so they shift with the line's baseline. Word
// measures them from the top-left of their paragraph — pin them there.
function pinFloatingAnchors(host) {
  host.querySelectorAll('section.docx div').forEach((w) => {
    const s = w.style;
    if (s.width !== '0px' || s.height !== '0px' || s.display !== 'inline-block' || s.position !== 'relative') return;
    const para = w.closest('p');
    if (!para) return;
    para.style.position = 'relative';
    s.position = 'absolute';
    // In a page header / footer the offset is measured from the text column,
    // not from the paragraph — a paragraph indented out into the margin (the
    // footer's "Follow us on" line) would otherwise drag its picture along.
    const edge = w.closest('header, footer');
    if (edge) {
      const shift = edge.getBoundingClientRect().left - para.getBoundingClientRect().left;
      if (Math.abs(shift) > 0.5) s.left = `${(parseFloat(s.left) || 0) + shift}px`;
    }
  });
}

// docx-preview draws some header / footer text boxes (the Grade Sheet's form
// number, university lines and awards list) as an <svg> with the text inside
// a <foreignObject>: clipped to the box, spaced like body text, and — when the
// box is "behind text" — underneath the letterhead picture. Each one is
// replaced by a plain box at the same spot holding the same paragraphs.
function flattenEdgeTextBoxes(host, lines = []) {
  // The header's rule line, edge to edge under the letterhead on every page.
  if (lines.length) {
    host.querySelectorAll('section.docx').forEach((section) => {
      const header = section.querySelector(':scope > header');
      const first = header?.querySelector('p');
      if (!header || !first) return;
      const page = section.getBoundingClientRect();
      const from = header.getBoundingClientRect();
      header.style.position = 'relative';
      lines.forEach((ln) => {
        const rule = document.createElement('div');
        Object.assign(rule.style, {
          position: 'absolute', left: `${page.left - from.left}px`, width: `${page.width}px`,
          top: `calc(${first.getBoundingClientRect().top - from.top}px + ${ln.top}pt)`,
          borderTop: `${ln.weight}pt solid #000`, height: '0', zIndex: '3',
        });
        header.appendChild(rule);
      });
    });
  }
  host.querySelectorAll('section.docx header svg, section.docx footer svg').forEach((svg) => {
    const paragraphs = [...svg.querySelectorAll('p')];
    const edge = svg.closest('header, footer');
    if (!paragraphs.length || !edge) return;
    // Where docx-preview put the box, measured from its header / footer.
    const at = svg.getBoundingClientRect();
    const from = edge.getBoundingClientRect();
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'absolute', left: `${at.left - from.left}px`, top: `${at.top - from.top}px`, width: `${at.width}px`,
      zIndex: '2', overflow: 'visible', boxSizing: 'border-box',
    });
    paragraphs.forEach((p) => {
      Object.assign(p.style, { margin: '0', padding: '0', lineHeight: '1.15', minHeight: '0', textIndent: '0' });
      // A line is as tall as the PARAGRAPH's own font, however small the text
      // in it — match it to the text, or 7pt lines space out like 11pt ones.
      const spans = [...p.querySelectorAll('span')];
      if (spans.length) p.style.fontSize = getComputedStyle(spans[0]).fontSize;
      spans.forEach((sp) => { sp.style.lineHeight = 'inherit'; });
      box.appendChild(p);
    });
    svg.remove();
    edge.style.position = 'relative';
    edge.appendChild(box);
  });
}

// The Grade Sheet's header and footer are laid out for a page with 1-inch
// side margins. On a document with narrower ones they are given that inch
// back, so the letterhead sits where it does on the Grade Sheet.
function insetEdges(host, sidePx) {
  host.querySelectorAll('section.docx').forEach((section) => {
    const cs = getComputedStyle(section);
    const left = sidePx - (parseFloat(cs.paddingLeft) || 0);
    const right = sidePx - (parseFloat(cs.paddingRight) || 0);
    section.querySelectorAll(':scope > header, :scope > footer').forEach((edge) => {
      if (left > 0.5) edge.style.marginLeft = `${left}px`;
      if (right > 0.5) edge.style.marginRight = `${right}px`;
    });
  });
}

// "Page 1 of 1" in the footer is a Word field; here every sheet gets its own number.
function numberPages(host, { keepEmptyLines = false } = {}) {
  const sections = [...host.querySelectorAll('section.docx')];
  sections.forEach((section, i) => {
    if (!keepEmptyLines)
    // An empty footer line (it shows up on some pages and not others) would
    // push the page number down — every page's footer is the same four lines.
    section.querySelectorAll(':scope > footer > p').forEach((p) => {
      if (!p.textContent.trim() && !p.querySelector('img')) p.style.display = 'none';
    });
    section.querySelectorAll(':scope > footer p').forEach((p) => {
      if (!/^\s*Page\s+\d+\s+of\s+\d+\s*$/i.test(p.textContent)) return;
      const spans = [...p.querySelectorAll('span')].filter((sp) => sp.children.length === 0);
      const style = spans[0]?.style.cssText || '';
      p.textContent = '';
      const span = document.createElement('span');
      span.style.cssText = style;
      span.textContent = `Page ${i + 1} of ${sections.length}`;
      p.appendChild(span);
    });
  });
}

// The footer lines up with the header: its left text starts under the
// header's first seal, and its awards list ends under the header's last badge.
function alignFooterToHeader(host) {
  host.querySelectorAll('section.docx').forEach((section) => {
    const strip = [...section.querySelectorAll(':scope > header img')].filter((img) => !isPlaceholder(img)).sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    const footer = section.querySelector(':scope > footer');
    if (!strip || !footer) return;
    const r = strip.getBoundingClientRect();
    // The seals and badges sit a little inside the letterhead picture's own edges.
    const left = r.left + r.width * 0.032;
    const right = r.right - r.width * 0.035;
    footer.querySelectorAll(':scope > p').forEach((p) => {
      const dx = left - p.getBoundingClientRect().left;
      p.style.position = 'relative';
      p.style.left = `${(parseFloat(p.style.left) || 0) + dx}px`;
    });
    footer.querySelectorAll(':scope > div').forEach((box) => {
      const dx = right - box.getBoundingClientRect().right;
      box.style.left = `${(parseFloat(box.style.left) || 0) + dx}px`;
    });
  });
}

const waitForImages = (root) => Promise.all([...root.querySelectorAll('img')].map((img) => (
  img.complete ? null : new Promise((res) => { img.onload = res; img.onerror = res; })
)));

// Bottom edges (in section-relative CSS px) where a page may safely end,
// plus how far down the page's content actually reaches.
function layoutOf(section) {
  const top = section.getBoundingClientRect().top;
  const points = new Set();
  let contentBottom = 0;
  // Body content only — the page header/footer always fit on the sheet.
  section.querySelectorAll('article tr, article p, article table, article img, article div').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height === 0 && r.width === 0) return;
    const bottom = Math.round(r.bottom - top);
    contentBottom = Math.max(contentBottom, bottom);
    // A paragraph inside a table cell isn't a safe break — only the row is.
    if ((el.tagName === 'P' && !el.closest('td')) || el.tagName === 'TR' || el.tagName === 'TABLE') points.add(bottom);
  });
  return { points: [...points].sort((a, b) => a - b), contentBottom };
}

// options.edgeSideMarginIn — side margin (inches) the page header and footer
// were designed for, when that differs from the document's own.
export async function docxBlobToPdf(docxBlob, filename, options = {}) {
  const sourceZip = new PizZip(await docxBlob.arrayBuffer());
  const boxes = collectTextBoxes(sourceZip);
  const lines = headerLines(sourceZip);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;background:#fff;';
  host.className = 'agms-docx-pdf';
  // The app's base styles (Tailwind preflight) give every <img>
  // max-width:100% — inside docx-preview's zero-width anchors that shrinks
  // floating pictures (the letterhead strip) to nothing.
  const reset = document.createElement('style');
  // (In <head>: docx-preview empties its container before rendering.)
  reset.textContent = [
    '.agms-docx-pdf img { max-width: none; }',
    // Footer lines sit tight, whatever paragraph spacing the document's own
    // styles carry — so every export's footer comes out the same.
    '.agms-docx-pdf section.docx > footer > p { margin-top: 0 !important; margin-bottom: 0 !important; padding: 0 !important; line-height: 20px !important; height: 20px !important; min-height: 0 !important; white-space: nowrap !important; overflow: visible !important; }',
    '.agms-docx-pdf section.docx > footer > p span { line-height: inherit !important; }',
  ].join('\n');
  document.head.appendChild(reset);
  document.body.appendChild(host);
  try {
    await renderAsync(docxBlob, host, null, {
      className: 'docx',
      inWrapper: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: true,
      renderHeaders: true,
      renderFooters: true,
      experimental: true,
      useBase64URL: true,
    });
    await waitForImages(host);
    fillTextBoxes(host, boxes);
    if (options.edgeSideMarginIn) insetEdges(host, options.edgeSideMarginIn * 96);
    flattenEdgeTextBoxes(host, lines);
    pinFloatingAnchors(host);
    numberPages(host);
    alignFooterToHeader(host);
    if (document.fonts?.ready) await document.fonts.ready;

    const sections = [...host.querySelectorAll('section.docx')];
    if (sections.length === 0) throw new Error('Nothing was rendered from the document.');

    let pdf = null;
    for (const section of sections) {
      section.style.background = '#fff';
      // Own stacking context, so "behind text" images (z-index -1, e.g. the
      // letterhead strip) paint above the page's white background.
      section.style.isolation = 'isolate';
      const cs = getComputedStyle(section);
      const pageW = section.offsetWidth;
      const pageH = parseFloat(cs.minHeight) || pageW * (11 / 8.5);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      const { points, contentBottom } = layoutOf(section);
      const canvas = await toCanvas(section, { pixelRatio: SCALE, backgroundColor: '#ffffff', cacheBust: false });
      // Trailing whitespace past the last line isn't content — only slice
      // onto another sheet when real content runs past this one.
      const totalH = Math.min(canvas.height / SCALE, Math.max(pageH, contentBottom + padBottom));

      let start = 0;
      let first = true;
      while (start < totalH - 1) {
        const offset = first ? 0 : padTop; // continuation sheets get the top margin back
        let end;
        if (totalH - start + offset <= pageH + 0.5) {
          end = totalH;
        } else {
          const limit = start + (pageH - offset - padBottom);
          end = points.filter((p) => p > start + 20 && p <= limit).pop() || limit;
        }
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = Math.round(pageH * SCALE);
        const ctx = slice.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, slice.width, slice.height);
        const sh = Math.min(Math.round((end - start) * SCALE), canvas.height - Math.round(start * SCALE));
        ctx.drawImage(canvas, 0, Math.round(start * SCALE), canvas.width, sh, 0, Math.round(offset * SCALE), canvas.width, sh);

        const wPt = pageW * 0.75;
        const hPt = pageH * 0.75;
        const orientation = wPt > hPt ? 'landscape' : 'portrait';
        if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], orientation, compress: true });
        else pdf.addPage([wPt, hPt], orientation);
        pdf.addImage(slice.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, wPt, hPt);

        start = end;
        first = false;
      }
    }
    pdf.save(filename);
  } finally {
    host.remove();
    reset.remove();
  }
}

// ── On-screen preview of a .docx, laid out as Word lays it out ──────────────
// The PDF exports above restyle a few things on purpose (footer spacing, the
// footer lined up under the header). A preview must not: it shows the file as
// it opens in Word. These helpers correct the places where the browser
// renderer strays from Word.

// Word centres a centred table on the text area even when the table is wider
// than it, letting it reach equally into both margins. A browser will not push
// an auto margin below zero, so such a table would hang off the right edge.
function centerWideTables(host) {
  host.querySelectorAll('section.docx > article > table, section.docx > footer > table, section.docx > header > table').forEach((table) => {
    if (table.style.marginLeft !== 'auto' || table.style.marginRight !== 'auto') return;
    const extra = table.offsetWidth - table.parentElement.clientWidth;
    if (extra > 0) table.style.marginLeft = `${-extra / 2}px`;
  });
}

// A table row's own alignment (where the ROW sits) is not the alignment of the
// text in its cells — the renderer applies it to the text, centring cells
// whose paragraphs are left-aligned (the student names).
function fixRowAlignment(host) {
  host.querySelectorAll('section.docx tr').forEach((tr) => {
    if (!tr.style.textAlign) return;
    tr.style.textAlign = '';
    [...tr.cells].forEach((td) => { if (!td.style.textAlign) td.style.textAlign = 'left'; });
  });
}

// Text boxes in the body (the Grade Sheet's "Note:" box under the roster) come
// out as an empty drawing. Each is replaced by a real box at the same place,
// with its outline, fill and text.
function drawBodyTextBoxes(host, boxes) {
  const real = boxes.filter(Boolean);
  if (!real.length) return;
  host.querySelectorAll('section.docx').forEach((section) => {
    [...section.querySelectorAll(':scope > article svg')].forEach((svg, i) => {
      const box = real[i % real.length];
      const para = svg.closest('p');
      if (!box || !para) return;
      const st = svg.style;
      const div = document.createElement('div');
      Object.assign(div.style, {
        position: 'absolute', left: st.marginLeft || '0', top: st.marginTop || '0', width: st.width, height: st.height,
        boxSizing: 'border-box', background: box.fill ? `#${box.fill}` : 'transparent',
        border: box.line ? `${box.line.weight}pt solid #${box.line.color}` : 'none',
        padding: `${box.inset.t}pt ${box.inset.r}pt ${box.inset.b}pt ${box.inset.l}pt`,
        lineHeight: '1.15', whiteSpace: 'pre-wrap', textAlign: 'left', zIndex: '2', overflow: 'hidden',
      });
      box.paragraphs.forEach((p) => {
        const line = document.createElement('div');
        line.style.textAlign = p.align === 'both' ? 'justify' : p.align;
        p.runs.forEach((r) => {
          const span = document.createElement('span');
          span.textContent = r.text;
          Object.assign(span.style, { fontFamily: r.font ? `"${r.font}", sans-serif` : 'inherit', fontSize: `${r.sizePt}pt`, fontWeight: r.bold ? '700' : '400', fontStyle: r.italic ? 'italic' : 'normal', color: r.color ? `#${r.color}` : '#000' });
          line.appendChild(span);
        });
        div.appendChild(line);
      });
      para.style.position = 'relative';
      svg.replaceWith(div);
    });
  });
}

// Word's line and row measurements, which the browser renderer gets wrong:
//  - a line is as tall as the text ON it; the renderer makes every line as
//    tall as the document's default 11pt font, so small-print lines (footer,
//    table headings) and empty spacer paragraphs come out too tall;
//  - "single" spacing is the font's own line spacing, not exactly the font size;
//  - a table row's height does not include its border.
const DEFAULT_FONT_PT = 11; // Word's document default
const DEFAULT_FONT = 'Calibri';
// "Single" line spacing as a multiple of the font size, per font.
const lineFactor = (fontName) => (/arial|helvetica/i.test(fontName || '') ? 1.149 : /times/i.test(fontName || '') ? 1.149 : 1.2207);
function wordMetrics(host, zip) {
  // The font size of each paragraph mark, in document order, per part — it
  // sets the height of an EMPTY paragraph.
  const markSizes = (name) => {
    const xml = (zip.file(name)?.asText() || '').replace(/<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>/g, (b) => (/<w:txbxContent>/.test(b) ? '<w:r><w:drawing/></w:r>' : b));
    return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || []).map((p) => {
      const mark = (p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/) || [''])[0];
      const rPr = (mark.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
      const sz = attr(rPr, /<w:sz w:val="(\d+)"/);
      return { size: sz ? Number(sz) / 2 : DEFAULT_FONT_PT, font: attr(rPr, /w:ascii="([^"]+)"/) || DEFAULT_FONT };
    });
  };
  const first = (kind) => Object.keys(zip.files).filter((n) => new RegExp(`^word/${kind}\\d*\\.xml$`).test(n)).sort()[0];
  // Which rows of the body's first table have an exact height.
  const bodyXml = zip.file('word/document.xml')?.asText() || '';
  const exactRows = (((bodyXml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/) || [''])[0]).match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []).map((r) => /<w:trHeight[^>]*w:hRule="exact"/.test(r));
  const parts = { article: markSizes('word/document.xml'), header: first('header') ? markSizes(first('header')) : [], footer: first('footer') ? markSizes(first('footer')) : [] };

  host.querySelectorAll('section.docx').forEach((section) => {
    Object.entries(parts).forEach(([region, sizes]) => {
      const edge = section.querySelector(`:scope > ${region}`);
      if (!edge) return;
      const paragraphs = [...edge.querySelectorAll('p')].filter((p) => !p.closest('svg'));
      // Only trust the order when the counts agree (one page of the body).
      const aligned = paragraphs.length === sizes.length;
      paragraphs.forEach((p, i) => {
        const spans = [...p.querySelectorAll('span')].filter((sp) => sp.textContent.trim());
        // The renderer sizes the text on its <span>s and leaves the paragraph
        // at the browser's 16px, which then sets every line's height. Give
        // the paragraph the size and font of the text actually on it.
        if (spans.length) {
          const biggest = spans.map((sp) => getComputedStyle(sp)).sort((x, y) => parseFloat(y.fontSize) - parseFloat(x.fontSize))[0];
          p.style.fontSize = biggest.fontSize;
          p.style.fontFamily = biggest.fontFamily;
          // Spans holding no visible text (tabs, bookmarks) must not make the
          // line taller than its text.
          p.querySelectorAll('span').forEach((sp) => { if (!sp.textContent.trim() && !sp.querySelector('img, div, svg')) { sp.style.fontSize = biggest.fontSize; sp.style.minHeight = '0'; } });
        } else if (!p.querySelector('img, div')) {
          // An empty paragraph is one line of its own (paragraph mark's) font.
          const mark = (aligned && sizes[i]) || { size: DEFAULT_FONT_PT, font: DEFAULT_FONT };
          p.style.fontSize = `${mark.size}pt`;
          p.style.minHeight = `${mark.size * lineFactor(mark.font)}pt`;
        }
        const lh = p.style.lineHeight;
        if (lh === '1') p.style.lineHeight = 'normal';
        else if (/^[0-9.]+$/.test(lh)) p.style.lineHeight = String(Number(lh) * 1.149);
      });
    });
    // Rows: Word's height is the space inside the borders.
    section.querySelectorAll('tr').forEach((tr) => {
      const h = tr.style.height; const cell = tr.cells[0];
      if (!h || !cell) return;
      // The width the document asked for (0.5pt), not the whole pixel the
      // screen rounds it to.
      const asked = cell.style.borderTopWidth || cell.style.borderWidth;
      if (asked && parseFloat(asked) > 0 && getComputedStyle(cell).borderTopStyle !== 'none') tr.style.height = `calc(${h} + ${asked})`;
    });
    // Rows set to an EXACT height (thin spacer rows) stay that thin in Word,
    // whatever is in them.
    const bodyRows = [...section.querySelectorAll(':scope > article > table > tbody > tr, :scope > article > table > tr')];
    if (bodyRows.length === exactRows.length) {
      bodyRows.forEach((tr, i) => {
        if (!exactRows[i]) return;
        tr.querySelectorAll('p').forEach((p) => { if (!p.textContent.trim()) Object.assign(p.style, { fontSize: '1px', lineHeight: '1px', minHeight: '0' }); });
      });
    }
  });
}

// Word hangs the page footer from the bottom of the sheet, whatever the body's
// length; the renderer lets it follow the body. And a floating box in the
// footer is measured from the text column, which the renderer loses.
function seatFooter(host, footerBoxes) {
  const real = footerBoxes.filter(Boolean);
  host.querySelectorAll('section.docx').forEach((section) => {
    const footer = section.querySelector(':scope > footer');
    if (!footer) return;
    const min = getComputedStyle(section).minHeight;
    if (parseFloat(min) > 0) section.style.height = min;
    footer.style.marginTop = 'auto';
    [...footer.querySelectorAll(':scope > div')].forEach((box, i) => {
      const src = real[i % (real.length || 1)];
      if (src && box.style.position === 'absolute') box.style.left = `${src.offsetH}pt`;
    });
  });
}

// Draws a .docx on the page as it opens in Word, into a visible element, for
// the in-app previews. Returns a function that removes the styles it added.
export async function renderDocxInto(host, docxBlob) {
  const sourceZip = new PizZip(await docxBlob.arrayBuffer());
  const boxes = collectTextBoxes(sourceZip);
  const lines = headerLines(sourceZip);
  host.classList.add('agms-docx-view');
  const reset = document.createElement('style');
  reset.textContent = [
    // The app's base styles give every <img> max-width:100%, which shrinks
    // floating pictures (the letterhead strip) to nothing.
    '.agms-docx-view img { max-width: none; }',
    '.agms-docx-view section.docx { background: #fff; isolation: isolate; box-sizing: border-box; overflow: hidden; }',
    // Word's table cells have no space above or below their text unless the
    // document asks for it (an inline style then wins over this).
    '.agms-docx-view section.docx td { padding-top: 0; padding-bottom: 0; }',
    // A footer line never wraps in Word (the renderer's tab widths can push
    // the end of "Follow us on ..." onto a second line).
    '.agms-docx-view section.docx > footer > p { white-space: pre; }',
    '.agms-docx-view section.docx > footer > p span { white-space: pre; }',
  ].join('\n');
  document.head.appendChild(reset);
  await renderAsync(docxBlob, host, null, {
    className: 'docx',
    inWrapper: false,
    breakPages: true,
    ignoreLastRenderedPageBreak: true,
    renderHeaders: true,
    renderFooters: true,
    experimental: true,
    useBase64URL: true,
  });
  await waitForImages(host);
  fillTextBoxes(host, { header: boxes.header, footer: boxes.footer });
  flattenEdgeTextBoxes(host, lines);
  drawBodyTextBoxes(host, boxes.article);
  pinFloatingAnchors(host);
  numberPages(host);
  fixRowAlignment(host);
  if (document.fonts?.ready) await document.fonts.ready;
  wordMetrics(host, sourceZip);
  centerWideTables(host);
  seatFooter(host, boxes.footer);
  return () => reset.remove();
}
