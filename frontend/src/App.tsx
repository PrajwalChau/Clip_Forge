import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Loading } from './components/States';
import { Shell } from './components/Shell';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { ProcessingPage } from './pages/ProcessingPage';
import { ClipsPage } from './pages/ClipsPage';
import { SocialAccountsPage } from './pages/SocialAccountsPage';
import { StoragePage } from './pages/StoragePage';
import { PlansPage } from './pages/PlansPage';
import { SettingsPage } from './pages/SettingsPage';
import { AccessDeniedPage } from './pages/AccessDeniedPage';
import { AdminShell } from './components/AdminShell';
import { AdminAuditLogsPage, AdminClipsPage, AdminHealthPage, AdminJobsPage, AdminOverviewPage, AdminPaymentsPage, AdminProjectsPage, AdminSettingsPage, AdminStoragePage, AdminSubscriptionsPage, AdminUserDetailPage, AdminUsersPage } from './pages/AdminPages';
import { SocialHelpPage } from './pages/SocialHelpPage';

const Protected = ({ children }: { children: React.ReactNode }) => { const { user, loading } = useAuth(); const location = useLocation(); if (loading) return <Loading />; return user ? <Shell>{children}</Shell> : <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />; };
const AdminProtected = ({ children }: { children: React.ReactNode }) => { const { user, loading } = useAuth(); const location = useLocation(); if (loading) return <Loading />; if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />; if (user.role !== 'admin') return <Navigate to="/access-denied" replace />; return <AdminShell>{children}</AdminShell>; };
const PublicOnly = ({ children }: { children: React.ReactNode }) => { const { user, loading } = useAuth(); if (loading) return <Loading />; return user ? <Navigate to="/app" replace /> : <>{children}</>; };

export const App = () => <Routes>
  <Route path="/" element={<LandingPage />} />
  <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
  <Route path="/access-denied" element={<Protected><AccessDeniedPage /></Protected>} />
  <Route path="/app" element={<Protected><DashboardPage /></Protected>} />
  <Route path="/app/new" element={<Protected><NewProjectPage /></Protected>} />
  <Route path="/app/projects/:projectId" element={<Protected><ProcessingPage /></Protected>} />
  <Route path="/app/clips" element={<Protected><ClipsPage /></Protected>} />
  <Route path="/app/social" element={<Protected><SocialAccountsPage /></Protected>} />
  <Route path="/app/help/social-accounts" element={<Protected><SocialHelpPage /></Protected>} />
  <Route path="/app/storage" element={<Protected><StoragePage /></Protected>} />
  <Route path="/app/plans" element={<Protected><PlansPage /></Protected>} />
  <Route path="/app/settings" element={<Protected><SettingsPage /></Protected>} />
  <Route path="/admin" element={<AdminProtected><AdminOverviewPage /></AdminProtected>} />
  <Route path="/admin/users" element={<AdminProtected><AdminUsersPage /></AdminProtected>} />
  <Route path="/admin/users/:userId" element={<AdminProtected><AdminUserDetailPage /></AdminProtected>} />
  <Route path="/admin/projects" element={<AdminProtected><AdminProjectsPage /></AdminProtected>} />
  <Route path="/admin/jobs" element={<AdminProtected><AdminJobsPage /></AdminProtected>} />
  <Route path="/admin/clips" element={<AdminProtected><AdminClipsPage /></AdminProtected>} />
  <Route path="/admin/storage" element={<AdminProtected><AdminStoragePage /></AdminProtected>} />
  <Route path="/admin/subscriptions" element={<AdminProtected><AdminSubscriptionsPage /></AdminProtected>} />
  <Route path="/admin/payments" element={<AdminProtected><AdminPaymentsPage /></AdminProtected>} />
  <Route path="/admin/health" element={<AdminProtected><AdminHealthPage /></AdminProtected>} />
  <Route path="/admin/audit-logs" element={<AdminProtected><AdminAuditLogsPage /></AdminProtected>} />
  <Route path="/admin/settings" element={<AdminProtected><AdminSettingsPage /></AdminProtected>} />
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>;
