import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { saveAs } from 'file-saver';
import { Icons, Badge, LoadingSpinner, Modal, programHeaderClass, programCascadeGradient, ProgramDot } from '../../components/common';
import { gradeService, reportService } from '../../services';
import API from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

// ── SSU Class Record formula (mirrors backend/controllers/gradeComponentController.js
// exactly, so the live preview here always matches what gets saved) ─────────────────
const itemRate = (score, maxScore) => {
  if (score === null || score === undefined || score === '') return null;
  const s = parseFloat(score);
  const m = parseFloat(maxScore) || 100;
  if (isNaN(s)) return null;
  return (s / m) * 45 + 50;
};

const componentAverage = (comp, studentId, componentScores) => {
  const items = comp.items || [];
  if (items.length === 0) return null;
  const rates = items.map(item => itemRate(componentScores[studentId]?.[item.id], item.max_score));
  if (rates.some(r => r === null)) return null;
  return rates.reduce((s, r) => s + r, 0) / rates.length;
};

const compositeToGWA = (composite) => {
  const floored = Math.floor(composite * 10) / 10;
  const gwa = 10.5 - 0.1 * floored;
  return Math.min(5.0, Math.max(1.0, gwa));
};

const periodGWA = (comps, studentId, componentScores) => {
  let composite = 0;
  for (const comp of comps) {
    const avg = componentAverage(comp, studentId, componentScores);
    if (avg === null) return null;
    composite += avg * (parseFloat(comp.weight) / 100);
  }
  return Math.round(compositeToGWA(composite) * 100) / 100;
};

// ── Real Class Record template (public/templates/class-record-template.xlsx) ────────
// Usable whenever the class has the standard 5 SSU components (same weights, same
// order) — even if an instructor trimmed some items down (e.g. only "Test 1", no
// "Test 2"). Items map into their component's reserved slot by position; any slot
// with no corresponding item is left blank rather than misaligning later columns.
// Only classes with MORE items than a slot has room for (e.g. 5 quizzes) fall back
// to the generated layout, since the template's columns are physically fixed.
const TEMPLATE_SHAPE = [
  { weight: 25, itemCount: 2 },  // Summative Test: Test 1, Test 2
  { weight: 5, itemCount: 4 },   // Class Participation: Quiz 1, Quiz 2, Ass. 1, Recit.
  { weight: 10, itemCount: 3 },  // Course Exercises/Laboratory: Lab 1, Lab 2, Lab 3
  { weight: 20, itemCount: 1 },  // Project/Term Requirement: Rate
  { weight: 40, itemCount: 1 },  // Major Exam: 100 Items
];
// Per-component column slots (nested to match TEMPLATE_SHAPE) — items fill these
// left-to-right by their own order_index; unused trailing slots are left blank.
const MIDTERM_SCORE_COLS = [['C', 'E'], ['I', 'K', 'M', 'O'], ['S', 'U', 'W'], ['AA'], ['AC']];
const FINALS_SCORE_COLS = [['AK', 'AM'], ['AQ', 'AS', 'AU', 'AW'], ['BA', 'BC', 'BE'], ['BI'], ['BK']];
const TEMPLATE_FIRST_ROW = 15;
const TEMPLATE_LAST_ROW = 59;

const canUseTemplate = (comps) => {
  if (comps.length !== TEMPLATE_SHAPE.length) return false;
  const sorted = [...comps].sort((a, b) => a.order_index - b.order_index);
  return sorted.every((c, i) =>
    Math.abs(parseFloat(c.weight) - TEMPLATE_SHAPE[i].weight) < 0.01 &&
    (c.items || []).length >= 1 &&
    (c.items || []).length <= TEMPLATE_SHAPE[i].itemCount
  );
};

// ── Grading Sheet remarks (mirrors pages/common/GradingSheet.js exactly) ────────────
const remarksFor = (status) => {
  if (status === 'Passed') return 'PASSED';
  if (status === 'Failed') return 'FAILED';
  if (status === 'INC') return 'INC';
  if (status === 'DRP') return 'DRP';
  return '';
};

// ── Excel export helpers (mirror the on-screen Class Record layout) ─────────────────
const buildPeriodColumns = (comps) => {
  const cols = [];
  comps.forEach(c => {
    (c.items || []).forEach(item => {
      cols.push({ kind: 'score', comp: c, item });
      cols.push({ kind: 'rate', comp: c, item });
    });
    cols.push({ kind: 'ave', comp: c });
  });
  cols.push({ kind: 'gwa' });
  return cols;
};

const THIN_BORDER = { top: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' }, bottom: { style: 'thin' } };
const HAIR_BORDER = { top: { style: 'hairline' }, left: { style: 'hairline' }, right: { style: 'hairline' }, bottom: { style: 'hairline' } };

const writePeriodSection = (ws, startRow, label, fillColor, comps, studentGrades, componentScores) => {
  const cols = buildPeriodColumns(comps);
  const totalCols = 2 + cols.length;

  ws.mergeCells(startRow, 1, startRow, totalCols);
  const titleCell = ws.getCell(startRow, 1);
  titleCell.value = label;
  titleCell.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const headerRow1 = startRow + 1;
  const headerRow2 = startRow + 2;

  ws.mergeCells(headerRow1, 1, headerRow2, 1);
  ws.getCell(headerRow1, 1).value = 'Student No.';
  ws.mergeCells(headerRow1, 2, headerRow2, 2);
  ws.getCell(headerRow1, 2).value = 'Name';

  let colIdx = 3;
  comps.forEach(c => {
    const span = (c.items || []).length * 2 + 1;
    ws.mergeCells(headerRow1, colIdx, headerRow1, colIdx + span - 1);
    const cCell = ws.getCell(headerRow1, colIdx);
    cCell.value = `${c.name} (${parseFloat(c.weight)}%)`;
    cCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } };

    (c.items || []).forEach(item => {
      ws.getCell(headerRow2, colIdx).value = `${item.name} (/${parseFloat(item.max_score)})`;
      ws.getCell(headerRow2, colIdx + 1).value = 'Rate';
      colIdx += 2;
    });
    ws.getCell(headerRow2, colIdx).value = 'Ave';
    colIdx += 1;
  });
  ws.mergeCells(headerRow1, colIdx, headerRow2, colIdx);
  ws.getCell(headerRow1, colIdx).value = 'GWA';
  ws.getCell(headerRow1, colIdx).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3E9C8' } };

  for (let r = headerRow1; r <= headerRow2; r++) {
    for (let c = 1; c <= totalCols; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { bold: true, size: 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = THIN_BORDER;
    }
  }

  let row = headerRow2 + 1;
  studentGrades.forEach(g => {
    ws.getCell(row, 1).value = g.student.student_no;
    ws.getCell(row, 2).value = g.student.name;
    let c = 3;
    let composite = 0;
    let allFilled = true;
    comps.forEach(comp => {
      const rates = [];
      (comp.items || []).forEach(item => {
        const score = componentScores[g.student.id]?.[item.id];
        const rate = itemRate(score, item.max_score);
        ws.getCell(row, c).value = score !== null && score !== undefined ? parseFloat(score) : null;
        ws.getCell(row, c + 1).value = rate !== null ? Math.round(rate * 100) / 100 : null;
        if (rate === null) allFilled = false; else rates.push(rate);
        c += 2;
      });
      const avg = rates.length === (comp.items || []).length && rates.length > 0
        ? rates.reduce((s, r) => s + r, 0) / rates.length
        : null;
      ws.getCell(row, c).value = avg !== null ? Math.round(avg * 100) / 100 : null;
      if (avg !== null) composite += avg * (parseFloat(comp.weight) / 100); else allFilled = false;
      c += 1;
    });
    const gwa = allFilled ? Math.round(compositeToGWA(composite) * 100) / 100 : null;
    const gwaCell = ws.getCell(row, c);
    gwaCell.value = gwa;
    gwaCell.font = { bold: true };
    gwaCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF6E8' } };

    for (let cc = 1; cc <= totalCols; cc++) {
      ws.getCell(row, cc).border = HAIR_BORDER;
      ws.getCell(row, cc).alignment = { horizontal: cc <= 2 ? 'left' : 'center', vertical: 'middle' };
    }
    row++;
  });

  return row + 1;
};

