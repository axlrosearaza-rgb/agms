import { useState, useEffect, useCallback } from 'react';
import { Icons, Avatar, Badge, SearchBar, Modal, LoadingSpinner, ProgramBadge, FacultyProgramTags, roleLabel, StatCard, EmptyState, ConfirmDialog, STUDENT_TYPES, studentTypeLabel, StudentTypeBadge, REGULARITY_OPTIONS, RegularityBadge, PresenceDot, PresenceLabel, formatStudentName, compareStudentNames, ProgramDot, programShortLabel } from '../../components/common';
import StudentGradeRecordModal from '../../components/common/StudentGradeRecordModal';
import { userService } from '../../services';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { usePageState } from '../../hooks/usePageState';
import { usePresence } from '../../hooks/usePresence';

const ALL_ROLES = ['Student', 'Faculty', 'Chairperson'];
// One dedicated color per role category — distinct from the program palette so the
// two color systems (role vs. program) never get visually confused within a row.
const ROLE_META = {
  Student:     { header: 'bg-blue-600',   badge: 'bg-blue-50 text-blue-700',     icon: 'Users' },
  Faculty:     { header: 'bg-purple-600', badge: 'bg-purple-50 text-purple-700', icon: 'User' },
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
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Default password for a new account — Faculty/Chairperson can change it
// afterward from their own Settings page (Change Password, calling PUT /auth/password).
const DEFAULT_PASSWORD = '123456';
const EMPLOYMENT_TYPES = ['Full Time', 'Part Time'];

const emptyForm = {
  name: '', email: '', username: '', password: DEFAULT_PASSWORD, role: 'Student',
  program: '', programs: [], department: '', student_no: '', year_level: 1, section: '',
  student_status: 'Regular', student_type: '', position: 'Chairperson', is_teaching: false, employment_type: 'Full Time',
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
// *real* program tags appears once under each — no year/section for staff.
// GE is excluded as a grouping key on purpose: it's a bonus tag on top of a
// real program, not a department of its own, so a GE-teaching instructor
// shows up inside their actual program's section (with a "GE" badge on their
// row, see FacultyGroupedView) rather than off in a separate GE-only group. ──
const groupFaculty = (faculty) => {
  const grouped = {};
  faculty.forEach((f) => {
    const realPrograms = (f.programs || []).filter((p) => p !== GE_OPTION);
    const tags = realPrograms.length > 0 ? realPrograms : (f.programs || []).length > 0 ? f.programs : ['Unassigned'];
    tags.forEach((tag) => {
      if (!grouped[tag]) grouped[tag] = [];
      grouped[tag].push(f);
    });
  });
  return grouped;
};

// Regular vs. Irregular split for any list of students — shared by the
// Program/Year/Section header rows below so all three levels break the same
// count down the same way, not just the program's own top-line total.
const regIrregCounts = (list) => ({
  regular: list.filter((s) => s.student_status !== 'Irregular').length,
  irregular: list.filter((s) => s.student_status === 'Irregular').length,
});

// Fixed widths on the two badges (instead of letting each hug its own digit
// count) so "Regular"/"Irregular" line up in their own column across every
// row of a table, no matter how many digits that row's own counts happen to
// have — otherwise a "608 Regular" row and a "26 Regular" row land their
// badges at different x-positions and the whole block reads as scattered
// rather than tabular.
function RegIrregBadges({ list, className = '' }) {
  const { regular, irregular } = regIrregCounts(list);
  return (
    <span className={`flex items-center gap-2 flex-shrink-0 whitespace-nowrap ${className}`}>
      <Badge variant="green" className="whitespace-nowrap justify-center w-[92px] tabular-nums">{regular} Regular</Badge>
      <Badge variant="red" className="whitespace-nowrap justify-center w-[92px] tabular-nums">{irregular} Irregular</Badge>
    </span>
  );
}

function StudentGroupedView({ students, expanded, toggle, actions, presence }) {
  const grouped = groupStudents(students);
  if (Object.keys(grouped).length === 0) {
    return <EmptyState icon={<Icons.Users className="w-8 h-8 opacity-30" />} title="No students found" description="Try a different search or program filter." />;
  }
  return Object.entries(grouped).sort().map(([prog, years]) => {
    const progStudents = Object.values(years).flatMap((y) => Object.values(y).flat());
    const progCount = progStudents.length;
    const key = `student:${prog}`;
    return (
      <div key={prog} className="border-b border-gray-100 last:border-0">
        <button onClick={() => toggle(key)} className="w-full flex items-center justify-between gap-3 px-5 py-3 cursor-pointer border-none bg-gray-50/60 hover:bg-gray-100 font-sans transition-colors">
          <div className="flex items-center gap-2.5 min-w-0">
            <ProgramBadge program={prog} bs size="lg" />
            <span className="text-xs text-gray-400 flex-shrink-0">({progCount})</span>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Regular vs. Irregular breakdown, on the right side of each
                level's own header — an "Irregular" student here means one
                taking classes off their normal Year/Section track (see
                student_status), so this is visible at the Program, Year, and
                Section levels alike instead of only after drilling all the
                way down. */}
            <RegIrregBadges list={progStudents} />
            <span className="w-4 flex justify-center flex-shrink-0">
              {expanded[key] ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
            </span>
          </div>
        </button>
        {expanded[key] && Object.entries(years).sort().map(([year, sections]) => {
          const yearKey = `${key}-${year}`;
          const yearStudents = Object.values(sections).flat();
          const yearCount = yearStudents.length;
          return (
            <div key={year}>
              <button onClick={() => toggle(yearKey)} className="w-full flex items-center justify-between gap-3 pl-9 pr-5 py-2 cursor-pointer border-none border-t border-gray-50 bg-blue-50/40 hover:bg-blue-50 font-sans transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <Icons.Flag className="w-3 h-3 text-blue-500 flex-shrink-0" />
                  <span className="text-[13px] font-medium text-blue-700 flex-shrink-0">{year}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">({yearCount})</span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <RegIrregBadges list={yearStudents} />
                  <span className="w-4 flex justify-center flex-shrink-0">
                    {expanded[yearKey] ? <Icons.ChevronUp className="w-3 h-3 text-gray-400" /> : <Icons.ChevronDown className="w-3 h-3 text-gray-400" />}
                  </span>
                </div>
              </button>
              {expanded[yearKey] && Object.entries(sections).sort().map(([sec, secStudents]) => {
                const secKey = `${yearKey}-${sec}`;
                return (
                  <div key={sec}>
                    <button onClick={() => toggle(secKey)} className="w-full flex items-center justify-between gap-3 pl-14 pr-5 py-1.5 cursor-pointer border-none border-t border-gray-50 bg-white hover:bg-green-50/40 font-sans transition-colors">
                      <span className="text-[13px] text-gray-600 flex-shrink-0">Section {sec}</span>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <RegIrregBadges list={secStudents} />
                        {/* Section's own grand total — otherwise a bare
                            number sitting next to "Regular"/"Irregular" reads
                            as a third, unlabeled count instead of their sum. */}
                        <Badge variant="blue" className="whitespace-nowrap tabular-nums w-[104px] justify-center">{secStudents.length} Total</Badge>
                        <span className="w-4 flex justify-center flex-shrink-0">
                          {expanded[secKey] ? <Icons.ChevronUp className="w-3 h-3 text-gray-400" /> : <Icons.ChevronDown className="w-3 h-3 text-gray-400" />}
                        </span>
                      </div>
                    </button>
                    {expanded[secKey] && (
                      <div className="overflow-x-auto">
                      <table className="w-full">
                        <tbody>
                          {secStudents.sort(compareStudentNames).map((s, idx) => (
                            <tr
                              key={s.id}
                              className={`border-t border-gray-50 transition-[filter,opacity] duration-150 hover:!blur-none hover:!opacity-100 ${
                                s.status === 'Active' ? 'hover:bg-gray-50/50' : 'blur-[1.5px] opacity-50 hover:bg-gray-50/50'
                              }`}
                            >
                              <td className="pl-16 pr-1 py-2.5 w-8 text-xs text-gray-400 text-right">{idx + 1}.</td>
                              <td className="pr-2 py-2.5 w-1/3">
                                <div className="flex items-center gap-2.5">
                                  <div className="relative flex-shrink-0">
                                    <Avatar letter={s.avatar || s.name?.[0]} className="bg-blue-500 text-white" size="w-7 h-7 text-xs" />
                                    <PresenceDot presence={presence?.[s.id]} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" />
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <p className="text-[13px] font-medium">{formatStudentName(s.name)}</p>
                                      <RegularityBadge status={s.student_status} />
                                      <StudentTypeBadge status={s.student_type} />
                                    </div>
                                    <PresenceLabel presence={presence?.[s.id]} />
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
                      </div>
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

// One row of the faculty/chairperson table — shared by both the per-program
// groups and the standalone Part-Time container below, so the two containers
// never drift out of sync visually.
function FacultyRow({ role, u, actions, presence }) {
  return (
    <tr
      className={`border-t border-gray-50 transition-[filter,opacity] duration-150 hover:!blur-none hover:!opacity-100 ${
        u.status === 'Active' ? 'hover:bg-gray-50/50' : 'blur-[1.5px] opacity-50 hover:bg-gray-50/50'
      }`}
    >
      <td className="pl-10 pr-2 py-2.5 w-1/3">
        <div className="flex items-center gap-2.5">
          <div className="relative flex-shrink-0">
            <Avatar letter={u.avatar || u.name?.[0]} className={`${ROLE_META[role].header} text-white`} size="w-7 h-7 text-xs" />
            <PresenceDot presence={presence?.[u.id]} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-white" />
          </div>
          <div>
            <p className="text-[13px] font-medium">{u.name}</p>
            <p className="text-[11px] text-gray-400">@{u.username}</p>
            <PresenceLabel presence={presence?.[u.id]} />
          </div>
        </div>
      </td>
      <td className="px-2 py-2.5 text-[13px] text-gray-500">
        {u.position === 'Dean' ? 'Dean' : roleLabel(role)}{u.is_teaching ? ' · Also Teaching' : ''}
        {(u.programs || []).includes(GE_OPTION) && <Badge variant="gray" className="ml-1.5">GE</Badge>}
      </td>
      <td className="px-2 py-2.5">{statusBadge(u.status)}</td>
      <td className="px-2 py-2.5 text-right pr-5">{actions(u)}</td>
    </tr>
  );
}

function FacultyGroupedView({ role, faculty, expanded, toggle, actions, presence }) {
  // Part-Time faculty are tagged with every program just so every
  // Chairperson can find them — grouping them under each program's header
  // like a real assignment would misrepresent that. They get pulled into
  // their own standalone container instead, separate from the per-program
  // groups (which are Full Time only from here on).
  const partTime = role === 'Faculty' ? faculty.filter((u) => u.employment_type === 'Part Time') : [];
  const fullTime = role === 'Faculty' ? faculty.filter((u) => u.employment_type !== 'Part Time') : faculty;

  const grouped = groupFaculty(fullTime);
  const hasProgramGroups = Object.keys(grouped).length > 0;

  if (!hasProgramGroups && partTime.length === 0) {
    return <EmptyState icon={<Icons.User className="w-8 h-8 opacity-30" />} title={`No ${role === 'Faculty' ? 'faculty' : `${role.toLowerCase()}s`} found`} description="Try a different search or program filter." />;
  }

  return (
    <>
      {Object.entries(grouped).sort().map(([prog, list]) => {
        const key = `faculty-${role}:${prog}`;
        return (
          <div key={prog} className="border-b border-gray-100 last:border-0">
            <button onClick={() => toggle(key)} className="w-full flex items-center justify-between px-5 py-3 cursor-pointer border-none bg-gray-50/60 hover:bg-gray-100 font-sans transition-colors">
              <div className="flex items-center gap-2.5">
                <ProgramBadge program={prog} bs size="lg" />
                <span className="text-xs text-gray-400">({list.length})</span>
              </div>
              {expanded[key] ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>
            {expanded[key] && (
              <div className="overflow-x-auto">
              <table className="w-full">
                <tbody>
                  {list.sort(compareStudentNames).map((u) => <FacultyRow key={u.id} role={role} u={u} actions={actions} presence={presence} />)}
                </tbody>
              </table>
              </div>
            )}
          </div>
        );
      })}

      {partTime.length > 0 && (
        <div className="border-b border-gray-100 last:border-0">
          <button onClick={() => toggle('faculty-parttime')} className="w-full flex items-center justify-between px-5 py-3 cursor-pointer border-none bg-amber-50/60 hover:bg-amber-100 font-sans transition-colors">
            <div className="flex items-center gap-2.5">
              <Badge variant="yellow" className="text-base px-4 py-1.5 font-bold">Part-Time Faculty</Badge>
              <span className="text-xs text-gray-400">({partTime.length})</span>
            </div>
            {expanded['faculty-parttime'] ? <Icons.ChevronUp className="w-4 h-4 text-gray-400" /> : <Icons.ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {expanded['faculty-parttime'] && (
            <div className="overflow-x-auto">
            <table className="w-full">
              <tbody>
                {partTime.sort(compareStudentNames).map((u) => <FacultyRow key={u.id} role={role} u={u} actions={actions} presence={presence} />)}
              </tbody>
            </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// facultyMode is the Faculty sidebar's "Students List" — the Chairperson's
// User Management stripped down to a read-only, students-only view of the
// caller's own program(s): no tabs for other roles, no Add/Edit/Delete/
// Reactivate — just search, filters, and View / View Grades on each student.
export default function UserManagement({ chairpersonMode = false, facultyMode = false }) {
  const { user: currentUser } = useAuth();
  // Both staff modes are scoped to the caller's own programs (the backend
  // already enforces it) — Admin is the only one who sees everything.
  const programScoped = chairpersonMode || facultyMode;
  // Viewing/editing still covers Student + Faculty (+ Chairperson for Admin) —
  // only *creation* is narrowed below. Students self-register (see
  // authController.register) and are verified rather than manually created, so
  // neither side ever creates one here: Admins seed the Chairperson for each
  // program, and each Chairperson in turn staffs their own program(s) with Faculty.
  const ROLES = facultyMode ? ['Student'] : chairpersonMode ? ['Student', 'Faculty'] : ALL_ROLES;
  const ROLE_ORDER = facultyMode ? ['Student'] : chairpersonMode ? ['Student', 'Faculty'] : ALL_ROLES;
  // Faculty's Students List covers every program (see userController.getUsers),
  // so its Program filter offers all of them — only Chairperson is narrowed
  // to their own program(s).
  const myPrograms = chairpersonMode ? (currentUser?.programs || []) : PROGRAMS;
  // Chairpersons may also tag a new Faculty account as teaching General Education —
  // GE spans every program, so it's offered alongside their own program(s) rather
  // than being scoped to them like a real program would be.
  const facultyProgramOptions = chairpersonMode
    ? (myPrograms.includes(GE_OPTION) ? myPrograms : [...myPrograms, GE_OPTION])
    : FACULTY_PROGRAMS;

  // Filters/tab/pagination/expanded groups persist across navigation (see
  // usePageState) — separately keyed per mode so Admin's own filters and a
  // Chairperson's don't bleed into each other on the shared component.
  const pk = facultyMode ? 'UserManagement.faculty' : chairpersonMode ? 'UserManagement.chairperson' : 'UserManagement.admin';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = usePageState(`${pk}.search`, '');
  const [programFilter, setProgramFilter] = usePageState(`${pk}.programFilter`, '');
  const [yearFilter, setYearFilter] = usePageState(`${pk}.yearFilter`, '');
  const [sectionFilter, setSectionFilter] = usePageState(`${pk}.sectionFilter`, '');
  const [activeRole, setActiveRole] = usePageState(`${pk}.activeRole`, ROLE_ORDER[0]);
  // Admin used to be limited to creating Chairperson accounts only — now
  // follows whichever tab (Faculty/Chairperson) is active, same as
  // Chairperson mode already follows its own single tab. Students are never
  // created here either way (self-registration), so this only matters when
  // the Student tab isn't the active one — see the "Add New" button below.
  const CREATE_ROLE = chairpersonMode ? 'Faculty' : (activeRole === 'Student' ? 'Faculty' : activeRole);
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [viewUser, setViewUser] = useState(null);
  const [gradesTarget, setGradesTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pagination, setPagination] = usePageState(`${pk}.pagination`, { page: 1, pages: 1, total: 0 });
  const [expanded, setExpanded] = usePageState(`${pk}.expanded`, {});

  const toggle = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Fetches every user in one go (not paginated) — needed since users are now
  // grouped into role boxes (each with its own Program/Year/Section sub-grouping)
  // instead of one tab-filtered table.
  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params = { all: true };
      // Faculty's / a teaching Chairperson's Students List spans every program;
      // Chairperson's own User Management (no facultyMode) stays program-scoped.
      if (facultyMode) params.all_programs = true;
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
    setFormData({ ...emptyForm, role: CREATE_ROLE });
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditUser(user);
    setFormData({
      name: user.name || '',
      email: user.email || '',
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
      student_type: user.student_type || '',
      position: user.position || 'Chairperson',
      is_teaching: !!user.is_teaching,
      employment_type: user.employment_type || 'Full Time',
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
    if (!formData.email || !formData.email.trim()) {
      toast.error('Email is required — it\'s how they\'ll recover a forgotten password.');
      return;
    }
    if (formData.role === 'Student') {
      if (!formData.student_no) {
        toast.error('Student ID Number is required');
        return;
      }
      if (!/^\d{6}$/.test(formData.student_no.trim())) {
        toast.error('Student Number must be exactly 6 digits');
        return;
      }
      if (!formData.program) {
        toast.error('Please select a program');
        return;
      }
    } else {
      if (!formData.username) {
        toast.error('Username is required for Faculty/Chairperson accounts');
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
        // Password is set once at creation and afterward is only ever changed
        // by the account owner themselves, from their own Settings page — never
        // sent on an edit, whether it's a student's self-chosen password or a
        // staff account's default one (backend ignores it here too either way).
        delete saveData.password;
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await userService.delete(deleteTarget.id);
      toast.success('Account permanently deleted');
      setDeleteTarget(null);
      loadUsers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
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

  // Part-Time faculty are tagged with every program purely so Admin can find
  // them from a single "Part-Time Faculty" container — they're not really
  // staffed to any one Chairperson's program, so they don't belong in the
  // Chairperson's own Faculty list at all (only Admin manages them).
  const allUsers = users.filter((u) =>
    u.role !== 'Admin' &&
    u.status !== 'Pending' &&
    u.status !== 'Rejected' &&
    !(chairpersonMode && u.role === 'Faculty' && u.employment_type === 'Part Time')
  );

  const visibleUsers = allUsers.filter((u) => {
    if (programFilter) {
      const inProgram = u.role === 'Student' ? u.program === programFilter : (u.programs || []).includes(programFilter);
      if (!inProgram) return false;
    }
    // Year/Section only ever apply to Students — Faculty/Chairperson rows never
    // get filtered out by them, so switching to those tabs stays unaffected.
    if (u.role === 'Student') {
      if (yearFilter && String(u.year_level) !== yearFilter) return false;
      if (sectionFilter && u.section !== sectionFilter) return false;
    }
    return true;
  });

  const usersByRole = ROLE_ORDER.reduce((acc, role) => {
    acc[role] = visibleUsers.filter((u) => u.role === role);
    return acc;
  }, {});

  // Online/offline for whoever's actually visible on the current tab —
  // scoped to just that (not every loaded user across every role) so this
  // doesn't balloon into a request for the whole account list at once.
  const presence = usePresence((usersByRole[activeRole] || []).map((u) => u.id));

  // Admin and Chairperson both lose edit rights over a Student's info once
  // they're verified (status Active) — matches the same rule the backend
  // enforces in userController.updateUser.
  const editLocked = (u) => u.role === 'Student' && u.status === 'Active';

  const renderActions = (u) => (
    <div className="flex gap-1.5 justify-end">
      <button className="btn-icon" onClick={() => openView(u)} title="View"><Icons.Eye /></button>
      {u.role === 'Student' && (
        // A read-only copy of this student's full curriculum record — every
        // subject, Year 1 through 4, with their overall GWA — the same view
        // the student themselves sees on My Grades, pulled up here so Admin/
        // Chairperson don't have to go looking for it separately.
        <button className="btn-icon" onClick={() => setGradesTarget(u)} title="View Grades (1st-4th Year + GWA)"><Icons.FileText /></button>
      )}
      {!facultyMode && (editLocked(u) ? (
        <button className="btn-icon opacity-40 cursor-not-allowed" disabled title="Verified — info can no longer be edited">
          <Icons.Lock />
        </button>
      ) : (
        <button className="btn-icon" onClick={() => openEdit(u)} title="Edit"><Icons.Edit /></button>
      ))}
      {!facultyMode && u.status !== 'Active' && (
        <button className="btn-icon hover:!bg-green-50 hover:!text-green-500" onClick={() => handleReactivate(u)} title="Reactivate">
          <Icons.Check />
        </button>
      )}
      {!facultyMode && u.role !== 'Student' && (
        <button className="btn-icon hover:!bg-red-50 hover:!text-red-500" onClick={() => setDeleteTarget(u)} title="Delete permanently">
          <Icons.Trash />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
        <div>
          <h2 className="text-lg font-bold text-navy">{facultyMode ? 'Students List' : 'User Management'}</h2>
          <p className="text-[13px] text-gray-500">
            {facultyMode
              ? `View the students in all programs and their grade records (${usersByRole.Student?.length || 0} total)`
              : chairpersonMode
                ? `View students and faculty, and create Faculty accounts in your program(s) (${pagination.total} total)`
                : `View students and faculty, and create Chairperson or Faculty accounts (${pagination.total} total)`}
          </p>
        </div>
        {activeRole !== 'Student' && (
          <button className="btn btn-gold" onClick={openCreate}>
            <Icons.Plus /> Add New {CREATE_ROLE}
          </button>
        )}
      </div>

      {/* Overview */}
      {facultyMode ? (
        // One tile per program instead of a single all-students total — the
        // list below is grouped by program too, so this doubles as the way to
        // jump straight to one: clicking a tile filters to that program (click
        // again to clear), same as picking it from the Program dropdown.
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {PROGRAMS.map((p) => {
            const count = allUsers.filter((u) => u.role === 'Student' && u.program === p).length;
            const active = programFilter === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setProgramFilter(active ? '' : p)}
                title={p}
                className={`stat-card text-left cursor-pointer font-sans border-2 transition-colors ${active ? 'border-navy bg-blue-50/40' : 'border-transparent hover:border-gray-200'}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 mb-1 flex items-center gap-1.5">
                    <ProgramDot program={p} />
                    {programShortLabel(p)}
                  </p>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">student{count !== 1 ? 's' : ''}</p>
                </div>
                <div className="stat-icon bg-blue-50 text-blue-600 flex-shrink-0"><Icons.Users /></div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={`grid grid-cols-2 ${chairpersonMode ? 'sm:grid-cols-2' : 'sm:grid-cols-3'} gap-4 mb-6`}>
          <StatCard label="Students" value={usersByRole.Student?.length || 0} icon={<Icons.Users />} iconBg="bg-blue-50 text-blue-600" />
          <StatCard label="Faculty" value={usersByRole.Faculty?.length || 0} icon={<Icons.User />} iconBg="bg-purple-50 text-purple-600" />
          {!programScoped && (
            <StatCard label="Chairpersons" value={usersByRole.Chairperson?.length || 0} icon={<Icons.Award />} iconBg="bg-orange-50 text-orange-600" />
          )}
        </div>
      )}

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
        {activeRole === 'Student' && (
          <>
            <select
              className="form-select w-auto min-w-[130px] text-sm py-2.5"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
            >
              <option value="">All Years</option>
              {[1, 2, 3, 4].map((y) => <option key={y} value={y}>Year {y}</option>)}
            </select>
            <select
              className="form-select w-auto min-w-[150px] text-sm py-2.5"
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
            >
              <option value="">All Sections</option>
              {SECTIONS.map((s) => <option key={s} value={s}>Section {s}</option>)}
            </select>
            {(yearFilter || sectionFilter) && (
              <button
                className="btn btn-outline text-sm py-2.5"
                onClick={() => { setYearFilter(''); setSectionFilter(''); }}
              >
                <Icons.X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </>
        )}
      </div>

      {/* Role tabs — pointless with a single role (facultyMode is students only) */}
      {!facultyMode && <div className="flex flex-wrap gap-2 mb-5">
        {ROLE_ORDER.map((role) => {
          const meta = ROLE_META[role];
          const RoleIcon = Icons[meta.icon];
          const active = activeRole === role;
          const label = role === 'Faculty' ? 'Faculty' : `${role}s`;
          return (
            <button
              key={role}
              onClick={() => setActiveRole(role)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer font-sans border transition-all
                ${active ? `${meta.header} text-white border-transparent shadow-sm` : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              <RoleIcon className="w-4 h-4" />
              {label}
              <span className={`text-xs font-normal ${active ? 'opacity-80' : 'text-gray-400'}`}>({usersByRole[role]?.length || 0})</span>
            </button>
          );
        })}
      </div>}

      {loading ? <LoadingSpinner /> : (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${ROLE_META[activeRole].badge}`}>
              {(() => { const RoleIcon = Icons[ROLE_META[activeRole].icon]; return <RoleIcon className="w-4 h-4" />; })()}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-navy">{activeRole === 'Faculty' ? 'Faculty' : `${activeRole}s`}</h3>
              <p className="text-xs text-gray-400">{usersByRole[activeRole]?.length || 0} record(s)</p>
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {activeRole === 'Student' ? (
              <StudentGroupedView students={usersByRole.Student || []} expanded={expanded} toggle={toggle} actions={renderActions} presence={presence} />
            ) : (
              <FacultyGroupedView role={activeRole} faculty={usersByRole[activeRole] || []} expanded={expanded} toggle={toggle} actions={renderActions} presence={presence} />
            )}
          </div>
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {showModal && (
        <Modal
          title={editUser ? `Edit User — ${editUser.name}` : `Add New ${CREATE_ROLE}`}
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
            <div className="sm:col-span-2">
              <label className="form-label">Email Address <span className="text-red-500">*</span></label>
              {editUser ? (
                // Same reasoning as the locked Password field below — once an
                // account exists, only its owner changes their own email
                // (Settings page's "Change Email", which re-verifies the new
                // address). This form only ever sets it at creation time.
                <p className="text-[13px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 flex items-center gap-2">
                  <Icons.Lock className="w-3.5 h-3.5 flex-shrink-0" /> {editUser.email || 'No email on file'} — only {editUser.name?.split(' ')[0] || 'this user'} can change it, from their own Settings page.
                </p>
              ) : (
                <>
                  <input className="form-input" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="e.g. jdelacruz@gmail.com" autoComplete="off" />
                  <p className="text-[11px] text-gray-400 mt-1">Needed for the "Forgot password" self-service link on the login page to work.</p>
                </>
              )}
            </div>
            {editUser ? (
              // Not editable from this general info form, or by Admin/
              // Chairperson at all once the account exists — password is
              // owner-only from here on, changed via their own Settings page.
              <div>
                <label className="form-label">Password</label>
                <p className="text-[13px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 flex items-center gap-2">
                  <Icons.Lock className="w-3.5 h-3.5 flex-shrink-0" />
                  Only {editUser.name?.split(' ')[0] || 'this user'} can change their own password, from their Settings page.
                </p>
              </div>
            ) : (
              <div>
                <label className="form-label">Password *</label>
                <div className="relative">
                  <input
                    className="form-input pr-10"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder="Enter password"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPassword(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none cursor-pointer text-gray-400 hover:text-gray-600 p-1">
                    {showPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Defaults to "{DEFAULT_PASSWORD}" — they can change it later from their own Settings page.</p>
              </div>
            )}
            <div>
              <label className="form-label">Role <span className="text-red-500">*</span></label>
              {editUser ? (
                chairpersonMode ? (
                  <>
                    <div className="form-input bg-gray-50 text-gray-600 flex items-center">{formData.role}</div>
                    <p className="text-[11px] text-gray-400 mt-1">Chairpersons cannot change a user's role.</p>
                  </>
                ) : (
                  <select className="form-select" value={formData.role} onChange={(e) => setFormData({ ...formData, role: e.target.value })}>
                    {ROLES.map((r) => <option key={r}>{r}</option>)}
                  </select>
                )
              ) : (
                <>
                  <div className="form-input bg-gray-50 text-gray-600 flex items-center">{CREATE_ROLE}</div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {chairpersonMode
                      ? 'Chairpersons can only create Faculty accounts.'
                      : `Matches the tab you're on — switch to "${CREATE_ROLE === 'Chairperson' ? 'Faculty' : 'Chairperson'}" to create that instead.`}
                  </p>
                </>
              )}
            </div>
            {formData.role !== 'Student' && (
              <div>
                <label className="form-label">Username <span className="text-red-500">*</span></label>
                {editUser ? (
                  <p className="text-[13px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 flex items-center gap-2">
                    <Icons.Lock className="w-3.5 h-3.5 flex-shrink-0" /> @{editUser.username} — only {editUser.name?.split(' ')[0] || 'this user'} can change it, from their Settings page.
                  </p>
                ) : (
                  <>
                    <input className="form-input" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} placeholder="e.g. jdelacruz" autoComplete="off" />
                    <p className="text-[11px] text-gray-400 mt-1">This is what they'll use to log in.</p>
                  </>
                )}
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
                  {/* Regular vs Irregular — functional (drives whether Section
                      below is required), so this stays editable even after
                      registration; promotionController can also flip it
                      automatically during evaluation. */}
                  <label className="form-label">Regular / Irregular</label>
                  <select className="form-select" value={formData.student_status} onChange={(e) => setFormData({ ...formData, student_status: e.target.value })}>
                    {REGULARITY_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Student Type</label>
                  {editUser ? (
                    // Self-declared at registration, not Admin-assigned — an
                    // existing student's own choice stays theirs to own; this
                    // is read-only here, just for reference. Only a brand-new
                    // account Admin is creating directly (no registration
                    // step happened) still needs the dropdown below.
                    <div className="form-input bg-gray-50 text-gray-500 flex items-center">{formData.student_type ? studentTypeLabel(formData.student_type) : '— Not set —'}</div>
                  ) : (
                    <select className="form-select" value={formData.student_type} onChange={(e) => setFormData({ ...formData, student_type: e.target.value })}>
                      <option value="">— None —</option>
                      {STUDENT_TYPES.map((t) => <option key={t} value={t}>{studentTypeLabel(t)}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="form-label">Student Number <span className="text-red-500">*</span></label>
                  <input className="form-input" inputMode="numeric" maxLength={6} value={formData.student_no} onChange={(e) => setFormData({ ...formData, student_no: e.target.value.replace(/\D/g, '').slice(0, 6) })} placeholder="e.g. 123456" />
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
                  <label className="form-label">Programs <span className="text-red-500">*</span></label>
                  <div className="grid grid-cols-2 gap-2 border border-gray-200 rounded-lg p-3">
                    {facultyProgramOptions.map((p) => (
                      <label key={p} className="flex items-center gap-2 text-[13px] cursor-pointer">
                        <input type="checkbox" checked={formData.programs.includes(p)} onChange={() => toggleFormProgram(p)} />
                        {p}
                      </label>
                    ))}
                  </div>
                </div>
                {formData.role === 'Faculty' && (
                  <div>
                    <label className="form-label">Employment Type</label>
                    <select className="form-select" value={formData.employment_type} onChange={(e) => setFormData({ ...formData, employment_type: e.target.value })}>
                      {EMPLOYMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                {formData.role === 'Chairperson' && (
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.is_teaching}
                        onChange={(e) => setFormData({ ...formData, is_teaching: e.target.checked })}
                      />
                      <span className="form-label mb-0">Also teaches classes (Faculty duties)</span>
                    </label>
                    <p className="text-[11px] text-gray-400 mt-1">
                      Gives this Chairperson account Faculty capabilities too — create/manage their own classes and encode grades — without a separate login.
                    </p>
                  </div>
                )}
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
                <span className="text-gray-500">Programs:</span>{' '}
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  <FacultyProgramTags user={viewUser} />
                </span>
              </div>
            )}
            {viewUser.role === 'Chairperson' && viewUser.is_teaching && (
              <div className="col-span-2"><Badge variant="purple">Also teaches classes</Badge></div>
            )}
            {viewUser.role === 'Student' && <div><span className="text-gray-500">Status:</span> <span className="ml-1"><RegularityBadge status={viewUser.student_status} /></span></div>}
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
            {viewUser.role === 'Faculty' && viewUser.employment_type && <div><span className="text-gray-500">Employment Type:</span> <span className="font-medium ml-1">{viewUser.employment_type}</span></div>}
            {viewUser.academic_rank && <div><span className="text-gray-500">Academic Rank:</span> <span className="font-medium ml-1">{viewUser.academic_rank}</span></div>}
            {viewUser.specialization && <div className="col-span-2"><span className="text-gray-500">Specialization:</span> <span className="font-medium ml-1">{viewUser.specialization}</span></div>}
            {viewUser.highest_education && <div><span className="text-gray-500">Highest Education:</span> <span className="font-medium ml-1">{viewUser.highest_education}</span></div>}
          </div>
        </Modal>
      )}

      {/* STUDENT GRADE RECORD */}
      {gradesTarget && (
        <StudentGradeRecordModal studentId={gradesTarget.id} onClose={() => setGradesTarget(null)} />
      )}

      {/* DELETE CONFIRMATION */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete Account"
          message={`Are you sure you want to delete this account? "${deleteTarget.name}" and all of their account data will be permanently removed. This action cannot be undone.`}
          confirmText={deleting ? 'Deleting...' : 'Delete Permanently'}
          confirmDisabled={deleting}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  );
}
