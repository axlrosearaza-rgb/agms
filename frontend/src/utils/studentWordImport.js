import PizZip from 'pizzip';

export const OFFICIAL_PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

export const VALID_SECTIONS = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)); // A-Z

// ── Reading ANY roster document ─────────────────────────────────────────────
// A usable roster only needs, per student: Student ID Number, Full Name,
// Program, Year and Section — in whatever layout the document happens to use:
//   - a table with headers worded any way ("Student No.", "ID Number",
//     "Name of Student", "Surname | First Name | M.I.", "Course & Year",
//     "Yr/Sec", ...), possibly under title/letterhead rows, possibly split
//     across several tables;
//   - a table with NO header row at all (columns are then recognized from
//     what their cells look like);
//   - Program/Year/Section given once for the whole list, above it
//     ("Course, Year & Section: BSIT 4-D") instead of in a column;
//   - plain lines of text ("240001  Dela Cruz, Juan M.  BSIT 4-D").
// Anything that can't be found falls back to the modal's defaults, and every
// row is shown for review before import.

const PROGRAM_PATTERNS = [
  [/\bbs\s*-?\s*it\b|\bbsit\b|information\s+technology|info\.?\s*tech/i, 'Bachelor of Science in Information Technology'],
  [/\bbs\s*-?\s*is\b|\bbsis\b|information\s+systems?|info\.?\s*sys/i, 'Bachelor of Science in Information Systems'],
  [/\bbs\s*-?\s*psych\w*|\bbsp\b|psychology/i, 'Bachelor of Science in Psychology'],
  [/\bbs\s*-?\s*stat\w*|\bbss\b|statistics/i, 'Bachelor of Science in Statistics'],
];

// The official program named anywhere in `text` ('' when none is).
function detectProgram(text = '') {
  const str = String(text || '');
  if (!str.trim()) return '';
  const exact = OFFICIAL_PROGRAMS.find((p) => p.toLowerCase() === str.trim().toLowerCase());
  if (exact) return exact;
  const hit = PROGRAM_PATTERNS.find(([re]) => re.test(str));
  return hit ? hit[1] : '';
}

/**
 * Normalizes a program string to an official AGMS program name ('' if it
 * isn't one — never passes an unrecognized value through as-is).
 */
export function normalizeProgram(raw = '') {
  const str = String(raw || '').trim();
  if (!str) return '';
  if (/^it$/i.test(str)) return OFFICIAL_PROGRAMS[0];
  if (/^is$/i.test(str)) return OFFICIAL_PROGRAMS[1];
  return detectProgram(str);
}

const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };
const WORD_YEAR = { first: 1, second: 2, third: 3, fourth: 4 };

// Year and/or Section found anywhere in `text`: "4-D", "4D", "4 - D",
// "IV-D", "BSIT 4-D", "Year 4 Section D", "4th Year - D", "Sec. D", "2nd yr".
function parseYearSection(text = '') {
  const str = ` ${String(text || '')} `;
  const out = {};
  let m = str.match(/(?:^|[^0-9A-Za-z])([1-4])\s*(?:st|nd|rd|th)?\s*(?:year|yr\.?)?\s*[-–/ ]?\s*([A-Z])(?![A-Za-z])/i);
  if (m) return { year_level: Number(m[1]), section: m[2].toUpperCase() };
  m = str.match(/(?:^|[^A-Za-z])(IV|I{1,3})\s*[-–/ ]\s*([A-Z])(?![A-Za-z])/i);
  if (m) return { year_level: ROMAN[m[1].toLowerCase()], section: m[2].toUpperCase() };
  m = str.match(/\b(?:year|yr)\.?\s*(?:level)?\s*[:\-]?\s*([1-4]|IV|I{1,3})\b/i)
    || str.match(/\b([1-4])\s*(?:st|nd|rd|th)\s*(?:year|yr)\b/i)
    || str.match(/\b(first|second|third|fourth)\s*(?:year|yr)\b/i);
  if (m) {
    const v = m[1].toLowerCase();
    out.year_level = Number(v) || ROMAN[v] || WORD_YEAR[v];
  }
  m = str.match(/\b(?:section|sec|block)\.?\s*[:\-]?\s*([A-Z])\b/i);
  if (m) out.section = m[1].toUpperCase();
  return out;
}

