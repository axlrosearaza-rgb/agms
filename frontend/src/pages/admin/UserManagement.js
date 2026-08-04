import { useState, useEffect, useCallback } from 'react';
import { Icons, Avatar, Badge, SearchBar, Modal, LoadingSpinner, ProgramBadge, ProgramDot, roleLabel } from '../../components/common';
import { userService } from '../../services';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

const ALL_ROLES = ['Student', 'Instructor', 'Chairperson'];
// One dedicated color per role category — distinct from the program palette so the
// two color systems (role vs. program) never get visually confused within a row.
const ROLE_META = {
  Student:     { header: 'bg-blue-600',   badge: 'bg-blue-50 text-blue-700',     icon: 'Users' },
  Instructor:  { header: 'bg-purple-600', badge: 'bg-purple-50 text-purple-700', icon: 'User' },
  Chairperson: { header: 'bg-orange-500', badge: 'bg-orange-50 text-orange-700', icon: 'Award' },
};
const PROGRAMS = [
  'Bachelor of Science in Information Technology',
  'Bachelor of Science in Information Systems',
  'Bachelor of Science in Psychology',
  'Bachelor of Science in Statistics',
];
const GE_OPTION = 'General Education (GE)';
const FACULTY_PROGRAMS = [...PROGRAMS, GE_OPTION];
const EMPLOYMENT_TYPES = ['Full Time', 'Part Time'];
const POSITIONS = ['Chairperson', 'Dean'];
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const emptyForm = {
  name: '', username: '', password: 'password123', role: 'Student',
  program: '', programs: [], department: '', student_no: '', year_level: 1, section: '',
  student_status: 'Regular', employee_no: '', employment_type: 'Full Time', position: 'Chairperson',
};

const statusBadge = (status) => {
  if (status === 'Active') return <Badge variant="green"><span className="w-1.5 h-1.5 rounded-full inline-block bg-green-500" /> Active</Badge>;
  if (status === 'Pending') return <Badge variant="yellow"><span className="w-1.5 h-1.5 rounded-full inline-block bg-yellow-500" /> Pending</Badge>;
  return <Badge variant="red"><span className="w-1.5 h-1.5 rounded-full inline-block bg-red-500" /> {status}</Badge>;
};

// ── Student grouping: Program → Year → Section (folded in from the old standalone
// Student Directory page — same structure, now living inside the Student box). ──
const groupStudents = (students) => {
  const grouped = {};
  students.forEach((s) => {
    const prog = s.program || 'No Program';
    const year = s.year_level ? `Year ${s.year_level}` : 'No Year';
    const sec = s.section || 'No Section';
    if (!grouped[prog]) grouped[prog] = {};
    if (!grouped[prog][year]) grouped[prog][year] = {};
    if (!grouped[prog][year][sec]) grouped[prog][year][sec] = [];
    grouped[prog][year][sec].push(s);
  });
  return grouped;
};

// ── Faculty grouping: Program → flat list. A faculty member with multiple
// `programs` tags appears once under each — no year/section for staff. ──
const groupFaculty = (faculty) => {
  const grouped = {};
  faculty.forEach((f) => {
    const tags = f.programs && f.programs.length > 0 ? f.programs : ['Unassigned'];
    tags.forEach((tag) => {
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push(f);
    });
  });
  return grouped;
};

