import { useState } from 'react';
import toast from 'react-hot-toast';
import { Modal, Icons } from '../common';
import { userService } from '../../services';

// The adviser corrects one of their advisees' details — name, Student ID
// Number, Regular/Irregular and student type (not the email — that's the
// student's own, verified by them). Program / Year / Section
// stay with the advisory section (changed by importing a class list).
const STUDENT_TYPES = [
  { value: 'New', label: 'New Student' },
  { value: 'Old', label: 'Old Student' },
  { value: 'Shifter', label: 'Shifter' },
  { value: 'Transferee', label: 'Transferee' },
  { value: 'Quitter', label: 'Returnee' },
];

export default function EditAdviseeModal({ student, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: student.name || '',
    student_no: student.student_no || '',
    student_status: student.student_status === 'Irregular' ? 'Irregular' : 'Regular',
    student_type: student.student_type || 'New',
  });
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) return toast.error('Student name is required.');
    if (!form.student_no.trim()) return toast.error('Student ID Number is required.');
    setSaving(true);
    try {
      const { data } = await userService.updateAdvisee(student.id, form);
      toast.success(data.message || 'Student updated.');
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update the student');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Edit Student Information"
      onClose={onClose}
      size="max-w-lg"
      footer={(
        <>
          <button className="btn btn-outline" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            <Icons.Check className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      )}
    >
      <div className="space-y-3">
        <div>
          <label className="form-label">Student Full Name <span className="text-red-500">*</span></label>
          <input className="form-input" value={form.name} onChange={set('name')} placeholder="DELA CRUZ, Juan M." />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="form-label">Student ID Number <span className="text-red-500">*</span></label>
            <input className="form-input font-mono" value={form.student_no} onChange={set('student_no')} />
          </div>
          <div>
            {/* The email is the student's own (they verify it themselves) — shown, not editable. */}
            <label className="form-label">Email</label>
            <input className="form-input bg-gray-50 text-gray-500 cursor-not-allowed" value={student.email || 'Not set yet'} readOnly disabled title="Only the student can set or change their email" />
          </div>
          <div>
            <label className="form-label">Status</label>
            <select className="form-select" value={form.student_status} onChange={set('student_status')}>
              <option value="Regular">Regular</option>
              <option value="Irregular">Irregular</option>
            </select>
          </div>
          <div>
            <label className="form-label">Student Type</label>
            <select className="form-select" value={form.student_type} onChange={set('student_type')}>
              {STUDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-gray-400">
          Program, Year and Section follow your advisory section. Only the student can change their email. Changes are recorded in the section's history.
        </p>
      </div>
    </Modal>
  );
}
