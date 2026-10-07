import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icons } from '../common';
import { accountSetupService } from '../../services';
import toast from 'react-hot-toast';

const STATUS_OPTIONS = [
  { value: 'Regular', title: 'Regular', desc: 'Taking the full set of subjects for my year and section.' },
  { value: 'Irregular', title: 'Irregular', desc: 'Taking a different mix — back subjects, advance subjects, or subjects from other sections.' },
];
const TYPE_OPTIONS = [
  { value: 'New', title: 'New Student', desc: 'First time enrolled in the university.' },
  { value: 'Old', title: 'Old Student', desc: 'Continuing from the previous semester.' },
  { value: 'Shifter', title: 'Shifter', desc: 'Moved from another program within SSU.' },
  { value: 'Transferee', title: 'Transferee', desc: 'Came from another school.' },
  { value: 'Quitter', title: 'Returnee', desc: 'Stopped before and now back.' },
];

// Shown to a student (after account setup) whenever the current semester has
// no declaration from them yet: their student type
// (accountSetupController.declareStatus). Regular / Irregular is NOT asked —
// the system sets it from the student's class lists. Blocking, like the
// setup wizard.
export default function StatusDeclarationModal({ semester, initial, onDone }) {
  const { updateUser, logout } = useAuth();
  // Pre-filled from what the system already knows — Regular / Irregular from
  // their grades (and the adviser's promotion), student type from their
  // history (Old once a semester is done here). The student can still change it.
  const firstValid = (list, ...vals) => vals.find((v) => list.some((o) => o.value === v)) || '';
  const [status, setStatus] = useState(firstValid(STATUS_OPTIONS, initial?.suggested_status, initial?.student_status, initial?.declared_status));
  const [type, setType] = useState(firstValid(TYPE_OPTIONS, initial?.suggested_type, initial?.student_type));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await accountSetupService.declareStatus(status, type);
      updateUser(data.user);
      toast.success(data.message || 'Status saved');
      onDone?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save your status.');
    } finally {
      setBusy(false);
    }
  };

  const Option = ({ opt, selected, onPick }) => (
    <button
      type="button"
      onClick={() => onPick(opt.value)}
      className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-all cursor-pointer font-sans bg-white ${
        selected ? 'border-navy bg-navy/5 shadow-sm' : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${selected ? 'border-navy' : 'border-gray-300'}`}>
          {selected && <span className="w-2 h-2 rounded-full bg-navy" />}
        </span>
        <span>
          <span className="block text-sm font-semibold text-navy">{opt.title}</span>
          <span className="block text-[12px] text-gray-500 mt-0.5">{opt.desc}</span>
        </span>
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-[2100] bg-[#060d1c]/60 backdrop-blur-[3px] overflow-y-auto animate-fadeIn">
      <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden animate-slideUp">
          <div className="bg-gradient-to-r from-navy-dark via-navy to-navy-light text-white px-6 py-5">
            <div className="flex items-center gap-3">
              <img src="/assets/logos/cas-seal-real.png" alt="College of Arts and Sciences" className="w-11 h-11 rounded-full object-contain bg-white p-0.5 flex-shrink-0" />
              <div>
                <h1 className="text-lg font-bold leading-tight">Declare your status</h1>
                <p className="text-xs opacity-75 mt-0.5">{semester ? `For ${semester}` : 'For this semester'}</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            <div>
              <p className="text-sm font-semibold text-gray-800 mb-2">1. Are you a Regular or Irregular student?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {STATUS_OPTIONS.map((o) => <Option key={o.value} opt={o} selected={status === o.value} onPick={setStatus} />)}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-800 mb-2">2. What type of student are you?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {TYPE_OPTIONS.map((o) => <Option key={o.value} opt={o} selected={type === o.value} onPick={setType} />)}
              </div>
            </div>

            <p className="text-[11px] text-gray-400">Your adviser sees what you declare. If your subjects this semester turn out incomplete, or include a back or advance subject, the system marks you Irregular automatically. You'll be asked again at the start of each semester.</p>

            <button className="btn btn-primary w-full justify-center py-3 text-[15px]" onClick={save} disabled={busy || !status || !type}>
              <Icons.Check className="w-4 h-4" /> {busy ? 'Saving...' : 'Save'}
            </button>
          </div>

          <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 flex justify-end text-xs">
            <button className="text-gray-500 hover:text-red-600 bg-transparent border-none cursor-pointer flex items-center gap-1" onClick={logout}>
              <Icons.LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
