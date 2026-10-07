import { Suspense } from 'react';
import { lazyPage } from './utils/lazyPage';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { Icons, LoadingSpinner } from './components/common';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './components/auth/LoginPage';
import ForgotPasswordPage from './components/auth/ForgotPasswordPage';
import ResetPasswordPage from './components/auth/ResetPasswordPage';

// Lazy loaded role & feature pages for fast chunk loading
const ProfilePage = lazyPage(() => import('./components/common/ProfilePage'));
const SettingsPage = lazyPage(() => import('./components/common/SettingsPage'));
const Messages = lazyPage(() => import('./pages/common/Messages'));
const GradingSheet = lazyPage(() => import('./pages/common/GradingSheet'));
const ClassRecordView = lazyPage(() => import('./pages/common/ClassRecordView'));
const PrivacyPolicy = lazyPage(() => import('./pages/public/PrivacyPolicy'));
const Terms = lazyPage(() => import('./pages/public/Terms'));
const ContactUs = lazyPage(() => import('./pages/public/ContactUs'));

// Admin pages
const AdminDashboard = lazyPage(() => import('./pages/admin/AdminDashboard'));
const UserManagement = lazyPage(() => import('./pages/admin/UserManagement'));
const SemesterManagement = lazyPage(() => import('./pages/admin/SemesterManagement'));
const GradeApproval = lazyPage(() => import('./pages/admin/GradeApproval'));
const GradeApprovalDetail = lazyPage(() => import('./pages/admin/GradeApprovalDetail'));

// Chairperson pages
const ChairpersonDashboard = lazyPage(() => import('./pages/chairperson/ChairpersonDashboard'));
const ChairpersonGradingSheets = lazyPage(() => import('./pages/chairperson/GradingSheets'));
const ChairpersonReports = lazyPage(() => import('./pages/chairperson/Reports'));

// Instructor pages
const InstructorDashboard = lazyPage(() => import('./pages/instructor/InstructorDashboard'));
const InstructorClasses = lazyPage(() => import('./pages/instructor/InstructorClasses'));
const GradeEncoding = lazyPage(() => import('./pages/instructor/GradeEncoding'));
const InstructorSubjects = lazyPage(() => import('./pages/instructor/Subjects'));
const MyAdvisory = lazyPage(() => import('./pages/instructor/MyAdvisory'));

// Student pages
const StudentDashboard = lazyPage(() => import('./pages/student/StudentDashboard'));
const StudentGrades = lazyPage(() => import('./pages/student/StudentGrades'));

