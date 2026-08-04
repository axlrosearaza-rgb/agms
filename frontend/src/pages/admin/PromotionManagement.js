import { useState, useEffect } from 'react';
import { Icons, Avatar, Badge, SearchBar, Modal, LoadingSpinner, ProgramBadge, ProgramDot } from '../../components/common';
import { semesterService } from '../../services';
import API from '../../services/api';
import toast from 'react-hot-toast';

const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];

/**
 * Promotion path:
 *   1st Year 1st Sem → 1st Year 2nd Sem → 2nd Year 1st Sem → 2nd Year 2nd Sem
 *   → 3rd Year 1st Sem → 3rd Year 2nd Sem → 4th Year 1st Sem → 4th Year 2nd Sem → Graduate
 *
 * A student is "Eligible for Promotion" (to next year) only when they are in
 * their year's 2nd semester and passed all subjects.
 *
 * A student is "Eligible for Next Semester" (same year) when they are in 1st semester
 * and passed all subjects.
 *
 * A student is "For Graduation" when they are 4th year 2nd semester and passed all subjects.
 */

function getSemesterLabel(semesterName = '') {
  const lower = semesterName.toLowerCase();
  if (lower.includes('2nd') || lower.includes('second')) return '2nd';
  if (lower.includes('1st') || lower.includes('first')) return '1st';
  return null;
}

function getNextStep(yearLevel, semLabel) {
  if (yearLevel === 4 && semLabel === '2nd') return { label: 'Graduation', isGraduating: true };
  if (semLabel === '1st') return { label: `Year ${yearLevel} — 2nd Semester`, isGraduating: false };
  if (semLabel === '2nd') return { label: `Year ${yearLevel + 1} — 1st Semester`, isGraduating: false };
  return { label: 'Unknown', isGraduating: false };
}

