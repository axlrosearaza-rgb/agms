import ExcelJS from 'exceljs';
import { formatPersonName } from '../components/common';
import { getRateFormula } from './classRecordExcel';

/**
 * Parses and validates an uploaded Class Record Excel spreadsheet (.xlsx).
 * Matches columns against class components and rows against enrolled students.
 * Detects mistakes:
 *  - Scores exceeding item.max_score
 *  - Negative scores
 *  - Non-numeric or formula error values
 *  - Direct rate values outside rate formula bounds
 *  - Students not enrolled in this class
 *  - Enrolled students missing from the spreadsheet
 *  - Unfilled / blank scores
 */
export async function parseAndValidateClassRecordExcel(file, { classData, components, studentGrades }) {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // 1. Locate the Class Record worksheet
  const ws = workbook.getWorksheet('Class Record') || workbook.worksheets[0];
  if (!ws) {
    throw new Error('No worksheets found in this Excel file.');
  }

  const rateFormula = getRateFormula(classData);
  const midComps = components.filter(c => c.period === 'Midterm');
  const finComps = components.filter(c => c.period === 'Finals');

  const allItems = [
    ...midComps.flatMap(c => (c.items || []).map(it => ({ ...it, period: 'Midterm', compName: c.name }))),
    ...finComps.flatMap(c => (c.items || []).map(it => ({ ...it, period: 'Finals', compName: c.name }))),
  ];

  // 2. Scan header rows (rows 1-20) to find Student No. and Name column positions
  let studentNoColMid = 2; // Default SSU layout: Col 2 (B) is Student No.
  let studentNameColMid = 3; // Default SSU layout: Col 3 (C) is Name
  let studentNoColFin = null;
  let studentNameColFin = null;
  let dataStartRow = 14; // Default SSU layout: Row 14 is first student

  // Search for the header row dynamically
  for (let r = 7; r <= 20; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 50; c++) {
      const val = String(row.getCell(c).value || '').toLowerCase().trim();
      if (val.includes('student no') || val === 'student number') {
        if (!studentNoColMid) {
          studentNoColMid = c;
          dataStartRow = r + 1;
        } else if (c > 10 && !studentNoColFin) {
          // Finals side in side-by-side layout
          studentNoColFin = c;
        }
      } else if (val === 'name' || val === 'student name') {
        if (!studentNameColMid) {
          studentNameColMid = c;
        } else if (c > 10 && !studentNameColFin) {
          studentNameColFin = c;
        }
      }
    }
  }

  // 2b. The file must have the SAME components as this Class Record —
  // scores are read by column position, so a file exported before a
  // component was added, removed or renamed would put scores in the wrong
  // place. Every component name has to appear in the file's header rows.
  const headerText = [];
  for (let r = 1; r < Math.max(dataStartRow, 14); r++) {
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value && typeof cell.value === 'object' ? (cell.value.richText ? cell.value.richText.map((t) => t.text).join('') : cell.value.result ?? '') : cell.value;
      headerText.push(String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim());
    });
  }
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const missing = [...new Set(components.map((c) => c.name))].filter((name) => !headerText.some((t) => t.includes(norm(name))));
  if (missing.length) {
    throw new Error(`This file's components don't match this Class Record (not found in the file: ${missing.join(', ')}). Export Excel again from this Class Record, fill it in, then import it — don't add, remove or rename components in between.`);
  }

  // 3. Map component items to worksheet columns
  // In the generated SSU layout:
  // Each item has:
  //   - if not direct rate: a SCORE column and a RATE column
  //   - if direct rate: a single RATE column
  // Followed by Ave (if show_ave) and Weighted.
  const itemColumnMap = {}; // { [itemId]: colIndex }

  // Map Midterm items starting at column 4
  let curCol = (studentNameColMid || 3) + 1;
  midComps.forEach((c) => {
    (c.items || []).forEach((item) => {
      const itemSpan = item.is_rate_direct ? (item.show_rate !== false ? 1 : 0) : (item.show_rate !== false ? 2 : 1);
      if (itemSpan === 0) return;
      // In SSU export, raw score is in curCol
      itemColumnMap[item.id] = curCol;
      curCol += itemSpan;
    });
    if (c.show_ave !== false) curCol += 1; // Ave col
    curCol += 1; // Weight col
  });

  // Calculate Finals block starting column if side-by-side
  let curFinCol = studentNoColFin ? studentNoColFin + 2 : null;
  if (!curFinCol && studentNoColMid) {
    // If not detected via text, calculate based on Midterm width:
    // Midterm tail cols: Midterm Term Grade (1), Overall 1/2 (1), Midterm Grade (1) = 3 cols
    let midTailCount = 3;
    const headerRow = ws.getRow(dataStartRow - 1);
    const checkCellVal = String(ws.getRow(10).getCell(curCol + 3).value || headerRow?.getCell(curCol + 3).value || '').toLowerCase();
    if (checkCellVal.includes('remark')) {
      midTailCount = 4;
    }
    const midEndCol = curCol + midTailCount - 1;
    curFinCol = midEndCol + 1 + 3; // + 1 for start, + 3 for No, Student No, Name
  }

  if (curFinCol) {
    finComps.forEach((c) => {
      (c.items || []).forEach((item) => {
        const itemSpan = item.is_rate_direct ? (item.show_rate !== false ? 1 : 0) : (item.show_rate !== false ? 2 : 1);
        if (itemSpan === 0) return;
        itemColumnMap[item.id] = curFinCol;
        curFinCol += itemSpan;
      });
      if (c.show_ave !== false) curFinCol += 1; // Ave col
      curFinCol += 1; // Weight col
    });
  }

  // 4. Read student rows from dataStartRow
  const enrolledByNo = new Map();
  const enrolledByName = new Map();
  studentGrades.forEach(g => {
    const cleanNo = String(g.student.student_no || '').replace(/\D/g, '');
    if (cleanNo) enrolledByNo.set(cleanNo, g.student);
    const cleanName = (g.student.name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (cleanName) enrolledByName.set(cleanName, g.student);
    const formattedCleanName = formatPersonName(g.student.name).toLowerCase().replace(/[^a-z]/g, '');
    if (formattedCleanName) enrolledByName.set(formattedCleanName, g.student);
  });

  const parsedScores = {}; // { [studentId]: { [itemId]: number } }
  const studentValidations = []; // Detailed evaluation per student
  const unenrolledStudents = [];
  const matchedStudentIds = new Set();

  let maxRow = Math.min(ws.rowCount, dataStartRow + studentGrades.length + 20);
  for (let r = dataStartRow; r <= maxRow; r++) {
    const row = ws.getRow(r);
    const rawNo = row.getCell(studentNoColMid || 2).value;
    const rawName = row.getCell(studentNameColMid || 3).value;

    const noStr = String(rawNo || '').trim();
    const nameStr = String(rawName || '').trim();

    // Check stop conditions: empty row or signature line
    if (!noStr && !nameStr) continue;
    if (nameStr.toLowerCase().includes('nothing follows') || nameStr.toLowerCase().includes('prepared by')) {
      break;
    }

    // Match enrolled student
    const cleanNo = noStr.replace(/\D/g, '');
    const cleanName = nameStr.toLowerCase().replace(/[^a-z]/g, '');
    let matchedStudent = enrolledByNo.get(cleanNo);
    if (!matchedStudent && cleanName) {
      matchedStudent = enrolledByName.get(cleanName);
    }

    if (!matchedStudent) {
      if (cleanNo.length >= 4 || cleanName.length >= 4) {
        unenrolledStudents.push({ rowNumber: r, studentNo: noStr, name: nameStr });
      }
      continue;
    }

    matchedStudentIds.add(matchedStudent.id);

    // Read scores for each mapped item
    const studentItemScores = {};
    const itemReports = {};
    let studentHasError = false;
    let studentHasWarning = false;

    allItems.forEach((item) => {
      const col = itemColumnMap[item.id];
      if (!col) return;

      const cell = row.getCell(col);
      let rawVal = cell.value;
      // Handle ExcelJS formula or rich text objects
      if (rawVal && typeof rawVal === 'object') {
        if ('result' in rawVal) rawVal = rawVal.result;
        else if ('text' in rawVal) rawVal = rawVal.text;
      }

      let error = null;
      let warning = null;
      let parsedNum = null;

      if (rawVal === null || rawVal === undefined || String(rawVal).trim() === '') {
        warning = 'Blank score in spreadsheet.';
        studentHasWarning = true;
      } else {
        const num = parseFloat(rawVal);
        if (isNaN(num)) {
          error = `Invalid non-numeric value: "${rawVal}"`;
          studentHasError = true;
        } else if (num < 0) {
          error = `Score cannot be negative (${num})`;
          studentHasError = true;
        } else {
          parsedNum = num;
          studentItemScores[item.id] = num;

          const max = parseFloat(item.max_score) || 100;
          if (item.is_rate_direct) {
            const minRate = rateFormula.base;
            const maxRate = rateFormula.base + rateFormula.range;
            if (num < minRate || num > maxRate) {
              error = `Direct rate (${num}) out of bounds (${minRate}–${maxRate})`;
              studentHasError = true;
            }
          } else if (num > max) {
            error = `Score (${num}) exceeds maximum allowed (${max})`;
            studentHasError = true;
          }
        }
      }

      itemReports[item.id] = {
        itemId: item.id,
        itemName: item.name,
        period: item.period,
        value: parsedNum,
        rawText: rawVal !== null && rawVal !== undefined ? String(rawVal) : '',
        error,
        warning,
      };
    });

    parsedScores[matchedStudent.id] = studentItemScores;
    studentValidations.push({
      student: matchedStudent,
      rowNumber: r,
      items: itemReports,
      hasError: studentHasError,
      hasWarning: studentHasWarning,
    });
  }

  // 5. Check for enrolled students missing entirely from the Excel file
  const missingStudents = studentGrades
    .filter(g => !matchedStudentIds.has(g.student.id))
    .map(g => g.student);

  // Missing students also get an entry in studentValidations with warnings
  missingStudents.forEach(st => {
    const itemReports = {};
    allItems.forEach(item => {
      itemReports[item.id] = {
        itemId: item.id,
        itemName: item.name,
        period: item.period,
        value: null,
        rawText: '',
        warning: 'Student missing from spreadsheet.',
      };
    });
    studentValidations.push({
      student: st,
      rowNumber: null,
      items: itemReports,
      hasError: false,
      hasWarning: true,
      isMissingFromSpreadsheet: true,
    });
  });

  // Calculate totals
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalEnteredScores = 0;

  studentValidations.forEach(sv => {
    Object.values(sv.items).forEach(it => {
      if (it.error) totalErrors++;
      if (it.warning) totalWarnings++;
      if (it.value !== null && it.value !== undefined) totalEnteredScores++;
    });
  });

  if (unenrolledStudents.length > 0) {
    totalWarnings += unenrolledStudents.length;
  }

  return {
    fileName: file.name,
    sheetName: ws.name,
    items: allItems,
    students: studentValidations,
    missingStudents,
    unenrolledStudents,
    summary: {
      totalEnrolled: studentGrades.length,
      matchedStudents: matchedStudentIds.size,
      missingCount: missingStudents.length,
      totalScores: totalEnteredScores,
      errorCount: totalErrors,
      warningCount: totalWarnings,
    },
    scoresByStudent: parsedScores,
  };
}