// Nav configs per role
const NAV = {
  Admin: [
    { path: '/admin', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/admin/users', label: 'User Management', icon: <Icons.Users /> },
    { path: '/admin/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/admin/semesters', label: 'Semesters', icon: <Icons.Clock /> },
    { path: '/admin/grade-approval', label: 'Grade Approval', icon: <Icons.Check /> },
    { path: '/admin/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Chairperson: [
    { path: '/chairperson', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/chairperson/users', label: 'User Management', icon: <Icons.Users /> },
    { path: '/chairperson/grading-sheets', label: 'Grade Approval', icon: <Icons.FileText /> },
    { path: '/chairperson/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/chairperson/reports', label: 'Reports', icon: <Icons.BarChart /> },
    { path: '/chairperson/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Faculty: [
    { path: '/faculty', label: 'Dashboard', icon: <Icons.Dashboard /> },
    // Grade Encoding (/faculty/encode/:classId) is a sibling route, not
    // nested under /faculty/classes — matchAlso keeps the header/breadcrumb/
    // sidebar showing "My Classes" (its actual parent section) while there,
    // instead of falling through to the default "Dashboard".
    { path: '/faculty/classes', label: 'My Classes', icon: <Icons.Book />, matchAlso: ['/faculty/encode'] },
    { path: '/faculty/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/faculty/advisory', label: 'My Advisory', icon: <Icons.User /> },
    { path: '/faculty/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Student: [
    { path: '/student', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/student/grades', label: 'Prospectus', icon: <Icons.FileText /> },
    { path: '/student/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
};

const ROLE_HOME = {
  Admin: '/admin',
  Chairperson: '/chairperson',
  Faculty: '/faculty',
  Student: '/student',
};

// A Chairperson who also teaches (`is_teaching`) gets Faculty nav items merged
// into their normal sidebar — same account, no separate login — rather than a
// full mode-switch. Appended at the bottom (behind a "Teaching" divider in
// AppLayout.js) rather than mixed in with their Chairperson duties, so it's
// visually clear which items are "run the program" vs. "my own classes".
const TEACHING_NAV_ITEMS = [
  // Same matchAlso reasoning as Faculty's own "My Classes" above —
  // /chairperson/encode/:classId is a sibling of /chairperson/classes, not
  // nested under it.
  { path: '/chairperson/classes', label: 'My Classes', icon: <Icons.Book />, section: 'teaching', matchAlso: ['/chairperson/encode'] },
];

// A Chairperson the Admin has made an adviser of one or more sections.
// Listed under the "Teaching" group, below My Classes.
const CHAIRPERSON_ADVISORY_ITEM = { path: '/chairperson/advisory', label: 'My Advisory', icon: <Icons.User />, section: 'teaching' };

function getNavItems(user) {
  const base = NAV[user?.role] || [];
  if (user?.role !== 'Chairperson') return base;
  const teaching = user?.is_teaching ? [...TEACHING_NAV_ITEMS] : [];
  if (Array.isArray(user?.advisories) && user.advisories.length > 0) teaching.push(CHAIRPERSON_ADVISORY_ITEM);
  return [...base, ...teaching];
}

function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to={ROLE_HOME[user?.role] || '/login'} replace />;
  }
  return children;
}

const PageLoader = () => (
  <div className="flex items-center justify-center p-12 min-h-[350px]">
    <div className="flex flex-col items-center gap-3">
      <div className="w-8 h-8 border-2 border-[#002147] border-t-transparent rounded-full animate-spin" />
      <span className="text-xs text-gray-400 font-medium">Loading module...</span>
    </div>
  </div>
);

function RoleLayout({ role, children }) {
  const { user } = useAuth();
  return (
    <ProtectedRoute allowedRoles={[role]}>
      <AppLayout navItems={getNavItems(user)}>
        <Suspense fallback={<PageLoader />}>
          {children}
        </Suspense>
      </AppLayout>
    </ProtectedRoute>
  );
}

// Guards the teaching-only Chairperson routes (My Classes, Grade Encoding) —
// role="Chairperson" alone isn't enough, the account also needs is_teaching set.
function RequireTeaching({ children }) {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (user?.role !== 'Chairperson' || !user?.is_teaching) {
    return <Navigate to={ROLE_HOME[user?.role] || '/login'} replace />;
  }
  return (
    <AppLayout navItems={getNavItems(user)}>
      <Suspense fallback={<PageLoader />}>
        {children}
      </Suspense>
    </AppLayout>
  );
}

function HomeRedirect() {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[user?.role] || '/login'} replace />;
}

function LoginGuard() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (isAuthenticated) return <Navigate to={ROLE_HOME[user?.role] || '/'} replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
        {/* bottom-right, not top-right — top-right sits directly under the
            header's own notification bell/dropdown, so a toast firing while
            that's open visually collides with it. */}
        <Toaster position="top-center" toastOptions={{ duration: 3000, style: { fontFamily: 'DM Sans, sans-serif', fontSize: '14px' } }} />
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Public — reachable from the footer with or without being signed in */}
          <Route path="/privacy-policy" element={<Suspense fallback={<PageLoader />}><PrivacyPolicy /></Suspense>} />
          <Route path="/terms" element={<Suspense fallback={<PageLoader />}><Terms /></Suspense>} />
          <Route path="/contact" element={<Suspense fallback={<PageLoader />}><ContactUs /></Suspense>} />

          {/* Standalone printable grading sheet — no sidebar chrome */}
          <Route path="/grading-sheet/:classId" element={<ProtectedRoute allowedRoles={['Faculty', 'Chairperson', 'Admin']}><Suspense fallback={<PageLoader />}><GradingSheet /></Suspense></ProtectedRoute>} />
          <Route path="/class-record/:classId" element={<ProtectedRoute allowedRoles={['Faculty', 'Chairperson', 'Admin']}><Suspense fallback={<PageLoader />}><ClassRecordView /></Suspense></ProtectedRoute>} />

          {/* Admin */}
          <Route path="/admin" element={<RoleLayout role="Admin"><AdminDashboard /></RoleLayout>} />
          <Route path="/admin/users" element={<RoleLayout role="Admin"><UserManagement /></RoleLayout>} />
          <Route path="/admin/subjects" element={<RoleLayout role="Admin"><InstructorSubjects /></RoleLayout>} />
          <Route path="/admin/semesters" element={<RoleLayout role="Admin"><SemesterManagement /></RoleLayout>} />
          <Route path="/admin/grade-approval" element={<RoleLayout role="Admin"><GradeApproval /></RoleLayout>} />
          <Route path="/admin/grade-approval/:classId" element={<RoleLayout role="Admin"><GradeApprovalDetail /></RoleLayout>} />
          <Route path="/admin/messages" element={<RoleLayout role="Admin"><Messages /></RoleLayout>} />
          <Route path="/admin/profile" element={<RoleLayout role="Admin"><ProfilePage /></RoleLayout>} />
          <Route path="/admin/settings" element={<RoleLayout role="Admin"><SettingsPage /></RoleLayout>} />

          {/* Chairperson */}
          <Route path="/chairperson" element={<RoleLayout role="Chairperson"><ChairpersonDashboard /></RoleLayout>} />
          <Route path="/chairperson/users" element={<RoleLayout role="Chairperson"><UserManagement chairpersonMode={true} /></RoleLayout>} />
          <Route path="/chairperson/grading-sheets" element={<RoleLayout role="Chairperson"><ChairpersonGradingSheets /></RoleLayout>} />
          <Route path="/chairperson/subjects" element={<RoleLayout role="Chairperson"><InstructorSubjects /></RoleLayout>} />
          <Route path="/chairperson/reports" element={<RoleLayout role="Chairperson"><ChairpersonReports /></RoleLayout>} />
          <Route path="/chairperson/advisory" element={<RoleLayout role="Chairperson"><MyAdvisory /></RoleLayout>} />
          <Route path="/chairperson/messages" element={<RoleLayout role="Chairperson"><Messages /></RoleLayout>} />
          <Route path="/chairperson/profile" element={<RoleLayout role="Chairperson"><ProfilePage /></RoleLayout>} />
          <Route path="/chairperson/settings" element={<RoleLayout role="Chairperson"><SettingsPage /></RoleLayout>} />
          {/* Teaching-Chairperson only — same pages Faculty use, reused as-is */}
          <Route path="/chairperson/classes" element={<RequireTeaching><InstructorClasses /></RequireTeaching>} />
          <Route path="/chairperson/encode/:classId" element={<RequireTeaching><GradeEncoding /></RequireTeaching>} />

          {/* Faculty */}
          <Route path="/faculty" element={<RoleLayout role="Faculty"><InstructorDashboard /></RoleLayout>} />
          <Route path="/faculty/classes" element={<RoleLayout role="Faculty"><InstructorClasses /></RoleLayout>} />
          <Route path="/faculty/subjects" element={<RoleLayout role="Faculty"><InstructorSubjects /></RoleLayout>} />
          <Route path="/faculty/advisory" element={<RoleLayout role="Faculty"><MyAdvisory /></RoleLayout>} />
          <Route path="/faculty/messages" element={<RoleLayout role="Faculty"><Messages /></RoleLayout>} />
          <Route path="/faculty/encode/:classId" element={<RoleLayout role="Faculty"><GradeEncoding /></RoleLayout>} />
          <Route path="/faculty/profile" element={<RoleLayout role="Faculty"><ProfilePage /></RoleLayout>} />
          <Route path="/faculty/settings" element={<RoleLayout role="Faculty"><SettingsPage /></RoleLayout>} />

          {/* Student */}
          <Route path="/student" element={<RoleLayout role="Student"><StudentDashboard /></RoleLayout>} />
          <Route path="/student/grades" element={<RoleLayout role="Student"><StudentGrades /></RoleLayout>} />
          <Route path="/student/messages" element={<RoleLayout role="Student"><Messages /></RoleLayout>} />
          <Route path="/student/profile" element={<RoleLayout role="Student"><ProfilePage /></RoleLayout>} />
          <Route path="/student/settings" element={<RoleLayout role="Student"><SettingsPage /></RoleLayout>} />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}