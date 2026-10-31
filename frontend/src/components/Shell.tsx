import { Bell, Clapperboard, Database, FolderOpen, LayoutDashboard, LogOut, Plus, Settings, Share2, ShieldCheck, Sparkles, Video } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navigation = [
  { to: '/app', label: 'Projects', icon: FolderOpen, end: true },
  { to: '/app/clips', label: 'Clips', icon: Clapperboard },
  { to: '/app/social', label: 'Social & Publishing', icon: Share2 },
  { to: '/app/storage', label: 'Storage & Usage', icon: Database },
  { to: '/app/plans', label: 'Plans & Billing', icon: Sparkles },
  { to: '/app/settings', label: 'Settings', icon: Settings }
];

export const Brand = () => <Link to="/" className="brand"><span className="brand-mark"><Video size={16} aria-hidden="true" /></span><span>ClipForge</span></Link>;

export const Shell = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const signOut = async (): Promise<void> => { await logout(); navigate('/login'); };
  return <div className="app-shell">
    <aside className="sidebar">
      <div>
        <div className="brand-row"><Brand /><span className="beta">Beta</span></div>
        <Link className="new-project-sidebar" to="/app/new"><Plus size={16} /> New project</Link>
        <nav aria-label="Workspace navigation" className="primary-nav">
          {navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}><Icon size={17} /><span>{label}</span></NavLink>)}
          {user?.role === 'admin' && <NavLink to="/admin" className="nav-item"><ShieldCheck size={17} /><span>Administration</span></NavLink>}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <Link to="/app/plans" className="usage-peek"><span>Current plan</span><strong>{user?.plan ?? 'free'}</strong><small>Manage usage and billing</small></Link>
        <div className="profile-row"><span className="avatar">{user?.name?.slice(0, 2).toUpperCase()}</span><span className="profile-copy"><strong>{user?.name}</strong><small>{user?.plan} creator</small></span><button className="icon-button" aria-label="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button></div>
      </div>
    </aside>
    <div className="app-main">
      <header className="topbar"><div className="workspace-crumb"><LayoutDashboard size={15} /><span>Workspace</span><i>/</i><strong>Main Studio</strong><span className="timezone-dot" /> <span>UTC+5:45 (NPT)</span></div><button className="icon-button" aria-label="Notifications"><Bell size={18} /></button></header>
      <main className="page-area">{children}</main>
    </div>
  </div>;
};
