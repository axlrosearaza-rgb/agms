import { useState, useEffect, useCallback } from 'react';
import { Icons, Badge, SearchBar, Modal, LoadingSpinner, ProgramDot, ConfirmDialog } from '../../components/common';
import { subjectService } from '../../services';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';

const SEMESTERS = ['1st Semester', '2nd Semester', 'Summer'];
// Curriculum-checklist ordering — "Summer" always last, not alphabetical.
const SEMESTER_ORDER = { '1st Semester': 0, '2nd Semester': 1, 'Summer': 2 };
const YEAR_LABEL = { 1: 'FIRST YEAR', 2: 'SECOND YEAR', 3: 'THIRD YEAR', 4: 'FOURTH YEAR' };

// Program → Department mapping (subjects store the short department name;
// User accounts store the full program name — same 4 programs, two spellings).
const PROGRAM_DEPARTMENT = {
  'Bachelor of Science in Information Technology': 'Information Technology',
  'Bachelor of Science in Information Systems': 'Information Systems',
  'Bachelor of Science in Psychology': 'Psychology',
  'Bachelor of Science in Statistics': 'Statistics',
};

const emptyForm = {
  code: '', name: '', department: '', program: '', year_level: 1, semester: '1st Semester',
  lecture_hours: 0, lecture_units: 0, lab_hours: 0, lab_units: 0,
  // Total Hrs/Units are their own fields, not forced to equal Lecture + Lab —
  // some subjects (Practicum, Thesis, OJT) have no Lecture/Lab split at all, just
  // a standalone Total (e.g. "486 Hrs / 6 Units"). Default Total Units to 3 as a
  // sane starting point; Total Hrs starts blank since there's no universal default.
  total_hours: '', units: 3,
  prerequisite_ids: [], co_requisite_ids: [],
  // Some "Pre-Requisites" aren't a subject at all — e.g. "4th Year Standing" for
  // Practicum/Seminars — so this is free text shown alongside the subject list.
  prerequisite_note: '',
  // Default grading breakdown for this subject — [{ name, weight }]. A template/
  // reference for instructors setting up their own class's grade components;
  // doesn't have to sum to 100 while someone's still filling it in.
  grading_scheme: [],
};

