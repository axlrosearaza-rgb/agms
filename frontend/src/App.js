import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Icons, LoadingSpinner } from './components/common';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import ForgotPasswordPage from './components/auth/ForgotPasswordPage';
import ResetPasswordPage from './components/auth/ResetPasswordPage';

// Lazy loaded role & feature pages for fast chunk loading
const ProfilePage = lazy(() => import('./components/common/ProfilePage'));
const SettingsPage = lazy(() => import('./components/common/SettingsPage'));
const Messages = lazy(() => import('./pages/common/Messages'));
const AssignedToMe = lazy(() => import('./pages/common/AssignedToMe'));
const GradingSheet = lazy(() => import('./pages/common/GradingSheet'));
const ClassRecordView = lazy(() => import('./pages/common/ClassRecordView'));
const PrivacyPolicy = lazy(() => import('./pages/public/PrivacyPolicy'));
const Terms = lazy(() => import('./pages/public/Terms'));
const ContactUs = lazy(() => import('./pages/public/ContactUs'));

// Admin pages
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const SubjectManagement = lazy(() => import('./pages/admin/SubjectManagement'));
const SemesterManagement = lazy(() => import('./pages/admin/SemesterManagement'));
const GradeApproval = lazy(() => import('./pages/admin/GradeApproval'));
const GradeApprovalDetail = lazy(() => import('./pages/admin/GradeApprovalDetail'));
const PromotionManagement = lazy(() => import('./pages/admin/PromotionManagement'));

// Chairperson pages
const ChairpersonDashboard = lazy(() => import('./pages/chairperson/ChairpersonDashboard'));
const PendingRegistrations = lazy(() => import('./pages/chairperson/PendingRegistrations'));
const ChairpersonGradingSheets = lazy(() => import('./pages/chairperson/GradingSheets'));
const ChairpersonReports = lazy(() => import('./pages/chairperson/Reports'));

// Instructor pages
const InstructorDashboard = lazy(() => import('./pages/instructor/InstructorDashboard'));
const InstructorClasses = lazy(() => import('./pages/instructor/InstructorClasses'));
const GradeEncoding = lazy(() => import('./pages/instructor/GradeEncoding'));
const InstructorSubjects = lazy(() => import('./pages/instructor/Subjects'));

// Student pages
const StudentDashboard = lazy(() => import('./pages/student/StudentDashboard'));
const StudentGrades = lazy(() => import('./pages/student/StudentGrades'));

