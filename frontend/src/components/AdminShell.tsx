import { Activity, BadgeDollarSign, Boxes, Clapperboard, ClipboardList, Database, FolderKanban, HeartPulse, LogOut, PanelLeftClose, Settings, ShieldCheck, UsersRound } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Brand } from './Shell';

const navigation = [
  { to: '/admin', label: 'Overview', icon: ShieldCheck, end: true },
  { to: '/admin/users', label: 'Users', icon: UsersRound },
  { to: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { to: '/admin/jobs', label: 'Processing jobs', icon: Activity },
  { to: '/admin/clips', label: 'Generated clips', icon: Clapperboard },
  { to: '/admin/storage', label: 'Storage', icon: Database },
  { to: '/admin/subscriptions', label: 'Plans & subscriptions', icon: Boxes },
  { to: '/admin/payments', label: 'Payments', icon: BadgeDollarSign },
  { to: '/admin/health', label: 'System health', icon: HeartPulse },
  { to: '/admin/audit-logs', label: 'Audit logs', icon: ClipboardList },
  { to: '/admin/settings', label: 'Settings', icon: Settings }
];

export const AdminShell = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth(); const navigate = useNavigate();
  const signOut = async (): Promise<void> => { await logout(); navigate('/login'); };
  return <div className="admin-shell">
    <aside className="admin-sidebar">
      <div><div className="brand-row"><Brand /><span className="admin-chip">Admin</span></div><div className="admin-context"><ShieldCheck size={16} /><span>Operations console</span></div><nav aria-label="Admin navigation" className="primary-nav admin-nav">{navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={17} /><span>{label}</span></NavLink>)}</nav></div>
      <div className="sidebar-bottom"><Link to="/app" className="return-workspace"><PanelLeftClose size={15} /> Creator workspace</Link><div className="profile-row"><span className="avatar">{user?.name.slice(0, 2).toUpperCase()}</span><span className="profile-copy"><strong>{user?.name}</strong><small>administrator</small></span><button className="icon-button" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button></div></div>
    </aside>
    <div className="admin-main"><header className="admin-topbar"><div><span className="admin-topbar-title">ClipForge</span><span className="admin-topbar-divider">/</span><strong>Administration</strong></div><span className="admin-online"><i /> API session secured</span></header><main className="admin-page-area">{children}</main></div>
  </div>;
};
