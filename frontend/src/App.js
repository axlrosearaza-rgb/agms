import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Icons, LoadingSpinner } from './components/common';
import AppLayout from './components/layout/AppLayout';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import ProfilePage from './components/common/ProfilePage';
import SettingsPage from './components/common/SettingsPage';
import Messages from './pages/common/Messages';
import GradingSheet from './pages/common/GradingSheet';

// Admin pages
import AdminDashboard from './pages/admin/AdminDashboard';
import UserManagement from './pages/admin/UserManagement';
import SubjectManagement from './pages/admin/SubjectManagement';
import SemesterManagement from './pages/admin/SemesterManagement';
import Reports from './pages/admin/Reports';
import StudentDirectory from './pages/admin/StudentDirectory';
import AdminEndorsements from './pages/admin/AdminEndorsements';
import PromotionManagement from './pages/admin/PromotionManagement';
import GradeApproval from './pages/admin/GradeApproval';
import GradeApprovalDetail from './pages/admin/GradeApprovalDetail';

// Chairperson pages
import ChairpersonDashboard from './pages/chairperson/ChairpersonDashboard';
import DepartmentStudents from './pages/chairperson/DepartmentStudents';
import Endorsements from './pages/chairperson/Endorsements';
import ChairpersonGradingSheets from './pages/chairperson/GradingSheets';
import ChairpersonReports from './pages/chairperson/Reports';

// Instructor pages
import InstructorDashboard from './pages/instructor/InstructorDashboard';
import InstructorClasses from './pages/instructor/InstructorClasses';
import GradeEncoding from './pages/instructor/GradeEncoding';
import StudentVerification from './pages/instructor/StudentVerification';
import InstructorSubjects from './pages/instructor/Subjects';
import InstructorReports from './pages/instructor/Reports';

// Student pages
import StudentDashboard from './pages/student/StudentDashboard';
import StudentGrades from './pages/student/StudentGrades';