// Nav configs per role
const NAV = {
  Admin: [
    { path: '/admin', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/admin/users', label: 'User Management', icon: <Icons.Users /> },
    { path: '/admin/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/admin/semesters', label: 'Semesters', icon: <Icons.Clock /> },
    { path: '/admin/grade-approval', label: 'Grade Approval', icon: <Icons.Check /> },
    { path: '/admin/promotions', label: 'Promotions', icon: <Icons.Award /> },
    { path: '/admin/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Chairperson: [
    { path: '/chairperson', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/chairperson/pending-students', label: 'Pending Registrations', icon: <Icons.Clock /> },
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
    { path: '/faculty/students', label: 'Students List', icon: <Icons.Users /> },
    { path: '/faculty/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/faculty/assigned-students', label: 'Assigned Work', icon: <Icons.Clock /> },
    { path: '/faculty/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Student: [
    { path: '/student', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/student/grades', label: 'My Grades', icon: <Icons.FileText /> },
    { path: '/student/assigned-students', label: 'Assigned Work', icon: <Icons.Clock /> },
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
  { path: '/chairperson/students', label: 'Students List', icon: <Icons.Users />, section: 'teaching' },
];

function getNavItems(user) {
  const base = NAV[user?.role] || [];
  if (user?.role === 'Chairperson' && user?.is_teaching) {
    return [...base, ...TEACHING_NAV_ITEMS];
  }
  return base;
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

function RegisterGuard() {
  const { isAuthenticated, user, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (isAuthenticated) return <Navigate to={ROLE_HOME[user?.role] || '/'} replace />;
  return <RegisterPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        {/* bottom-right, not top-right — top-right sits directly under the
            header's own notification bell/dropdown, so a toast firing while
            that's open visually collides with it. */}
        <Toaster position="bottom-right" toastOptions={{ duration: 3000, style: { fontFamily: 'DM Sans, sans-serif', fontSize: '14px' } }} />
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/register" element={<RegisterGuard />} />
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
          <Route path="/admin/subjects" element={<RoleLayout role="Admin"><SubjectManagement /></RoleLayout>} />
          <Route path="/admin/semesters" element={<RoleLayout role="Admin"><SemesterManagement /></RoleLayout>} />
          <Route path="/admin/grade-approval" element={<RoleLayout role="Admin"><GradeApproval /></RoleLayout>} />
          <Route path="/admin/grade-approval/:classId" element={<RoleLayout role="Admin"><GradeApprovalDetail /></RoleLayout>} />
          <Route path="/admin/promotions" element={<RoleLayout role="Admin"><PromotionManagement /></RoleLayout>} />
          <Route path="/admin/messages" element={<RoleLayout role="Admin"><Messages /></RoleLayout>} />
          <Route path="/admin/profile" element={<RoleLayout role="Admin"><ProfilePage /></RoleLayout>} />
          <Route path="/admin/settings" element={<RoleLayout role="Admin"><SettingsPage /></RoleLayout>} />

          {/* Chairperson */}
          <Route path="/chairperson" element={<RoleLayout role="Chairperson"><ChairpersonDashboard /></RoleLayout>} />
          <Route path="/chairperson/pending-students" element={<RoleLayout role="Chairperson"><PendingRegistrations /></RoleLayout>} />
          <Route path="/chairperson/users" element={<RoleLayout role="Chairperson"><UserManagement chairpersonMode={true} /></RoleLayout>} />
          <Route path="/chairperson/grading-sheets" element={<RoleLayout role="Chairperson"><ChairpersonGradingSheets /></RoleLayout>} />
          <Route path="/chairperson/subjects" element={<RoleLayout role="Chairperson"><InstructorSubjects /></RoleLayout>} />
          <Route path="/chairperson/reports" element={<RoleLayout role="Chairperson"><ChairpersonReports /></RoleLayout>} />
          <Route path="/chairperson/messages" element={<RoleLayout role="Chairperson"><Messages /></RoleLayout>} />
          <Route path="/chairperson/profile" element={<RoleLayout role="Chairperson"><ProfilePage /></RoleLayout>} />
          <Route path="/chairperson/settings" element={<RoleLayout role="Chairperson"><SettingsPage /></RoleLayout>} />
          {/* Teaching-Chairperson only — same pages Faculty use, reused as-is */}
          <Route path="/chairperson/classes" element={<RequireTeaching><InstructorClasses /></RequireTeaching>} />
          <Route path="/chairperson/students" element={<RequireTeaching><UserManagement facultyMode={true} /></RequireTeaching>} />
          <Route path="/chairperson/encode/:classId" element={<RequireTeaching><GradeEncoding /></RequireTeaching>} />

          {/* Faculty */}
          <Route path="/faculty" element={<RoleLayout role="Faculty"><InstructorDashboard /></RoleLayout>} />
          <Route path="/faculty/classes" element={<RoleLayout role="Faculty"><InstructorClasses /></RoleLayout>} />
          <Route path="/faculty/students" element={<RoleLayout role="Faculty"><UserManagement facultyMode={true} /></RoleLayout>} />
          <Route path="/faculty/subjects" element={<RoleLayout role="Faculty"><InstructorSubjects /></RoleLayout>} />
          <Route path="/faculty/assigned-students" element={<RoleLayout role="Faculty"><AssignedToMe /></RoleLayout>} />
          <Route path="/faculty/messages" element={<RoleLayout role="Faculty"><Messages /></RoleLayout>} />
          <Route path="/faculty/encode/:classId" element={<RoleLayout role="Faculty"><GradeEncoding /></RoleLayout>} />
          <Route path="/faculty/profile" element={<RoleLayout role="Faculty"><ProfilePage /></RoleLayout>} />
          <Route path="/faculty/settings" element={<RoleLayout role="Faculty"><SettingsPage /></RoleLayout>} />

          {/* Student */}
          <Route path="/student" element={<RoleLayout role="Student"><StudentDashboard /></RoleLayout>} />
          <Route path="/student/grades" element={<RoleLayout role="Student"><StudentGrades /></RoleLayout>} />
          <Route path="/student/assigned-students" element={<RoleLayout role="Student"><AssignedToMe /></RoleLayout>} />
          <Route path="/student/messages" element={<RoleLayout role="Student"><Messages /></RoleLayout>} />
          <Route path="/student/profile" element={<RoleLayout role="Student"><ProfilePage /></RoleLayout>} />
          <Route path="/student/settings" element={<RoleLayout role="Student"><SettingsPage /></RoleLayout>} />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}