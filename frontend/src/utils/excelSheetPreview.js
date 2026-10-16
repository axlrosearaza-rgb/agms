// Draws an ExcelJS worksheet on the page as it looks in Excel: the same column
// widths and row heights, merged cells, fills, fonts, borders, alignment,
// rotated headings, number formats, conditional colours and pictures.
//
// Used by the Class Record preview (pages/common/ClassRecordView.js), which
// draws the very workbook the Export button saves — so the preview is the
// exported file, not a separate look-alike that could drift from it.

const PX_PER_PT = 96 / 72;
const EMU_PER_PX = 9525;
const DEFAULT_COL_WIDTH = 8.43;
const DEFAULT_ROW_HEIGHT_PT = 15;

// Column width units to pixels, as Excel itself measures them on a Windows
// screen (checked against Excel: width 4 = 29px, 13 = 94px, 25 = 180px).
const colWidthPx = (units) => Math.round(units * 7.19 + 0.3);
const cssColor = (c) => {
  if (!c || !c.argb) return null;
  const a = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
  return `#${a}`;
};
const BORDER_CSS = { thin: '1px solid', hair: '1px dotted', dotted: '1px dotted', dashed: '1px dashed', medium: '2px solid', thick: '3px solid', double: '3px double' };
const borderCss = (side) => (side && side.style ? `${BORDER_CSS[side.style] || '1px solid'} ${cssColor(side.color) || '#000000'}` : null);

// The text Excel shows for a cell: a formula's stored result, formatted by
// the cell's number format.
function displayText(cell) {
  let v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('formula' in v || 'sharedFormula' in v) v = v.result;
    else if ('text' in v) v = v.text;
    else if ('error' in v) return String(v.error);
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && 'error' in v) return String(v.error);
  }
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === 'number') {
    const fmt = cell.numFmt || 'General';
    if (fmt.includes('%')) {
      const d = (fmt.split('.')[1] || '').replace(/[^0]/g, '').length;
      return `${(v * 100).toFixed(d)}%`;
    }
    if (/^0(\.0+)?$/.test(fmt)) {
      const d = (fmt.split('.')[1] || '').length;
      // Half-up like Excel, not banker's or binary-float rounding.
      const f = 10 ** d;
      return (Math.round(v * f + 1e-9) / f).toFixed(d);
    }
    return String(Math.round(v * 1e10) / 1e10);
  }
  return String(v);
}

const colIndex = (letters) => letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const parseRef = (ref) => {
  const m = /^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(ref);
  if (!m) return null;
  return { c1: colIndex(m[1]), r1: Number(m[2]), c2: colIndex(m[3] || m[1]), r2: Number(m[4] || m[2]) };
};

// Conditional formatting: only "cell equals a text" rules are used by the
// Class Record (PASSED green, FAILED red).
function conditionalStyle(ws, row, col, text) {
  const list = ws.conditionalFormattings || [];
  for (const cf of list) {
    const inRange = String(cf.ref || '').split(/[ ,]+/).some((part) => {
      const r = parseRef(part);
      return r && row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;
    });
    if (!inRange) continue;
    for (const rule of cf.rules || []) {
      if (rule.type !== 'cellIs' || rule.operator !== 'equal') continue;
      const want = String((rule.formulae || [])[0] || '').replace(/^"|"$/g, '');
      if (want && want === text) return rule.style || null;
    }
  }
  return null;
}