// ── Class Record grid — one table per period (Midterm/Finals), Score+Rate per item,
// live-computed Ave per component and GWA per student, matching the real spreadsheet ──
function PeriodTable({ comps, studentGrades, componentScores, updateScore }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50">
            <th rowSpan={2} className="text-left px-4 py-2.5 text-xs font-semibold uppercase text-gray-600 sticky left-0 bg-gray-50 min-w-[180px] align-bottom border-b border-gray-200">Student</th>
            {comps.map(c => (
              <th key={c.id} colSpan={(c.items || []).length * 2 + 1} className="text-center px-3 py-2 text-xs font-semibold text-gray-700 border-b border-l border-gray-200">
                {c.name} <span className="font-normal text-gray-400">({parseFloat(c.weight)}%)</span>
              </th>
            ))}
            <th rowSpan={2} className="text-center px-3 py-2.5 text-xs font-semibold text-navy min-w-[70px] align-bottom border-b border-l border-gray-200 bg-navy/5">GWA</th>
          </tr>
          <tr className="bg-gray-50">
            {comps.flatMap(c => [
              ...(c.items || []).flatMap(item => ([
                <th key={`${item.id}-s`} className="text-center px-2 py-1.5 text-[10px] font-medium text-gray-500 min-w-[60px] border-l border-gray-100">
                  {item.name}<br /><span className="text-gray-400">/{parseFloat(item.max_score)}</span>
                </th>,
                <th key={`${item.id}-r`} className="text-center px-2 py-1.5 text-[10px] font-medium text-gray-400 min-w-[50px] bg-gray-100/60">Rate</th>,
              ])),
              <th key={`${c.id}-ave`} className="text-center px-2 py-1.5 text-[10px] font-semibold text-gray-600 min-w-[56px] border-l border-gray-200 bg-blue-50/50">Ave</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {studentGrades.map(g => {
            const gwa = periodGWA(comps, g.student.id, componentScores);
            return (
              <tr key={g.student.id} className={`border-b border-gray-50 ${g.status === 'INC' ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5 text-sm sticky left-0 bg-white">
                  <p className="font-medium">{g.student.name}</p>
                  <p className="text-xs text-gray-400">{g.student.student_no}</p>
                  {g.status === 'INC' && <Badge variant="yellow" className="mt-1">INC</Badge>}
                </td>
                {comps.flatMap(c => {
                  const avg = componentAverage(c, g.student.id, componentScores);
                  return [
                    ...(c.items || []).flatMap(item => {
                      const score = componentScores[g.student.id]?.[item.id];
                      const rate = itemRate(score, item.max_score);
                      return [
                        <td key={`${item.id}-s`} className="px-1 py-2 text-center border-l border-gray-100">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="form-input text-center text-xs py-1.5 w-14 mx-auto"
                            placeholder="0"
                            value={score ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '' || /^\d*\.?\d*$/.test(v)) updateScore(g.student.id, item.id, v);
                            }}
                            disabled={g.submitted || g.status === 'INC'}
                          />
                        </td>,
                        <td key={`${item.id}-r`} className="px-2 py-2 text-center text-xs text-gray-500 bg-gray-50/60">{rate !== null ? rate.toFixed(1) : '—'}</td>,
                      ];
                    }),
                    <td key={`${c.id}-ave`} className="px-2 py-2 text-center text-xs font-semibold text-gray-700 border-l border-gray-200 bg-blue-50/40">{avg !== null ? avg.toFixed(2) : '—'}</td>,
                  ];
                })}
                <td className="px-3 py-2.5 text-center font-bold text-navy border-l border-gray-200 bg-navy/5">
                  {g.status === 'INC' ? <span className="text-amber-500">INC</span> : (gwa !== null ? gwa.toFixed(2) : '—')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function GradeEncoding() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const periodHeaderClass = programHeaderClass(user?.program);
  const periodCascade = programCascadeGradient(user?.program);
  const [classData, setClassData] = useState(null);
  const [studentGrades, setStudentGrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('components');

  // Component state
  const [components, setComponents] = useState([]);
  const [componentScores, setComponentScores] = useState({}); // { studentId: { itemId: score } }
  const [showComponentSetup, setShowComponentSetup] = useState(false);
  const [editComponents, setEditComponents] = useState([]);
  const [savingComponents, setSavingComponents] = useState(false);
  const [savingScores, setSavingScores] = useState(false);

  // ✅ INC modal state
  const [showINCModal, setShowINCModal] = useState(false);
  const [incTarget, setIncTarget] = useState(null); // { student, gradeId, mode: 'mark' | 'resolve' }
  const [incRemarks, setIncRemarks] = useState('');
  const [incDeadline, setIncDeadline] = useState('');
  const [incMidterm, setIncMidterm] = useState('');
  const [incFinals, setIncFinals] = useState('');
  const [savingINC, setSavingINC] = useState(false);

  useEffect(() => { loadData(); }, [classId]);

  // Class Record is the primary view, but fall back to Grade Sheet if this class has no components set up yet.
  useEffect(() => {
    if (!loading && components.length === 0) setActiveTab('grades');
  }, [loading, components]);

  const loadData = async () => {
    try {
      const { data } = await gradeService.getByClass(classId);
      setClassData(data.class);
      setStudentGrades(data.student_grades.map((sg) => ({
        student: sg.student,
        midterm: sg.grade?.midterm ? parseFloat(sg.grade.midterm).toFixed(2) : '',
        finals: sg.grade?.finals ? parseFloat(sg.grade.finals).toFixed(2) : '',
        average: sg.grade?.average ?? null,
        status: sg.grade?.status || 'Pending',
        submitted: sg.grade?.submitted || false,
        gradeId: sg.grade?.id || null,
        inc_remarks: sg.grade?.inc_remarks || '',
        inc_deadline: sg.grade?.inc_deadline || null,
        inc_resolved_date: sg.grade?.inc_resolved_date || null,
      })));

      try {
        const compRes = await API.get(`/grade-components/${classId}/components`);
        setComponents(compRes.data.components || []);
        const scoreRes = await API.get(`/grade-components/${classId}/scores`);
        setComponentScores(scoreRes.data.scores || {});
      } catch (e) {
        setComponents([]);
        setComponentScores({});
      }
    } catch (err) {
      toast.error('Failed to load class data');
    } finally {
      setLoading(false);
    }
  };

  const updateGrade = (studentId, field, value) => {
    setStudentGrades((prev) =>
      prev.map((g) => g.student.id === studentId ? { ...g, [field]: value } : g)
    );
  };

  const getAverage = (g) => {
    if (g.status === 'INC') return null;
    if (g.midterm === '' || g.finals === '') return null;
    const mid = parseFloat(g.midterm);
    const fin = parseFloat(g.finals);
    if (isNaN(mid) || isNaN(fin)) return null;
    return Math.round(((mid + fin) / 2) * 100) / 100;
  };

  const isPassed = (avg) => avg !== null && avg >= 1.0 && avg <= 3.0;

  // ✅ "allComplete" now considers INC as a valid complete state
  const allComplete = studentGrades.every((g) =>
    g.status === 'INC' ||
    g.status === 'DRP' ||
    (g.midterm !== '' && g.finals !== '')
  );

  // SSU Class Record standard breakdown (matches SAMPLE-CLASS-RECORD.xlsx exactly,
  // including each component's sub-items — scores are entered per item, then
  // averaged/weighted into the component and period GWA server-side).
  const SSU_TEMPLATE = [
    { name: 'Summative Test', weight: 25, items: [{ name: 'Test 1', max_score: 30 }, { name: 'Test 2', max_score: 30 }] },
    { name: 'Class Participation', weight: 5, items: [{ name: 'Quiz 1', max_score: 10 }, { name: 'Quiz 2', max_score: 10 }, { name: 'Ass. 1', max_score: 10 }, { name: 'Recit.', max_score: 100 }] },
    { name: 'Course Exercises/Laboratory', weight: 10, items: [{ name: 'Lab 1', max_score: 10 }, { name: 'Lab 2', max_score: 10 }, { name: 'Lab 3', max_score: 30 }] },
    { name: 'Project/Term Requirement', weight: 20, items: [{ name: 'Rate', max_score: 100 }] },
    { name: 'Major Exam', weight: 40, items: [{ name: '100 Items', max_score: 100 }] },
  ];

  // ====== Component Setup ======
  const openComponentSetup = () => {
    setEditComponents(components.length > 0
      ? components.map(c => ({
          ...c,
          weight: parseFloat(c.weight),
          items: (c.items || []).map(i => ({ ...i, max_score: parseFloat(i.max_score) })),
        }))
      : []
    );
    setShowComponentSetup(true);
  };

  const loadSSUTemplate = () => {
    const build = (period) => SSU_TEMPLATE.map((c, i) => ({
      name: c.name, period, weight: c.weight, order_index: i,
      items: c.items.map((it, j) => ({ ...it, order_index: j })),
    }));
    setEditComponents([...build('Midterm'), ...build('Finals')]);
  };

  const addComponent = (period) => {
    const periodComps = editComponents.filter(c => c.period === period);
    setEditComponents([...editComponents, {
      name: '', period, weight: 0, order_index: periodComps.length, items: [],
    }]);
  };

  const updateComponent = (index, field, value) => {
    const updated = [...editComponents];
    updated[index] = {
      ...updated[index],
      [field]: field === 'weight' || field === 'order_index' ? parseFloat(value) || 0 : value,
    };
    setEditComponents(updated);
  };

  const removeComponent = (index) => setEditComponents(editComponents.filter((_, i) => i !== index));

  const addItem = (compIndex) => {
    const updated = [...editComponents];
    const items = updated[compIndex].items || [];
    updated[compIndex] = { ...updated[compIndex], items: [...items, { name: '', max_score: 100, order_index: items.length }] };
    setEditComponents(updated);
  };

  const updateItem = (compIndex, itemIndex, field, value) => {
    const updated = [...editComponents];
    const items = [...updated[compIndex].items];
    items[itemIndex] = {
      ...items[itemIndex],
      [field]: field === 'max_score' || field === 'order_index' ? parseFloat(value) || 0 : value,
    };
    updated[compIndex] = { ...updated[compIndex], items };
    setEditComponents(updated);
  };

  const removeItem = (compIndex, itemIndex) => {
    const updated = [...editComponents];
    updated[compIndex] = { ...updated[compIndex], items: updated[compIndex].items.filter((_, i) => i !== itemIndex) };
    setEditComponents(updated);
  };

  const getTotalWeight = (period) =>
    editComponents.filter(c => c.period === period).reduce((sum, c) => sum + (parseFloat(c.weight) || 0), 0);

  const saveComponentSetup = async () => {
    const midComps = editComponents.filter(c => c.period === 'Midterm');
    const finComps = editComponents.filter(c => c.period === 'Finals');

    if (midComps.length > 0 && Math.abs(getTotalWeight('Midterm') - 100) > 0.01) {
      toast.error('Midterm weights must total 100%');
      return;
    }
    if (finComps.length > 0 && Math.abs(getTotalWeight('Finals') - 100) > 0.01) {
      toast.error('Finals weights must total 100%');
      return;
    }
    for (const comp of editComponents) {
      if (!comp.name.trim()) { toast.error('All components must have a name'); return; }
      if (!comp.items || comp.items.length === 0) { toast.error(`"${comp.name}" needs at least one item`); return; }
      for (const item of comp.items) {
        if (!item.name.trim()) { toast.error(`All items in "${comp.name}" must have a name`); return; }
      }
    }

    setSavingComponents(true);
    try {
      await API.put(`/grade-components/${classId}/components`, { components: editComponents });
      toast.success('Components saved!');
      setShowComponentSetup(false);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save components');
    } finally {
      setSavingComponents(false);
    }
  };

  // ====== Component Scores (per item) ======
  const updateScore = (studentId, itemId, value) => {
    setComponentScores(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [itemId]: value === '' ? null : parseFloat(value),
      },
    }));
  };

  const saveAllScores = async () => {
    setSavingScores(true);
    try {
      await API.put(`/grade-components/${classId}/scores`, { scores: componentScores });
      toast.success('Scores saved and grades computed!');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save scores');
    } finally {
      setSavingScores(false);
    }
  };

  // ====== Save Draft ======
  const handleSaveDraft = async () => {
    setSaving(true);
    try {
      // ✅ Skip INC/DRP students from normal grade encode
      const grades = studentGrades
        .filter((g) => g.status !== 'INC' && g.status !== 'DRP')
        .filter((g) => g.midterm !== '' || g.finals !== '')
        .map((g) => ({
          student_id: g.student.id,
          midterm: g.midterm ? parseFloat(g.midterm) : null,
          finals: g.finals ? parseFloat(g.finals) : null,
        }));

      await API.post('/grades/encode', {
        class_id: parseInt(classId),
        grades,
      });

      toast.success('Grades saved as draft');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  // ====== Submit Grades ======
  const handleSubmit = async () => {
    if (!allComplete) {
      toast.error('Please complete all grades or mark incomplete students as INC first');
      return;
    }
    setSaving(true);
    try {
      // ✅ Only encode non-INC students that have grades
      const grades = studentGrades
        .filter((g) => g.status !== 'INC' && g.status !== 'DRP')
        .map((g) => ({
          student_id: g.student.id,
          midterm: parseFloat(g.midterm),
          finals: parseFloat(g.finals),
        }));

      if (grades.length > 0) {
        await API.post('/grades/encode', {
          class_id: parseInt(classId),
          grades,
        });
      }

      await API.post('/grades/submit', { class_id: parseInt(classId) });

      toast.success('Grades submitted successfully!');
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  // ====== INC Handlers ======
  const openMarkINC = (g) => {
    setIncTarget({ student: g.student, gradeId: g.gradeId, mode: 'mark' });
    setIncRemarks(g.inc_remarks || '');
    setIncDeadline(g.inc_deadline ? new Date(g.inc_deadline).toISOString().split('T')[0] : '');
    setIncMidterm('');
    setIncFinals('');
    setShowINCModal(true);
  };

  const openResolveINC = (g) => {
    setIncTarget({ student: g.student, gradeId: g.gradeId, mode: 'resolve' });
    setIncRemarks('');
    setIncDeadline('');
    setIncMidterm('');
    setIncFinals('');
    setShowINCModal(true);
  };

  const handleSaveINC = async () => {
    if (!incTarget) return;
    setSavingINC(true);

    try {
      if (incTarget.mode === 'mark') {
        await API.post('/grades/inc', {
          class_id: parseInt(classId),
          student_id: incTarget.student.id,
          inc_remarks: incRemarks,
          inc_deadline: incDeadline || null,
        });
        toast.success(`${incTarget.student.name} marked as INC`);
      } else {
        // Resolve INC
        if (!incMidterm || !incFinals) {
          toast.error('Both midterm and finals are required to resolve INC');
          return;
        }
        await API.post('/grades/inc/resolve', {
          grade_id: incTarget.gradeId,
          midterm: parseFloat(incMidterm),
          finals: parseFloat(incFinals),
        });
        toast.success(`INC resolved for ${incTarget.student.name}`);
      }

      setShowINCModal(false);
      setIncTarget(null);
      loadData();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to process INC');
    } finally {
      setSavingINC(false);
    }
  };

  // ====== Excel Export — generated layout (fallback for customized component structures) ======
  const exportUsingGeneratedLayout = async () => {
    const midComps = components.filter(c => c.period === 'Midterm');
    const finComps = components.filter(c => c.period === 'Finals');

    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'AGMS';
      const ws = workbook.addWorksheet('Class Record');

      const maxCols = Math.max(
        2 + buildPeriodColumns(midComps).length,
        2 + buildPeriodColumns(finComps).length,
        6
      );

      ws.mergeCells(1, 1, 1, maxCols);
      ws.getCell(1, 1).value = 'SAMAR STATE UNIVERSITY';
      ws.getCell(1, 1).font = { bold: true, size: 14 };
      ws.getCell(1, 1).alignment = { horizontal: 'center' };

      ws.mergeCells(2, 1, 2, maxCols);
      ws.getCell(2, 1).value = 'COLLEGE OF ARTS AND SCIENCES';
      ws.getCell(2, 1).font = { bold: true, size: 11 };
      ws.getCell(2, 1).alignment = { horizontal: 'center' };

      ws.mergeCells(3, 1, 3, maxCols);
      ws.getCell(3, 1).value = 'CLASS RECORD';
      ws.getCell(3, 1).font = { italic: true, size: 10, color: { argb: 'FF666666' } };
      ws.getCell(3, 1).alignment = { horizontal: 'center' };

      ws.getCell(5, 1).value = `Name of Faculty: ${classData?.instructor?.name || ''}`;
      ws.getCell(5, 1).font = { bold: true, size: 10 };
      ws.getCell(6, 1).value = `Subject: ${classData?.subject?.code || ''} — ${classData?.subject?.name || ''}`;
      ws.getCell(6, 1).font = { size: 10 };
      ws.getCell(7, 1).value = `Section: ${classData?.section || '—'}    Schedule: ${classData?.schedule || '—'}    Semester: ${classData?.semester || ''} ${classData?.academic_year || ''}`;
      ws.getCell(7, 1).font = { size: 10 };

      let nextRow = 9;
      if (midComps.length > 0) {
        nextRow = writePeriodSection(ws, nextRow, 'MIDTERM GRADE', 'FF0F2A4A', midComps, studentGrades, componentScores);
      }
      if (finComps.length > 0) {
        nextRow = writePeriodSection(ws, nextRow, 'FINALS GRADE', 'FF1B3A5C', finComps, studentGrades, componentScores);
      }

      // Final summary block
      ws.mergeCells(nextRow, 1, nextRow, 6);
      ws.getCell(nextRow, 1).value = 'FINAL GRADE SUMMARY';
      ws.getCell(nextRow, 1).font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      ws.getCell(nextRow, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9A84C' } };
      ws.getCell(nextRow, 1).alignment = { horizontal: 'center' };
      nextRow += 1;

      ['Student No.', 'Name', 'Midterm', 'Finals', 'Average', 'Remarks'].forEach((h, i) => {
        const cell = ws.getCell(nextRow, i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } };
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });
      nextRow += 1;

      studentGrades.forEach(g => {
        const avg = getAverage(g);
        const passed = isPassed(avg);
        const row = [
          g.student.student_no, g.student.name,
          g.status === 'INC' ? 'INC' : (g.midterm || ''),
          g.status === 'INC' ? 'INC' : (g.finals || ''),
          g.status === 'INC' ? 'INC' : (avg !== null ? avg.toFixed(2) : ''),
          g.status === 'INC' ? 'INC' : (avg !== null ? (passed ? 'Passed' : 'Failed') : ''),
        ];
        row.forEach((val, i) => {
          const cell = ws.getCell(nextRow, i + 1);
          cell.value = val;
          cell.border = HAIR_BORDER;
          cell.alignment = { horizontal: i <= 1 ? 'left' : 'center', vertical: 'middle' };
        });
        nextRow += 1;
      });

      ws.getColumn(1).width = 14;
      ws.getColumn(2).width = 24;
      for (let c = 3; c <= maxCols; c++) ws.getColumn(c).width = 9;

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `${classData?.subject?.code || 'class'}_ClassRecord.xlsx`);
      toast.success('Exported to Excel!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to export to Excel');
    }
  };

  // ====== Excel Export — real SSU Class Record template, live formulas preserved ======
  const exportUsingRealTemplate = async () => {
    const midComps = [...components.filter(c => c.period === 'Midterm')].sort((a, b) => a.order_index - b.order_index);
    const finComps = [...components.filter(c => c.period === 'Finals')].sort((a, b) => a.order_index - b.order_index);

    // Build a flat { col, item|null } list per period, honoring each component's
    // reserved slot range so a component with fewer items than its slot capacity
    // just leaves the trailing slot(s) blank instead of shifting later columns.
    const buildSlots = (comps, colGroups) => comps.flatMap((comp, i) => {
      const sortedItems = [...(comp.items || [])].sort((a, b) => a.order_index - b.order_index);
      return (colGroups[i] || []).map((col, j) => ({ col, item: sortedItems[j] || null }));
    });
    const midSlots = buildSlots(midComps, MIDTERM_SCORE_COLS);
    const finSlots = buildSlots(finComps, FINALS_SCORE_COLS);

    try {
      const res = await fetch('/templates/class-record-template.xlsx');
      const buffer = await res.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const ws = workbook.worksheets[0];

      const faculty = classData?.instructor?.name || '';
      const section = classData?.section ? `Section ${classData.section}` : '';
      const sy = classData?.academic_year || '';
      const subjLine = `Subject: ${classData?.subject?.code || ''} (${classData?.subject?.name || ''})`;
      const schedLine = `Schedule: ${classData?.schedule || '—'}`;
      const semLine = classData?.semester || '';

      ['A7', 'AI7'].forEach(addr => { ws.getCell(addr).value = `Name of Faculty:  ${faculty}`; });
      ['I7', 'AP7'].forEach(addr => { ws.getCell(addr).value = `Course, Year and Section: ${section}`; });
      ['AB7', 'BJ7'].forEach(addr => { ws.getCell(addr).value = `SY ${sy}`; });
      ['A8', 'AI8'].forEach(addr => { ws.getCell(addr).value = subjLine; });
      ['I8', 'AP8'].forEach(addr => { ws.getCell(addr).value = schedLine; });
      ['AB8', 'BJ8'].forEach(addr => { ws.getCell(addr).value = semLine; });

      const templateCapacity = TEMPLATE_LAST_ROW - TEMPLATE_FIRST_ROW + 1;
      const studentCount = studentGrades.length;

      if (studentCount > templateCapacity) {
        ws.duplicateRow(TEMPLATE_LAST_ROW, studentCount - templateCapacity, true);
      }

      studentGrades.forEach((g, i) => {
        const row = TEMPLATE_FIRST_ROW + i;
        ws.getCell(`A${row}`).value = i + 1;
        ws.getCell(`AI${row}`).value = i + 1;
        ws.getCell(`B${row}`).value = g.student.name;

        midSlots.forEach(({ col, item }) => {
          const score = item ? componentScores[g.student.id]?.[item.id] : null;
          ws.getCell(`${col}${row}`).value = (score !== null && score !== undefined) ? parseFloat(score) : null;
        });
        finSlots.forEach(({ col, item }) => {
          const score = item ? componentScores[g.student.id]?.[item.id] : null;
          ws.getCell(`${col}${row}`).value = (score !== null && score !== undefined) ? parseFloat(score) : null;
        });
      });

      // Clear unused pre-built rows so they don't show phantom "50" rates from blank scores
      if (studentCount < templateCapacity) {
        for (let row = TEMPLATE_FIRST_ROW + studentCount; row <= TEMPLATE_LAST_ROW; row++) {
          ws.getRow(row).eachCell({ includeEmpty: true }, (cell) => { cell.value = null; });
        }
      }

      const buffer2 = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer2], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      saveAs(blob, `${classData?.subject?.code || 'class'}_ClassRecord.xlsx`);
      toast.success('Exported using the official SSU Class Record template!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to export using the template — falling back to generated layout');
      await exportUsingGeneratedLayout();
    }
  };

  // ====== Export — official Grading Sheet (SSU-UNREG-FR-017), the summary passed to
  // the Chairperson. Uses the REAL registrar .docx as a byte-preserving template (same
  // approach as the Class Record's real .xlsx template) — every font, logo, border and
  // signature block comes straight from the original file; only the blank fields get
  // filled in. The template has 25 fixed rows (the physical paper form's limit), so
  // classes larger than that only get their first 25 (sorted by name) filled in. ======
  const GRADING_SHEET_ROWS = 25;
  const exportGradingSheet = async () => {
    try {
      const res = await fetch('/templates/grading-sheet-template.docx');
      const buffer = await res.arrayBuffer();
      const zip = new PizZip(buffer);
      const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });

      const sorted = [...studentGrades].sort((a, b) => (a.student?.name || '').localeCompare(b.student?.name || ''));
      if (sorted.length > GRADING_SHEET_ROWS) {
        toast(`This form has ${GRADING_SHEET_ROWS} rows — only the first ${GRADING_SHEET_ROWS} students (by name) are included.`, { icon: 'ℹ️' });
      }

      const data = {
        sy: classData?.academic_year || '',
        semester: classData?.semester || '',
        program: classData?.subject?.program || '',
        subjcode: classData?.subject?.code || '',
        coursedesc: classData?.subject?.name || '',
        units: classData?.subject?.units || '',
        instructor: classData?.instructor?.name || '',
        college: classData?.subject?.department || '',
        instructor_name: classData?.instructor?.name || '',
      };

      for (let i = 1; i <= GRADING_SHEET_ROWS; i++) {
        const g = sorted[i - 1];
        if (!g) {
          data[`id${i}`] = ''; data[`name${i}`] = ''; data[`mid${i}`] = ''; data[`fin${i}`] = ''; data[`rem${i}`] = '';
          continue;
        }
        const avg = getAverage(g);
        const remarksStatus = g.status === 'INC' || g.status === 'DRP' ? g.status : (avg !== null ? (isPassed(avg) ? 'Passed' : 'Failed') : '');
        data[`id${i}`] = g.student.student_no || '';
        data[`name${i}`] = g.student.name || '';
        data[`mid${i}`] = g.status === 'INC' ? 'INC' : (g.midterm || '');
        data[`fin${i}`] = g.status === 'INC' ? 'INC' : (g.finals || '');
        data[`rem${i}`] = remarksFor(remarksStatus);
      }

      doc.render(data);
      const out = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      saveAs(out, `${classData?.subject?.code || 'class'}_GradingSheet.docx`);
      toast.success('Exported using the official SSU Grading Sheet template!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to export the Grading Sheet');
    }
  };

  const [sendingGradingSheet, setSendingGradingSheet] = useState(false);
  const handleSendGradingSheet = async () => {
    if (!window.confirm('Send this class\'s Grading Sheet to your Chairperson?')) return;
    try {
      setSendingGradingSheet(true);
      const { data } = await reportService.sendGradingSheet(classId);
      toast.success(data.message);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send Grading Sheet');
    } finally {
      setSendingGradingSheet(false);
    }
  };

  // ====== Excel Export — entry point ======
  const exportToExcel = async () => {
    const midComps = components.filter(c => c.period === 'Midterm');
    const finComps = components.filter(c => c.period === 'Finals');
    const hasAnyComponents = midComps.length > 0 || finComps.length > 0;
    const matchesTemplate = hasAnyComponents &&
      (midComps.length === 0 || canUseTemplate(midComps)) &&
      (finComps.length === 0 || canUseTemplate(finComps));

    if (matchesTemplate) {
      await exportUsingRealTemplate();
    } else {
      if (hasAnyComponents) {
        toast('Components don\'t match the standard SSU template shape — using a generated layout instead.', { icon: 'ℹ️' });
      }
      await exportUsingGeneratedLayout();
    }
  };

  if (loading) return <LoadingSpinner />;

  const midtermComps = components.filter(c => c.period === 'Midterm');
  const finalsComps = components.filter(c => c.period === 'Finals');
  const hasComponents = components.length > 0;
  const incCount = studentGrades.filter(g => g.status === 'INC').length;

  return (
    <>
      <button className="btn btn-outline mb-4" onClick={() => navigate('/instructor')}>
        <Icons.ArrowLeft /> Back to Dashboard
      </button>

      <div className="flex items-center gap-3 mb-1">
        <Badge variant="blue">{classData?.subject?.code}</Badge>
        <span className="text-[13px] text-gray-400">{classData?.subject?.units} Units</span>
        <span className="ml-auto text-[13px] text-gray-500">{studentGrades.length} Students</span>
        {/* ✅ Show INC count badge if any */}
        {incCount > 0 && (
          <Badge variant="yellow">{incCount} INC</Badge>
        )}
      </div>
      <h2 className="text-xl font-bold mb-1">{classData?.subject?.name}</h2>
      <p className="text-[13px] text-gray-500 flex items-center gap-1 mb-4">
        <Icons.Clock /> {classData?.schedule}
      </p>

      {/* Tab switcher + actions */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-0 border-b-2 border-gray-200">
          {[...(hasComponents ? ['components'] : []), 'grades'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all capitalize
                ${activeTab === tab ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
            >
              {tab === 'grades' ? 'Grade Sheet (Summary)' : 'Class Record'}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white"
            style={{ background: 'linear-gradient(135deg, #0f2a4a, #1b3a5c)' }}
            onClick={openComponentSetup}
          >
            <Icons.Settings className="w-4 h-4" />
            {hasComponents ? 'Edit Components' : 'Setup Components'}
          </button>
          {activeTab === 'grades' ? (
            <>
              <button
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white"
                style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
                onClick={exportGradingSheet}
              >
                <Icons.FileText className="w-4 h-4" /> Export Grading Sheet
              </button>
              <button
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #c9a84c, #dfc06a)' }}
                onClick={handleSendGradingSheet}
                disabled={sendingGradingSheet}
              >
                <Icons.Send className="w-4 h-4" /> {sendingGradingSheet ? 'Sending...' : 'Send to Chairperson'}
              </button>
            </>
          ) : (
            <button
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg cursor-pointer border-none font-sans transition-all text-white"
              style={{ background: 'linear-gradient(135deg, #1a7a4c, #28b464)' }}
              onClick={exportToExcel}
            >
              <Icons.FileText className="w-4 h-4" /> Export Excel
            </button>
          )}
        </div>
      </div>

      {/* ====== GRADES TAB ====== */}
      {activeTab === 'grades' && (
        <div className="card">
          <div className="card-header">
            <h3 className="text-base font-semibold text-navy">Student Grades — Summary</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {hasComponents
                ? 'Auto-computed from the Class Record. This is the summary passed to the Chairperson — you can also override manually here before submitting.'
                : 'SSU GWA Scale: 1.0 (Excellent) — 3.0 (Passing) — 5.0 (Failed)'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-navy text-white">
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase rounded-tl-lg">Student No.</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase">Student Name</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Midterm</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Finals</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Average</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Remarks</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase">Status</th>
                  {/* ✅ New column for INC actions */}
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase rounded-tr-lg">INC</th>
                </tr>
              </thead>
              <tbody>
                {studentGrades.map((g) => {
                  const isINC = g.status === 'INC';
                  const avg = isINC ? null : getAverage(g);
                  const passed = isPassed(avg);

                  return (
                    <tr
                      key={g.student.id}
                      className={`border-b border-gray-50 ${isINC ? 'bg-amber-50/60' : ''}`}
                    >
                      <td className="px-4 py-3.5 font-medium text-sm">{g.student.student_no}</td>
                      <td className="px-4 py-3.5 text-sm">
                        <div>
                          {g.student.name}
                          {/* ✅ Show INC remarks and deadline inline */}
                          {isINC && g.inc_remarks && (
                            <p className="text-[11px] text-amber-600 mt-0.5">{g.inc_remarks}</p>
                          )}
                          {isINC && g.inc_deadline && (
                            <p className="text-[11px] text-gray-400">
                              Deadline: {new Date(g.inc_deadline).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC ? (
                          <span className="text-amber-400 font-semibold text-sm">INC</span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            className="grade-input text-center w-20 mx-auto"
                            placeholder="1.0–5.0"
                            value={g.midterm}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '' || /^\d*\.?\d*$/.test(v)) updateGrade(g.student.id, 'midterm', v);
                            }}
                            disabled={g.submitted && !isINC}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC ? (
                          <span className="text-amber-400 font-semibold text-sm">INC</span>
                        ) : (
                          <input
                            type="text"
                            inputMode="decimal"
                            className="grade-input text-center w-20 mx-auto"
                            placeholder="1.0–5.0"
                            value={g.finals}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '' || /^\d*\.?\d*$/.test(v)) updateGrade(g.student.id, 'finals', v);
                            }}
                            disabled={g.submitted && !isINC}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC ? (
                          <span className="text-amber-500 font-bold">INC</span>
                        ) : (
                          <span className={`text-base font-bold ${avg !== null ? (passed ? 'text-green-500' : 'text-red-500') : 'text-gray-300'}`}>
                            {avg !== null ? avg.toFixed(2) : '—'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC
                          ? <Badge variant="yellow">INC</Badge>
                          : avg !== null
                            ? <Badge variant={passed ? 'green' : 'red'}>{passed ? 'Passed' : 'Failed'}</Badge>
                            : '—'
                        }
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        {isINC
                          ? <Badge variant="yellow">INC</Badge>
                          : g.submitted
                            ? <Badge variant="green"><Icons.Check /> Submitted</Badge>
                            : <Badge variant="yellow">Pending</Badge>
                        }
                      </td>

                      {/* ✅ INC Action Column */}
                      <td className="px-4 py-3.5 text-center">
                        {isINC ? (
                          // Student is INC — show Resolve button
                          <button
                            className="text-xs px-3 py-1.5 rounded-lg font-semibold text-white border-none cursor-pointer font-sans"
                            style={{ background: 'linear-gradient(135deg, #b45309, #d97706)' }}
                            onClick={() => openResolveINC(g)}
                          >
                            Resolve INC
                          </button>
                        ) : !g.submitted ? (
                          // Not yet submitted — show Mark as INC button
                          <button
                            className="text-xs px-3 py-1.5 rounded-lg font-semibold border cursor-pointer font-sans text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors"
                            onClick={() => openMarkINC(g)}
                          >
                            Mark INC
                          </button>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
            <p className={`text-[13px] flex items-center gap-1.5 ${allComplete ? 'text-green-500' : 'text-amber-500'}`}>
              {allComplete
                ? <><Icons.Check /> All grades are complete {incCount > 0 && `(${incCount} INC)`}</>
                : 'Some grades are incomplete — complete or mark as INC to submit'}
            </p>
            <div className="flex gap-2">
              <button className="btn btn-outline" onClick={handleSaveDraft} disabled={saving}>
                <Icons.Save /> Save Draft
              </button>
              <button className="btn btn-gold" onClick={handleSubmit} disabled={!allComplete || saving}>
                <Icons.Send /> Submit Grades
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== CLASS RECORD TAB ====== */}
      {activeTab === 'components' && hasComponents && (
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-navy">Class Record</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Enter each student's raw score per item (test, quiz, lab, etc.) — Rate, component Average,
                and the period GWA update live as you type, matching the official SSU Class Record.
              </p>
            </div>
            <button className="btn btn-gold text-sm" onClick={saveAllScores} disabled={savingScores}>
              {savingScores ? 'Saving...' : 'Save All Scores'}
            </button>
          </div>

          {midtermComps.length > 0 && (
            <>
              <div className="px-6 py-3 border-b border-transparent" style={{ background: periodCascade }}>
                <h4 className={`text-sm font-semibold ${periodHeaderClass.text}`}>Midterm</h4>
              </div>
              <PeriodTable comps={midtermComps} studentGrades={studentGrades} componentScores={componentScores} updateScore={updateScore} />
            </>
          )}

          {finalsComps.length > 0 && (
            <>
              <div className="px-6 py-3 border-b border-t border-transparent" style={{ background: periodCascade }}>
                <h4 className={`text-sm font-semibold ${periodHeaderClass.text}`}>Finals</h4>
              </div>
              <PeriodTable comps={finalsComps} studentGrades={studentGrades} componentScores={componentScores} updateScore={updateScore} />
            </>
          )}
        </div>
      )}

      {/* ====== COMPONENT SETUP MODAL ====== */}
      {showComponentSetup && (
        <Modal
          title="Grade Component Setup"
          onClose={() => setShowComponentSetup(false)}
          size="max-w-2xl"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setShowComponentSetup(false)}>Cancel</button>
              <button className="btn btn-gold" onClick={saveComponentSetup} disabled={savingComponents}>
                {savingComponents ? 'Saving...' : 'Save Components'}
              </button>
            </>
          }
        >
          {editComponents.length === 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icons.Award className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-bold text-blue-900 mb-1">SSU Class Record Standard</h4>
                  <p className="text-xs text-blue-700 leading-relaxed mb-3">
                    Matches the official SSU Class Record: Summative Test (25%), Class Participation (5%),
                    Course Exercises/Laboratory (10%), Project/Term Requirement (20%), and Major Exam (40%)
                    for both Midterm and Finals — each with its own sub-items (tests, quizzes, labs, etc.).
                  </p>
                  <button
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg border-none cursor-pointer font-sans hover:bg-blue-700 transition-colors"
                    onClick={loadSSUTemplate}
                  >
                    <Icons.Check className="w-4 h-4" /> Use SSU Template
                  </button>
                </div>
              </div>
            </div>
          )}

          {editComponents.length > 0 && (
            <div className="flex items-center justify-between mb-4">
              <p className="text-[13px] text-gray-500">
                Weights per period must total <strong>100%</strong>. Final Grade = average of Midterm + Finals.
              </p>
              <button
                className="text-xs text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700"
                onClick={loadSSUTemplate}
              >
                Reset to SSU Template
              </button>
            </div>
          )}

          {/* Midterm Section */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-navy flex items-center gap-2">
                <ProgramDot program={user?.program} /> Midterm Components
              </h4>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Math.abs(getTotalWeight('Midterm') - 100) < 0.01 ? 'bg-green-100 text-green-700' : getTotalWeight('Midterm') > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                  {getTotalWeight('Midterm')}% / 100%
                </span>
                <button className="text-xs text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addComponent('Midterm')}>
                  + Add Component
                </button>
              </div>
            </div>
            {editComponents.filter(c => c.period === 'Midterm').length === 0 && (
              <p className="text-xs text-gray-400 italic py-3 text-center">No midterm components yet.</p>
            )}
            {editComponents.map((comp, idx) => comp.period === 'Midterm' && (
              <div key={idx} className="mb-3 bg-gray-50 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <input className="form-input text-sm flex-1 bg-white" placeholder="Component name" value={comp.name} onChange={(e) => updateComponent(idx, 'name', e.target.value)} />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input className="form-input text-sm w-20 text-center bg-white font-semibold" type="number" value={comp.weight || ''} onChange={(e) => updateComponent(idx, 'weight', e.target.value)} />
                    <span className="text-xs text-gray-500 font-semibold">%</span>
                  </div>
                  <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0" onClick={() => removeComponent(idx)}><Icons.X /></button>
                </div>
                <div className="pl-3 border-l-2 border-gray-200 space-y-1.5">
                  {(comp.items || []).map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center gap-2">
                      <input className="form-input text-xs flex-1 bg-white py-1.5" placeholder="Item name (e.g. Test 1)" value={item.name} onChange={(e) => updateItem(idx, itemIdx, 'name', e.target.value)} />
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-[10px] text-gray-400 uppercase">Max</span>
                        <input className="form-input text-xs w-16 text-center bg-white py-1.5" type="number" value={item.max_score || ''} onChange={(e) => updateItem(idx, itemIdx, 'max_score', e.target.value)} />
                      </div>
                      <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0 !w-7 !h-7" onClick={() => removeItem(idx, itemIdx)}><Icons.X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <button className="text-[11px] text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addItem(idx)}>
                    + Add Item
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-dashed border-gray-200 my-4" />

          {/* Finals Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-navy flex items-center gap-2">
                <ProgramDot program={user?.program} /> Finals Components
              </h4>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${Math.abs(getTotalWeight('Finals') - 100) < 0.01 ? 'bg-green-100 text-green-700' : getTotalWeight('Finals') > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}>
                  {getTotalWeight('Finals')}% / 100%
                </span>
                <button className="text-xs text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addComponent('Finals')}>
                  + Add Component
                </button>
              </div>
            </div>
            {editComponents.filter(c => c.period === 'Finals').length === 0 && (
              <p className="text-xs text-gray-400 italic py-3 text-center">No finals components yet.</p>
            )}
            {editComponents.map((comp, idx) => comp.period === 'Finals' && (
              <div key={idx} className="mb-3 bg-gray-50 rounded-lg px-3 py-2.5">
                <div className="flex items-center gap-2 mb-2">
                  <input className="form-input text-sm flex-1 bg-white" placeholder="Component name" value={comp.name} onChange={(e) => updateComponent(idx, 'name', e.target.value)} />
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <input className="form-input text-sm w-20 text-center bg-white font-semibold" type="number" value={comp.weight || ''} onChange={(e) => updateComponent(idx, 'weight', e.target.value)} />
                    <span className="text-xs text-gray-500 font-semibold">%</span>
                  </div>
                  <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0" onClick={() => removeComponent(idx)}><Icons.X /></button>
                </div>
                <div className="pl-3 border-l-2 border-gray-200 space-y-1.5">
                  {(comp.items || []).map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center gap-2">
                      <input className="form-input text-xs flex-1 bg-white py-1.5" placeholder="Item name (e.g. Test 1)" value={item.name} onChange={(e) => updateItem(idx, itemIdx, 'name', e.target.value)} />
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className="text-[10px] text-gray-400 uppercase">Max</span>
                        <input className="form-input text-xs w-16 text-center bg-white py-1.5" type="number" value={item.max_score || ''} onChange={(e) => updateItem(idx, itemIdx, 'max_score', e.target.value)} />
                      </div>
                      <button className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0 !w-7 !h-7" onClick={() => removeItem(idx, itemIdx)}><Icons.X className="w-3 h-3" /></button>
                    </div>
                  ))}
                  <button className="text-[11px] text-blue-500 font-medium cursor-pointer bg-transparent border-none font-sans hover:text-blue-700" onClick={() => addItem(idx)}>
                    + Add Item
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              <strong>How it works:</strong> Enter raw scores per item in the Component Scores tab.
              Each item score is transmuted to a rate, averaged per component, then weighted and
              summed into the period's GWA (1.0–5.0). Final Grade = average of Midterm Grade + Finals Grade.
            </p>
          </div>
        </Modal>
      )}

      {/* ====== INC MODAL ====== */}
      {showINCModal && incTarget && (
        <Modal
          title={incTarget.mode === 'mark' ? 'Mark Student as INC' : 'Resolve INC Grade'}
          onClose={() => { setShowINCModal(false); setIncTarget(null); }}
          size="max-w-md"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setShowINCModal(false); setIncTarget(null); }}>
                Cancel
              </button>
              <button
                className="btn btn-gold"
                onClick={handleSaveINC}
                disabled={savingINC}
              >
                {savingINC ? 'Saving...' : incTarget.mode === 'mark' ? 'Confirm INC' : 'Resolve INC'}
              </button>
            </>
          }
        >
          <div className="flex items-center gap-3 mb-5 p-3 bg-amber-50 rounded-xl border border-amber-200">
            <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <span className="text-amber-700 font-bold text-sm">!</span>
            </div>
            <div>
              <p className="text-sm font-semibold text-amber-900">{incTarget.student.name}</p>
              <p className="text-xs text-amber-600">{incTarget.student.student_no}</p>
            </div>
          </div>

          {incTarget.mode === 'mark' ? (
            <>
              <p className="text-[13px] text-gray-500 mb-4">
                Marking this student as <strong>INC</strong> means they have not completed the
                requirements. They will appear as INC in grade sheets and will not affect GWA
                until resolved.
              </p>
              <div className="mb-4">
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Reason / Remarks <span className="text-gray-400">(optional)</span>
                </label>
                <textarea
                  className="form-input w-full text-sm resize-none"
                  rows={3}
                  placeholder="e.g. Failed to submit final project, medical leave..."
                  value={incRemarks}
                  onChange={(e) => setIncRemarks(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Compliance Deadline <span className="text-gray-400">(optional)</span>
                </label>
                <input
                  type="date"
                  className="form-input w-full text-sm"
                  value={incDeadline}
                  onChange={(e) => setIncDeadline(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
            </>
          ) : (
            <>
              <p className="text-[13px] text-gray-500 mb-4">
                The student has complied with the INC requirements. Enter their final grades below
                to resolve the INC and compute their final average.
              </p>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Midterm Grade</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="form-input w-full text-sm"
                    placeholder="1.0–5.0"
                    value={incMidterm}
                    onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setIncMidterm(v); }}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">Finals Grade</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="form-input w-full text-sm"
                    placeholder="1.0–5.0"
                    value={incFinals}
                    onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setIncFinals(v); }}
                  />
                </div>
              </div>
              {incMidterm && incFinals && !isNaN(parseFloat(incMidterm)) && !isNaN(parseFloat(incFinals)) && (
                <div className="p-3 bg-gray-50 rounded-xl text-center">
                  <p className="text-xs text-gray-500 mb-1">Computed Final Average</p>
                  <p className={`text-2xl font-bold ${
                    ((parseFloat(incMidterm) + parseFloat(incFinals)) / 2) <= 3.0
                      ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {(((parseFloat(incMidterm) + parseFloat(incFinals)) / 2)).toFixed(2)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {((parseFloat(incMidterm) + parseFloat(incFinals)) / 2) <= 3.0 ? 'Passed' : 'Failed'}
                  </p>
                </div>
              )}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
