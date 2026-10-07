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
      inset: { l: inset('lIns', 91440), t: inset('tIns', 45720), r: inset('rIns', 91440), b: inset('bIns', 45720) },
      paragraphs,
    };
  });
}

// Text boxes in docx-preview's rendering order: page headers first (that's
// where the letterhead lives), then the body.
function collectTextBoxes(zip) {
  const headers = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).sort();
  return [...headers, 'word/document.xml'].flatMap((name) => textBoxesIn(zip.file(name)?.asText() || ''));
}

function isPlaceholder(img) {
  return img.naturalWidth <= 1 && img.naturalHeight <= 1;
}

// Swap each fallback placeholder <img> for its text box's real content.
function fillTextBoxes(host, boxes) {
  const placeholders = [...host.querySelectorAll('section.docx img')].filter(isPlaceholder);
  placeholders.forEach((img, i) => {
    const box = boxes[i];
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

export async function docxBlobToPdf(docxBlob, filename) {
  const boxes = collectTextBoxes(new PizZip(await docxBlob.arrayBuffer()));

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-20000px;top:0;background:#fff;';
  host.className = 'agms-docx-pdf';
  // The app's base styles (Tailwind preflight) give every <img>
  // max-width:100% — inside docx-preview's zero-width anchors that shrinks
  // floating pictures (the letterhead strip) to nothing.
  const reset = document.createElement('style');
  // (In <head>: docx-preview empties its container before rendering.)
  reset.textContent = '.agms-docx-pdf img { max-width: none; }';
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
    pinFloatingAnchors(host);
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
