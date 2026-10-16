import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import API from '../../services/api';
import { setUser as persistUser, markActivity } from '../../services/authStorage';
import { Icons } from '../common';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, updateUser } = useAuth();
  // Idle screen lock — Admin / Chairperson / Faculty only (students are never
  // locked). Unset = 5 minutes, 0 = Off.
  const isStaff = ['Admin', 'Chairperson', 'Faculty'].includes(user?.role);
  const idleLockMinutes = user?.idle_lock_minutes == null ? 5 : Number(user.idle_lock_minutes);
  const [savingIdle, setSavingIdle] = useState(false);
  const IDLE_CHOICES = [
    { value: 0, label: 'Off — never lock' },
    { value: 5, label: 'After 5 minutes' },
    { value: 10, label: 'After 10 minutes' },
    { value: 15, label: 'After 15 minutes' },
    { value: 30, label: 'After 30 minutes' },
    { value: 60, label: 'After 1 hour' },
  ];
  const handleIdleChange = async (minutes) => {
    try {
      setSavingIdle(true);
      const { data } = await API.put('/auth/preferences', { idle_lock_minutes: minutes });
      // Restart the idle clock so switching the lock on doesn't lock right away.
      markActivity();
      updateUser(data.user);
      toast.success(minutes === 0 ? 'Screen lock turned off.' : `Screen will lock after ${minutes === 60 ? '1 hour' : `${minutes} minutes`} of inactivity.`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save the screen lock setting.');
    } finally {
      setSavingIdle(false);
    }
  };
  const { theme, setTheme, isDark } = useTheme();
  const isStudent = user?.role === 'Student';
  const loginLabel = isStudent ? 'Student Number' : 'Username';

  const [newLogin, setNewLogin] = useState(user?.[isStudent ? 'student_no' : 'username'] || '');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [savingLogin, setSavingLogin] = useState(false);

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [showEmailPassword, setShowEmailPassword] = useState(false);
  const [requestingEmail, setRequestingEmail] = useState(false);
  const [emailCodeSent, setEmailCodeSent] = useState(false);
  const [emailCode, setEmailCode] = useState('');
  const [confirmingEmail, setConfirmingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleChangeUsername = async (e) => {
    e.preventDefault();
    const current = user?.[isStudent ? 'student_no' : 'username'] || '';
    if (!newLogin.trim() || newLogin.trim() === current) {
      toast.error(`Enter a different ${loginLabel.toLowerCase()} first.`);
      return;
    }
    if (!loginPassword) {
      toast.error('Enter your current password to confirm this change.');
      return;
    }
    try {
      setSavingLogin(true);
      await API.put('/auth/username', { newLogin: newLogin.trim(), currentPassword: loginPassword });
      toast.success(`${loginLabel} updated successfully!`);
      setLoginPassword('');
      // Reload so AuthContext/localStorage pick up the new login identifier
      // (same pattern ProfilePage uses after an account-info edit).
      const res = await API.get('/auth/me');
      if (res.data?.user) {
        persistUser(res.data.user);
        window.location.reload();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to update ${loginLabel.toLowerCase()}.`);
    } finally {
      setSavingLogin(false);
    }
  };

  const handleRequestEmailChange = async (e) => {
    e.preventDefault();
    if (!newEmail.trim() || newEmail.trim().toLowerCase() === (user?.email || '').toLowerCase()) {
      toast.error('Enter a valid email address first.');
      return;
    }
    if (!emailPassword) {
      toast.error('Enter your current password to confirm this change.');
      return;
    }
    try {
      setRequestingEmail(true);
      const res = await API.put('/auth/email/request', { newEmail: newEmail.trim(), currentPassword: emailPassword });
      if (res.data?.directUpdated) {
        toast.success(res.data.message || 'Email address added to your account successfully!');
        setNewEmail('');
        setEmailPassword('');
        const meRes = await API.get('/auth/me');
        if (meRes.data?.user) {
          persistUser(meRes.data.user);
          window.location.reload();
        }
        return;
      }
      toast.success('Verification code sent to your new email.');
      setEmailCodeSent(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update email.');
    } finally {
      setRequestingEmail(false);
    }
  };

  const handleConfirmEmailChange = async (e) => {
    e.preventDefault();
    if (!emailCode.trim()) {
      toast.error('Enter the verification code.');
      return;
    }
    try {
      setConfirmingEmail(true);
      await API.put('/auth/email/confirm', { code: emailCode.trim() });
      toast.success('Email address updated and verified!');
      setNewEmail('');
      setEmailPassword('');
      setEmailCode('');
      setEmailCodeSent(false);
      const res = await API.get('/auth/me');
      if (res.data?.user) {
        persistUser(res.data.user);
        window.location.reload();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to confirm email change.');
    } finally {
      setConfirmingEmail(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill out all password fields.');
      return;
    }

    if (newPassword.length < 8) {
      toast.error('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match.');
      return;
    }

    try {
      setSaving(true);
      await API.put('/auth/password', { currentPassword, newPassword });
      toast.success('Password changed successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="mb-5">
        <h2 className="text-lg font-bold text-navy">Settings</h2>
        <p className="text-[13px] text-gray-500">Manage your account settings</p>
      </div>

      <div className="flex flex-col gap-6 max-w-2xl">
        {/* Appearance & Theme (Dark Mode) - Available to all users */}
        <div className="card p-6">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-semibold text-navy flex items-center gap-2">
              {isDark ? <Icons.Moon className="w-4 h-4 text-gold" /> : <Icons.Sun className="w-4 h-4 text-gold" />} Appearance & Theme
            </h3>
            <span className="badge badge-gold font-bold text-xs uppercase px-2.5 py-0.5">
              {theme} mode
            </span>
          </div>
          <p className="text-[13px] text-gray-500 mb-5">
            Choose your preferred theme for the system. This setting is saved to your browser and applies across all pages and records.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Light Mode Option */}
            <button
              type="button"
              onClick={() => setTheme('light')}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer text-left flex flex-col justify-between ${
                theme === 'light'
                  ? 'border-gold bg-gold/5 shadow-sm ring-1 ring-gold/20'
                  : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Icons.Sun className="w-4 h-4" />
                </span>
                {theme === 'light' && (
                  <span className="w-2.5 h-2.5 rounded-full bg-gold shadow-xs" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Light Mode</p>
                <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">Crisp daytime interface with high readability</p>
              </div>
            </button>

            {/* Dark Mode Option */}
            <button
              type="button"
              onClick={() => setTheme('dark')}
              className={`p-4 rounded-xl border-2 transition-all cursor-pointer text-left flex flex-col justify-between ${
                theme === 'dark'
                  ? 'border-gold bg-gold/5 shadow-sm ring-1 ring-gold/20'
                  : 'border-gray-200 dark:border-slate-700 hover:border-gray-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                {/* Solid night tile (the light tile's counterpart) — a
                    translucent dark tint over the white card read as a
                    muddy grey with a barely-visible moon. */}
                <span className="w-8 h-8 rounded-lg bg-indigo-950 text-indigo-200 ring-1 ring-indigo-900/40 flex items-center justify-center shadow-sm">
                  <Icons.Moon className="w-4 h-4" />
                </span>
                {theme === 'dark' && (
                  <span className="w-2.5 h-2.5 rounded-full bg-gold shadow-xs" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">Dark Mode</p>
                <p className="text-[11.5px] text-gray-500 dark:text-gray-400 mt-0.5">Sleek, eye-friendly contrast in low light</p>
              </div>
            </button>
          </div>
        </div>

        {/* Change Username / Student Number — Students can only change their
            password (their Student Number is their fixed enrollment
            identifier, not something to self-edit; same reasoning holds for
            email, see below). Every other role keeps full self-service. */}
        {!isStudent && (
        <div className="card p-6">
          <h3 className="text-base font-semibold text-navy mb-1 flex items-center gap-2">
            <Icons.User className="w-4 h-4" /> Change {loginLabel}
          </h3>
          <p className="text-[13px] text-gray-500 mb-5">
            This is what you use to log in — {isStudent ? 'your Student Number' : 'your username'}, not your email.
          </p>

          <form onSubmit={handleChangeUsername} className="space-y-4 max-w-md">
            <div>
              <label className="form-label">New {loginLabel}</label>
              <input
                className="form-input"
                value={newLogin}
                onChange={(e) => setNewLogin(e.target.value)}
                placeholder={isStudent ? 'e.g. 2024-0001' : 'e.g. jdelacruz'}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="form-label">Current Password</label>
              <div className="relative">
                <input
                  className="form-input pr-10"
                  type={showLoginPassword ? 'text' : 'password'}
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Confirm with your current password"
                />
                <button
                  type="button"
                  onClick={() => setShowLoginPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 p-0.5"
                >
                  {showLoginPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="pt-2">
              <button type="submit" className="btn btn-gold" disabled={savingLogin}>
                {savingLogin ? 'Updating...' : `Update ${loginLabel}`}
              </button>
            </div>
          </form>
        </div>
        )}

        {/* Email Address — shown to every role, the Admin included: this is
            the address a password reset link is sent to (Forgot Password), so
            the Admin must be able to set a real one. An account created
            without an email can add it here; any account can change it. */}
        {(
        <div className="card p-6">
          <h3 className="text-base font-semibold text-navy mb-1 flex items-center gap-2">
            <Icons.Mail className="w-4 h-4 text-gold" /> {user?.email ? 'Change Email' : 'Add Email Address'}
          </h3>
          <p className="text-[13px] text-gray-500 mb-5">
            {user?.email
              ? 'Used for account recovery (Forgot Password) and notifications. A code is sent to the new address to verify it before it takes effect.'
              : 'An email address is required for your account for account recovery (Forgot Password) and system notifications.'}
          </p>

          {!user?.email && (
            <div className="mb-4 p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-3 text-[13px] text-amber-800 dark:text-amber-300">
              <Icons.AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold mb-0.5">Email Address Required</p>
                <p className="opacity-90">Please set your email address. You will need it to recover your account if you ever forget your password.</p>
              </div>
            </div>
          )}

          {!emailCodeSent ? (
            <form onSubmit={handleRequestEmailChange} className="space-y-4 max-w-md">
              <div>
                <label className="form-label">{user?.email ? 'New Email Address' : 'Email Address'} <span className="text-red-500">*</span></label>
                <input
                  className="form-input"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. jdelacruz@gmail.com"
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="form-label">Current Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    className="form-input pr-10"
                    type={showEmailPassword ? 'text' : 'password'}
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Confirm with your current password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmailPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 p-0.5"
                  >
                    {showEmailPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="pt-2">
                <button type="submit" className="btn btn-gold" disabled={requestingEmail}>
                  {requestingEmail
                    ? 'Saving...'
                    : user?.email
                    ? 'Send Verification Code'
                    : 'Save Email Address'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleConfirmEmailChange} className="space-y-4 max-w-md">
              <p className="text-[13px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3.5 py-2.5">
                We sent a 6-digit code to <b>{newEmail.trim()}</b>. Enter it below to confirm the change.
              </p>
              <div>
                <label className="form-label">Verification Code</label>
                <input
                  className="form-input"
                  value={emailCode}
                  onChange={(e) => setEmailCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="off"
                />
              </div>
              <div className="pt-2 flex items-center gap-3">
                <button type="submit" className="btn btn-gold" disabled={confirmingEmail}>
                  {confirmingEmail ? 'Confirming...' : 'Confirm Email'}
                </button>
                <button type="button" className="btn btn-outline" onClick={() => { setEmailCodeSent(false); setEmailCode(''); }}>
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
        )}

        {/* Screen lock — staff only. */}
        {isStaff && (
          <div className="card p-6">
            <h3 className="text-base font-semibold text-navy mb-1 flex items-center gap-2">
              <Icons.Lock className="w-4 h-4 text-gold" /> Screen Lock
            </h3>
            <p className="text-[13px] text-gray-500 mb-4">
              Lock the screen when you've been inactive for a while — you'll need your password to continue. Handy on shared computers.
            </p>
            <label className="form-label">Lock the screen</label>
            <select
              className="form-select max-w-xs"
              value={IDLE_CHOICES.some((c) => c.value === idleLockMinutes) ? idleLockMinutes : 5}
              onChange={(e) => handleIdleChange(parseInt(e.target.value, 10))}
              disabled={savingIdle}
            >
              {IDLE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-2">
              {idleLockMinutes === 0
                ? 'Your screen never locks on its own. Remember to sign out on shared computers.'
                : `Currently: locks after ${idleLockMinutes === 60 ? '1 hour' : `${idleLockMinutes} minutes`} without any mouse or keyboard activity.`}
            </p>
          </div>
        )}

        {/* Change Password — the one section every role, including Students, always keeps. */}
        <div className="card p-6">
          <h3 className="text-base font-semibold text-navy mb-1 flex items-center gap-2">
            <Icons.Lock className="w-4 h-4" /> Change Password
          </h3>
          <p className="text-[13px] text-gray-500 mb-5">Update your password to keep your account secure.</p>

          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <div>
              <label className="form-label">Current Password</label>
              <div className="relative">
                <input
                  className="form-input pr-10"
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Enter current password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 p-0.5"
                >
                  {showCurrent ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">New Password</label>
              <div className="relative">
                <input
                  className="form-input pr-10"
                  type={showNew ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowNew(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 p-0.5"
                >
                  {showNew ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="form-label">Confirm New Password</label>
              <div className="relative">
                <input
                  className="form-input pr-10"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 p-0.5"
                >
                  {showConfirm ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="btn btn-gold"
                disabled={saving}
              >
                {saving ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}