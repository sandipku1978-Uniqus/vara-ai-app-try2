import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Search, LayoutDashboard, BarChart2, MessageSquare, Menu,
  BookOpen, Globe, Users, Briefcase, Handshake, Code, LifeBuoy,
  TrendingUp, UserCheck, Mail, ShieldCheck, Gavel, Scale,
  FileSearch, DollarSign, Mic, ClipboardList
} from 'lucide-react';
import { useApp } from '../../context/AppState';
import { VaraLogo } from '../../pages/LandingPage';
import './Layout.css';

export function Sidebar() {
  const location = useLocation();
  const isLanding = location.pathname === '/';

  if (isLanding) return null; // No sidebar on landing page

  return (
    <aside className="sidebar glass-card" style={{ overflowY: 'auto' }}>
      <div className="sidebar-logo">
        <VaraLogo size={24} />
        <span>Vara</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-group-header">Reporting & Benchmarking</div>
        <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={18} />
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/search" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Search size={18} />
          <span>Research</span>
        </NavLink>
        <NavLink to="/compare" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <BarChart2 size={18} />
          <span>Benchmarking</span>
        </NavLink>
        <NavLink to="/esg" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Globe size={18} />
          <span>ESG Research</span>
        </NavLink>
        <NavLink to="/boards" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Users size={18} />
          <span>Board Profiles</span>
        </NavLink>
        <NavLink to="/insiders" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <UserCheck size={18} />
          <span>Insider Trading</span>
        </NavLink>

        <div className="nav-group-header">Business Intelligence</div>
        <NavLink to="/accounting" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <BookOpen size={18} />
          <span>Accounting Standards</span>
        </NavLink>
        <NavLink to="/accounting-analytics" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <TrendingUp size={18} />
          <span>Accounting Analytics</span>
        </NavLink>
        <NavLink to="/earnings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Mic size={18} />
          <span>Earnings Releases</span>
        </NavLink>

        <div className="nav-group-header">Regulation & Compliance</div>
        <NavLink to="/regulation" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Scale size={18} />
          <span>Securities Regulation</span>
        </NavLink>
        <NavLink to="/comment-letters" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Mail size={18} />
          <span>Comment Letters</span>
        </NavLink>
        <NavLink to="/no-action-letters" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <ShieldCheck size={18} />
          <span>No-Action Letters</span>
        </NavLink>
        <NavLink to="/enforcement" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Gavel size={18} />
          <span>SEC Enforcement</span>
        </NavLink>

        <div className="nav-group-header">Transactions</div>
        <NavLink to="/ipo" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Briefcase size={18} />
          <span>IPO Center</span>
        </NavLink>
        <NavLink to="/mna" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Handshake size={18} />
          <span>M&A Research</span>
        </NavLink>
        <NavLink to="/exhibits" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <FileSearch size={18} />
          <span>Exhibits & Agreements</span>
        </NavLink>
        <NavLink to="/exempt-offerings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <DollarSign size={18} />
          <span>Exempt Offerings</span>
        </NavLink>
        <NavLink to="/adv-registrations" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <ClipboardList size={18} />
          <span>ADV Registrations</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <NavLink to="/api-portal" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Code size={18} />
          <span>API Portal</span>
        </NavLink>
        <NavLink to="/support" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LifeBuoy size={18} />
          <span>Support Center</span>
        </NavLink>
      </div>
    </aside>
  );
}

export function Navbar() {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const { setChatOpen } = useApp();

  return (
    <header className={`navbar ${isLanding ? 'landing-nav' : ''}`}>
      {isLanding && (
        <div className="navbar-logo">
          <VaraLogo size={24} />
          <span>Vara</span>
        </div>
      )}
      
      {!isLanding && (
        <div className="mobile-menu-btn">
          <Menu size={24} />
        </div>
      )}

      <div className="navbar-spacer"></div>

      <div className="navbar-actions">
        {!isLanding && (
          <button className="icon-btn" onClick={() => setChatOpen(true)} title="AI Assistant">
            <MessageSquare size={20} />
          </button>
        )}
        <div className="avatar">JD</div>
      </div>
    </header>
  );
}

export function Layout() {
  const location = useLocation();
  const isLanding = location.pathname === '/';

  return (
    <div className={`app-wrapper ${isLanding ? 'is-landing' : 'has-sidebar'}`}>
      <Sidebar />
      <div className="main-content">
        <Navbar />
        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
