import { useState } from 'react';
import toast from 'react-hot-toast';
import { Icons, formatPersonNameFirstLast } from '../common';
import { accountSetupService } from '../../services';
import { useAuth } from '../../context/AuthContext';

// "Is this your class?" — shown to a student for each class they were put in
// that isn't their own Year + Section (utils/enrollmentChecks.js on the
// backend). "Yes" confirms it; "No" takes the student off that class list
// right away and tells the instructor. One class at a time until none are left.
export default function ClassConfirmationModal({ pending, user, onAnswered }) {
  const [busy, setBusy] = useState(false);
  const { updateUser } = useAuth();
  const item = pending[0];
  if (!item) return null;

  const answer = async (value) => {
    setBusy(true);
    try {
      const { data } = await accountSetupService.answerClassConfirmation(item.enrollment_id, value);
      toast.success(data.message);
      // Removed from the class → their Regular / Irregular status may have changed back.
      if (data.user) updateUser(data.user);
      // Pages showing the student's subjects reload their lists.
      window.dispatchEvent(new Event('agms:enrollments-changed'));
      onAnswered(item.enrollment_id);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save your answer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2050] bg-[#060d1c]/60 backdrop-blur-[3px] overflow-y-auto animate-fadeIn">
      <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-slideUp">
          <div className="bg-gradient-to-r from-navy-dark via-navy to-navy-light text-white px-6 py-5">
            <h1 className="text-lg font-bold leading-tight">Is this your class?</h1>
            <p className="text-xs opacity-75 mt-0.5">
              {pending.length > 1 ? `${pending.length} classes to confirm` : 'Please confirm'}
            </p>
          </div>

          <div className="p-6">
            <p className="text-sm text-gray-600 mb-4">
              You were added to a class that is outside your own year and section
              {user?.year_level ? ` (Year ${user.year_level}${user.section ? ` - Section ${user.section}` : ''})` : ''}:
            </p>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-5">
              <p className="text-base font-bold text-navy">{item.subject_code}</p>
              <p className="text-[13px] text-gray-700">{item.subject_name}</p>
              <p className="text-xs text-gray-600 mt-1.5">
                Year {item.year_level || '—'}{item.section ? ` · Section ${item.section}` : ''}
                {item.semester ? ` · ${item.semester}` : ''}
              </p>
              {item.instructor_name && (
                <p className="text-xs text-gray-600">Faculty: {formatPersonNameFirstLast(item.instructor_name)}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button className="btn btn-outline justify-center py-3 !text-red-600 !border-red-200 hover:!bg-red-50" onClick={() => answer('no')} disabled={busy}>
                <Icons.X className="w-4 h-4" /> No, not mine
              </button>
              <button className="btn btn-primary justify-center py-3" onClick={() => answer('yes')} disabled={busy}>
                <Icons.Check className="w-4 h-4" /> Yes, I'm enrolled
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-3">
              If you answer "No", you are removed from this class list and your faculty is told.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
