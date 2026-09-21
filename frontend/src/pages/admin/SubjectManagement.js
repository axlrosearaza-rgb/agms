import { useState, useEffect, useCallback } from 'react';
import { Icons, Badge, SearchBar, Modal, LoadingSpinner, StatCard, ProgramBadge, ConfirmDialog } from '../../components/common';
import { subjectService } from '../../services';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';

const DEPARTMENTS = ['Information Technology', 'Information Systems', 'Psychology', 'Statistics'];
const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];
// Subjects store the short department name; programs store the full name —
// same 4 programs, two spellings, kept in sync when Admin edits Program.
const PROGRAM_DEPARTMENT = {
  'Bachelor of Science in Information Technology': 'Information Technology',
  'Bachelor of Science in Information Systems': 'Information Systems',
  'Bachelor of Science in Psychology': 'Psychology',
  'Bachelor of Science in Statistics': 'Statistics',
};
const SEMESTERS = ['1st Semester', '2nd Semester', 'Summer'];
// Curriculum-checklist ordering — "Summer" always last, not alphabetical.
const SEMESTER_ORDER = { '1st Semester': 0, '2nd Semester': 1, 'Summer': 2 };
const YEAR_LABEL = { 1: 'FIRST YEAR', 2: 'SECOND YEAR', 3: 'THIRD YEAR', 4: 'FOURTH YEAR' };