export default function Subjects() {
  const { user } = useAuth();
  const myPrograms = (user?.programs || []).filter((p) => p !== 'General Education (GE)');
  // Only the Chairperson creates/edits/deletes subjects now — Faculty shares this
  // page but sees a read-only catalog once the Chairperson has set it up.
  const canManage = user?.role === 'Chairperson';

  // Namespaced by role — this page is reused as-is for both Faculty and
  // Chairperson, so their search/expanded state (usePageState, persists
  // across navigation) shouldn't bleed into each other.
  const pk = `Subjects.${user?.role || 'unknown'}`;
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = usePageState(`${pk}.search`, '');
  const [showModal, setShowModal] = useState(false);
  const [editSubject, setEditSubject] = useState(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [prereqSearch, setPrereqSearch] = useState('');
  // Year/Semester sections collapse by default — 52+ subjects across 4 years
  // made this page unusably long fully expanded. Toggled per-key, same
  // dropdown pattern as the Program/Year/Section accordion in User Management.
  const [expanded, setExpanded] = usePageState(`${pk}.expanded`, {});
  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  const [coreqSearch, setCoreqSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadSubjects = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await subjectService.getAll();
      setSubjects(data.subjects || []);
    } catch (err) {
      toast.error('Failed to load subjects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  const openCreate = (prefillYear, prefillSemester) => {
    setEditSubject(null);
    setFormData({
      ...emptyForm,
      program: myPrograms[0] || '',
      department: PROGRAM_DEPARTMENT[myPrograms[0]] || '',
      year_level: prefillYear || 1,
      semester: prefillSemester || '1st Semester',
    });
    setPrereqSearch('');
    setCoreqSearch('');
    setShowModal(true);
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
      grading_scheme: (s.grading_scheme || []).map((c) => ({ ...c })),
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

  const addGradingRow = () => {
    setFormData((prev) => ({ ...prev, grading_scheme: [...prev.grading_scheme, { name: '', weight: 0 }] }));
  };
  const updateGradingRow = (index, field, value) => {
    setFormData((prev) => ({
      ...prev,
      grading_scheme: prev.grading_scheme.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    }));
  };
  const removeGradingRow = (index) => {
    setFormData((prev) => ({ ...prev, grading_scheme: prev.grading_scheme.filter((_, i) => i !== index) }));
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
      // Blank Total Hrs means "not applicable" — send null, not an empty string
      // (which Postgres would reject outright for an INTEGER column). Drop any
      // grading-scheme row left with no name — an empty label isn't useful and
      // just clutters the template.
      const gradingScheme = formData.grading_scheme
        .filter((row) => row.name?.trim())
        .map((row) => ({ name: row.name.trim(), weight: Number(row.weight) || 0 }));
      const payload = {
        ...formData,
        total_hours: formData.total_hours === '' ? null : formData.total_hours,
        grading_scheme: gradingScheme.length > 0 ? gradingScheme : null,
      };
      if (editSubject) {
        await subjectService.update(editSubject.id, payload);
        toast.success('Subject updated');
      } else {
        await subjectService.create(payload);
        toast.success('Subject created');
      }
      setShowModal(false);
      setEditSubject(null);
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save subject');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const s = deleteTarget;
    if (!s) return;
    try {
      await subjectService.delete(s.id);
      toast.success('Subject deleted');
      setDeleteTarget(null);
      loadSubjects();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete subject');
    }
  };

  const filtered = subjects.filter((s) =>
    !search ||
    s.name?.toLowerCase().includes(search.toLowerCase()) ||
    s.code?.toLowerCase().includes(search.toLowerCase())
  );

  const prereqOptions = subjects.filter((s) => !editSubject || s.id !== editSubject.id);
  const prereqFiltered = prereqOptions.filter((p) =>
    !prereqSearch || p.code?.toLowerCase().includes(prereqSearch.toLowerCase()) || p.name?.toLowerCase().includes(prereqSearch.toLowerCase())
  );
  const coreqFiltered = prereqOptions.filter((p) =>
    !coreqSearch || p.code?.toLowerCase().includes(coreqSearch.toLowerCase()) || p.name?.toLowerCase().includes(coreqSearch.toLowerCase())
  );

  // Group into the curriculum-checklist sequence: Year -> Semester -> subjects
  // (in code order), with subjects missing either field parked in "Unassigned"
  // so nothing silently disappears from the list.
  const grouped = {};
  const unassigned = [];
  filtered.forEach((s) => {
    if (!s.year_level || !s.semester) {
      unassigned.push(s);
      return;
    }
    if (!grouped[s.year_level]) grouped[s.year_level] = {};
    if (!grouped[s.year_level][s.semester]) grouped[s.year_level][s.semester] = [];
    grouped[s.year_level][s.semester].push(s);
  });
  const years = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  // Total Hours is its own value (not derived) — falls back to Lecture+Lab only
  // for legacy rows that predate the standalone Total field.
  const totalHrsOf = (s) => s.total_hours ?? ((s.lecture_hours ?? s.lab_hours) != null ? (s.lecture_hours || 0) + (s.lab_hours || 0) : null);

  if (loading) return <LoadingSpinner />;

  const semesterTable = (yr, sem, rows) => {
    const sums = rows.reduce((acc, s) => ({
      lecHrs: acc.lecHrs + (s.lecture_hours || 0),
      lecUnits: acc.lecUnits + (s.lecture_units || 0),
      labHrs: acc.labHrs + (s.lab_hours || 0),
      labUnits: acc.labUnits + (s.lab_units || 0),
      totalHrs: acc.totalHrs + (totalHrsOf(s) || 0),
      totalUnits: acc.totalUnits + (s.units || 0),
    }), { lecHrs: 0, lecUnits: 0, labHrs: 0, labUnits: 0, totalHrs: 0, totalUnits: 0 });

    const semKey = `sem:${yr}-${sem}`;
    const semOpen = !!expanded[semKey];

    return (
      <div key={sem} className="mb-4 last:mb-0">
        <div className="flex items-center justify-between px-1 mb-2">
          <button
            onClick={() => toggle(semKey)}
            className="flex items-center gap-2 bg-transparent border-none cursor-pointer p-0 font-sans"
          >
            {semOpen ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
            <h4 className="text-sm font-semibold text-gray-600 italic">{sem}</h4>
            <span className="text-xs text-gray-400">({rows.length})</span>
          </button>
          {canManage && (
            <button className="btn-icon" onClick={() => openCreate(yr, sem)} title={`Add subject to Year ${yr} — ${sem}`}>
              <Icons.Plus className="w-4 h-4" />
            </button>
          )}
        </div>
        {semOpen && (
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
              {rows.sort((a, b) => a.code.localeCompare(b.code)).map((s) => (
                <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-3 py-2.5 font-semibold text-navy">
                    {/* Only worth showing once a Faculty actually teaches more than
                        one program (e.g. a real program + General Education) —
                        for everyone else every row would be the same color anyway. */}
                    {myPrograms.length > 1 && <ProgramDot program={s.program} className="mr-1.5" />}
                    {s.code}
                  </td>
                  <td className="px-3 py-2.5">{s.name}</td>
                  <td className="px-2 py-2.5 text-center">{s.lecture_hours ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center">{s.lecture_units ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center">{s.lab_hours ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center">{s.lab_units ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center font-medium">{totalHrsOf(s) ?? '—'}</td>
                  <td className="px-2 py-2.5 text-center font-medium">{s.units}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      {s.prerequisites?.map((p) => <Badge key={p.id} variant="orange">{p.code}</Badge>)}
                      {s.prerequisite_note && <span className="text-xs text-gray-500 italic">{s.prerequisite_note}</span>}
                      {!s.prerequisites?.length && !s.prerequisite_note && <span className="text-gray-300 text-xs">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {s.co_requisites?.length > 0 ? (
                      <div className="flex flex-wrap gap-1">{s.co_requisites.map((p) => <Badge key={p.id} variant="blue">{p.code}</Badge>)}</div>
                    ) : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {canManage ? (
                      <div className="flex gap-1.5 justify-end">
                        <button className="btn-icon" onClick={() => openEdit(s)} title="Edit"><Icons.Edit /></button>
                        <button className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => setDeleteTarget(s)} title="Delete"><Icons.Trash /></button>
                      </div>
                    ) : <span className="text-gray-300 text-xs">—</span>}
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
        )}
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">Subjects</h2>
          <p className="text-[13px] text-gray-500">Curriculum sequence for your program(s), grouped by Year and Semester ({filtered.length})</p>
        </div>
        {canManage && (
          <button className="btn btn-gold" onClick={() => openCreate()}>
            <Icons.Plus /> Add Subject
          </button>
        )}
      </div>

      <div className="mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name or code..." />
      </div>

      {years.length === 0 && unassigned.length === 0 && (
        <div className="card p-12 text-center text-gray-400">
          <Icons.FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          No subjects found.
        </div>
      )}

      {years.map((yr) => {
        const semesters = Object.keys(grouped[yr]).sort((a, b) => (SEMESTER_ORDER[a] ?? 9) - (SEMESTER_ORDER[b] ?? 9));
        const yearKey = `year:${yr}`;
        const yearOpen = !!expanded[yearKey];
        const yearSubjectCount = semesters.reduce((n, sem) => n + grouped[yr][sem].length, 0);
        return (
          <div key={yr} className="card overflow-hidden mb-5">
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
                {semesters.map((sem) => semesterTable(yr, sem, grouped[yr][sem]))}
              </div>
            )}
          </div>
        );
      })}

      {unassigned.length > 0 && (
        <div className="card overflow-hidden mb-5">
          <button
            onClick={() => toggle('year:unassigned')}
            className="w-full px-5 py-3 bg-gray-400 text-white flex items-center justify-center gap-2 cursor-pointer border-none font-sans"
          >
            <h3 className="text-sm font-bold tracking-wide">UNASSIGNED — no Year/Semester set</h3>
            <span className="text-xs opacity-70">({unassigned.length})</span>
            {expanded['year:unassigned'] ? <Icons.ChevronUp className="w-4 h-4" /> : <Icons.ChevronDown className="w-4 h-4" />}
          </button>
          {expanded['year:unassigned'] && (
            <div className="card-body">
              {semesterTable(null, 'No Semester Set', unassigned)}
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <Modal
          title={editSubject ? `Edit Subject — ${editSubject.code}` : 'Add New Subject'}
          onClose={() => { setShowModal(false); setEditSubject(null); }}
          size="max-w-2xl"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setShowModal(false); setEditSubject(null); }}>Cancel</button>
              <button className="btn btn-gold" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editSubject ? 'Update Subject' : 'Create Subject'}
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
                {myPrograms.map((p) => <option key={p} value={p}>{p}</option>)}
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

            {/* Lecture / Laboratory-RLE breakdown, matching the official curriculum checklist.
                Leave these at 0 for subjects with no split (Practicum, Thesis, OJT) — Total
                Hrs/Units below are independent fields, not forced to equal this sum. */}
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

            {/* Default grading breakdown — a template instructors can start from
                when they set up their own class's grade components; doesn't
                enforce anything on actual grading. Always editable, including
                after this subject already has classes running. */}
            <div className="sm:col-span-2 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">Grading System <span className="normal-case font-normal text-gray-400">(optional — a default breakdown for this subject)</span></p>
                {formData.grading_scheme.length > 0 && (
                  <span className={`text-xs font-semibold ${
                    formData.grading_scheme.reduce((sum, r) => sum + (Number(r.weight) || 0), 0) === 100 ? 'text-green-600' : 'text-amber-600'
                  }`}>
                    Total: {formData.grading_scheme.reduce((sum, r) => sum + (Number(r.weight) || 0), 0)}%
                  </span>
                )}
              </div>

              {formData.grading_scheme.length === 0 && (
                <p className="text-xs text-gray-400 mb-2">No grading components yet.</p>
              )}

              <div className="space-y-2">
                {formData.grading_scheme.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="form-input flex-1 text-[13px]"
                      value={row.name}
                      onChange={(e) => updateGradingRow(i, 'name', e.target.value)}
                      placeholder="e.g. Major Exam"
                    />
                    <div className="relative w-24 flex-shrink-0">
                      <input
                        type="number" min="0" max="100"
                        className="form-input text-[13px] pr-6"
                        value={row.weight}
                        onChange={(e) => updateGradingRow(i, 'weight', e.target.value === '' ? '' : parseFloat(e.target.value))}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
                    </div>
                    <button type="button" className="btn-icon hover:!bg-red-50 hover:!text-red-500 flex-shrink-0" onClick={() => removeGradingRow(i)} title="Remove">
                      <Icons.Trash />
                    </button>
                  </div>
                ))}
              </div>

              <button type="button" className="text-xs font-semibold text-gold bg-transparent border-none cursor-pointer hover:underline mt-2" onClick={addGradingRow}>
                <Icons.Plus className="w-3 h-3 inline" /> Add Component
              </button>
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
          message={`Are you sure you want to delete ${deleteTarget.code} — ${deleteTarget.name}? This will also remove any prerequisite/co-requisite links to it. This cannot be undone.`}
          confirmText="Delete"
          variant="red"
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
