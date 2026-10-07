import PizZip from 'pizzip';

// ── Reading an adviser list (the Dean's "Room Assignment" sheet) ────────────
// Only three things are taken from each line: the Program (a heading such as
// "BSS", "BS Psych", "BSIS", "BSIT" — carried down to the lines under it),
// the Curricular Year & Section ("1A", "2-B", "4 G") and the Adviser's name.
// Anything else on the line — the Room Assignment column, titles, headers,
// footers — is ignored. Works for a Word table, tab-separated lines, or text
// pasted from either.

const PROGRAMS = [
  [/\bbs\s*-?\s*it\b|\bbsit\b|information\s+technology/i, 'Bachelor of Science in Information Technology'],
  [/\bbs\s*-?\s*is\b|\bbsis\b|information\s+systems?/i, 'Bachelor of Science in Information Systems'],
  [/\bbs\s*-?\s*psych\w*|\bbsp\b|psychology/i, 'Bachelor of Science in Psychology'],
  [/\bbs\s*-?\s*stat\w*|\bbss\b|statistics/i, 'Bachelor of Science in Statistics'],
];
const detectProgram = (text) => (PROGRAMS.find(([re]) => re.test(text)) || [])[1] || '';

// "1A", "1-A", "1 A" as its own token (year 1-4, section A-Z).
const YEAR_SECTION = /(?:^|[\s\t|])([1-4])\s*[-–]?\s*([A-Z])(?=[\s\t|]|$)/;

const HONORIFIC = /^(?:mr|mrs|ms|miss|dr|engr|prof|atty|sir|maam|ma'am)\.?\s+/i;

// The adviser part of the text after the year-section: up to the room
// assignment, which always starts with a digit ("3F, ACAD 6", "4F ...") or a
// room word ("NCAS 10", "ACAD", "Room", "Lab").
function adviserFrom(rest) {
  // Tab/"|"-separated when the line has those (a stray double space inside a
  // name, "Joan  E.Uy", isn't a column break then); else 2+ spaces.
  const sep = /[\t|]/.test(rest) ? /[\t|]/ : /\s{2,}/;
  const cells = rest.split(sep).map((c) => c.trim()).filter(Boolean);
  // Separate columns: the first cell that reads as a name.
  const cellName = cells.find((c) => /[A-Za-zÑñ]{2,}/.test(c) && !/\d/.test(c) && /\s/.test(c));
  let name = cellName || rest;
  const cut = name.search(/\d|\(|\b(?:NCAS|ACAD|Room|Rm\.?|Lab)\b/);
  if (cut > 0) name = name.slice(0, cut);
  return name.replace(/[,;]+\s*$/, '').replace(/\s+/g, ' ').trim();
}

/**
 * Lines of text → [{ program, year_level, section, adviser_name, line }].
 * `lines` may contain tabs between columns.
 */
export function parseAdviserLines(lines) {
  const rows = [];
  let program = '';
  for (const raw of lines) {
    const line = String(raw || '').replace(/ /g, ' ');
    if (!line.trim()) continue;
    const ys = line.match(YEAR_SECTION);
    // A program heading can be on its own line or at the start of the first row.
    const head = ys ? line.slice(0, ys.index + 1) : line;
    const prog = detectProgram(head);
    if (prog) program = prog;
    if (!ys) continue;
    const name = adviserFrom(line.slice(ys.index + ys[0].length));
    if (!name || !/[A-Za-zÑñ]{2,}/.test(name)) continue;
    rows.push({
      program,
      year_level: Number(ys[1]),
      section: ys[2].toUpperCase(),
      adviser_name: name,
      line: line.trim(),
    });
  }
  return rows;
}

// Word paragraph / cell text, keeping tabs and line breaks.
function textOf(node) {
  let s = '';
  const walk = (n) => {
    for (let i = 0; i < n.childNodes.length; i++) {
      const c = n.childNodes[i];
      if (c.nodeType !== 1) continue;
      if (c.tagName === 'w:t') s += c.textContent || '';
      else if (c.tagName === 'w:tab') s += '\t';
      else if (c.tagName === 'w:br' || c.tagName === 'w:cr') s += '\n';
      else walk(c);
    }
  };
  walk(node);
  return s;
}

/** A .docx file → lines of text (table rows become tab-separated lines). */
export async function docxToLines(file) {
  const zip = new PizZip(await file.arrayBuffer());
  const xml = zip.file('word/document.xml')?.asText();
  if (!xml) throw new Error('This does not look like a Word (.docx) file.');
  const doc = new window.DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagName('w:body')[0] || doc;
  const lines = [];
  const walk = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const el = node.childNodes[i];
      if (el.nodeType !== 1) continue;
      if (el.tagName === 'w:tbl') {
        const trs = el.getElementsByTagName('w:tr');
        for (let r = 0; r < trs.length; r++) {
          const cells = [];
          const kids = trs[r].childNodes;
          for (let c = 0; c < kids.length; c++) {
            if (kids[c].tagName === 'w:tc') {
              // Several lines inside one cell (e.g. "1A" / "1B" stacked) stay separate.
              const paras = kids[c].getElementsByTagName('w:p');
              const parts = [];
              for (let p = 0; p < paras.length; p++) parts.push(textOf(paras[p]));
              cells.push(parts);
            }
          }
          // Stacked cells: line k of each cell belongs together.
          const depth = Math.max(1, ...cells.map((c) => c.length));
          for (let k = 0; k < depth; k++) lines.push(cells.map((c) => (c[k] || '').trim()).join('\t'));
        }
      } else if (el.tagName === 'w:p') {
        textOf(el).split('\n').forEach((l) => lines.push(l));
      } else if (el.tagName === 'w:sdt' || el.tagName === 'w:sdtContent') {
        walk(el);
      }
    }
  };
  walk(body);
  return lines;
}

