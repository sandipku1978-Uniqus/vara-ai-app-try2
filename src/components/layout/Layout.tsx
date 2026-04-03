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

      <nav className="sidebar-nav">
        <div className="nav-group-header">Reporting & Benchmarking</div>
        <SidebarNavItem to="/dashboard" label="Dashboard" icon={<LayoutDashboard size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/search" label="Research" icon={<Search size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/compare" label="Benchmarking" icon={<BarChart2 size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/esg" label="ESG Research" icon={<Globe size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/boards" label="Board Profiles" icon={<Users size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/insiders" label="Insider Trading" icon={<UserCheck size={18} />} isSidebarCollapsed={isSidebarCollapsed} />

        <div className="nav-group-header">Business Intelligence</div>
        <SidebarNavItem to="/accounting" label="Accounting Standards" icon={<BookOpen size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/accounting-analytics" label="Accounting Analytics" icon={<TrendingUp size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/earnings" label="8-K Event Filings" icon={<Mic size={18} />} isSidebarCollapsed={isSidebarCollapsed} />

        <div className="nav-group-header">Regulation & Compliance</div>
        <SidebarNavItem to="/regulation" label="Securities Regulation" icon={<Scale size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/comment-letters" label="Comment Letters" icon={<Mail size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/no-action-letters" label="No-Action Letters" icon={<ShieldCheck size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/enforcement" label="SEC Enforcement" icon={<Gavel size={18} />} isSidebarCollapsed={isSidebarCollapsed} />

        <div className="nav-group-header">Transactions</div>
        <SidebarNavItem to="/ipo" label="IPO Center" icon={<Briefcase size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/mna" label="M&A Research" icon={<Handshake size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
        <SidebarNavItem to="/exhibits" label="Exhibits & Agreements" icon={<FileSearch size={18} />} isSidebarCollapsed={isSidebarCollapsed} />
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

export function Layout({ children }: { children: ReactNode }) {
  const location = usePathname();
  const isLanding = location === '/';
  const { isChatOpen } = useApp();

  return (
    <div className={`app-wrapper ${isLanding ? 'is-landing' : 'has-sidebar'} ${!isLanding && isChatOpen ? 'has-copilot' : ''}`}>
      <Sidebar />
      <div className="main-content">
        <Navbar />
        <main className="page-content">
          {children}
        </main>
      </div>
    </div>
  );
}