// Returns { element, width, height } — `element` is a positioned <div> holding
// the sheet; width and height are its natural size in CSS pixels.
export function renderWorksheet(workbook, ws) {
  const lastCol = ws.actualColumnCount ? ws.columnCount : 1;
  const lastRow = ws.rowCount || 1;

  const widths = [];
  for (let c = 1; c <= lastCol; c += 1) widths.push(colWidthPx(ws.getColumn(c).width || DEFAULT_COL_WIDTH));
  const heights = [];
  for (let r = 1; r <= lastRow; r += 1) {
    const h = ws.getRow(r).height;
    heights.push(Math.round((h || DEFAULT_ROW_HEIGHT_PT) * PX_PER_PT));
  }
  const totalW = widths.reduce((a, b) => a + b, 0);
  const totalH = heights.reduce((a, b) => a + b, 0);
  const leftOf = (c) => widths.slice(0, c).reduce((a, b) => a + b, 0); // c = 0-based column
  const topOf = (r) => heights.slice(0, r).reduce((a, b) => a + b, 0);

  // Merged ranges, keyed by their top-left cell.
  const spans = {}; const covered = new Set();
  (ws.model.merges || []).forEach((ref) => {
    const m = parseRef(ref);
    if (!m) return;
    spans[`${m.r1}:${m.c1}`] = { rows: m.r2 - m.r1 + 1, cols: m.c2 - m.c1 + 1 };
    for (let r = m.r1; r <= m.r2; r += 1) for (let c = m.c1; c <= m.c2; c += 1) if (r !== m.r1 || c !== m.c1) covered.add(`${r}:${c}`);
  });

  const wrap = document.createElement('div');
  wrap.className = 'xl-sheet';
  wrap.style.cssText = `position:relative;width:${totalW}px;height:${totalH}px;background:#fff;color:#000;font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.15;`;

  const table = document.createElement('table');
  table.style.cssText = `border-collapse:collapse;table-layout:fixed;width:${totalW}px;border-spacing:0;`;
  const colgroup = document.createElement('colgroup');
  widths.forEach((w) => { const col = document.createElement('col'); col.style.width = `${w}px`; colgroup.appendChild(col); });
  table.appendChild(colgroup);
  const tbody = document.createElement('tbody');

  for (let r = 1; r <= lastRow; r += 1) {
    const tr = document.createElement('tr');
    tr.style.height = `${heights[r - 1]}px`;
    const row = ws.getRow(r);
    for (let c = 1; c <= lastCol; c += 1) {
      if (covered.has(`${r}:${c}`)) continue;
      const cell = row.getCell(c);
      const td = document.createElement('td');
      const span = spans[`${r}:${c}`];
      let cellW = widths[c - 1]; let cellH = heights[r - 1];
      if (span) {
        if (span.cols > 1) td.colSpan = span.cols;
        if (span.rows > 1) td.rowSpan = span.rows;
        cellW = widths.slice(c - 1, c - 1 + span.cols).reduce((a, b) => a + b, 0);
        cellH = heights.slice(r - 1, r - 1 + span.rows).reduce((a, b) => a + b, 0);
      }
      const text = displayText(cell);
      // Excel lets text run on over the cells to its right only while they
      // are empty; next to a filled cell it is cut off at its own edge.
      const nextCol = c + (span ? span.cols : 1);
      const neighbourFilled = nextCol <= lastCol && displayText(row.getCell(nextCol)) !== '';
      const cond = text ? conditionalStyle(ws, r, c, text) : null;
      const font = { ...(cell.font || {}), ...((cond && cond.font) || {}) };
      const fill = (cond && cond.fill) || cell.fill;
      const al = cell.alignment || {};
      const st = td.style;
      st.padding = '0 1px';
      st.boxSizing = 'border-box';
      st.height = `${cellH}px`;
      st.overflow = neighbourFilled ? 'hidden' : 'visible';
      st.whiteSpace = al.wrapText ? 'normal' : 'nowrap';
      if (al.wrapText) st.overflowWrap = 'anywhere';
      if (fill && fill.type === 'pattern' && fill.pattern === 'solid') { const bg = cssColor(fill.fgColor); if (bg) st.background = bg; }
      if (font.name) st.fontFamily = `"${font.name}", Arial, sans-serif`;
      if (font.size) st.fontSize = `${font.size}pt`;
      if (font.bold) st.fontWeight = '700';
      if (font.italic) st.fontStyle = 'italic';
      if (font.underline) st.textDecoration = 'underline';
      const fc = cssColor(font.color); if (fc) st.color = fc;
      const raw = cell.value && typeof cell.value === 'object' && 'result' in cell.value ? cell.value.result : cell.value;
      st.textAlign = al.horizontal === 'centerContinuous' ? 'center' : (al.horizontal || (typeof raw === 'number' ? 'right' : 'left'));
      st.verticalAlign = al.vertical === 'middle' ? 'middle' : (al.vertical === 'top' ? 'top' : 'bottom');
      const b = cell.border || {};
      ['top', 'right', 'bottom', 'left'].forEach((side) => { const css = borderCss(b[side]); if (css) st[`border${side[0].toUpperCase()}${side.slice(1)}`] = css; });

      if (text) {
        if (al.textRotation === 90 || al.textRotation === 'vertical') {
          // Reads bottom-to-top, like Excel's 90° rotation.
          const box = document.createElement('div');
          box.style.cssText = `display:flex;align-items:center;justify-content:center;width:${cellW - 4}px;height:${cellH - 2}px;overflow:hidden;`;
          const inner = document.createElement('span');
          inner.style.cssText = 'writing-mode:vertical-rl;transform:rotate(180deg);white-space:nowrap;';
          inner.textContent = text;
          box.appendChild(inner);
          td.appendChild(box);
        } else if (al.shrinkToFit && !al.wrapText) {
          const inner = document.createElement('span');
          inner.style.cssText = 'display:inline-block;white-space:nowrap;transform-origin:left center;';
          inner.textContent = text;
          inner.dataset.fit = String(cellW - 4);
          td.appendChild(inner);
        } else {
          td.textContent = text;
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  // Pictures (the two seals), placed by the same anchors Excel uses.
  (ws.getImages ? ws.getImages() : []).forEach((im) => {
    try {
      const media = workbook.getImage(Number(im.imageId));
      const tl = im.range && im.range.tl; const ext = im.range && im.range.ext;
      if (!media || !media.buffer || !tl || !ext) return;
      const mime = media.extension === 'png' ? 'image/png' : 'image/jpeg';
      const bytes = new Uint8Array(media.buffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const url = `data:${mime};base64,${btoa(bin)}`;
      const img = document.createElement('img');
      img.src = url; img.alt = '';
      const left = leftOf(tl.nativeCol || 0) + (tl.nativeColOff || 0) / EMU_PER_PX;
      const top = topOf(tl.nativeRow || 0) + (tl.nativeRowOff || 0) / EMU_PER_PX;
      img.style.cssText = `position:absolute;left:${left}px;top:${top}px;width:${ext.width}px;height:${ext.height}px;max-width:none;`;
      wrap.appendChild(img);
    } catch (e) { /* a picture that cannot be read is simply left out */ }
  });

  return { element: wrap, width: totalW, height: totalH, release: () => {} };
}

// "Shrink to fit" cells: scale the text down once it is in the page and can be measured.
export function applyShrinkToFit(root) {
  root.querySelectorAll('span[data-fit]').forEach((el) => {
    const max = Number(el.dataset.fit); const w = el.offsetWidth;
    if (max > 0 && w > max) el.style.transform = `scale(${max / w})`;
  });
}