// Nav configs per role
const NAV = {
  Admin: [
    { path: '/admin', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/admin/users', label: 'User Management', icon: <Icons.Users /> },
    { path: '/admin/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/admin/semesters', label: 'Semesters', icon: <Icons.Clock /> },
    { path: '/admin/endorsements', label: 'Endorsements', icon: <Icons.Send /> },
    { path: '/admin/promotions', label: 'Promotions', icon: <Icons.Award /> },
    { path: '/admin/grade-approval', label: 'Grade Approval', icon: <Icons.Check /> },
    { path: '/admin/reports', label: 'Reports', icon: <Icons.BarChart /> },
    { path: '/admin/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Chairperson: [
    { path: '/chairperson', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/chairperson/users', label: 'User Management', icon: <Icons.Users /> },
    { path: '/chairperson/students', label: 'Program Overview', icon: <Icons.Users /> },
    { path: '/chairperson/grading-sheets', label: 'Grading Sheets', icon: <Icons.FileText /> },
    { path: '/chairperson/endorsements', label: 'Endorsements', icon: <Icons.Send /> },
    { path: '/chairperson/promotions', label: 'Promotions', icon: <Icons.Award /> },
    { path: '/chairperson/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/chairperson/semesters', label: 'Semesters', icon: <Icons.Clock /> },
    { path: '/chairperson/reports', label: 'Reports', icon: <Icons.BarChart /> },
    { path: '/chairperson/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Instructor: [
    { path: '/instructor', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/instructor/classes', label: 'My Classes', icon: <Icons.Book /> },
    { path: '/instructor/subjects', label: 'Subjects', icon: <Icons.FileText /> },
    { path: '/instructor/students', label: 'Student Directory', icon: <Icons.Search /> },
    { path: '/instructor/reports', label: 'Reports', icon: <Icons.BarChart /> },
    { path: '/instructor/verify', label: 'Student Verification', icon: <Icons.Users /> },
    { path: '/instructor/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
  Student: [
    { path: '/student', label: 'Dashboard', icon: <Icons.Dashboard /> },
    { path: '/student/grades', label: 'My Grades', icon: <Icons.FileText /> },
    { path: '/student/messages', label: 'Messages', icon: <Icons.MessageSquare /> },
  ],
};

const ROLE_HOME = {
  Admin: '/admin',
  Chairperson: '/chairperson',
  Instructor: '/instructor',
  Student: '/student',
};

function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to={ROLE_HOME[user?.role] || '/login'} replace />;
  }
  return children;
}

function RoleLayout({ role, children }) {
  return (
    <ProtectedRoute allowedRoles={[role]}>
      <AppLayout navItems={NAV[role]}>{children}</AppLayout>
    </ProtectedRoute>
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
        <Toaster position="top-right" toastOptions={{ duration: 3000, style: { fontFamily: 'DM Sans, sans-serif', fontSize: '14px' } }} />
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/register" element={<RegisterGuard />} />

          {/* Standalone printable grading sheet — no sidebar chrome */}
          <Route path="/grading-sheet/:classId" element={<ProtectedRoute allowedRoles={['Instructor', 'Chairperson', 'Admin']}><GradingSheet /></ProtectedRoute>} />

          {/* Admin */}
          <Route path="/admin" element={<RoleLayout role="Admin"><AdminDashboard /></RoleLayout>} />
          <Route path="/admin/users" element={<RoleLayout role="Admin"><UserManagement /></RoleLayout>} />
          <Route path="/admin/subjects" element={<RoleLayout role="Admin"><SubjectManagement /></RoleLayout>} />
          <Route path="/admin/semesters" element={<RoleLayout role="Admin"><SemesterManagement /></RoleLayout>} />
          <Route path="/admin/endorsements" element={<RoleLayout role="Admin"><AdminEndorsements /></RoleLayout>} />
          <Route path="/admin/promotions" element={<RoleLayout role="Admin"><PromotionManagement /></RoleLayout>} />
          <Route path="/admin/grade-approval" element={<RoleLayout role="Admin"><GradeApproval /></RoleLayout>} />
          <Route path="/admin/grade-approval/:classId" element={<RoleLayout role="Admin"><GradeApprovalDetail /></RoleLayout>} />
          <Route path="/admin/reports" element={<RoleLayout role="Admin"><Reports /></RoleLayout>} />
          <Route path="/admin/messages" element={<RoleLayout role="Admin"><Messages /></RoleLayout>} />
          <Route path="/admin/profile" element={<RoleLayout role="Admin"><ProfilePage /></RoleLayout>} />
          <Route path="/admin/settings" element={<RoleLayout role="Admin"><SettingsPage /></RoleLayout>} />

          {/* Chairperson */}
          <Route path="/chairperson" element={<RoleLayout role="Chairperson"><ChairpersonDashboard /></RoleLayout>} />
          <Route path="/chairperson/users" element={<RoleLayout role="Chairperson"><UserManagement chairpersonMode={true} /></RoleLayout>} />
          <Route path="/chairperson/students" element={<RoleLayout role="Chairperson"><DepartmentStudents /></RoleLayout>} />
          <Route path="/chairperson/grading-sheets" element={<RoleLayout role="Chairperson"><ChairpersonGradingSheets /></RoleLayout>} />
          <Route path="/chairperson/endorsements" element={<RoleLayout role="Chairperson"><Endorsements /></RoleLayout>} />
          <Route path="/chairperson/promotions" element={<RoleLayout role="Chairperson"><PromotionManagement chairpersonMode={true} /></RoleLayout>} />
          <Route path="/chairperson/subjects" element={<RoleLayout role="Chairperson"><InstructorSubjects /></RoleLayout>} />
          <Route path="/chairperson/semesters" element={<RoleLayout role="Chairperson"><SemesterManagement /></RoleLayout>} />
          <Route path="/chairperson/reports" element={<RoleLayout role="Chairperson"><ChairpersonReports /></RoleLayout>} />
          <Route path="/chairperson/messages" element={<RoleLayout role="Chairperson"><Messages /></RoleLayout>} />
          <Route path="/chairperson/profile" element={<RoleLayout role="Chairperson"><ProfilePage /></RoleLayout>} />
          <Route path="/chairperson/settings" element={<RoleLayout role="Chairperson"><SettingsPage /></RoleLayout>} />

          {/* Instructor */}
          <Route path="/instructor" element={<RoleLayout role="Instructor"><InstructorDashboard /></RoleLayout>} />
          <Route path="/instructor/classes" element={<RoleLayout role="Instructor"><InstructorClasses /></RoleLayout>} />
          <Route path="/instructor/verify" element={<RoleLayout role="Instructor"><StudentVerification /></RoleLayout>} />
          <Route path="/instructor/subjects" element={<RoleLayout role="Instructor"><InstructorSubjects /></RoleLayout>} />
          <Route path="/instructor/students" element={<RoleLayout role="Instructor"><StudentDirectory /></RoleLayout>} />
          <Route path="/instructor/reports" element={<RoleLayout role="Instructor"><InstructorReports /></RoleLayout>} />
          <Route path="/instructor/messages" element={<RoleLayout role="Instructor"><Messages /></RoleLayout>} />
          <Route path="/instructor/encode/:classId" element={<RoleLayout role="Instructor"><GradeEncoding /></RoleLayout>} />
          <Route path="/instructor/profile" element={<RoleLayout role="Instructor"><ProfilePage /></RoleLayout>} />
          <Route path="/instructor/settings" element={<RoleLayout role="Instructor"><SettingsPage /></RoleLayout>} />

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
    </BrowserRouter>
  );
}