/**
 * Normalizes year level to integer 1-4 (null when it can't be read).
 */
export function normalizeYearLevel(raw = '') {
  const str = String(raw || '').trim().toLowerCase();
  if (!str) return null;
  if (/^[1-4]$/.test(str)) return Number(str);
  if (ROMAN[str]) return ROMAN[str];
  const ys = parseYearSection(str);
  if (ys.year_level) return ys.year_level;
  const m = str.match(/\b([1-4])(?:st|nd|rd|th)?\b/) || str.match(/\b(first|second|third|fourth)\b/);
  if (m) return Number(m[1]) || WORD_YEAR[m[1]];
  return null;
}

/**
 * Normalizes section to a single letter A-Z ('' when it can't be read).
 */
export function normalizeSection(raw = '') {
  const str = String(raw || '').trim();
  if (!str) return '';
  if (/^[A-Z]$/i.test(str)) return str.toUpperCase();
  const ys = parseYearSection(str);
  if (ys.section) return ys.section;
  const m = str.match(/(?:^|[^A-Za-z])([A-Z])$/i);
  return m ? m[1].toUpperCase() : '';
}

/**
 * Normalizes student status
 */
export function normalizeStudentStatus(raw = '') {
  const str = String(raw || '').trim().toLowerCase();
  if (str.includes('irreg')) return 'Irregular';
  return 'Regular';
}

/**
 * Normalizes student type
 */
export function normalizeStudentType(raw = '') {
  const str = String(raw || '').trim().toLowerCase();
  if (!str) return 'New';
  if (str.includes('shift')) return 'Shifter';
  if (str.includes('trans')) return 'Transferee';
  // "Returnee" (stopped and came back) — checked before "returning" (old).
  if (str.includes('quit') || str.includes('returnee')) return 'Quitter';
  if (str.includes('old') || str.includes('return')) return 'Old';
  return 'New';
}

/**
 * Clean student ID number (whitespace removed)
 */
export function normalizeStudentNo(raw = '') {
  return String(raw || '').trim().replace(/\s+/g, '');
}

// Looks like a Student ID Number: "240001", "2021-00123", "21-1234", "SSU-21-0001".
const ID_RE = /^(?:[A-Z]{2,5}-?)?\d{2,4}-?\d{3,7}$/i;
const looksLikeId = (v) => ID_RE.test(normalizeStudentNo(v)) && /\d{5,}/.test(String(v).replace(/\D/g, ''));
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
// Looks like a person's name: letters (with , . ' - ñ), at least two words, no digits.
const looksLikeName = (v) => {
  const s = String(v || '').trim();
  return s.length >= 4 && !/\d/.test(s) && !EMAIL_RE.test(s) && /[A-Za-zÑñ]{2,}.*[\s,][A-Za-zÑñ]/.test(s) && !detectProgram(s);
};

/**
 * Extracts visible text content from an OpenXML element (table cell or paragraph)
 */
