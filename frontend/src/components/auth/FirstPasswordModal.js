import { useState } from 'react';
import toast from 'react-hot-toast';
import { Icons } from '../common';
import { useAuth } from '../../context/AuthContext';
import { authService } from '../../services';
import { checkPassword } from '../../utils/passwordRules';

// First login for Faculty / Chairperson / Admin: replace the password the
// account was created with — the same "create your own password" step the
// students get in their setup wizard, with the same strong-password rules.
// Blocking: nothing else can be used until it's done (or the user signs out).
export default function FirstPasswordModal() {
  const { updateUser, logout } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const rules = checkPassword(password);
  const passedCount = rules.filter((r) => r.ok).length;
  const passwordValid = !!password && passedCount === rules.length;
  const strength = !password ? null : passedCount === rules.length ? 'Strong' : passedCount >= 3 ? 'Medium' : 'Weak';
  const strengthColor = { Strong: 'bg-green-500', Medium: 'bg-amber-500', Weak: 'bg-red-500' }[strength];
  const strengthText = { Strong: 'text-green-600', Medium: 'text-amber-600', Weak: 'text-red-500' }[strength];
  const confirmMatches = !!confirm && confirm === password;
  const confirmError = confirm && !confirmMatches ? 'Passwords do not match.' : null;

  const save = async (e) => {
    e.preventDefault();
    if (!passwordValid || !confirmMatches) return;
    setBusy(true);
    try {
      const { data } = await authService.setFirstPassword(password, confirm);
      updateUser(data.user);
      toast.success(data.message || 'Your new password is saved.');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save your password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[2100] bg-[#060d1c]/60 backdrop-blur-[3px] overflow-y-auto animate-fadeIn">
      <div className="min-h-full flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden animate-slideUp">
          <div className="bg-gradient-to-r from-navy-dark via-navy to-navy-light text-white px-6 py-5">
            <div className="flex items-center gap-3">
              <img src="/assets/logos/cas-seal-real.png" alt="College of Arts and Sciences" className="w-11 h-11 rounded-full object-contain bg-white p-0.5 flex-shrink-0" />
              <div>
                <h1 className="text-lg font-bold leading-tight">Create your own password</h1>
                <p className="text-xs opacity-75 mt-0.5">First sign-in</p>
              </div>
            </div>
          </div>

          <form className="p-6" onSubmit={save}>
            <p className="text-[13px] text-gray-500 mb-4">You signed in with the password your account was created with. Replace it so only you can access your account.</p>
            <label className="form-label">New password</label>
            <div className="relative mb-1">
              <input
                className={`form-input pr-10 ${password && !passwordValid ? '!border-red-400' : passwordValid ? '!border-green-400' : ''}`}
                type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password"
              />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 btn-icon" onClick={() => setShowPw((v) => !v)} title={showPw ? 'Hide' : 'Show'}>
                {showPw ? <Icons.EyeOff /> : <Icons.Eye />}
              </button>
            </div>
            <div className="mb-3">
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex gap-1 flex-1">
                  {rules.map((r, i) => (
                    <span key={r.key} className={`h-1.5 flex-1 rounded-full ${password && i < passedCount ? strengthColor : 'bg-gray-200'}`} />
                  ))}
                </div>
                <span className={`text-xs font-semibold min-w-[52px] text-right ${strength ? strengthText : 'text-gray-400'}`}>{strength || 'Strength'}</span>
              </div>
              {/* Only what's still missing — a rule disappears once it's met. */}
              {rules.some((r) => !r.ok) && (
                <ul className="mt-2 space-y-0.5">
                  {rules.filter((r) => !r.ok).map((r) => (
                    <li key={r.key} className="text-xs flex items-center gap-1.5 text-gray-500">
                      <span className="w-3.5 h-3.5 flex-shrink-0 inline-flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-gray-300" /></span>
                      {r.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <label className="form-label">Confirm new password</label>
            <input
              className={`form-input mb-1 ${confirmError ? '!border-red-400' : confirmMatches && passwordValid ? '!border-green-400' : ''}`}
              type={showPw ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
              placeholder="Type your new password again"
            />
            <p className={`text-xs mb-5 flex items-center gap-1 min-h-[16px] ${confirmError ? 'text-red-500' : 'text-green-600'}`}>
              {confirmError && <><Icons.X className="w-3.5 h-3.5 flex-shrink-0" />{confirmError}</>}
              {confirmMatches && passwordValid && <><Icons.Check className="w-3.5 h-3.5 flex-shrink-0" />Passwords match.</>}
            </p>
            <button type="submit" className="btn btn-primary w-full justify-center py-3" disabled={busy || !passwordValid || !confirmMatches}>{busy ? 'Saving...' : 'Save password'}</button>
          </form>

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