export default function SubjectManagement() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  // Search/filter/expanded groups persist across navigation (usePageState) —
  // clicking to another page and back no longer collapses everything or
  // clears what you'd searched for.
  const [search, setSearch] = usePageState('SubjectManagement.search', '');
  const [deptFilter, setDeptFilter] = usePageState('SubjectManagement.deptFilter', '');
  const [viewSubject, setViewSubject] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editSubject, setEditSubject] = useState(null);
  const [formData, setFormData] = useState(null);
  const [saving, setSaving] = useState(false);
  const [prereqSearch, setPrereqSearch] = useState('');
  const [coreqSearch, setCoreqSearch] = useState('');
  // All 4 programs' full curriculum at once made this page unusably long fully
  // expanded — collapsed by default, toggled per Program/Year key, same pattern
  // as the Chairperson/Faculty Subjects page's Year/Semester accordion.
  const [expanded, setExpanded] = usePageState('SubjectManagement.expanded', {});
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadSubjects = useCallback(async () => {
    try {
      setLoading(true);
      const params = {};
      if (search) params.search = search;
      if (deptFilter) params.department = deptFilter;
      const { data } = await subjectService.getAll(params);
      setSubjects(data.subjects || []);
    } catch (err) {
      toast.error('Failed to load subjects');
    } finally {
      setLoading(false);
    }
  }, [search, deptFilter]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  const handleDelete = async () => {
    const sub = deleteTarget;
    if (!sub) return;
    try {
      await subjectService.delete(sub.id);
      toast.success('Subject deleted');
      setDeleteTarget(null);
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete subject');
    }
  };

  const openEdit = (s) => {
    setEditSubject(s);
    setFormData({
      code: s.code || '',
      name: s.name || '',
      department: s.department || '',
      program: s.program || '',
      year_level: s.year_level || 1,
      semester: s.semester || '1st Semester',
      lecture_hours: s.lecture_hours ?? 0,
      lecture_units: s.lecture_units ?? 0,
      lab_hours: s.lab_hours ?? 0,
      lab_units: s.lab_units ?? 0,
      total_hours: s.total_hours ?? '',
      units: s.units ?? 3,
      prerequisite_ids: (s.prerequisites || []).map((p) => p.id),
      co_requisite_ids: (s.co_requisites || []).map((p) => p.id),
      prerequisite_note: s.prerequisite_note || '',
    });
    setPrereqSearch('');
    setCoreqSearch('');
    setShowModal(true);
  };

  const togglePrereq = (id) => {
    setFormData((prev) => {
      const has = prev.prerequisite_ids.includes(id);
      return { ...prev, prerequisite_ids: has ? prev.prerequisite_ids.filter((x) => x !== id) : [...prev.prerequisite_ids, id] };
    });
  };

  const toggleCoreq = (id) => {
    setFormData((prev) => {
      const has = prev.co_requisite_ids.includes(id);
      return { ...prev, co_requisite_ids: has ? prev.co_requisite_ids.filter((x) => x !== id) : [...prev.co_requisite_ids, id] };
    });
  };

  const handleProgramChange = (program) => {
    setFormData((prev) => ({ ...prev, program, department: PROGRAM_DEPARTMENT[program] || prev.department }));
  };

  const handleSave = async () => {
    if (!formData.code || !formData.name || !formData.program) {
      toast.error('Code, name, and program are required');
      return;
    }
    if (!formData.units || formData.units < 1 || formData.units > 6) {
      toast.error('Total Units must be between 1 and 6');
      return;
    }
    try {
      setSaving(true);
      const payload = { ...formData, total_hours: formData.total_hours === '' ? null : formData.total_hours };
      await subjectService.update(editSubject.id, payload);
      toast.success('Subject updated');
      setShowModal(false);
      setEditSubject(null);
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save subject');
    } finally {
      setSaving(false);
    }
  };

  const totalUnits = subjects.reduce((s, sub) => s + (sub.units || 0), 0);
  const departments = [...new Set(subjects.map(s => s.department))];

  // Group into the curriculum-checklist sequence: Program -> Year -> Semester,
  // with anything missing Year/Semester parked in "Unassigned" per program.
  const grouped = {};
  const unassigned = {};
  subjects.forEach((s) => {
    const prog = s.program || 'No Program';
    if (!s.year_level || !s.semester) {
      if (!unassigned[prog]) unassigned[prog] = [];
      unassigned[prog].push(s);
      return;
    }
    if (!grouped[prog]) grouped[prog] = {};
    if (!grouped[prog][s.year_level]) grouped[prog][s.year_level] = {};
    if (!grouped[prog][s.year_level][s.semester]) grouped[prog][s.year_level][s.semester] = [];
    grouped[prog][s.year_level][s.semester].push(s);
  });
  const programs = Object.keys(grouped).sort();

  // Total Hours is its own value (not derived) — falls back to Lecture+Lab only
  // for legacy rows that predate the standalone Total field.
  const totalHrsOf = (s) => s.total_hours ?? ((s.lecture_hours ?? s.lab_hours) != null ? (s.lecture_hours || 0) + (s.lab_hours || 0) : null);

  const prereqOptions = subjects.filter((s) => !editSubject || s.id !== editSubject.id);
  const prereqFiltered = prereqOptions.filter((p) =>
    !prereqSearch || p.code?.toLowerCase().includes(prereqSearch.toLowerCase()) || p.name?.toLowerCase().includes(prereqSearch.toLowerCase())
  );
  const coreqFiltered = prereqOptions.filter((p) =>
    !coreqSearch || p.code?.toLowerCase().includes(coreqSearch.toLowerCase()) || p.name?.toLowerCase().includes(coreqSearch.toLowerCase())
  );

  const semesterTable = (sem, rows) => {
    const sums = rows.reduce((acc, s) => ({
      lecHrs: acc.lecHrs + (s.lecture_hours || 0),
      lecUnits: acc.lecUnits + (s.lecture_units || 0),
      labHrs: acc.labHrs + (s.lab_hours || 0),
      labUnits: acc.labUnits + (s.lab_units || 0),
      totalHrs: acc.totalHrs + (totalHrsOf(s) || 0),
      totalUnits: acc.totalUnits + (s.units || 0),
    }), { lecHrs: 0, lecUnits: 0, labHrs: 0, labUnits: 0, totalHrs: 0, totalUnits: 0 });

    return (
      <div key={sem} className="mb-4 last:mb-0">
        <h4 className="text-sm font-semibold text-gray-600 italic px-1 mb-2">{sem}</h4>
        <div className="overflow-x-auto border border-gray-200 rounded-lg max-h-[70vh] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th rowSpan={2} className="text-left px-3 py-2 text-[11px] font-semibold uppercase text-gray-500 align-bottom">Course Code</th>
                <th rowSpan={2} className="text-left px-3 py-2 text-[11px] font-semibold uppercase text-gray-500 align-bottom">Course Description</th>
                <th colSpan={2} className="text-center px-3 py-1.5 text-[11px] font-semibold uppercase text-gray-500 border-b border-gray-200">Lecture</th>
                <th colSpan={2} className="text-center px-3 py-1.5 text-[11px] font-semibold uppercase text-gray-500 border-b border-gray-200">Laboratory / RLE</th>
                <th colSpan={2} className="text-center px-3 py-1.5 text-[11px] font-semibold uppercase text-gray-500 border-b border-gray-200">Total</th>
                <th rowSpan={2} className="text-left px-3 py-2 text-[11px] font-semibold uppercase text-gray-500 align-bottom">Pre-Requisite</th>
                <th rowSpan={2} className="text-left px-3 py-2 text-[11px] font-semibold uppercase text-gray-500 align-bottom">Co-Requisite</th>
                <th rowSpan={2} className="text-right px-3 py-2 text-[11px] font-semibold uppercase text-gray-500 align-bottom">Actions</th>
              </tr>
              <tr className="bg-gray-50">
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Hrs</th>
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Units</th>
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Hrs</th>
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Units</th>
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Hrs</th>
                <th className="text-center px-2 py-1.5 text-[10px] font-semibold uppercase text-gray-400">Units</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice().sort((a, b) => a.code.localeCompare(b.code)).map((s) => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-3 py-2.5 font-bold text-navy">{s.code}</td>
                  <td className="px-3 py-2.5">
                    <p className="font-medium">{s.name}</p>
                    {s.description && <p className="text-xs text-gray-400 truncate max-w-xs">{s.description}</p>}
                  </td>
                  <td className="px-2 py-2.5 text-center">{s.lecture_hours ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center">{s.lecture_units ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center">{s.lab_hours ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center">{s.lab_units ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center font-medium">{totalHrsOf(s) ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center font-medium">{s.units}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {s.prerequisites?.map(p => <Badge key={p.id} variant="orange">{p.code}</Badge>)}
                      {s.prerequisite_note && <span className="text-xs text-gray-500 italic">{s.prerequisite_note}</span>}
                      {!s.prerequisites?.length && !s.prerequisite_note && <span className="text-gray-300 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {s.co_requisites?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">{s.co_requisites.map(p => <Badge key={p.id} variant="blue">{p.code}</Badge>)}</div>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-1.5 justify-end">
                      <button className="btn-icon" onClick={() => setViewSubject(s)} title="View"><Icons.Eye /></button>
                      <button className="btn-icon" onClick={() => openEdit(s)} title="Edit"><Icons.Edit /></button>
                      <button className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => setDeleteTarget(s)} title="Delete"><Icons.Trash /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-navy text-white font-semibold">
                <td colSpan={2} className="px-3 py-2.5 text-right text-xs uppercase">Total</td>
                <td className="px-2 py-2.5 text-center">{sums.lecHrs}</td>
                <td className="px-2 py-2.5 text-center">{sums.lecUnits}</td>
                <td className="px-2 py-2.5 text-center">{sums.labHrs}</td>
                <td className="px-2 py-2.5 text-center">{sums.labUnits}</td>
                <td className="px-2 py-2.5 text-center">{sums.totalHrs}</td>
                <td className="px-2 py-2.5 text-center">{sums.totalUnits}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Subject Management</h2>
          <p className="text-[13px] text-gray-500">Faculty and Chairpersons create their own program's subjects; Admin can review, edit, and clean up anything here.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Subjects" value={subjects.length} icon={<Icons.FileText />} iconBg="bg-blue-50 text-blue-500" />
        <StatCard label="Total Units" value={totalUnits} icon={<Icons.Book />} iconBg="bg-green-50 text-green-500" />
        <StatCard label="Departments" value={departments.length} icon={<Icons.Users />} iconBg="bg-purple-50 text-purple-500" />
        <StatCard label="With Prerequisites" value={subjects.filter(s => s.prerequisites?.length > 0).length} icon={<Icons.Flag />} iconBg="bg-orange-50 text-orange-500" />
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by code or name..." />
        <select className="form-select w-auto text-sm py-2.5" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">All Departments</option>
          {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <>
          {programs.length === 0 && Object.keys(unassigned).length === 0 && (
            <div className="card p-12 text-center text-gray-400">No subjects found.</div>
          )}
          {programs.map((prog) => {
            const years = Object.keys(grouped[prog]).map(Number).sort((a, b) => a - b);
            const progKey = `prog:${prog}`;
            const progOpen = !!expanded[progKey];
            const progSubjectCount = years.reduce((n, yr) => n + Object.values(grouped[prog][yr]).reduce((n2, rows) => n2 + rows.length, 0), 0)
              + (unassigned[prog]?.length || 0);
            return (
              <div key={prog} className="card overflow-hidden mb-4">
                <button
                  onClick={() => toggle(progKey)}
                  className="w-full flex items-center justify-between px-5 py-3 cursor-pointer border-none bg-gray-50/60 hover:bg-gray-100 font-sans transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    {prog === 'No Program' ? <span className="text-xs font-semibold text-gray-500 uppercase">No Program</span> : <ProgramBadge program={prog} size="lg" />}
                    <span className="text-xs text-gray-400">({progSubjectCount})</span>
                  </div>
                  {progOpen ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                {progOpen && (
                  <div className="card-body">
                    {years.map((yr) => {
                      const semesters = Object.keys(grouped[prog][yr]).sort((a, b) => (SEMESTER_ORDER[a] ?? 9) - (SEMESTER_ORDER[b] ?? 9));
                      const yearKey = `${progKey}-year:${yr}`;
                      const yearOpen = !!expanded[yearKey];
                      const yearSubjectCount = semesters.reduce((n, sem) => n + grouped[prog][yr][sem].length, 0);
                      return (
                        <div key={yr} className="card overflow-hidden mb-4 last:mb-0">
                          <button
                            onClick={() => toggle(yearKey)}
                            className="w-full px-5 py-3 bg-navy text-white flex items-center justify-center gap-2 cursor-pointer border-none font-sans"
                          >
                            <h3 className="text-sm font-bold tracking-wide">{YEAR_LABEL[yr] || `YEAR ${yr}`}</h3>
                            <span className="text-xs opacity-70">({yearSubjectCount})</span>
                            {yearOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
                          </button>
                          {yearOpen && (
                            <div className="card-body">
                              {semesters.map((sem) => semesterTable(sem, grouped[prog][yr][sem]))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {unassigned[prog]?.length > 0 && (() => {
                      const unassignedKey = `${progKey}-unassigned`;
                      const unassignedOpen = !!expanded[unassignedKey];
                      return (
                        <div className="card overflow-hidden mb-4 last:mb-0">
                          <button
                            onClick={() => toggle(unassignedKey)}
                            className="w-full px-5 py-3 bg-gray-400 text-white flex items-center justify-center gap-2 cursor-pointer border-none font-sans"
                          >
                            <h3 className="text-sm font-bold tracking-wide">UNASSIGNED — no Year/Semester set</h3>
                            <span className="text-xs opacity-70">({unassigned[prog].length})</span>
                            {unassignedOpen ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
                          </button>
                          {unassignedOpen && (
                            <div className="card-body">
                              {semesterTable('No Semester Set', unassigned[prog])}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* VIEW MODAL */}
      {viewSubject && (
        <Modal title={`${viewSubject.code} — ${viewSubject.name}`} onClose={() => setViewSubject(null)} footer={
          <button className="btn btn-outline" onClick={() => setViewSubject(null)}>Close</button>
        }>
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div><span className="text-gray-500">Code:</span> <span className="font-bold ml-1">{viewSubject.code}</span></div>
            <div><span className="text-gray-500">Total:</span> <span className="font-medium ml-1">{totalHrsOf(viewSubject) ?? '—'} Hrs / {viewSubject.units} Units</span></div>
            <div><span className="text-gray-500">Department:</span> <span className="font-medium ml-1">{viewSubject.department}</span></div>
            <div className="col-span-2"><span className="text-gray-500">Program:</span> <span className="ml-1">{viewSubject.program ? <ProgramBadge program={viewSubject.program} /> : '—'}</span></div>
            <div><span className="text-gray-500">Year Level:</span> <span className="font-medium ml-1">{viewSubject.year_level ? `Year ${viewSubject.year_level}` : '—'}</span></div>
            <div><span className="text-gray-500">Semester:</span> <span className="font-medium ml-1">{viewSubject.semester || '—'}</span></div>
            <div><span className="text-gray-500">Lecture:</span> <span className="font-medium ml-1">{viewSubject.lecture_hours ?? '—'} Hrs / {viewSubject.lecture_units ?? '—'} Units</span></div>
            <div><span className="text-gray-500">Laboratory/RLE:</span> <span className="font-medium ml-1">{viewSubject.lab_hours ?? '—'} Hrs / {viewSubject.lab_units ?? '—'} Units</span></div>
          </div>
          {viewSubject.description && (
            <div className="mb-4">
              <span className="text-gray-500 text-sm">Description:</span>
              <p className="text-sm mt-1">{viewSubject.description}</p>
            </div>
          )}
          <div className="mb-4">
            <span className="text-gray-500 text-sm">Prerequisites:</span>
            {viewSubject.prerequisites?.length > 0 || viewSubject.prerequisite_note ? (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {viewSubject.prerequisites?.map(p => <Badge key={p.id} variant="orange">{p.code} — {p.name}</Badge>)}
                {viewSubject.prerequisite_note && <span className="text-sm text-gray-500 italic">{viewSubject.prerequisite_note}</span>}
              </div>
            ) : <p className="text-sm text-gray-400 mt-1">None</p>}
          </div>
          <div>
            <span className="text-gray-500 text-sm">Co-Requisites:</span>
            {viewSubject.co_requisites?.length > 0 ? (
              <div className="flex flex-wrap gap-2 mt-2">
                {viewSubject.co_requisites.map(p => <Badge key={p.id} variant="blue">{p.code} — {p.name}</Badge>)}
              </div>
            ) : <p className="text-sm text-gray-400 mt-1">None</p>}
          </div>
        </Modal>
      )}

      {/* EDIT MODAL */}
      {showModal && formData && (
        <Modal
          title={`Edit Subject — ${editSubject.code}`}
          onClose={() => { setShowModal(false); setEditSubject(null); }}
          size="max-w-2xl"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setShowModal(false); setEditSubject(null); }}>Cancel</button>
              <button className="btn btn-gold" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Update Subject'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Course Code <span className="text-red-500">*</span></label>
              <input className="form-input" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g. CC101" />
            </div>
            <div>
              <label className="form-label">Program <span className="text-red-500">*</span></label>
              <select className="form-select" value={formData.program} onChange={(e) => handleProgramChange(e.target.value)}>
                <option value="">Select Program</option>
                {PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="form-label">Course Description <span className="text-red-500">*</span></label>
              <input className="form-input" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Introduction to Computing" />
            </div>
            <div>
              <label className="form-label">Year Level</label>
              <select className="form-select" value={formData.year_level} onChange={(e) => setFormData({ ...formData, year_level: parseInt(e.target.value) })}>
                {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div>
              <label className="form-label">Semester</label>
              <select className="form-select" value={formData.semester} onChange={(e) => setFormData({ ...formData, semester: e.target.value })}>
                {SEMESTERS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div className="sm:col-span-2 border border-gray-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Lecture / Laboratory-RLE Breakdown <span className="normal-case font-normal text-gray-400">(leave at 0 if not applicable, e.g. Practicum)</span></p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="form-label text-xs">Lecture Hrs</label>
                  <input type="number" min="0" className="form-input" value={formData.lecture_hours} onChange={(e) => setFormData({ ...formData, lecture_hours: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="form-label text-xs">Lecture Units</label>
                  <input type="number" min="0" className="form-input" value={formData.lecture_units} onChange={(e) => setFormData({ ...formData, lecture_units: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="form-label text-xs">Lab/RLE Hrs</label>
                  <input type="number" min="0" className="form-input" value={formData.lab_hours} onChange={(e) => setFormData({ ...formData, lab_hours: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="form-label text-xs">Lab/RLE Units</label>
                  <input type="number" min="0" className="form-input" value={formData.lab_units} onChange={(e) => setFormData({ ...formData, lab_units: parseInt(e.target.value) || 0 })} />
                </div>
              </div>

              <div className="flex items-center justify-between mt-3 mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">Total (stands on its own — e.g. Practicum: 486 Hrs / 6 Units, no Lecture/Lab)</p>
                <button
                  type="button"
                  className="text-xs font-semibold text-gold bg-transparent border-none cursor-pointer hover:underline"
                  onClick={() => setFormData((prev) => ({
                    ...prev,
                    total_hours: (prev.lecture_hours || 0) + (prev.lab_hours || 0),
                    units: (prev.lecture_units || 0) + (prev.lab_units || 0),
                  }))}
                >
                  Compute from Lecture + Lab
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-xs">Total Hrs</label>
                  <input type="number" min="0" className="form-input" value={formData.total_hours} onChange={(e) => setFormData({ ...formData, total_hours: e.target.value === '' ? '' : parseInt(e.target.value) || 0 })} placeholder="e.g. 486" />
                </div>
                <div>
                  <label className="form-label text-xs">Total Units <span className="text-red-500">*</span></label>
                  <input type="number" min="1" max="6" className="form-input" value={formData.units} onChange={(e) => setFormData({ ...formData, units: parseInt(e.target.value) || '' })} placeholder="e.g. 6" />
                </div>
              </div>
            </div>

            <div>
              <label className="form-label">Pre-Requisite</label>
              <input
                className="form-input mb-2 text-[13px]"
                value={prereqSearch}
                onChange={(e) => setPrereqSearch(e.target.value)}
                placeholder="Search subjects..."
              />
              <div className="grid grid-cols-1 gap-2 border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                {prereqOptions.length === 0 && <span className="text-xs text-gray-400">No other subjects yet.</span>}
                {prereqOptions.length > 0 && prereqFiltered.length === 0 && <span className="text-xs text-gray-400">No matches.</span>}
                {prereqFiltered.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input type="checkbox" checked={formData.prerequisite_ids.includes(p.id)} onChange={() => togglePrereq(p.id)} />
                    {p.code} — {p.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Co-Requisite</label>
              <input
                className="form-input mb-2 text-[13px]"
                value={coreqSearch}
                onChange={(e) => setCoreqSearch(e.target.value)}
                placeholder="Search subjects..."
              />
              <div className="grid grid-cols-1 gap-2 border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                {prereqOptions.length === 0 && <span className="text-xs text-gray-400">No other subjects yet.</span>}
                {prereqOptions.length > 0 && coreqFiltered.length === 0 && <span className="text-xs text-gray-400">No matches.</span>}
                {coreqFiltered.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                    <input type="checkbox" checked={formData.co_requisite_ids.includes(p.id)} onChange={() => toggleCoreq(p.id)} />
                    {p.code} — {p.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="form-label">Additional Requirement <span className="text-gray-400 font-normal normal-case">(optional — for standing-based requirements, not a subject)</span></label>
              <input
                className="form-input"
                value={formData.prerequisite_note}
                onChange={(e) => setFormData({ ...formData, prerequisite_note: e.target.value })}
                placeholder="e.g. 4th Year Standing"
              />
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Subject"
          message={`Are you sure you want to delete ${deleteTarget.code} — ${deleteTarget.name}? This will also remove all prerequisite/co-requisite links to it. This cannot be undone.`}
          confirmText="Delete"
          variant="red"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
