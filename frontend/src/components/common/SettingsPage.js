import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import API from '../../services/api';
import { Icons } from '../common';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleChangePassword = async (e) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Please fill out all password fields.');
      return;
    }

    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Change Password */}
        <div className="card p-6 lg:col-span-2">
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
                  placeholder="Min. 6 characters"
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

        {/* Account Info Sidebar */}
        <div className="card p-6">
          <h3 className="text-base font-semibold text-navy mb-4 flex items-center gap-2">
            <Icons.User className="w-4 h-4" /> Account Info
          </h3>
          <div className="space-y-4">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Name</p>
              <p className="text-[14px] font-medium text-gray-800">{user?.name || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Email</p>
              <p className="text-[14px] font-medium text-gray-800">{user?.email || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Role</p>
              <p className="text-[14px] font-medium text-gray-800">{user?.role || '—'}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Department</p>
              <p className="text-[14px] font-medium text-gray-800">{user?.department || '—'}</p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-gray-100">
            <p className="text-[11px] text-gray-400">
              To update your name, email, or other details, please contact the system administrator.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}