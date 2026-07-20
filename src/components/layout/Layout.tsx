'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { SignInButton, SignUpButton, UserButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Search, LayoutDashboard, BarChart2, MessageSquare, Menu, ChevronLeft, ChevronRight,
  BookOpen, Globe, Users, Briefcase, Handshake, Code, LifeBuoy,
  TrendingUp, UserCheck, Mail, ShieldCheck, Gavel, Scale,
  FileSearch, DollarSign, Mic, ClipboardList, Moon, Sun
} from 'lucide-react';
import { useApp } from '../../context/AppState';
import { URCBrandLockup, URCBrandMark } from '../brand/URCBrand';
import { BRAND } from '../../config/brand';
import { clerkEnabled } from '../../services/auth';
import CommandPalette from './CommandPalette';
import './Layout.css';

function SidebarNavItem({
  to,
  label,
  icon,
  isSidebarCollapsed,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  isSidebarCollapsed: boolean;
}) {
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link
      href={to}
      title={isSidebarCollapsed ? label : undefined}
      aria-label={label}
      className={`nav-item ${isActive ? 'active' : ''}`}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function Sidebar() {
  const location = usePathname();
  const isLanding = location === '/';
  const { themeMode, isSidebarCollapsed, toggleSidebarCollapsed } = useApp();
  const brandTone = themeMode === 'dark' ? 'light' : 'dark';

  if (isLanding) return null; // No sidebar on landing page

  return (
    <aside className={`sidebar glass-card ${isSidebarCollapsed ? 'collapsed' : ''}`} style={{ overflowY: 'auto' }}>
      {isSidebarCollapsed && (
        <button
          type="button"
          className="sidebar-expand-handle"
          onClick={toggleSidebarCollapsed}
          aria-label="Expand side navigation"
          title="Expand navigation"
        >
          <ChevronRight size={16} />
        </button>
      )}
      <div className="sidebar-logo">
        {isSidebarCollapsed ? (
          <div className="sidebar-brand-mark-shell" aria-label={BRAND.parentName} title={BRAND.parentName}>
            <URCBrandMark size={34} tone={brandTone} className="sidebar-brand-mark" />
          </div>
        ) : (
          <URCBrandLockup size={28} compact tone={brandTone} showParent className="sidebar-brand-lockup" />
        )}
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={toggleSidebarCollapsed}
          aria-label={isSidebarCollapsed ? 'Expand side navigation' : 'Collapse side navigation'}
          title={isSidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Grouped by the accountant's job, not the data's domain:
          Monitor → Research → Benchmark → Reference → Transactions */}
      <nav className="sidebar-nav">
        <div className="nav-group-header">Monitor</div>
        <SidebarNavItem to="/dashboard" label="Dashboard" icon={<LayoutDashboard size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/earnings" label="8-K Event Filings" icon={<Mic size={18} />} isSidebarCollapsed={isSidebarCollapsed} />

        <div className="nav-group-header">Research</div>
        <SidebarNavItem to="/search" label="Research Workbench" icon={<Search size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/comment-letters" label="Comment Letters" icon={<Mail size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/exhibits" label="Exhibits & Agreements" icon={<FileSearch size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/no-action-letters" label="No-Action Letters" icon={<ShieldCheck size={18} />} isSidebarCollapsed={isSidebarCollapsed} />

        <div className="nav-group-header">Benchmark</div>
        <SidebarNavItem to="/compare" label="Benchmarking" icon={<BarChart2 size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/accounting-analytics" label="Accounting Analytics" icon={<TrendingUp size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/esg" label="ESG Research" icon={<Globe size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/boards" label="Board Profiles" icon={<Users size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/insiders" label="Insider Trading" icon={<UserCheck size={18} />} isSidebarCollapsed={isSidebarCollapsed} />

        <div className="nav-group-header">Reference</div>
        <SidebarNavItem to="/accounting" label="Accounting Standards" icon={<BookOpen size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/regulation" label="Securities Regulation" icon={<Scale size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/enforcement" label="SEC Enforcement" icon={<Gavel size={18} />} isSidebarCollapsed={isSidebarCollapsed} />

        <div className="nav-group-header">Transactions</div>
        <SidebarNavItem to="/ipo" label="IPO Center" icon={<Briefcase size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/mna" label="M&A Research" icon={<Handshake size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/exempt-offerings" label="Exempt Offerings" icon={<DollarSign size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/adv-registrations" label="ADV Registrations" icon={<ClipboardList size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
      </nav>

      <div className="sidebar-footer">
        <SidebarNavItem to="/api-portal" label="API Portal" icon={<Code size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/support" label="Support Center" icon={<LifeBuoy size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
      </div>
    </aside>
  );
}

export function Navbar() {
  const location = usePathname();
  const isLanding = location === '/';
  const { setChatOpen, setCurrentPageContext, themeMode, toggleThemeMode } = useApp();
  const nextThemeLabel = themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  const brandTone = themeMode === 'dark' ? 'light' : 'dark';
  const { isSignedIn, isLoaded } = useUser();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const pageLabels: Record<string, string> = {
      '/': 'Home',
      '/dashboard': 'Dashboard',
      '/search': 'Research',
      '/filing': 'Filing Detail',
      '/compare': 'Benchmarking',
      '/accounting': 'Accounting Hub',
      '/comment-letters': 'Comment Letters',
      '/boards': 'Board Profiles',
      '/esg': 'ESG Research',
      '/ipo': 'IPO Center',
      '/mna': 'M&A Research',
    };

    const matchingLabel = Object.entries(pageLabels).find(([path]) =>
      path === '/'
        ? location === path
        : location === path || location.startsWith(`${path}/`)
    )?.[1] || 'Workspace';

    setCurrentPageContext({ path: location, label: matchingLabel });
  }, [location, setCurrentPageContext]);

  return (
    <header className={`navbar ${isLanding ? 'landing-nav' : ''}`}>
      {isLanding && (
        <div className="navbar-logo">
          <URCBrandLockup size={26} tone={brandTone} showParent className="navbar-brand-lockup" />
        </div>
      )}
      
      {!isLanding && (
        <div className="mobile-menu-btn">
          <Menu size={24} />
        </div>
      )}

      <div className="navbar-spacer"></div>

      <div className="navbar-actions">
        <button className="theme-toggle-btn" onClick={toggleThemeMode} title={mounted ? nextThemeLabel : 'Switching theme...'} type="button">
          {mounted ? (themeMode === 'dark' ? <Moon size={17} /> : <Sun size={17} />) : <div style={{width: 17, height: 17}} />}
          <span className="theme-toggle-copy">
            <strong>{mounted ? (themeMode === 'dark' ? 'Dark mode' : 'Light mode') : 'Theme'}</strong>
            <span>{mounted ? (themeMode === 'dark' ? 'Switches to light surfaces' : 'Switches to darker viewing') : 'Loading...'}</span>
          </span>
        </button>
        {!isLanding && (
          <button className="copilot-entry-btn" onClick={() => setChatOpen(true)} title={`Open ${BRAND.copilotName}`}>
            <span className="copilot-entry-ping" />
            <MessageSquare size={18} />
            <span className="copilot-entry-copy">
              <strong>{BRAND.copilotName}</strong>
              <span>Plan, search, and cite</span>
            </span>
          </button>
        )}
        {clerkEnabled ? (
          isLoaded && !isSignedIn ? (
            <div className="nav-auth-actions">
              <SignInButton>
                <button className="nav-auth-btn nav-auth-btn-secondary" type="button">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton>
                <button className="nav-auth-btn nav-auth-btn-primary" type="button">
                  Get Started
                </button>
              </SignUpButton>
            </div>
          ) : isLoaded && isSignedIn ? (
            <UserButton
              appearance={{
                elements: {
                  avatarBox: 'urc-clerk-avatar',
                },
              }}
            />
          ) : null
        ) : (
          <div className="avatar">JD</div>
        )}
      </div>
    </header>
  );
}

/** Route → (group, page) map driving the global breadcrumb trail. */
const BREADCRUMB_MAP: Record<string, [string, string]> = {
  '/dashboard': ['Monitor', 'Dashboard'],
  '/earnings': ['Monitor', '8-K Event Filings'],
  '/search': ['Research', 'Research Workbench'],
  '/comment-letters': ['Research', 'Comment Letters'],
  '/exhibits': ['Research', 'Exhibits & Agreements'],
  '/no-action-letters': ['Research', 'No-Action Letters'],
  '/compare': ['Benchmark', 'Benchmarking'],
  '/accounting-analytics': ['Benchmark', 'Accounting Analytics'],
  '/esg': ['Benchmark', 'ESG Research'],
  '/boards': ['Benchmark', 'Board Profiles'],
  '/insiders': ['Benchmark', 'Insider Trading'],
  '/accounting': ['Reference', 'Accounting Standards'],
  '/regulation': ['Reference', 'Securities Regulation'],
  '/enforcement': ['Reference', 'SEC Enforcement'],
  '/ipo': ['Transactions', 'IPO Center'],
  '/mna': ['Transactions', 'M&A Research'],
  '/exempt-offerings': ['Transactions', 'Exempt Offerings'],
  '/adv-registrations': ['Transactions', 'ADV Registrations'],
  '/api-portal': ['More', 'API Portal'],
  '/support': ['More', 'Support Center'],
};

function Breadcrumbs() {
  const location = usePathname();
  if (!location || location === '/') return null;

  let trail: Array<{ label: string; href?: string }>;
  if (location.startsWith('/filing/')) {
    trail = [{ label: 'Research', href: '/search' }, { label: 'Filing viewer' }];
  } else if (location.startsWith('/company/')) {
    // The dossier renders its own breadcrumb with the company name
    return null;
  } else {
    const entry = BREADCRUMB_MAP[location];
    if (!entry) return null;
    trail = [{ label: entry[0] }, { label: entry[1] }];
  }

  return (
    <nav aria-label="Breadcrumb" style={{ padding: '10px 24px 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
      <a href="/dashboard" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Home</a>
      {trail.map((crumb, index) => (
        <span key={crumb.label}>
          <span style={{ margin: '0 6px' }}>/</span>
          {crumb.href ? (
            <a href={crumb.href} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>{crumb.label}</a>
          ) : (
            <span style={{ color: index === trail.length - 1 ? 'var(--text-primary)' : undefined, fontWeight: index === trail.length - 1 ? 600 : 400 }}>
              {crumb.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const location = usePathname();
  const isLanding = location === '/';
  const { isChatOpen } = useApp();

  return (
    <div className={`app-wrapper ${isLanding ? 'is-landing' : 'has-sidebar'} ${!isLanding && isChatOpen ? 'has-copilot' : ''}`}>
      <Sidebar />
      <CommandPalette />
      <div className="main-content">
        <Navbar />
        {!isLanding && <Breadcrumbs />}
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
