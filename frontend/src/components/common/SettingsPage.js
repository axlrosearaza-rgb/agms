import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import API from '../../services/api';
import { setUser as persistUser } from '../../services/authStorage';
import { Icons } from '../common';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user } = useAuth();
  const isStudent = user?.role === 'Student';
  const isAdmin = user?.role === 'Admin';
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
      toast.error('Enter a different email address first.');
      return;
    }
    if (!emailPassword) {
      toast.error('Enter your current password to confirm this change.');
      return;
    }
    try {
      setRequestingEmail(true);
      await API.put('/auth/email/request', { newEmail: newEmail.trim(), currentPassword: emailPassword });
      toast.success('Verification code sent to your new email.');
      setEmailCodeSent(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send verification code.');
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

        {/* Change Email — same "password-only for Students" restriction as
            above, plus Admin specifically no longer gets this section at
            all either (their email is fixed once set, same as Department
            on their own Profile page). */}
        {!isStudent && !isAdmin && (
        <div className="card p-6">
          <h3 className="text-base font-semibold text-navy mb-1 flex items-center gap-2">
            <Icons.Mail className="w-4 h-4" /> Change Email
          </h3>
          <p className="text-[13px] text-gray-500 mb-5">
            Used for account recovery (Forgot Password) and notifications. A code is sent to the new address to verify it before it takes effect.
          </p>

          {!emailCodeSent ? (
            <form onSubmit={handleRequestEmailChange} className="space-y-4 max-w-md">
              <div>
                <label className="form-label">New Email Address</label>
                <input
                  className="form-input"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="e.g. jdelacruz@gmail.com"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="form-label">Current Password</label>
                <div className="relative">
                  <input
                    className="form-input pr-10"
                    type={showEmailPassword ? 'text' : 'password'}
                    value={emailPassword}
                    onChange={(e) => setEmailPassword(e.target.value)}
                    placeholder="Confirm with your current password"
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
                  {requestingEmail ? 'Sending code...' : 'Send Verification Code'}
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