function StudentGroupedView({ students, expanded, toggle, actions }) {
  const grouped = groupStudents(students);
  if (Object.keys(grouped).length === 0) {
    return <p className="text-center py-8 text-gray-400 text-sm">No students found.</p>;
  }
  return Object.entries(grouped).sort().map(([prog, years]) => {
    const progCount = Object.values(years).reduce((t, y) => t + Object.values(y).reduce((t2, s) => t2 + s.length, 0), 0);
    const key = `student:${prog}`;
    return (
      <div key={prog} className="border-b border-gray-100 last:border-0">
        <button onClick={() => toggle(key)} className="w-full flex items-center justify-between px-5 py-3 cursor-pointer border-none bg-gray-50/60 hover:bg-gray-100 font-sans transition-colors">
          <div className="flex items-center gap-2.5">
            <ProgramDot program={prog} />
            <span className="text-sm font-semibold text-gray-800">{prog}</span>
            <span className="text-xs text-gray-400">({progCount})</span>
          </div>
          {expanded[key] ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {expanded[key] && Object.entries(years).sort().map(([year, sections]) => {
          const yearKey = `${key}-${year}`;
          const yearCount = Object.values(sections).reduce((t, s) => t + s.length, 0);
          return (
            <div key={year}>
              <button onClick={() => toggle(yearKey)} className="w-full flex items-center justify-between pl-9 pr-5 py-2 cursor-pointer border-none border-t border-gray-50 bg-blue-50/40 hover:bg-blue-50 font-sans transition-colors">
                <div className="flex items-center gap-2">
                  <Icons.Flag className="w-3 h-3 text-blue-500" />
                  <span className="text-[13px] font-medium text-blue-700">{year}</span>
                  <span className="text-xs text-gray-400">({yearCount})</span>
                </div>
                {expanded[yearKey] ? <Icons.ChevronUp className="w-3 h-3 text-gray-400" /> : <Icons.ChevronDown className="w-3 h-3 text-gray-400" />}
              </button>
              {expanded[yearKey] && Object.entries(sections).sort().map(([sec, secStudents]) => {
                const secKey = `${yearKey}-${sec}`;
                return (
                  <div key={sec}>
                    <button onClick={() => toggle(secKey)} className="w-full flex items-center justify-between pl-14 pr-5 py-1.5 cursor-pointer border-none border-t border-gray-50 bg-white hover:bg-green-50/40 font-sans transition-colors">
                      <span className="text-[13px] text-gray-600">Section {sec}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="blue">{secStudents.length}</Badge>
                        {expanded[secKey] ? <Icons.ChevronUp className="w-3 h-3 text-gray-400" /> : <Icons.ChevronDown className="w-3 h-3 text-gray-400" />}
                      </div>
                    </button>
                    {expanded[secKey] && (
                      <table className="w-full">
                        <tbody>
                          {secStudents.sort((a, b) => a.name.localeCompare(b.name)).map((s) => (
                            <tr key={s.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                              <td className="pl-16 pr-2 py-2.5 w-1/3">
                                <div className="flex items-center gap-2.5">
                                  <Avatar letter={s.avatar || s.name?.[0]} className="bg-blue-500 text-white" size="w-7 h-7 text-xs" />
                                  <div>
                                    <p className="text-[13px] font-medium">{s.name}</p>
                                    <Badge variant={s.student_status === 'Irregular' ? 'orange' : 'gray'}>
                                      {s.student_status === 'Irregular' ? 'Irreg' : 'Reg'}
                                    </Badge>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2 py-2.5 text-[13px] text-gray-500">{s.student_no || '—'}</td>
                              <td className="px-2 py-2.5">{statusBadge(s.status)}</td>
                              <td className="px-2 py-2.5 text-right pr-5">{actions(s)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  });
}

function FacultyGroupedView({ role, faculty, expanded, toggle, actions }) {
  const grouped = groupFaculty(faculty);
  if (Object.keys(grouped).length === 0) {
    return <p className="text-center py-8 text-gray-400 text-sm">No {role === 'Instructor' ? 'faculty' : `${role.toLowerCase()}s`} found.</p>;
  }
  return Object.entries(grouped).sort().map(([prog, list]) => {
    const key = `faculty-${role}:${prog}`;
    return (
      <div key={prog} className="border-b border-gray-100 last:border-0">
        <button onClick={() => toggle(key)} className="w-full flex items-center justify-between px-5 py-3 cursor-pointer border-none bg-gray-50/60 hover:bg-gray-100 font-sans transition-colors">
          <div className="flex items-center gap-2.5">
            {prog === 'Unassigned' ? <span className="w-2 h-2 rounded-full bg-gray-300 inline-block" /> : <ProgramDot program={prog} />}
            <span className="text-sm font-semibold text-gray-800">{prog}</span>
            <span className="text-xs text-gray-400">({list.length})</span>
          </div>
          {expanded[key] ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {expanded[key] && (
          <table className="w-full">
            <tbody>
              {list.sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                <tr key={u.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="pl-10 pr-2 py-2.5 w-1/3">
                    <div className="flex items-center gap-2.5">
                      <Avatar letter={u.avatar || u.name?.[0]} className={`${ROLE_META[role].header} text-white`} size="w-7 h-7 text-xs" />
                      <div>
                        <p className="text-[13px] font-medium">{u.name}</p>
                        <p className="text-[11px] text-gray-400">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-[13px] text-gray-500">
                    {u.position === 'Dean' ? 'Dean' : roleLabel(role)}{u.employment_type === 'Part Time' ? ' · Part Time' : ''}
                  </td>
                  <td className="px-2 py-2.5">{statusBadge(u.status)}</td>
                  <td className="px-2 py-2.5 text-right pr-5">{actions(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  });
}

export default function UserManagement({ chairpersonMode = false }) {
  const { user: currentUser } = useAuth();
  // Chairpersons manage Student/Instructor only, scoped to their own program(s) —
  // Chairperson/Admin account creation stays Admin-only.
  const ROLES = chairpersonMode ? ['Student', 'Instructor'] : ALL_ROLES;
  const ROLE_ORDER = chairpersonMode ? ['Student', 'Instructor'] : ALL_ROLES;
  const myPrograms = chairpersonMode ? (currentUser?.programs || []) : PROGRAMS;
  const facultyProgramOptions = chairpersonMode ? myPrograms : FACULTY_PROGRAMS;

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [viewUser, setViewUser] = useState(null);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [expanded, setExpanded] = useState({});

  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Fetches every user in one go (not paginated) — needed since users are now
  // grouped into role boxes (each with its own Program/Year/Section sub-grouping)
  // instead of one tab-filtered table.
  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params = { all: true };
      if (search) params.search = search;
      const { data } = await userService.getAll(params);
      setUsers(data.users);
      setPagination(data.pagination);
    } catch (err) {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const openCreate = () => {
    setEditUser(null);
    setFormData({ ...emptyForm });
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditUser(user);
    setFormData({
      name: user.name || '',
      username: user.username || '',
      password: '',
      role: user.role || 'Student',
      program: user.program || '',
      programs: user.programs || [],
      department: user.department || '',
      student_no: user.student_no || '',
      year_level: user.year_level || 1,
      section: user.section || '',
      student_status: user.student_status || 'Regular',
      employee_no: user.employee_no || '',
      employment_type: user.employment_type || 'Full Time',
      position: user.position || 'Chairperson',
    });
    setShowModal(true);
  };

  const openView = async (user) => {
    try {
      const { data } = await userService.getById(user.id);
      setViewUser(data.user);
    } catch (err) {
      toast.error('Failed to load user details');
    }
  };

  const toggleFormProgram = (p) => {
    setFormData((prev) => {
      const has = prev.programs.includes(p);
      return { ...prev, programs: has ? prev.programs.filter((x) => x !== p) : [...prev.programs, p] };
    });
  };

  const handleSave = async () => {
    if (!formData.name || !formData.role) {
      toast.error('Name and role are required');
      return;
    }
    if (formData.role === 'Student') {
      if (!formData.student_no) {
        toast.error('Student ID Number is required');
        return;
      }
      if (!formData.program) {
        toast.error('Please select a program');
        return;
      }
    } else {
      if (!formData.username) {
        toast.error('Username is required for Instructor/Chairperson accounts');
        return;
      }
      if (!formData.programs || formData.programs.length === 0) {
        toast.error('Select at least one program they teach in');
        return;
      }
    }
    if (!editUser && !formData.password) {
      toast.error('Password is required for new users');
      return;
    }
    try {
      setSaving(true);
      const saveData = { ...formData, department: 'College of Arts and Sciences' };
      if (editUser) {
        if (!saveData.password) delete saveData.password;
        await userService.update(editUser.id, saveData);
        toast.success('User updated successfully');
      } else {
        await userService.create(saveData);
        toast.success('User created successfully');
      }
      setShowModal(false);
      setEditUser(null);
      setFormData({ ...emptyForm });
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save user');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (id, name) => {
    if (!window.confirm(`Deactivate ${name}?`)) return;
    try {
      await userService.deactivate(id);
      toast.success('User deactivated');
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to deactivate');
    }
  };

  const handleReactivate = async (user) => {
    try {
      await userService.update(user.id, { status: 'Active' });
      toast.success('User reactivated');
      loadUsers();
    } catch (err) {
      toast.error('Failed to reactivate');
    }
  };

  const allUsers = users.filter((u) => u.role !== 'Admin' && u.status !== 'Pending');

  const visibleUsers = allUsers.filter((u) => {
    if (!programFilter) return true;
    if (u.role === 'Student') return u.program === programFilter;
    return (u.programs || []).includes(programFilter);
  });

  const usersByRole = ROLE_ORDER.reduce((acc, role) => {
    acc[role] = visibleUsers.filter((u) => u.role === role);
    return acc;
  }, {});

  const renderActions = (u) => (
    <div className="flex gap-1.5 justify-end">
      <button className="btn-icon" onClick={() => openView(u)} title="View"><Icons.Eye /></button>
      <button className="btn-icon" onClick={() => openEdit(u)} title="Edit"><Icons.Edit /></button>
      {u.status === 'Active' ? (
        <button className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => handleDeactivate(u.id, u.name)} title="Deactivate">
          <Icons.Trash />
        </button>
      ) : (
        <button className="btn-icon hover:!bg-green-50 hover:!text-green-500" onClick={() => handleReactivate(u)} title="Reactivate">
          <Icons.Check />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">User Management</h2>
          <p className="text-[13px] text-gray-500">
            {chairpersonMode
              ? `Manage students and faculty in your program(s) (${pagination.total} total)`
              : `Manage students, faculty, and chairpersons (${pagination.total} total)`}
          </p>
        </div>
        <button className="btn btn-gold" onClick={openCreate}>
          <Icons.Plus /> Add New User
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by name, username, or student number..." />
        <select
          className="form-select w-auto min-w-[320px] text-sm py-2.5"
          value={programFilter}
          onChange={(e) => setProgramFilter(e.target.value)}
        >
          <option value="">All Programs</option>
          {myPrograms.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>

      {loading ? <LoadingSpinner /> : (
        <div className="space-y-6">
          {ROLE_ORDER.map((role) => {
            const meta = ROLE_META[role];
            const roleUsers = usersByRole[role];
            const RoleIcon = Icons[meta.icon];

            return (
              <div key={role} className="card overflow-hidden">
                <div className={`px-5 py-3.5 ${meta.header} text-white flex items-center gap-3`}>
                  <RoleIcon className="w-4 h-4 opacity-90" />
                  <h3 className="text-sm font-semibold">{role === 'Instructor' ? 'Faculty' : `${role}s`}</h3>
                  <span className="text-xs opacity-75 font-normal">({roleUsers.length})</span>
                </div>
                {role === 'Student' ? (
                  <StudentGroupedView students={roleUsers} expanded={expanded} toggle={toggle} actions={renderActions} />
                ) : (
                  <FacultyGroupedView role={role} faculty={roleUsers} expanded={expanded} toggle={toggle} actions={renderActions} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <Modal
          title={editUser ? `Edit User — ${editUser.name}` : 'Add New User'}
          onClose={() => { setShowModal(false); setEditUser(null); }}
          size="max-w-xl"
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setShowModal(false); setEditUser(null); }}>Cancel</button>
              <button className="btn btn-gold" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : editUser ? 'Update User' : 'Create User'}
              </button>
            </>
          }
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="form-label">Full Name <span className="text-red-500">*</span></label>
              <input className="form-input" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="Enter full name" />
            </div>
            <div>
              <label className="form-label">{editUser ? 'New Password (leave blank to keep)' : 'Password *'}</label>
              <div className="relative">
                <input
                  className="form-input pr-10"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={editUser ? 'Leave blank to keep current' : 'Enter password'}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 p-1">
                  {showPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="form-label">Role <span className="text-red-500">*</span></label>
              <select className="form-select" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            {formData.role !== 'Student' && (
              <div>
                <label className="form-label">Username <span className="text-red-500">*</span></label>
                <input className="form-input" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} placeholder="e.g. jdelacruz" autoComplete="off" />
                <p className="text-[11px] text-gray-400 mt-1">This is what they'll use to log in.</p>
              </div>
            )}

            {formData.role === 'Student' ? (
              <>
                <div>
                  <label className="form-label">Program <span className="text-red-500">*</span></label>
                  <select className="form-select" value={formData.program} onChange={(e) => setFormData({ ...formData, program: e.target.value })}>
                    <option value="">Select Program</option>
                    {myPrograms.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Student Type</label>
                  <select className="form-select" value={formData.student_status} onChange={(e) => setFormData({ ...formData, student_status: e.target.value })}>
                    <option value="Regular">Regular</option>
                    <option value="Irregular">Irregular</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Student Number <span className="text-red-500">*</span></label>
                  <input className="form-input" value={formData.student_no} onChange={(e) => setFormData({ ...formData, student_no: e.target.value })} placeholder="e.g. 2024-0001" />
                </div>
                <div>
                  <label className="form-label">Year Level</label>
                  <select className="form-select" value={formData.year_level} onChange={(e) => setFormData({ ...formData, year_level: parseInt(e.target.value) })}>
                    {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Section {formData.student_status === 'Irregular' && <span className="text-red-500">*</span>}</label>
                  <select className="form-select" value={formData.section} onChange={(e) => setFormData({ ...formData, section: e.target.value })}>
                    <option value="">— No Section —</option>
                    {SECTIONS.map((s) => <option key={s} value={s}>Section {s}</option>)}
                  </select>
                </div>
              </>
            ) : (
              <>
                <div className="sm:col-span-2">
                  <label className="form-label">Programs Taught <span className="text-red-500">*</span></label>
                  <div className="grid grid-cols-2 gap-2 border border-gray-200 rounded-lg p-3">
                    {facultyProgramOptions.map((p) => (
                      <label key={p} className="flex items-center gap-2 text-[13px] cursor-pointer">
                        <input type="checkbox" checked={formData.programs.includes(p)} onChange={() => toggleFormProgram(p)} />
                        {p}
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Select every program this person teaches in (e.g. an IT instructor who also teaches IS classes).</p>
                </div>
                <div>
                  <label className="form-label">Employment Type</label>
                  <select className="form-select" value={formData.employment_type} onChange={(e) => setFormData({ ...formData, employment_type: e.target.value })}>
                    {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                {formData.role === 'Chairperson' && (
                  <div>
                    <label className="form-label">Position</label>
                    <select className="form-select" value={formData.position} onChange={(e) => setFormData({ ...formData, position: e.target.value })}>
                      {POSITIONS.map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="form-label">Employee Number</label>
                  <input className="form-input" value={formData.employee_no} onChange={(e) => setFormData({ ...formData, employee_no: e.target.value })} placeholder="e.g. 45345" />
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* VIEW USER MODAL */}
      {viewUser && (
        <Modal
          title="User Details"
          onClose={() => setViewUser(null)}
          footer={
            <button className="btn btn-outline" onClick={() => setViewUser(null)}>Close</button>
          }
        >
          <div className="flex items-center gap-4 mb-5">
            <Avatar letter={viewUser.avatar || viewUser.name?.[0]} className="bg-navy text-white" size="w-14 h-14 text-xl" />
            <div>
              <h3 className="text-lg font-bold">{viewUser.name}</h3>
              <p className="text-sm text-gray-500">{viewUser.username ? `@${viewUser.username}` : viewUser.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Role:</span> <span className="font-medium ml-1">{viewUser.position === 'Dean' ? 'Dean' : viewUser.role}</span></div>
            <div>
              <span className="text-gray-500">Status:</span>{' '}
              <Badge variant={viewUser.status === 'Active' ? 'green' : viewUser.status === 'Pending' ? 'yellow' : 'red'}>{viewUser.status}</Badge>
            </div>
            {viewUser.username && <div><span className="text-gray-500">Username:</span> <span className="font-medium ml-1">{viewUser.username}</span></div>}
            {viewUser.email && <div><span className="text-gray-500">Email:</span> <span className="font-medium ml-1">{viewUser.email}</span></div>}
            {viewUser.program && <div className="col-span-2"><span className="text-gray-500">Program:</span> <span className="ml-1"><ProgramBadge program={viewUser.program} /></span></div>}
            {viewUser.programs && viewUser.programs.length > 0 && (
              <div className="col-span-2">
                <span className="text-gray-500">Programs Taught:</span>{' '}
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  {viewUser.programs.map((p) => <ProgramBadge key={p} program={p} short />)}
                </span>
              </div>
            )}
            {viewUser.employment_type && <div><span className="text-gray-500">Employment:</span> <span className="font-medium ml-1">{viewUser.employment_type}</span></div>}
            {viewUser.student_status && viewUser.role === 'Student' && <div><span className="text-gray-500">Student Type:</span> <span className="font-medium ml-1">{viewUser.student_status}</span></div>}
            {viewUser.department && <div className="col-span-2"><span className="text-gray-500">College:</span> <span className="font-medium ml-1">{viewUser.department}</span></div>}
            {viewUser.student_no && <div><span className="text-gray-500">Student No:</span> <span className="font-medium ml-1">{viewUser.student_no}</span></div>}
            {viewUser.year_level && <div><span className="text-gray-500">Year Level:</span> <span className="font-medium ml-1">Year {viewUser.year_level}</span></div>}
            {viewUser.section && <div><span className="text-gray-500">Section:</span> <span className="font-medium ml-1">Section {viewUser.section}</span></div>}
            {viewUser.irregular_sections && viewUser.irregular_sections.length > 0 && (
              <div className="col-span-2">
                <span className="text-gray-500">Taking Classes In:</span>{' '}
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  {viewUser.irregular_sections.map((p, i) => (
                    <Badge key={i} variant="orange">Year {p.year_level} - Sec {p.section}{p.semester ? ` (${p.semester})` : ''}</Badge>
                  ))}
                </span>
              </div>
            )}
            {viewUser.employee_no && <div><span className="text-gray-500">Employee No:</span> <span className="font-medium ml-1">{viewUser.employee_no}</span></div>}
            {viewUser.academic_rank && <div><span className="text-gray-500">Academic Rank:</span> <span className="font-medium ml-1">{viewUser.academic_rank}</span></div>}
            {viewUser.specialization && <div className="col-span-2"><span className="text-gray-500">Specialization:</span> <span className="font-medium ml-1">{viewUser.specialization}</span></div>}
            {viewUser.highest_education && <div><span className="text-gray-500">Highest Education:</span> <span className="font-medium ml-1">{viewUser.highest_education}</span></div>}
          </div>
        </Modal>
      )}
    </>
  );
}
