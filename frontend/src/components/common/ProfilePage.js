import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import API from '../../services/api';
import { setUser as persistUser } from '../../services/authStorage';
import { Icons, Avatar, Badge, ProgramBadge, roleLabel, StudentTypeBadge, RegularityBadge, studentYearLevelsLabel, CurrentSemesterTag } from '../common';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const { user, login } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Email isn't editable from here — changing it goes through Settings'
  // own "Change Email" flow (current-password confirmation + a verification
  // code sent to the new address), not a plain unverified text field.
  const [form, setForm] = useState({
    name: user?.name || '',
  });

  const roleBadgeColor = {
    Admin: 'green',
    Chairperson: 'orange',
    Faculty: 'purple',
    Student: 'blue',
  };

  const startEdit = () => {
    setForm({
      name: user?.name || '',
    });
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }

    setSaving(true);
    try {
      await API.put(`/users/${user.id}`, {
        name: form.name.trim(),
      });

      // Reload user data
      const res = await API.get('/auth/me');
      const userData = res.data?.user;
      if (userData) {
        persistUser(userData);
        // Force page reload to update user context
        window.location.reload();
      }

      toast.success('Profile updated successfully!');
      setEditing(false);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-navy">My Profile</h2>
          <p className="text-[13px] text-gray-500">{editing ? 'Edit your account information' : 'View your account information'}</p>
        </div>
        {!editing && user?.role === 'Admin' && (
          <button className="btn btn-gold text-sm" onClick={startEdit}>
            <Icons.Edit className="w-4 h-4" /> Edit Profile
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="card p-6 flex flex-col items-center text-center">
          <Avatar
            letter={user?.avatar || user?.name?.[0]}
            className="bg-navy text-white"
            size="w-20 h-20 text-3xl"
          />
          <h3 className="text-lg font-bold mt-4">{user?.name}</h3>
          <p className="text-sm text-gray-500 mt-1">{user?.email}</p>
          <div className="mt-3">
            <Badge variant={roleBadgeColor[user?.role] || 'blue'}>{roleLabel(user?.role)}</Badge>
          </div>
          <div className="mt-3">
            <Badge variant={user?.status === 'Active' ? 'green' : 'red'}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${user?.status === 'Active' ? 'bg-green-500' : 'bg-red-500'}`} />
              {user?.status}
            </Badge>
          </div>
        </div>

        {/* Details Card */}
        <div className="card p-6 lg:col-span-2">
          <h3 className="text-base font-semibold text-navy mb-4 flex items-center gap-2">
            <Icons.User className="w-4 h-4" /> Account Information
          </h3>

          {editing ? (
            /* ====== EDIT MODE ====== */
            <div className="space-y-4 max-w-lg">
              <div>
                <label className="form-label">Full Name</label>
                <input className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Enter your full name" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 pt-2">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Role</p>
                  <p className="text-[14px] font-medium text-gray-500">{user?.role} <span className="text-xs text-gray-400">(cannot be changed)</span></p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Account Status</p>
                  <p className="text-[14px] font-medium text-gray-500">{user?.status} <span className="text-xs text-gray-400">(cannot be changed)</span></p>
                </div>
              </div>

              <div className="flex gap-2 pt-3">
                <button className="btn btn-gold" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                <button className="btn btn-outline" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            /* ====== VIEW MODE ====== */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-5 gap-x-8">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Full Name</p>
                <p className="text-[14px] font-medium text-gray-800">{user?.name || '—'}</p>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Email Address</p>
                <p className="text-[14px] font-medium text-gray-800">{user?.email || '—'}</p>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Role</p>
                <p className="text-[14px] font-medium text-gray-800">{user?.role || '—'}</p>
              </div>

              {(user?.role === 'Faculty' || user?.role === 'Chairperson') && (
                <div className="sm:col-span-2">
                  <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">
                    {(user?.programs?.length > 1) ? 'Programs' : 'Program'}
                  </p>
                  {user?.employment_type === 'Part Time' ? (
                    <Badge variant="golden-yellow">Part Timer</Badge>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(user?.programs?.length > 0 ? user.programs : [user?.program]).filter(Boolean).map((p) => (
                        <ProgramBadge key={p} program={p} bs />
                      ))}
                      {!(user?.programs?.length > 0) && !user?.program && (
                        <span className="text-[14px] font-medium text-gray-800">—</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {user?.role === 'Student' && (
                <>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Student Number</p>
                    <p className="text-[14px] font-medium text-gray-800">{user?.student_no || '—'}</p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Program</p>
                    <p className="text-[14px] font-medium text-gray-800">{user?.program || '—'}</p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Year Level</p>
                    {/* An Irregular student taking classes across more than
                        one Year Level shows all of them here, not just the
                        primary pair's year_level. */}
                    <p className="text-[14px] font-medium text-gray-800">{studentYearLevelsLabel(user)}</p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Section</p>
                    <p className="text-[14px] font-medium text-gray-800">{user?.section || '—'}</p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Academic Year</p>
                    <CurrentSemesterTag className="!bg-gray-100" />
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Status</p>
                    <RegularityBadge status={user?.student_status} />
                  </div>

                  {user?.student_type && (
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Student Type</p>
                      <StudentTypeBadge status={user.student_type} />
                    </div>
                  )}

                  {user?.student_status === 'Irregular' && user?.irregular_sections?.length > 0 && (
                    <div className="sm:col-span-2">
                      <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Taking Classes In</p>
                      <div className="flex flex-wrap gap-1.5">
                        {user.irregular_sections.map((p, i) => (
                          <Badge key={i} variant="red">
                            Year {p.year_level} - Sec {p.section}{p.semester ? ` (${p.semester})` : ''}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Account Status</p>
                <p className="text-[14px] font-medium text-gray-800">{user?.status || '—'}</p>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1">Member Since</p>
                <p className="text-[14px] font-medium text-gray-800">
                  {user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}