function extractCellText(el) {
  if (!el) return '';
  // Paragraph by paragraph, so a cell holding "Dela Cruz," / "Juan M." on two
  // lines reads "Dela Cruz, Juan M." instead of "Dela Cruz,Juan M.".
  const paras = el.getElementsByTagName('w:p');
  const collect = (node) => {
    const runs = node.getElementsByTagName('w:t');
    let s = '';
    for (let i = 0; i < runs.length; i++) s += runs[i].textContent || '';
    return s;
  };
  if (el.tagName === 'w:tc' && paras.length > 0) {
    const parts = [];
    for (let i = 0; i < paras.length; i++) {
      const t = collect(paras[i]).trim();
      if (t) parts.push(t);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return collect(el).replace(/\s+/g, ' ').trim();
}

// What a header cell is about (or null). Word-based, so "Middle Initial"
// never reads as an ID column just because "middle" contains "id".
function classifyHeader(text = '') {
  const h = String(text || '').toLowerCase().replace(/[’']/g, '').trim();
  if (!h) return null;
  const w = new Set(h.split(/[^a-z0-9#]+/).filter(Boolean));
  const has = (...xs) => xs.some((x) => w.has(x));

  if (has('email', 'e', 'gmail') && /mail/.test(h)) return 'email';
  if (has('id', 'lrn', 'sn') || (has('student', 'stud') && has('no', 'number', 'num', '#', 'nos')) || /i\.d\.?/.test(h) || /^(student|stud)\s*#$/.test(h)) return 'student_no';
  if (has('surname', 'lastname') || (has('last', 'family') && has('name'))) return 'last_name';
  if (has('firstname', 'given') || (has('first') && has('name'))) return 'first_name';
  if (has('middle', 'mi', 'middlename', 'm') && (has('middle', 'mi', 'middlename') || /m\.\s*i/.test(h))) return 'middle_name';
  if ((has('course', 'program', 'prog', 'degree') && has('year', 'yr', 'section', 'sec'))
    || (has('year', 'yr') && has('section', 'sec', 'block'))
    || /^(cys|y\s*[&/]\s*s|yr\s*[&/]\s*sec)$/.test(h)) return 'course_year_section';
  if (has('course', 'program', 'prog', 'degree', 'major', 'curriculum')) return 'program';
  if (has('year', 'yr', 'level') && !has('school', 'academic')) return 'year_level';
  if (has('section', 'sec', 'block')) return 'section';
  if (has('regularity', 'regular', 'irregular') || (has('status') && !has('civil'))) return 'student_status';
  if (has('type', 'classification')) return 'student_type';
  if (has('name', 'names', 'student', 'students', 'fullname')) return 'name';
  return null;
}

const KEY_FIELDS = ['student_no', 'name', 'last_name', 'first_name', 'program', 'year_level', 'section', 'course_year_section'];

// A row that reads as column headers → { field: columnIndex }, else null.
function headerMapFor(row) {
  const map = {};
  row.forEach((cell, i) => {
    if (String(cell || '').length > 40) return;
    const f = classifyHeader(cell);
    if (f && map[f] === undefined) map[f] = i;
  });
  const score = KEY_FIELDS.filter((f) => map[f] !== undefined).length;
  const hasWho = map.student_no !== undefined || map.name !== undefined || map.last_name !== undefined;
  return score >= 2 && hasWho ? map : null;
}

// No header row: work out each column from what its cells look like.
function inferColumns(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const frac = (col, test) => {
    const vals = rows.map((r) => r[col]).filter((v) => v && String(v).trim());
    return vals.length ? vals.filter(test).length / vals.length : 0;
  };
  const pick = (test, taken) => {
    let best = -1;
    let bestScore = 0.5;
    for (let c = 0; c < width; c++) {
      if (taken.has(c)) continue;
      const s = frac(c, test);
      if (s > bestScore) { best = c; bestScore = s; }
    }
    if (best >= 0) taken.add(best);
    return best >= 0 ? best : undefined;
  };
  const taken = new Set();
  const map = {};
  map.student_no = pick(looksLikeId, taken);
  map.name = pick(looksLikeName, taken);
  map.course_year_section = pick((v) => !!detectProgram(v) && !!parseYearSection(v).section, taken);
  map.program = pick((v) => !!detectProgram(v), taken);
  map.year_level = pick((v) => /^([1-4](st|nd|rd|th)?|i{1,3}|iv)(\s*(year|yr))?$/i.test(String(v).trim()), taken);
  map.section = pick((v) => /^(sec(tion)?\.?\s*)?[A-Z]$/i.test(String(v).trim()), taken);
  if (map.year_level === undefined && map.section === undefined) {
    map.course_year_section = map.course_year_section ?? pick((v) => !!parseYearSection(v).section, taken);
  }
  map.email = pick((v) => EMAIL_RE.test(v), taken);
  Object.keys(map).forEach((k) => map[k] === undefined && delete map[k]);
  return map;
}

// Program / Year / Section stated once for the whole list — in the lines
// above the table ("Course, Year & Section: BSIT 4-D", "BSIT 4-D Class
// List"), used for any row whose own columns don't say.
function contextFrom(lines) {
  const ctx = {};
  const labelled = lines.filter((l) => /course|program|degree|year|section|sec\.|block|class\s*list|roster/i.test(l));
  for (const l of [...labelled, ...lines]) {
    if (!ctx.program) ctx.program = detectProgram(l);
    if (!ctx.year_level || !ctx.section) {
      // School/academic-year text ("A.Y. 2026-2027", "S.Y.") must never read as Year/Section.
      const cleaned = l.replace(/\b(19|20)\d{2}\s*[-–]\s*(19|20)?\d{2}\b/g, ' ').replace(/\b[AS]\.\s*Y\.?|\b(school|academic)\s+year\b/gi, ' ');
      const ys = parseYearSection(cleaned);
      if (!ctx.year_level && ys.year_level) ctx.year_level = ys.year_level;
      if (!ctx.section && ys.section) ctx.section = ys.section;
    }
  }
  return ctx;
}

// "Dela Cruz" + "Juan" + "Mendoza" → "Dela Cruz, Juan M."
// Surnames are always stored in capital letters: "DELA CRUZ, Juan M.".
// For a "Surname, First M." name, everything before the comma.
export function upperSurname(name = '') {
  const s = String(name || '');
  const i = s.indexOf(',');
  return i < 0 ? s : s.slice(0, i).toUpperCase() + s.slice(i);
}

export function composeName(last, first, middle) {
  const l = String(last || '').trim().toUpperCase();
  const f = String(first || '').trim();
  const m = String(middle || '').trim().replace(/\./g, '');
  const mi = m ? `${m.charAt(0).toUpperCase()}.` : '';
  if (!l) return [f, mi].filter(Boolean).join(' ');
  return f ? `${l}, ${f}${mi ? ` ${mi}` : ''}` : l;
}

const tidyName = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\d.)\-\s]+(?=[A-Za-zÑñ])/, '').replace(/[;|]+$/, '').trim();

// One plain line of text → a raw record: "240001 Dela Cruz, Juan M. BSIT 4-D juan@gmail.com"
function parseFreeLine(line) {
  let rest = ` ${line} `;
  const rec = {};
  const email = rest.match(EMAIL_RE);
  if (email) { rec.email = email[0]; rest = rest.replace(email[0], ' '); }
  const id = rest.match(/(?:^|\s)((?:[A-Z]{2,5}-?)?\d{2,4}-?\d{3,7})(?=\s|$)/i);
  if (id && /\d{5,}/.test(id[1].replace(/\D/g, ''))) { rec.student_no = id[1]; rest = rest.replace(id[1], ' '); }
  const prog = PROGRAM_PATTERNS.map(([re]) => rest.match(re)).find(Boolean);
  if (prog) { rec.program = detectProgram(prog[0]); rest = rest.replace(prog[0], ' '); }
  const ysMatch = rest.match(/(?:^|\s)([1-4])\s*(?:st|nd|rd|th)?\s*(?:year|yr)?\s*[-–/ ]?\s*([A-Z])(?=\s|$)/i)
    || rest.match(/(?:^|\s)(IV|I{1,3})\s*[-–/]\s*([A-Z])(?=\s|$)/i);
  if (ysMatch) {
    rec.year_level = Number(ysMatch[1]) || ROMAN[ysMatch[1].toLowerCase()];
    rec.section = ysMatch[2].toUpperCase();
    rest = rest.replace(ysMatch[0], ' ');
  }
  if (/\birregular\b/i.test(rest)) { rec.student_status = 'Irregular'; rest = rest.replace(/\birregular\b/i, ' '); } else rest = rest.replace(/\bregular\b/i, ' ');
  rec.name = tidyName(rest.replace(/\s{2,}/g, ' '));
  return rec;
}

// Rows of cells → raw records { student_no, name, program, year_level, section, ... }.
function recordsFromRows(rows, outsideLines = []) {
  // Header anywhere in the first 15 rows (title/letterhead rows above it
  // are fine) — its position also splits off any lines above it as context.
  let headerIdx = -1;
  let map = null;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const m = headerMapFor(rows[r]);
    if (m) { headerIdx = r; map = m; break; }
  }
  const aboveLines = headerIdx > 0 ? rows.slice(0, headerIdx).map((r) => r.filter(Boolean).join(' ')) : [];
  const ctx = contextFrom([...outsideLines, ...aboveLines]);
  let dataRows = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;

  if (!map) {
    map = inferColumns(dataRows);
    // Nothing column-shaped at all (one text blob per row) → read each row
    // as a line. Lines without an ID Number aren't students — they're titles
    // like "BSIT 4-D Class List", which say the Program/Year/Section instead.
    if (map.student_no === undefined && map.name === undefined) {
      const texts = dataRows.map((r) => r.filter(Boolean).join('  '));
      const parsed = texts.map(parseFreeLine);
      const lineCtx = contextFrom([...outsideLines, ...aboveLines, ...texts.filter((t, i) => !parsed[i].student_no)]);
      return parsed.filter((rec) => rec.student_no).map((rec) => ({
        ...rec,
        program: rec.program || lineCtx.program || '',
        year_level: rec.year_level || lineCtx.year_level || null,
        section: rec.section || lineCtx.section || '',
      }));
    }
  }

  const cell = (row, f) => (map[f] !== undefined ? String(row[map[f]] ?? '').trim() : '');
  const withCtx = (rec) => ({
    ...rec,
    program: rec.program || (rec.program_unrecognized ? '' : ctx.program) || '',
    year_level: rec.year_level || ctx.year_level || null,
    section: rec.section || ctx.section || '',
  });
  return dataRows.map((row) => {
    // A whole student written in one cell/line under a multi-column header
    // ("240042 Mendoza, Ella P. BSIT 1-C") — read it as free text.
    const filled = row.filter((v) => v && String(v).trim());
    if (filled.length === 1 && Object.keys(map).length > 1 && !looksLikeId(filled[0])) {
      const rec = parseFreeLine(filled[0]);
      return rec.student_no ? withCtx(rec) : null;
    }
    const rawId = cell(row, 'student_no');
    let name = cell(row, 'name');
    if (map.last_name !== undefined || map.first_name !== undefined) {
      name = composeName(cell(row, 'last_name'), cell(row, 'first_name'), cell(row, 'middle_name')) || name;
    }
    name = tidyName(name);
    const cys = cell(row, 'course_year_section');
    const ys = parseYearSection(cys);
    const rawProgram = cell(row, 'program');
    const program = normalizeProgram(rawProgram) || detectProgram(cys) || '';
    const rec = {
      student_no: rawId,
      name,
      program,
      // The document named a program that isn't one of ours ("BS Nursing") —
      // flagged for review, never silently swapped for the default.
      program_unrecognized: !program && rawProgram ? rawProgram : null,
      year_level: normalizeYearLevel(cell(row, 'year_level')) || ys.year_level || null,
      section: normalizeSection(cell(row, 'section')) || ys.section || '',
      email: (cell(row, 'email').match(EMAIL_RE) || [])[0] || null,
      student_status: cell(row, 'student_status') ? normalizeStudentStatus(cell(row, 'student_status')) : undefined,
      student_type: cell(row, 'student_type') ? normalizeStudentType(cell(row, 'student_type')) : undefined,
    };
    // Title, subtotal and signature rows: neither an ID nor a name, or an
    // obvious footer ("Prepared by: ...", "Nothing follows", "Total").
    if (!looksLikeId(rawId) && (!looksLikeName(name) || /:|prepared|noted|approved|checked|verified|total|nothing follows|signature/i.test(name))) return null;
    return withCtx(rec);
  }).filter(Boolean);
}

/**
 * Parse an uploaded Microsoft Word (.docx) file containing a student roster —
 * any layout, as long as it has each student's ID Number, Full Name, Program,
 * Year and Section somewhere (see the comment at the top of this section).
 */
export async function parseStudentWordDocx(file, defaults = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = new PizZip(arrayBuffer);
  const documentXml = zip.file('word/document.xml')?.asText();
  if (!documentXml) {
    throw new Error('Invalid Word document: could not find word/document.xml inside file.');
  }

  const xmlDoc = new window.DOMParser().parseFromString(documentXml, 'application/xml');
  if (xmlDoc.getElementsByTagName('parsererror')[0]) {
    throw new Error('Could not parse Word document XML structure.');
  }

  // Walk the body in order: paragraphs outside tables are context (and, when
  // there are no tables at all, the roster itself); each table is read on
  // its own, since several tables can have different layouts.
  const body = xmlDoc.getElementsByTagName('w:body')[0];
  const records = [];
  const linesSoFar = [];
  const looseLines = [];
  let sawTable = false;
  const walk = (node) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const el = node.childNodes[i];
      if (el.nodeType !== 1) continue;
      if (el.tagName === 'w:tbl') {
        sawTable = true;
        const rows = [];
        const trs = el.getElementsByTagName('w:tr');
        for (let r = 0; r < trs.length; r++) {
          // Direct cells only — a nested table's cells belong to its own rows.
          const cells = [];
          const kids = trs[r].childNodes;
          for (let c = 0; c < kids.length; c++) {
            if (kids[c].tagName === 'w:tc') cells.push(extractCellText(kids[c]));
            else if (kids[c].tagName === 'w:sdt') {
              const tcs = kids[c].getElementsByTagName('w:tc');
              for (let k = 0; k < tcs.length; k++) cells.push(extractCellText(tcs[k]));
            }
          }
          if (cells.some((v) => v && v.trim())) rows.push(cells);
        }
        records.push(...recordsFromRows(rows, linesSoFar.slice(-8)));
      } else if (el.tagName === 'w:p') {
        const t = extractCellText(el);
        if (t) { linesSoFar.push(t); looseLines.push(t); }
      } else if (el.tagName === 'w:sdt' || el.tagName === 'w:sdtContent') {
        walk(el);
      }
    }
  };
  walk(body || xmlDoc);

  if (!sawTable || records.length === 0) {
    const lineRows = looseLines.map((l) => (/\t|\s{2,}|\|/.test(l) ? l.split(/\t|\s{2,}|\|/).map((c) => c.trim()) : [l]));
    records.push(...recordsFromRows(lineRows));
  }

  if (records.length === 0) {
    throw new Error('No student records found. The document needs each student\'s ID Number and Full Name (plus Program, Year and Section, in a column or stated above the list).');
  }
  return finalizeRecords(records, defaults, file.name);
}

/**
 * Parse raw pasted text (e.g. copied from Word table, Excel, or Google Docs)
 */
export function parseStudentPastedText(text, defaults = {}, fileName = 'Pasted Text') {
  if (!text || !text.trim()) {
    throw new Error('Please paste text or table rows to parse.');
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Tabs (copied table cells), pipes, or 2+ spaces separate columns — never a
  // single comma, which is part of "Dela Cruz, Juan M.".
  const rows = lines.map((l) => (/\t|\||\s{2,}/.test(l) ? l.split(/\t|\||\s{2,}/).map((c) => c.trim()) : [l]));
  const records = recordsFromRows(rows);
  if (records.length === 0) throw new Error('No student records found in the pasted text.');
  return finalizeRecords(records, defaults, fileName);
}

// ── Pasting a class list into the import's entry table ──────────────────────

/**
 * Rows of cell text from a paste. Word, Excel and Google Docs/Sheets put an
 * HTML table on the clipboard when a table is copied — read that first (it
 * keeps cells intact even when they contain spaces or line breaks); otherwise
 * split the plain text on tabs, pipes or 2+ spaces (never a single comma,
 * which is part of "Dela Cruz, Juan M.").
 */
export function clipboardToRows(html, text) {
  if (html && /<table/i.test(html) && typeof window !== 'undefined' && window.DOMParser) {
    const doc = new window.DOMParser().parseFromString(html, 'text/html');
    const rows = [];
    doc.querySelectorAll('tr').forEach((tr) => {
      const cells = [...tr.querySelectorAll('td,th')].map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.some(Boolean)) rows.push(cells);
    });
    if (rows.length) return rows;
  }
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => (l.includes('\t') ? l.split('\t').map((c) => c.trim())
      : /\||\s{2,}/.test(l.trim()) ? l.trim().split(/\||\s{2,}/).map((c) => c.trim())
        : [l.trim()]));
}

const SURNAME_PREFIX = /^(de|del|dela|delos|della|san|sta\.?|santa|santo|van|von|la|las|los|mac|mc)$/i;

/** "Dela Cruz, Juan M." or "Juan M. Dela Cruz" → { surname, first_name, middle_initial } */
export function splitPersonName(full = '') {
  const s = String(full || '').replace(/\s+/g, ' ').trim();
  if (!s) return { surname: '', first_name: '', middle_initial: '' };
  let surname;
  let rest;
  if (s.includes(',')) {
    const i = s.indexOf(',');
    surname = s.slice(0, i).trim();
    rest = s.slice(i + 1).trim();
  } else {
    const t = s.split(' ');
    let k = t.length - 1;
    while (k > 1 && SURNAME_PREFIX.test(t[k - 1])) k -= 1;
    surname = t.slice(k).join(' ');
    rest = t.slice(0, k).join(' ');
  }
  const toks = rest.split(' ').filter(Boolean);
  let middle_initial = '';
  if (toks.length > 1 && /^[A-Za-zÑñ]\.?$/.test(toks[toks.length - 1])) {
    middle_initial = `${toks.pop().charAt(0).toUpperCase()}.`;
  }
  return { surname, first_name: toks.join(' '), middle_initial };
}

/**
 * Pasted rows → what goes into the entry table.
 *   { mode: 'cells', rows }   — the block already matches the table's own
 *     column order (or is a single column): drop it in cell-for-cell from
 *     where it was pasted, the way a spreadsheet does.
 *   { mode: 'students', rows } — a class list in any other shape (its own
 *     headers or column order, a "No." column, one "Full Name" column,
 *     "Course & Year" together, plain lines...): read it like a Word roster
 *     and turn each student into a full table row.
 */
export function pastedRowsForGrid(matrix, colIdx = 0) {
  if (!matrix.length) return { mode: 'cells', rows: [] };
  const width = Math.max(...matrix.map((r) => r.length));
  const hasHeader = !!headerMapFor(matrix[0]);

  if (!hasHeader) {
    // One column pasted into a column other than the first (e.g. a column of
    // first names), or a column of bare ID numbers into the first → fill down.
    if (width === 1) {
      const vals = matrix.map((r) => r[0] || '');
      const wholeStudents = vals.filter((v) => /\d{5,}/.test(v.replace(/\D/g, '')) && /[A-Za-zÑñ]{2,}/.test(v)).length;
      if (colIdx !== 0 || wholeStudents < vals.length / 2) return { mode: 'cells', rows: matrix };
    } else if (colIdx === 0) {
      // Already in the table's order: ID | Surname | First | M.I. | ... —
      // an ID first, and a plain surname (not a full "Surname, First" name) next.
      const ids = matrix.filter((r) => looksLikeId(r[0])).length;
      const plainSurnames = matrix.filter((r) => r[1] && !r[1].includes(',') && r[1].trim().split(/\s+/).length <= 3).length;
      if (ids >= matrix.length * 0.6 && plainSurnames >= matrix.length * 0.6 && width >= 3) return { mode: 'cells', rows: matrix };
    } else {
      return { mode: 'cells', rows: matrix };
    }
  }

  const records = recordsFromRows(matrix);
  if (records.length === 0) return { mode: 'cells', rows: matrix };
  return {
    mode: 'students',
    rows: records.map((r) => ({
      student_no: normalizeStudentNo(r.student_no),
      ...splitPersonName(r.name),
      program: r.program || '',
      year_level: r.year_level ? String(r.year_level) : '',
      section: r.section || '',
    })),
  };
}

// Raw records → validated rows for the review table (defaults fill any gap).
function finalizeRecords(records, defaults = {}, fileName = '') {
  const stamp = Date.now();
  const students = records.map((rec, idx) => {
    const student_no = normalizeStudentNo(rec.student_no);
    // Always "SURNAME, First M." — a "First M. Surname" name is turned around
    // (splitPersonName) so every imported name reads the same way.
    const tidied = tidyName(rec.name);
    const name = tidied && !tidied.includes(',') && tidied.split(' ').length >= 2
      ? (() => { const p = splitPersonName(tidied); return composeName(p.surname, p.first_name, p.middle_initial); })()
      : upperSurname(tidied);
    const program = rec.program || (rec.program_unrecognized ? '' : defaults.program) || '';
    const year_level = rec.year_level || defaults.year_level || 1;
    const section = String(rec.section || defaults.section || '').toUpperCase();
    const errors = [];
    if (!student_no) errors.push('Student ID Number is missing.');
    if (!name) errors.push('Student Name is missing.');
    if (rec.program_unrecognized) errors.push(`Program "${rec.program_unrecognized}" not recognized — choose one.`);
    else if (!program) errors.push('Program is missing.');
    else if (!OFFICIAL_PROGRAMS.includes(program)) errors.push('Program not recognized.');
    return {
      id: `student-row-${idx + 1}-${stamp}`,
      rowNum: idx + 1,
      student_no,
      name,
      program,
      year_level,
      section,
      email: rec.email ? String(rec.email).trim().toLowerCase() : null,
      student_status: rec.student_status || defaults.student_status || 'Regular',
      student_type: rec.student_type || defaults.student_type || 'New',
      // Which of the 5 key fields came from the document itself vs. a default.
      fromDefaults: ['program', 'year_level', 'section'].filter((f) => !rec[f]),
      errors,
      isValid: errors.length === 0,
    };
  });
  // Same ID twice in one document — only the first is imported.
  const seen = new Set();
  students.forEach((s) => {
    if (!s.student_no) return;
    if (seen.has(s.student_no)) {
      s.errors.push('Duplicate Student ID Number in this document.');
      s.isValid = false;
    }
    seen.add(s.student_no);
  });
  return {
    students,
    totalRows: students.length,
    validCount: students.filter((s) => s.isValid).length,
    errorCount: students.filter((s) => !s.isValid).length,
    fileName,
  };
}

// ── Excel class list ─────────────────────────────────────────────────────────
// Template columns: Student ID Number | Student Full Name | Program | Year | Section.
export const EXCEL_TEMPLATE_HEADERS = ['Student ID Number', 'Student Full Name', 'Program', 'Year', 'Section'];
const SAMPLE_ID = '240001';
const SAMPLE_NAME = 'DELA CRUZ, Juan M.';

// Downloads a blank, ready-to-fill class list template (.xlsx), with one
// sample row showing the expected format. `defaults` pre-fills Program/Year/Section.
export async function downloadStudentExcelTemplate(defaults = {}, label = '') {
  const { default: ExcelJS } = await import('exceljs');
  const { saveAs } = await import('file-saver');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Class List');
  ws.columns = [{ width: 22 }, { width: 42 }, { width: 48 }, { width: 10 }, { width: 12 }];
  const header = ws.addRow(EXCEL_TEMPLATE_HEADERS);
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A5C' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  // Sample row — grey italic; type over it with the first student.
  const sample = ws.addRow([SAMPLE_ID, SAMPLE_NAME, defaults.program || OFFICIAL_PROGRAMS[0], defaults.year_level || 1, defaults.section || 'A']);
  sample.eachCell((cell) => { cell.font = { italic: true, color: { argb: 'FF888888' } }; });
  // IDs stay text (no dropped leading zeros / scientific notation).
  ws.getColumn(1).numFmt = '@';
  for (let r = 2; r <= 300; r += 1) {
    // Program / Year pick from a dropdown, so they're always spelled right.
    ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${OFFICIAL_PROGRAMS.join(',')}"`] };
    ws.getCell(`D${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: ['"1,2,3,4"'] };
    ws.getCell(`D${r}`).alignment = { horizontal: 'center' };
    ws.getCell(`E${r}`).alignment = { horizontal: 'center' };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  const name = `Class_List_Template${label ? `_${label.replace(/[^A-Za-z0-9]+/g, '_')}` : ''}.xlsx`;
  saveAs(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
}

const excelCellText = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
    return '';
  }
  return String(v);
};

/**
 * Parse an uploaded Excel (.xlsx) class list — the template above, or any
 * sheet with the same information (read with the same forgiving column
 * detection as Word files and pasted lists).
 */
export async function parseStudentExcel(file, defaults = {}) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const records = [];
  wb.eachSheet((ws) => {
    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      for (let c = 1; c <= row.cellCount; c += 1) cells.push(excelCellText(row.getCell(c).value).trim());
      if (cells.some(Boolean)) rows.push(cells);
    });
    // The template's own grey sample row isn't a student.
    const real = rows.filter((r) => !(r[0] === SAMPLE_ID && r[1] === SAMPLE_NAME));
    if (real.length) records.push(...recordsFromRows(real));
  });
  if (records.length === 0) {
    throw new Error('No student records found. The sheet needs each student\'s ID Number and Full Name.');
  }
  return finalizeRecords(records, defaults, file.name);
}