export default function PromotionManagement({ chairpersonMode = false }) {
  const canAct = chairpersonMode;
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [students, setStudents] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [selectedSemester, setSelectedSemester] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [search, setSearch] = useState('');
  const [evaluated, setEvaluated] = useState(false);
  const [viewStudent, setViewStudent] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeTab, setActiveTab] = useState('regular');

  // Derive what semester we're evaluating (1st or 2nd)
  const currentSemLabel = getSemesterLabel(selectedSemester);

  useEffect(() => {
    semesterService.getAll()
      .then(({ data }) => setSemesters(data.semesters || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleEvaluate = async () => {
    if (!selectedSemester) { toast.error('Please select a semester to evaluate'); return; }
    try {
      setEvaluating(true);
      setStudents([]);
      setSelectedIds([]);
      const { data } = await API.get('/promotions/evaluate', {
        params: {
          semester: selectedSemester,
          program: programFilter || undefined,
          year_level: yearFilter || undefined,
        },
      });
      setStudents(data.students || []);
      setEvaluated(true);
      setActiveTab('regular');
      toast.success(`Evaluated ${data.students?.length || 0} students`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to evaluate students');
    } finally {
      setEvaluating(false);
    }
  };

  const handlePromote = async () => {
    if (selectedIds.length === 0) { toast.error('Select at least one student to promote'); return; }

    const actionLabel = currentSemLabel === '1st'
      ? 'move to 2nd Semester'
      : 'promote to the next year level';

    if (!window.confirm(`${actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1)} for ${selectedIds.length} student(s)? This cannot be undone.`)) return;
    try {
      setPromoting(true);
      const { data } = await API.post('/promotions/promote', {
        student_ids: selectedIds,
        semester: selectedSemester,
      });
      toast.success(`Successfully processed ${data.promoted} student(s)!`);
      setSelectedIds([]);
      handleEvaluate();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to promote students');
    } finally {
      setPromoting(false);
    }
  };

  const handleMarkIrregular = async (studentId) => {
    if (!window.confirm('Mark this student as Irregular? Their progress will remain unchanged.')) return;
    try {
      await API.post('/promotions/mark-irregular', { student_id: studentId });
      toast.success('Student marked as Irregular');
      handleEvaluate();
    } catch (err) {
      toast.error('Failed to update student status');
    }
  };

  const handleReleaseGrades = async () => {
    if (selectedIds.length === 0) { toast.error('Select at least one student to release grades for'); return; }
    if (!window.confirm(`Release ${selectedSemester} grades to ${selectedIds.length} student(s)? They will be able to see them immediately.`)) return;
    try {
      setReleasing(true);
      const { data } = await API.post('/promotions/release-grades', {
        student_ids: selectedIds,
        semester: selectedSemester,
      });
      toast.success(data.message);
      setSelectedIds([]);
      handleEvaluate();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to release grades');
    } finally {
      setReleasing(false);
    }
  };

  const toggleSelect = (id) =>
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleSelectSection = (sectionStudents) => {
    const ids = sectionStudents.map(s => s.id);
    const allSelected = ids.every(id => selectedIds.includes(id));
    setSelectedIds(prev => allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  const toggleSelectProgram = (programStudents) => {
    const ids = programStudents.map(s => s.id);
    const allSelected = ids.every(id => selectedIds.includes(id));
    setSelectedIds(prev => allSelected ? prev.filter(id => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  };

  // ── Categorize ──────────────────────────────────────────────────────
  // Graduating: 4th year, 2nd sem, all passed
  const graduatingStudents = students.filter(s =>
    s.promotion_status === 'For Graduation' ||
    (s.year_level === 4 && currentSemLabel === '2nd' && s.promotion_status === 'Eligible')
  );

  // Regular: eligible for next step (not graduating)
  const regularStudents = students.filter(s =>
    (s.promotion_status === 'Eligible' || s.promotion_status === 'For Next Semester') &&
    !graduatingStudents.find(g => g.id === s.id)
  );

  const irregularStudents = students.filter(s => s.promotion_status === 'Failed Subjects');
  const noGradesStudents  = students.filter(s => s.promotion_status === 'No Grades');

  // ── Apply search + filters ───────────────────────────────────────────
  const applyFilters = (list) => list.filter(s => {
    if (programFilter && s.program !== programFilter) return false;
    if (yearFilter && s.year_level !== parseInt(yearFilter)) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name?.toLowerCase().includes(q) || s.student_no?.includes(q);
    }
    return true;
  });

  const filteredRegular    = applyFilters(regularStudents);
  const filteredIrregular  = applyFilters(irregularStudents);
  const filteredNoGrades   = applyFilters(noGradesStudents);
  const filteredGraduating = applyFilters(graduatingStudents);

  // ── Group regular: Program → Year → Section ──────────────────────────
  const groupedRegular = {};
  filteredRegular.forEach(s => {
    const prog = s.program || 'No Program';
    const yr   = `Year ${s.year_level || '?'}`;
    const sec  = s.section || 'No Section';
    if (!groupedRegular[prog]) groupedRegular[prog] = {};
    if (!groupedRegular[prog][yr]) groupedRegular[prog][yr] = {};
    if (!groupedRegular[prog][yr][sec]) groupedRegular[prog][yr][sec] = [];
    groupedRegular[prog][yr][sec].push(s);
  });

  // ── Group irregular: Program → Year ─────────────────────────────────
  const groupedIrregular = {};
  filteredIrregular.forEach(s => {
    const prog = s.program || 'No Program';
    const yr   = `Year ${s.year_level || '?'}`;
    if (!groupedIrregular[prog]) groupedIrregular[prog] = {};
    if (!groupedIrregular[prog][yr]) groupedIrregular[prog][yr] = [];
    groupedIrregular[prog][yr].push(s);
  });

  // ── Group no grades: Program → Year ─────────────────────────────────
  const groupedNoGrades = {};
  filteredNoGrades.forEach(s => {
    const prog = s.program || 'No Program';
    const yr   = `Year ${s.year_level || '?'}`;
    if (!groupedNoGrades[prog]) groupedNoGrades[prog] = {};
    if (!groupedNoGrades[prog][yr]) groupedNoGrades[prog][yr] = [];
    groupedNoGrades[prog][yr].push(s);
  });

  // ── Group graduating: Program ─────────────────────────────────────────
  const groupedGraduating = {};
  filteredGraduating.forEach(s => {
    const prog = s.program || 'No Program';
    if (!groupedGraduating[prog]) groupedGraduating[prog] = [];
    groupedGraduating[prog].push(s);
  });

  // ── Promote button label based on semester ──────────────────────────
  const promoteLabel = currentSemLabel === '1st'
    ? 'Advance to 2nd Semester'
    : 'Promote to Next Year';

  if (loading) return <LoadingSpinner />;

  // ── Semester flow stepper data ────────────────────────────────────────
  const semesterSteps = [
    { label: '1st Year', sems: ['1st Sem', '2nd Sem'] },
    { label: '2nd Year', sems: ['1st Sem', '2nd Sem'] },
    { label: '3rd Year', sems: ['1st Sem', '2nd Sem'] },
    { label: '4th Year', sems: ['1st Sem', '2nd Sem'] },
  ];

  return (
    <>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Promotion Management</h2>
          <p className="text-[13px] text-gray-500">
            {chairpersonMode
              ? 'Evaluate, endorse, and advance students in your program'
              : 'Read-only summary — promotion actions are handled by each program’s Chairperson'}
          </p>
        </div>
        {canAct && evaluated && selectedIds.length > 0 && (
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={handleReleaseGrades} disabled={releasing}>
              {releasing
                ? <><span className="inline-block w-4 h-4 border-2 border-navy/30 border-t-navy rounded-full animate-spin mr-2" />Releasing...</>
                : <><Icons.Send className="w-4 h-4" /> Release Grades ({selectedIds.length})</>
              }
            </button>
            <button className="btn btn-gold" onClick={handlePromote} disabled={promoting}>
              {promoting
                ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Processing...</>
                : <><Icons.Check className="w-4 h-4" /> {promoteLabel} ({selectedIds.length})</>
              }
            </button>
          </div>
        )}
      </div>

      {/* ── Promotion Pathway Info ─────────────────────────────────────── */}
      <div className="card mb-5 bg-navy/5 border border-navy/10">
        <div className="card-body py-4">
          <p className="text-[11px] font-semibold text-navy uppercase tracking-wide mb-3">Promotion Pathway</p>
          <div className="flex flex-wrap items-center gap-0">
            {semesterSteps.map((yr, yi) =>
              yr.sems.map((sem, si) => {
                const isLast = yi === 3 && si === 1;
                return (
                  <div key={`${yi}-${si}`} className="flex items-center">
                    <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg text-center ${isLast ? 'bg-purple-100 border border-purple-200' : 'bg-white border border-gray-200'}`}>
                      <span className="text-[10px] font-bold text-gray-400">{yr.label}</span>
                      <span className={`text-[11px] font-semibold mt-0.5 ${isLast ? 'text-purple-700' : 'text-navy'}`}>{sem}</span>
                    </div>
                    {!(yi === 3 && si === 1) && (
                      <div className={`flex items-center mx-1 ${si === 1 ? 'text-gold' : 'text-gray-300'}`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {si === 1 && <span className="text-[9px] font-bold text-gold -ml-1 mr-1">YR</span>}
                      </div>
                    )}
                    {yi === 3 && si === 1 && (
                      <div className="flex items-center ml-2">
                        <span className="text-[11px] font-bold text-purple-600 bg-purple-100 border border-purple-200 px-2 py-1 rounded-lg">🎓 Graduate</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            <span className="text-gold font-bold">YR</span> = Year promotion · Students must pass each semester to advance to the next step
          </p>
        </div>
      </div>

      {/* ── Step 1: Configure ─────────────────────────────────────────── */}
      <div className="card mb-5">
        <div className="card-header">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 bg-navy text-white rounded-full text-xs font-bold flex items-center justify-center">1</span>
            <h3 className="text-base font-semibold text-navy">Select Evaluation Period</h3>
          </div>
          <p className="text-xs text-gray-400 mt-1 ml-8">
            Choose the semester. For 1st semester results: students advance to 2nd semester. For 2nd semester results: students promote to the next year level.
          </p>
        </div>
        <div className="card-body">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="form-label">Semester <span className="text-red-500">*</span></label>
              <select className="form-select" value={selectedSemester} onChange={e => { setSelectedSemester(e.target.value); setEvaluated(false); setStudents([]); setSelectedIds([]); }}>
                <option value="">Select Semester</option>
                {semesters.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>

            {selectedSemester && currentSemLabel && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${currentSemLabel === '2nd' ? 'bg-gold/10 border-gold/30 text-gold' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                {currentSemLabel === '2nd'
                  ? <><Icons.Award className="w-3.5 h-3.5" /> Year Promotion Semester</>
                  : <><Icons.Flag className="w-3.5 h-3.5" /> Semester Advancement</>
                }
              </div>
            )}

            <div className="flex-1 min-w-[200px]">
              <label className="form-label">Program (optional)</label>
              <select className="form-select" value={programFilter} onChange={e => setProgramFilter(e.target.value)}>
                <option value="">All Programs</option>
                {PROGRAMS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="min-w-[140px]">
              <label className="form-label">Year Level (optional)</label>
              <select className="form-select" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
                <option value="">All Years</option>
                {[1, 2, 3, 4].map(y => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <button className="btn btn-gold mb-0.5" onClick={handleEvaluate} disabled={!selectedSemester || evaluating}>
              {evaluating
                ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Evaluating...</>
                : <><Icons.Search className="w-4 h-4" /> Evaluate Students</>
              }
            </button>
          </div>
        </div>
      </div>

      {/* ── Results ──────────────────────────────────────────────────── */}
      {evaluated && (
        <>
          {/* Step 2: Summary */}
          <div className="card mb-5">
            <div className="card-header">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 bg-navy text-white rounded-full text-xs font-bold flex items-center justify-center">2</span>
                <h3 className="text-base font-semibold text-navy">Evaluation Results — {selectedSemester}</h3>
              </div>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Regular / Eligible */}
                <div
                  onClick={() => setActiveTab('regular')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'regular' ? 'bg-green-100 border-green-400 ring-2 ring-green-300' : 'bg-green-50 border-green-100 hover:border-green-300'}`}
                >
                  <p className="text-2xl font-bold text-green-600">{regularStudents.length}</p>
                  <p className="text-xs text-green-700 font-medium mt-1">
                    {currentSemLabel === '1st' ? 'Advance to 2nd Sem' : 'Promote to Next Year'}
                  </p>
                  <p className="text-[10px] text-green-500 mt-0.5">All subjects passed</p>
                </div>

                {/* Irregular */}
                <div
                  onClick={() => setActiveTab('irregular')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'irregular' ? 'bg-red-100 border-red-400 ring-2 ring-red-300' : 'bg-red-50 border-red-100 hover:border-red-300'}`}
                >
                  <p className="text-2xl font-bold text-red-500">{irregularStudents.length}</p>
                  <p className="text-xs text-red-700 font-medium mt-1">Irregular Students</p>
                  <p className="text-[10px] text-red-400 mt-0.5">Has failed subjects</p>
                </div>

                {/* No Grades */}
                <div
                  onClick={() => setActiveTab('no-grades')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'no-grades' ? 'bg-amber-100 border-amber-400 ring-2 ring-amber-300' : 'bg-amber-50 border-amber-100 hover:border-amber-300'}`}
                >
                  <p className="text-2xl font-bold text-amber-600">{noGradesStudents.length}</p>
                  <p className="text-xs text-amber-700 font-medium mt-1">No Grades Yet</p>
                  <p className="text-[10px] text-amber-500 mt-0.5">Grades not submitted</p>
                </div>

                {/* Graduating */}
                <div
                  onClick={() => setActiveTab('graduating')}
                  className={`rounded-xl p-4 text-center border cursor-pointer transition-all ${activeTab === 'graduating' ? 'bg-purple-100 border-purple-400 ring-2 ring-purple-300' : 'bg-purple-50 border-purple-100 hover:border-purple-300'}`}
                >
                  <p className="text-2xl font-bold text-purple-600">{graduatingStudents.length}</p>
                  <p className="text-xs text-purple-700 font-medium mt-1">For Graduation</p>
                  <p className="text-[10px] text-purple-400 mt-0.5">4th Year, 2nd Sem · All passed</p>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">
                Click a card to switch view · {students.length} total students evaluated
              </p>
            </div>
          </div>

          {/* Step 3: Review */}
          <div className="card mb-5">
            <div className="card-header border-b border-gray-100">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 bg-navy text-white rounded-full text-xs font-bold flex items-center justify-center">3</span>
                  <h3 className="text-base font-semibold text-navy">Review & Process Students</h3>
                </div>
                <SearchBar value={search} onChange={setSearch} placeholder="Search by name or student no..." />
              </div>

              {/* Tabs */}
              <div className="flex gap-0 border-b-2 border-gray-200 mt-4 -mx-5 px-5 overflow-x-auto">
                {/* Regular tab */}
                <button
                  onClick={() => setActiveTab('regular')}
                  className={`px-4 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all flex items-center gap-2 whitespace-nowrap
                    ${activeTab === 'regular' ? 'text-navy border-navy font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
                >
                  <span className="w-5 h-5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold flex items-center justify-center">
                    {regularStudents.length}
                  </span>
                  {currentSemLabel === '1st' ? '2nd Sem Eligible' : 'Year Promotion'}
                  {selectedIds.length > 0 && activeTab === 'regular' && (
                    <span className="text-[10px] bg-gold text-white px-1.5 py-0.5 rounded-full font-bold">
                      {selectedIds.length} selected
                    </span>
                  )}
                </button>

                {/* Irregular tab */}
                <button
                  onClick={() => setActiveTab('irregular')}
                  className={`px-4 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all flex items-center gap-2 whitespace-nowrap
                    ${activeTab === 'irregular' ? 'text-red-600 border-red-500 font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
                >
                  <span className="w-5 h-5 rounded-full bg-red-100 text-red-600 text-[10px] font-bold flex items-center justify-center">
                    {irregularStudents.length}
                  </span>
                  Irregular
                </button>

                {/* No Grades tab */}
                <button
                  onClick={() => setActiveTab('no-grades')}
                  className={`px-4 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all flex items-center gap-2 whitespace-nowrap
                    ${activeTab === 'no-grades' ? 'text-amber-600 border-amber-500 font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
                >
                  <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-600 text-[10px] font-bold flex items-center justify-center">
                    {noGradesStudents.length}
                  </span>
                  No Grades
                </button>

                {/* Graduating tab */}
                <button
                  onClick={() => setActiveTab('graduating')}
                  className={`px-4 py-2.5 text-sm font-medium cursor-pointer border-none bg-transparent font-sans border-b-2 -mb-[2px] transition-all flex items-center gap-2 whitespace-nowrap
                    ${activeTab === 'graduating' ? 'text-purple-600 border-purple-500 font-semibold' : 'text-gray-500 border-transparent hover:text-gray-700'}`}
                >
                  <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-600 text-[10px] font-bold flex items-center justify-center">
                    {graduatingStudents.length}
                  </span>
                  Graduating 🎓
                </button>
              </div>
            </div>

            {/* ══ REGULAR TAB ══════════════════════════════════════════════ */}
            {activeTab === 'regular' && (
              <div className="p-5">
                {/* Context banner */}
                {currentSemLabel && (
                  <div className={`flex items-start gap-3 px-4 py-3 rounded-xl mb-5 border ${currentSemLabel === '2nd' ? 'bg-gold/10 border-gold/30' : 'bg-blue-50 border-blue-200'}`}>
                    <Icons.Flag className={`w-4 h-4 mt-0.5 flex-shrink-0 ${currentSemLabel === '2nd' ? 'text-gold' : 'text-blue-500'}`} />
                    <div>
                      <p className={`text-sm font-semibold ${currentSemLabel === '2nd' ? 'text-amber-800' : 'text-blue-800'}`}>
                        {currentSemLabel === '1st'
                          ? 'Advancing students from 1st Semester → 2nd Semester (same year level)'
                          : 'Promoting students from 2nd Semester → Next Year Level'}
                      </p>
                      <p className={`text-xs mt-0.5 ${currentSemLabel === '2nd' ? 'text-amber-700' : 'text-blue-600'}`}>
                        {currentSemLabel === '1st'
                          ? 'These students passed all 1st semester subjects and are eligible to enroll in 2nd semester courses.'
                          : 'These students passed all 2nd semester subjects and are eligible for year-level promotion. 4th year students will be marked For Graduation.'}
                      </p>
                    </div>
                  </div>
                )}

                {filteredRegular.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Users className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No eligible students found</p>
                    <p className="text-sm mt-1">Try adjusting your filters</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {Object.entries(groupedRegular).sort().map(([program, yearGroups]) => {
                      const programStudents = Object.values(yearGroups).flatMap(yr => Object.values(yr).flat());
                      const allProgramSelected = programStudents.every(s => selectedIds.includes(s.id));

                      return (
                        <div key={program} className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-navy text-white flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <Icons.Award className="w-4 h-4 text-gold opacity-90" />
                              <div>
                                <h4 className="text-sm font-semibold flex items-center gap-1.5"><ProgramDot program={program} />{program}</h4>
                                <p className="text-[11px] opacity-60">{programStudents.length} students eligible</p>
                              </div>
                            </div>
                            <button
                              onClick={() => toggleSelectProgram(programStudents)}
                              className="text-xs text-white/70 hover:text-white border border-white/20 hover:border-white/60 px-3 py-1.5 rounded-lg bg-transparent cursor-pointer font-sans transition-all"
                            >
                              {allProgramSelected ? '− Deselect All' : '+ Select All Program'}
                            </button>
                          </div>

                          {Object.entries(yearGroups).sort().map(([year, sections]) => {
                            const totalInYear = Object.values(sections).reduce((t, s) => t + s.length, 0);
                            const yearNum = parseInt(year.replace('Year ', ''));
                            const { label: nextStepLabel } = getNextStep(yearNum, currentSemLabel);

                            return (
                              <div key={year} className="border-t border-gray-100">
                                <div className="px-5 py-2.5 bg-blue-50/60 flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Icons.Flag className="w-3.5 h-3.5 text-blue-500" />
                                    <span className="text-sm font-semibold text-blue-800">{year}</span>
                                    <span className="text-[11px] text-gray-400">
                                      · {totalInYear} students · {Object.keys(sections).length} section{Object.keys(sections).length > 1 ? 's' : ''}
                                    </span>
                                  </div>
                                  <span className="text-[11px] text-blue-600 font-semibold bg-blue-100 px-2.5 py-1 rounded-full">
                                    → {nextStepLabel}
                                  </span>
                                </div>

                                {Object.entries(sections).sort().map(([section, sectionStudents]) => {
                                  const sectionIds = sectionStudents.map(s => s.id);
                                  const allSectionSelected = sectionIds.every(id => selectedIds.includes(id));

                                  return (
                                    <div key={section} className="border-t border-gray-100">
                                      <div className="px-6 py-2 bg-white flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="w-6 h-6 bg-gold/20 text-gold rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0">
                                            {section === 'No Section' ? '?' : section.charAt(0)}
                                          </span>
                                          <span className="text-sm font-semibold text-gray-700">
                                            {section === 'No Section' ? 'No Section Assigned' : `Section ${section}`}
                                          </span>
                                          <Badge variant="blue">{sectionStudents.length} students</Badge>
                                        </div>
                                        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
                                          <input
                                            type="checkbox"
                                            className="accent-gold"
                                            checked={allSectionSelected}
                                            onChange={() => toggleSelectSection(sectionStudents)}
                                          />
                                          {allSectionSelected ? 'Deselect Section' : 'Select Section'}
                                        </label>
                                      </div>

                                      <table className="w-full">
                                        <thead>
                                          <tr className="bg-gray-50/80">
                                            <th className="w-10 px-4 py-2" />
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Subjects Passed</th>
                                            {chairpersonMode && <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Endorsement</th>}
                                            <th className="text-left px-4 py-2 text-[11px] font-semibold uppercase text-gray-400">Next Step</th>
                                            <th className="w-10 px-4 py-2" />
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {sectionStudents.sort((a, b) => a.name.localeCompare(b.name)).map(s => {
                                            const isSelected = selectedIds.includes(s.id);
                                            const { label: nextStep } = getNextStep(s.year_level, currentSemLabel);
                                            return (
                                              <tr
                                                key={s.id}
                                                className={`border-b border-gray-50 transition-colors ${isSelected ? 'bg-green-50/70' : 'hover:bg-gray-50/40'}`}
                                              >
                                                <td className="px-4 py-2.5 text-center">
                                                  <input
                                                    type="checkbox"
                                                    className="accent-gold"
                                                    checked={isSelected}
                                                    onChange={() => toggleSelect(s.id)}
                                                  />
                                                </td>
                                                <td className="px-4 py-2.5">
                                                  <div className="flex items-center gap-2">
                                                    <Avatar letter={s.avatar || s.name?.[0]} className="bg-green-500 text-white" size="w-7 h-7 text-xs" />
                                                    <span className="text-[13px] font-medium">{s.name}</span>
                                                  </div>
                                                </td>
                                                <td className="px-4 py-2.5 text-sm text-gray-500">{s.student_no}</td>
                                                <td className="px-4 py-2.5">
                                                  <span className={`font-bold text-sm ${parseFloat(s.gwa) <= 3.0 ? 'text-green-600' : 'text-gray-400'}`}>
                                                    {s.gwa || 'N/A'}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-sm">
                                                  <span className="text-green-600 font-semibold">{s.passed_count}</span>
                                                  <span className="text-gray-400 text-xs ml-1">subjects</span>
                                                </td>
                                                {chairpersonMode && (
                                                  <td className="px-4 py-2.5">
                                                    {s.endorsement_status === 'Endorsed' && <Badge variant="green"><Icons.Check className="w-3 h-3" /> Endorsed</Badge>}
                                                    {s.endorsement_status === 'Flagged' && <Badge variant="red"><Icons.Flag className="w-3 h-3" /> Flagged</Badge>}
                                                    {!s.endorsement_status && <Badge variant="yellow"><Icons.Clock className="w-3 h-3" /> Not Endorsed</Badge>}
                                                  </td>
                                                )}
                                                <td className="px-4 py-2.5">
                                                  <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                                    → {nextStep}
                                                  </span>
                                                </td>
                                                <td className="px-4 py-2.5">
                                                  <button className="btn-icon" onClick={() => setViewStudent(s)} title="View grades">
                                                    <Icons.Eye />
                                                  </button>
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}

                {filteredRegular.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
                    <p className="text-sm text-gray-500">
                      <span className="font-semibold text-navy">{selectedIds.length}</span> of{' '}
                      <span className="font-semibold">{regularStudents.length}</span> eligible students selected
                    </p>
                    {canAct && (
                      <div className="flex gap-2">
                        <button
                          className="btn btn-outline"
                          onClick={handleReleaseGrades}
                          disabled={selectedIds.length === 0 || releasing}
                        >
                          {releasing
                            ? <><span className="inline-block w-4 h-4 border-2 border-navy/30 border-t-navy rounded-full animate-spin mr-2" />Releasing...</>
                            : <><Icons.Send className="w-4 h-4" /> Release Grades</>
                          }
                        </button>
                        <button
                          className="btn btn-gold"
                          onClick={handlePromote}
                          disabled={selectedIds.length === 0 || promoting}
                        >
                          {promoting
                            ? <><span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />Processing...</>
                            : <><Icons.Check className="w-4 h-4" /> {selectedIds.length > 0 ? `${promoteLabel} (${selectedIds.length})` : 'Select Students'}</>
                          }
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ══ IRREGULAR TAB ════════════════════════════════════════════ */}
            {activeTab === 'irregular' && (
              <div className="p-5">
                {filteredIrregular.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Check className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No irregular students</p>
                    <p className="text-sm mt-1">All students passed their subjects!</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-red-50 border border-red-200 rounded-xl mb-5">
                      <Icons.AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-red-700">
                          {irregularStudents.length} student{irregularStudents.length > 1 ? 's' : ''} failed one or more subjects
                        </p>
                        <p className="text-xs text-red-500 mt-0.5">
                          They must re-enroll in failed subjects alongside eligible subjects from the next semester.
                          Click <strong>Mark Irregular</strong> to officially record their status.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {Object.entries(groupedIrregular).sort().map(([program, yearGroups]) => (
                        <div key={program} className="border border-red-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-red-600 text-white flex items-center gap-3">
                            <Icons.Flag className="w-4 h-4 opacity-80" />
                            <div>
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">
                                {Object.values(yearGroups).reduce((t, yr) => t + yr.length, 0)} irregular students
                              </p>
                            </div>
                          </div>

                          {Object.entries(yearGroups).sort().map(([year, yearStudents]) => (
                            <div key={year} className="border-t border-red-100">
                              <div className="px-5 py-2.5 bg-red-50/70 flex items-center gap-2">
                                <Icons.Flag className="w-3.5 h-3.5 text-red-400" />
                                <span className="text-sm font-semibold text-red-700">{year}</span>
                                <span className="text-[11px] text-gray-400">· {yearStudents.length} students · stays at {year}</span>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Failed Subjects</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Passed</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {yearStudents.sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                                      <tr key={s.id} className="border-b border-gray-50 hover:bg-red-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-2.5">
                                            <Avatar letter={s.avatar || s.name?.[0]} className="bg-red-400 text-white" size="w-8 h-8 text-xs" />
                                            <span className="text-[13px] font-semibold">{s.name}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                        <td className="px-4 py-3">
                                          {s.section
                                            ? <Badge variant="blue">Section {s.section}</Badge>
                                            : <span className="text-gray-400 text-xs">—</span>
                                          }
                                        </td>
                                        <td className="px-4 py-3">
                                          <span className="font-bold text-sm text-red-500">{s.gwa || 'N/A'}</span>
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="flex flex-wrap gap-1">
                                            {(s.grades || []).filter(g => g.status === 'Failed').map((g, i) => (
                                              <span key={i} className="text-[11px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold">
                                                {g.subject_code}
                                              </span>
                                            ))}
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                          <span className="text-green-600 font-semibold">{s.passed_count}</span>
                                          <span className="text-gray-400 text-xs ml-1">subj</span>
                                        </td>
                                        <td className="px-4 py-3">
                                          <div className="flex gap-1.5">
                                            <button className="btn-icon" onClick={() => setViewStudent(s)} title="View all grades">
                                              <Icons.Eye />
                                            </button>
                                            {canAct && (
                                              <button
                                                onClick={() => handleMarkIrregular(s.id)}
                                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg border-none cursor-pointer font-sans font-medium transition-colors"
                                              >
                                                <Icons.Flag className="w-3 h-3" /> Mark Irregular
                                              </button>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══ NO GRADES TAB ════════════════════════════════════════════ */}
            {activeTab === 'no-grades' && (
              <div className="p-5">
                {filteredNoGrades.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Check className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">All students have grades submitted</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-xl mb-5">
                      <Icons.AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-amber-800">
                          {noGradesStudents.length} student{noGradesStudents.length > 1 ? 's' : ''} have no submitted grades for this semester
                        </p>
                        <p className="text-xs text-amber-600 mt-0.5">
                          These students cannot be evaluated for promotion until their faculty submit grades.
                          Please follow up with the concerned instructors.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {Object.entries(groupedNoGrades).sort().map(([program, yearGroups]) => (
                        <div key={program} className="border border-amber-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-amber-500 text-white flex items-center gap-3">
                            <Icons.Flag className="w-4 h-4 opacity-80" />
                            <div>
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">
                                {Object.values(yearGroups).reduce((t, yr) => t + yr.length, 0)} students without grades
                              </p>
                            </div>
                          </div>

                          {Object.entries(yearGroups).sort().map(([year, yearStudents]) => (
                            <div key={year} className="border-t border-amber-100">
                              <div className="px-5 py-2.5 bg-amber-50/70 flex items-center gap-2">
                                <Icons.Flag className="w-3.5 h-3.5 text-amber-400" />
                                <span className="text-sm font-semibold text-amber-800">{year}</span>
                                <span className="text-[11px] text-gray-400">· {yearStudents.length} students · pending grade submission</span>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-100">
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Program</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Status</th>
                                      <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {yearStudents.sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                                      <tr key={s.id} className="border-b border-gray-50 hover:bg-amber-50/30 transition-colors">
                                        <td className="px-4 py-3">
                                          <div className="flex items-center gap-2.5">
                                            <Avatar letter={s.avatar || s.name?.[0]} className="bg-amber-400 text-white" size="w-8 h-8 text-xs" />
                                            <span className="text-[13px] font-semibold">{s.name}</span>
                                          </div>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                        <td className="px-4 py-3">
                                          {s.section
                                            ? <Badge variant="blue">Section {s.section}</Badge>
                                            : <span className="text-gray-400 text-xs">—</span>
                                          }
                                        </td>
                                        <td className="px-4 py-3">
                                          {s.program ? <ProgramBadge program={s.program} /> : <span className="text-xs text-gray-600">—</span>}
                                        </td>
                                        <td className="px-4 py-3">
                                          <Badge variant="yellow">No Grades Submitted</Badge>
                                        </td>
                                        <td className="px-4 py-3">
                                          <button className="btn-icon" onClick={() => setViewStudent(s)} title="View student details">
                                            <Icons.Eye />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══ GRADUATING TAB ═══════════════════════════════════════════ */}
            {activeTab === 'graduating' && (
              <div className="p-5">
                {filteredGraduating.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Icons.Award className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No graduating students</p>
                    <p className="text-sm mt-1">
                      {currentSemLabel !== '2nd'
                        ? 'Graduating students only appear during 2nd semester evaluation.'
                        : 'No 4th year students with all subjects passed found.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-3 px-4 py-3.5 bg-purple-50 border border-purple-200 rounded-xl mb-5">
                      <Icons.Award className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-semibold text-purple-800">
                          🎓 {graduatingStudents.length} student{graduatingStudents.length > 1 ? 's' : ''} eligible for graduation
                        </p>
                        <p className="text-xs text-purple-600 mt-0.5">
                          These are 4th year students who have passed all subjects in their final semester.
                          Process their graduation clearance and mark them as graduated.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-5">
                      {Object.entries(groupedGraduating).sort().map(([program, progStudents]) => (
                        <div key={program} className="border border-purple-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="px-5 py-3.5 bg-purple-700 text-white flex items-center gap-3">
                            <Icons.Award className="w-4 h-4 opacity-90" />
                            <div>
                              <h4 className="text-sm font-semibold">{program}</h4>
                              <p className="text-[11px] opacity-70">{progStudents.length} graduating students</p>
                            </div>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full">
                              <thead>
                                <tr className="bg-purple-50/50 border-b border-purple-100">
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Student No.</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Section</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">GWA</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Subjects Passed</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Status</th>
                                  <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase text-gray-400">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {progStudents.sort((a, b) => a.name.localeCompare(b.name)).map(s => (
                                  <tr key={s.id} className="border-b border-gray-50 hover:bg-purple-50/30 transition-colors">
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2.5">
                                        <Avatar letter={s.avatar || s.name?.[0]} className="bg-purple-500 text-white" size="w-8 h-8 text-xs" />
                                        <div>
                                          <span className="text-[13px] font-semibold">{s.name}</span>
                                          <p className="text-[10px] text-purple-500 font-medium">4th Year · Final Semester</p>
                                        </div>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-500">{s.student_no}</td>
                                    <td className="px-4 py-3">
                                      {s.section
                                        ? <Badge variant="blue">Section {s.section}</Badge>
                                        : <span className="text-gray-400 text-xs">—</span>
                                      }
                                    </td>
                                    <td className="px-4 py-3">
                                      <span className={`font-bold text-sm ${parseFloat(s.gwa) <= 3.0 ? 'text-green-600' : 'text-gray-400'}`}>
                                        {s.gwa || 'N/A'}
                                      </span>
                                    </td>
                                    <td className="px-4 py-3 text-sm">
                                      <span className="text-green-600 font-semibold">{s.passed_count}</span>
                                      <span className="text-gray-400 text-xs ml-1">subjects</span>
                                    </td>
                                    <td className="px-4 py-3">
                                      <Badge variant="purple"><Icons.Award className="w-3 h-3" /> For Graduation</Badge>
                                    </td>
                                    <td className="px-4 py-3">
                                      <button className="btn-icon" onClick={() => setViewStudent(s)} title="View grades">
                                        <Icons.Eye />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
                      <p className="text-sm text-gray-500">
                        <span className="font-semibold text-purple-700">{filteredGraduating.length}</span> student{filteredGraduating.length !== 1 ? 's' : ''} ready for graduation processing
                      </p>
                      <p className="text-xs text-gray-400">Process graduation clearance through the Graduation module</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Grade Detail Modal ─────────────────────────────────────────── */}
      {viewStudent && (
        <Modal
          title={`${viewStudent.name} — Grade Detail`}
          onClose={() => setViewStudent(null)}
          size="max-w-2xl"
          footer={<button className="btn btn-outline" onClick={() => setViewStudent(null)}>Close</button>}
        >
          <div className="grid grid-cols-2 gap-3 text-sm mb-5">
            <div><span className="text-gray-500">Program:</span> <span className="ml-1">{viewStudent.program ? <ProgramBadge program={viewStudent.program} /> : '—'}</span></div>
            <div><span className="text-gray-500">Student No:</span> <span className="font-medium ml-1">{viewStudent.student_no}</span></div>
            <div><span className="text-gray-500">Year Level:</span> <span className="font-medium ml-1">Year {viewStudent.year_level}</span></div>
            <div><span className="text-gray-500">Section:</span> <span className="font-medium ml-1">{viewStudent.section ? `Section ${viewStudent.section}` : '—'}</span></div>
            <div>
              <span className="text-gray-500">GWA:</span>
              <span className={`font-bold ml-1 ${parseFloat(viewStudent.gwa) <= 3.0 ? 'text-green-600' : 'text-red-500'}`}>
                {viewStudent.gwa || 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Status:</span>
              <span className="ml-1">
                {(viewStudent.promotion_status === 'Eligible' || viewStudent.promotion_status === 'For Next Semester') &&
                  viewStudent.year_level !== 4 && (
                  <Badge variant="green">
                    {currentSemLabel === '1st' ? 'Advance to 2nd Semester' : 'Eligible for Promotion'}
                  </Badge>
                )}
                {viewStudent.promotion_status === 'Failed Subjects' && <Badge variant="red">Failed Subjects</Badge>}
                {(viewStudent.promotion_status === 'For Graduation' || (viewStudent.year_level === 4 && viewStudent.promotion_status === 'Eligible')) && (
                  <Badge variant="purple">For Graduation</Badge>
                )}
                {viewStudent.promotion_status === 'No Grades' && <Badge variant="yellow">No Grades Yet</Badge>}
              </span>
            </div>
          </div>

          <h4 className="font-semibold text-navy mb-3 text-sm">Subjects This Semester</h4>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Subject</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Midterm</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Finals</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Average</th>
                  <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {(viewStudent.grades || []).map((g, i) => (
                  <tr key={i} className={`border-t border-gray-50 ${g.status === 'Failed' ? 'bg-red-50/50' : ''}`}>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{g.subject_code}</p>
                      <p className="text-xs text-gray-400">{g.subject_name}</p>
                    </td>
                    <td className="px-3 py-2.5 text-center font-semibold">{g.midterm ? parseFloat(g.midterm).toFixed(2) : '—'}</td>
                    <td className="px-3 py-2.5 text-center font-semibold">{g.finals ? parseFloat(g.finals).toFixed(2) : '—'}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`font-bold ${g.status === 'Passed' ? 'text-green-600' : 'text-red-500'}`}>
                        {g.average ? parseFloat(g.average).toFixed(2) : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Badge variant={g.status === 'Passed' ? 'green' : 'red'}>{g.status}</Badge>
                    </td>
                  </tr>
                ))}
                {(!viewStudent.grades || viewStudent.grades.length === 0) && (
                  <tr><td colSpan="5" className="text-center py-6 text-gray-400 text-xs">No submitted grades found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </>
  );
}