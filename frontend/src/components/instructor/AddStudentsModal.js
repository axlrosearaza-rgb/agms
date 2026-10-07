import { useEffect, useMemo, useState } from 'react';
import { Icons, Badge, Modal, LoadingSpinner, SearchBar, formatPersonName, programShortLabel } from '../common';
import { classService } from '../../services';
import toast from 'react-hot-toast';

// "Add Students" for a class — two ways in:
//   1. From the advisory class list: the class's own Program / Year / Section,
//      students already in the system (imported by their adviser) — tick who's in.
//   2. Import Class List: a Word file, a pasted list or the entry table (also
//      how students from other sections are added).
export default function AddStudentsModal({ cls, onClose, onImport, onAdded }) {
  const [mode, setMode] = useState('choose'); // choose | section
  const program = cls.subject?.program;
  const year = cls.year_level;
  const section = cls.section;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const classLabel = `${cls.subject?.code || 'Class'}${cls.year_level ? ` · Year ${cls.year_level}` : ''}${cls.section ? ` · Sec ${cls.section}` : ''}`;

  useEffect(() => {
    if (mode !== 'section') return;
    setLoading(true);
    setSelected(new Set());
    classService.getSectionStudents(cls.id, { program, year_level: year, section })
      .then(({ data: d }) => setData(d))
      .catch((err) => { toast.error(err.response?.data?.message || 'Failed to load the section'); setData(null); })
      .finally(() => setLoading(false));
  }, [mode, program, year, section, cls.id]);

  const students = data?.students || [];
  const addable = students.filter((s) => !s.is_enrolled && !s.prerequisite_needed);
  const q = search.trim().toLowerCase();
  const visible = useMemo(() => students.filter((s) => !q || s.name?.toLowerCase().includes(q) || s.student_no?.includes(q)), [students, q]);
  const allOn = addable.length > 0 && addable.every((s) => selected.has(s.id));
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const add = async () => {
    setSaving(true);
    try {
      const { data: d } = await classService.enroll(cls.id, [...selected]);
      toast.success(d.message || 'Students added');
      onAdded?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add students');
    } finally {
      setSaving(false);
    }
  };

  const Choice = ({ icon, title, desc, onClick, accent }) => (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 p-4 cursor-pointer font-sans bg-white transition-all hover:shadow-md ${accent}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-navy/5 text-navy flex items-center justify-center flex-shrink-0">{icon}</div>
        <div>
          <p className="text-sm font-bold text-navy">{title}</p>
          <p className="text-[12px] text-gray-500 mt-0.5">{desc}</p>
        </div>
      </div>
    </button>
  );

  return (
    <Modal
      title={`Add Students — ${classLabel}`}
      onClose={onClose}
      size={mode === 'section' ? 'max-w-3xl' : 'max-w-lg'}
      footer={mode === 'section' ? (
        <>
          <button className="btn btn-outline mr-auto" onClick={() => setMode('choose')} disabled={saving}>Back</button>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-gold" onClick={add} disabled={saving || selected.size === 0}>
            <Icons.Plus className="w-4 h-4" /> {saving ? 'Adding...' : `Add ${selected.size} Student${selected.size !== 1 ? 's' : ''}`}
          </button>
        </>
      ) : (
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
      )}
    >
      {mode === 'choose' ? (
        <div className="space-y-3">
          <p className="text-[13px] text-gray-500">How do you want to add students to this class?</p>
          <Choice
            icon={<Icons.Users className="w-5 h-5" />}
            title="From the advisory class list"
            desc={`Pick from the students of ${programShortLabel(cls.subject?.program)} ${cls.year_level || ''}-${cls.section || ''} already imported by their adviser.`}
            onClick={() => setMode('section')}
            accent="border-gray-200 hover:border-navy"
          />
          <Choice
            icon={<Icons.Upload className="w-5 h-5" />}
            title="Import Class List"
            desc="Bring in students from a Word file, a pasted list or the entry table — including irregular students from other sections. New students get an account."
            onClick={() => { onClose(); onImport(cls); }}
            accent="border-gray-200 hover:border-blue-500"
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-[12px] text-gray-500">
              <b>{programShortLabel(program)} {year}-{section}</b>
              {data?.adviser ? <> · Adviser: {formatPersonName(data.adviser)}</> : ' · no adviser assigned'}
              {' '}· {students.length} student{students.length !== 1 ? 's' : ''}
            </p>
            <div className="flex items-center gap-3">
              {addable.length > 0 && (
                <button type="button" className="text-xs text-gold font-semibold cursor-pointer bg-transparent border-none font-sans hover:underline"
                  onClick={() => setSelected(allOn ? new Set() : new Set(addable.map((s) => s.id)))}>
                  {allOn ? 'Deselect All' : 'Select All'}
                </button>
              )}
              <div className="w-56 flex"><SearchBar value={search} onChange={setSearch} placeholder="Search name or ID..." /></div>
            </div>
          </div>

          {loading ? <LoadingSpinner /> : students.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">
              No students in {programShortLabel(program)} {year}-{section} yet — their adviser hasn't imported the list. Use Import Class List instead.
            </p>
          ) : (
            <div className="max-h-[45vh] overflow-y-auto space-y-1.5 pr-1">
              {visible.map((s, idx) => {
                const disabled = s.is_enrolled || !!s.prerequisite_needed;
                return (
                  <label key={s.id} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-colors ${
                    s.is_enrolled ? 'border-green-200 bg-green-50/60 cursor-default'
                      : s.prerequisite_needed ? 'border-amber-200 bg-amber-50/50 cursor-default'
                        : 'border-gray-100 hover:bg-gray-50 cursor-pointer'}`}>
                    <input type="checkbox" className="accent-gold" disabled={disabled} checked={s.is_enrolled || selected.has(s.id)} onChange={() => toggle(s.id)} />
                    <span className="text-[11px] text-gray-400 font-medium w-5 flex-shrink-0 text-right">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[13px] font-semibold">{formatPersonName(s.name)}</p>
                        {s.is_enrolled && <Badge variant="green"><Icons.Check className="w-3 h-3" /> In this class</Badge>}
                        {s.student_status === 'Irregular' && <Badge variant="red">Irregular</Badge>}
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {s.student_no}
                        {s.prerequisite_needed && <span className="text-amber-700"> · Must pass {s.prerequisite_needed.join(', ')} first</span>}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