// ── Matching names to accounts ─────────────────────────────────────────────
const DEGREES = /\b(ph\.?\s*d|ed\.?\s*d|dit|mit|mba|mpa|rgc|rpm|rpsy|lpt|cpa|jr|sr|ii|iii|iv)\b\.?/gi;
const DEGREE_TEST = new RegExp(DEGREES.source, 'i');

// Name → meaningful lowercase words (no titles, degrees or initials).
export function nameWords(name = '') {
  let s = String(name || '').trim();
  // "SURNAME, First M." → "First M. SURNAME"
  if (/^[^,]+,\s*[^,]+$/.test(s) && !DEGREE_TEST.test(s.split(',')[1])) {
    const [last, first] = s.split(',');
    s = `${first} ${last}`;
  }
  s = s.split(',')[0]; // drop ", DIT", ", RGC, RPm" suffixes
  s = s.replace(HONORIFIC, '').replace(DEGREES, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length > 1);
}

/**
 * Best account for a written name, or null. Surname (last word) must match,
 * plus at least one given name ("Ma." and "Maria" both fine — any other word).
 * Returns { user, ambiguous } — ambiguous when two accounts tie.
 */
export function matchAdviser(name, candidates) {
  const words = nameWords(name);
  if (words.length === 0) return { user: null, ambiguous: false };
  const surname = words[words.length - 1];
  const given = words.slice(0, -1);
  let best = null;
  let bestScore = 0;
  let tie = false;
  for (const u of candidates) {
    const uw = nameWords(u.name);
    if (!uw.includes(surname)) continue;
    const overlap = given.filter((w) => uw.includes(w) || (w === 'ma' && uw.includes('maria'))).length;
    if (given.length > 0 && overlap === 0) continue;
    const score = overlap + (uw[uw.length - 1] === surname ? 1 : 0);
    if (score > bestScore) { best = u; bestScore = score; tie = false; } else if (score === bestScore) tie = true;
  }
  return { user: tie ? null : best, ambiguous: tie };
}
