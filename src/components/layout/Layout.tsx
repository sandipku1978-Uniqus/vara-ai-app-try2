'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { SignInButton, SignUpButton, UserButton, useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  Search, LayoutDashboard, BarChart2, MessageSquare, Menu, ChevronLeft, ChevronRight,
  BookOpen, Globe, Users, Briefcase, Handshake, LifeBuoy,
  TrendingUp, UserCheck, Mail, ShieldCheck, Gavel, Scale,
  FileSearch, DollarSign, Mic, ClipboardList, Moon, Sun, X
} from 'lucide-react';
import { useApp } from '../../context/AppState';
import { URCBrandLockup, URCBrandMark } from '../brand/URCBrand';
import MemoTray from '../memo/MemoTray';
import { BRAND } from '../../config/brand';
import { EARNINGS_SCOPE_LABEL } from '../../config/earnings';
import { clerkEnabled } from '../../services/auth';
import { findProductRoute } from '../../config/routes';
import CommandPalette from './CommandPalette';
import './Layout.css';

function SidebarNavItem({
  to,
  label,
  icon,
  isSidebarCollapsed,
  onNavigate,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  isSidebarCollapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <Link
      href={to}
      title={isSidebarCollapsed ? label : undefined}
      aria-label={label}
      // The `active` class paints the current destination; aria-current is what
      // actually reports it. Without it the highlight exists only in pixels.
      aria-current={isActive ? 'page' : undefined}
      className={`nav-item ${isActive ? 'active' : ''}`}
      onClick={onNavigate}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function Sidebar({ mobileOpen, onMobileClose }: { mobileOpen: boolean; onMobileClose: () => void }) {
  const location = usePathname();
  const isLanding = location === '/';
  // Signed-out visitors (public Support page) must not be routed into the auth
  // wall by the logo — home for them is the public landing (readiness F-11).
  const { isSignedIn } = useUser();
  const homeHref = isSignedIn ? '/dashboard' : '/';
  const { themeMode, isSidebarCollapsed, toggleSidebarCollapsed } = useApp();
  const brandTone = themeMode === 'dark' ? 'light' : 'dark';
  const asideRef = useRef<HTMLElement>(null);
  const visuallyCollapsed = isSidebarCollapsed && !mobileOpen;

  useEffect(() => {
    if (!mobileOpen || !asideRef.current) return;

    const sidebar = asideRef.current;
    const focusable = () => Array.from(sidebar.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
    focusable()[0]?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onMobileClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    sidebar.addEventListener('keydown', handleKeyDown);
    return () => {
      sidebar.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen, onMobileClose]);

  if (isLanding) return null; // No sidebar on landing page

  return (
    <aside
      ref={asideRef}
      id="primary-navigation"
      // The desktop rail is complementary navigation. At the mobile
      // breakpoint the same element becomes a focus-trapped modal drawer, so
      // expose dialog semantics only while that modal behavior is active.
      role={mobileOpen ? 'dialog' : undefined}
      aria-modal={mobileOpen ? true : undefined}
      aria-label="Primary navigation"
      className={`sidebar glass-card ${visuallyCollapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
      style={{ overflowY: 'auto' }}
    >
      <button type="button" className="mobile-sidebar-close" onClick={onMobileClose} aria-label="Close navigation">
        <X size={20} aria-hidden="true" />
      </button>
      {visuallyCollapsed && (
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
        {/* The logo links home, as users expect. */}
        <Link href={homeHref} className="sidebar-logo-link" aria-label={`${BRAND.productName} — go to ${isSignedIn ? 'dashboard' : 'home'}`} onClick={onMobileClose}>
          {visuallyCollapsed ? (
            <div className="sidebar-brand-mark-shell" title={BRAND.parentName}>
              <URCBrandMark size={28} tone={brandTone} className="sidebar-brand-mark" />
            </div>
          ) : (
            <URCBrandLockup size={22} compact tone={brandTone} showParent className="sidebar-brand-lockup" />
          )}
        </Link>
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={toggleSidebarCollapsed}
          aria-label={visuallyCollapsed ? 'Expand side navigation' : 'Collapse side navigation'}
          title={visuallyCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {visuallyCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* Primary task order: Monitor → Research → Benchmark → Reference → Transactions. */}
      <nav className="sidebar-nav">
        <div className="nav-group-header">Monitor</div>
        <SidebarNavItem to="/dashboard" label="Dashboard" icon={<LayoutDashboard size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/earnings" label={EARNINGS_SCOPE_LABEL} icon={<Mic size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />

        <div className="nav-group-header">Research</div>
        <SidebarNavItem to="/search" label="Research Workbench" icon={<Search size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/comment-letters" label="Comment Letters" icon={<Mail size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/exhibits" label="Exhibits & Agreements" icon={<FileSearch size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/no-action-letters" label="No-Action Letters" icon={<ShieldCheck size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />

        <div className="nav-group-header">Benchmark</div>
        <SidebarNavItem to="/compare" label="Benchmarking" icon={<BarChart2 size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/accounting-analytics" label="Accounting Analytics" icon={<TrendingUp size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/esg" label="ESG Research" icon={<Globe size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/boards" label="Board Profiles" icon={<Users size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/insiders" label="Insider Trading" icon={<UserCheck size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />

        <div className="nav-group-header">Reference</div>
        <SidebarNavItem to="/accounting" label="Accounting Standards" icon={<BookOpen size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/regulation" label="Securities Regulation" icon={<Scale size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/enforcement" label="SEC Litigation Releases" icon={<Gavel size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />

        <div className="nav-group-header">Transactions</div>
        <SidebarNavItem to="/ipo" label="IPO Center" icon={<Briefcase size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/mna" label="M&A Research" icon={<Handshake size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/exempt-offerings" label="Exempt Offerings" icon={<DollarSign size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
        <SidebarNavItem to="/adv-registrations" label="ADV Registrations" icon={<ClipboardList size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
      </nav>

      <div className="sidebar-footer">
        <SidebarNavItem to="/support" label="Support Center" icon={<LifeBuoy size={16} />} isSidebarCollapsed={visuallyCollapsed} onNavigate={onMobileClose} />
      </div>
    </aside>
  );
}

export function Navbar({ mobileNavOpen, onMobileNavToggle, menuButtonRef }: { mobileNavOpen: boolean; onMobileNavToggle: () => void; menuButtonRef: RefObject<HTMLButtonElement | null> }) {
  const location = usePathname();
  const isLanding = location === '/';
  const { setChatOpen, setCurrentPageContext, themeMode, toggleThemeMode } = useApp();
  const nextThemeLabel = themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  const brandTone = themeMode === 'dark' ? 'light' : 'dark';
  const { isSignedIn, isLoaded } = useUser();
  const [mounted, setMounted] = useState(false);
  // Platform-correct shortcut glyph — ⌘ on Mac, Ctrl elsewhere. Resolved
  // after mount to avoid a hydration mismatch; ⌘ until then.
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setMounted(true);
    if (typeof navigator !== 'undefined') {
      setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent));
    }
  }, []);

  useEffect(() => {
    const matchingLabel = location === '/' ? 'Home' : findProductRoute(location)?.label || 'Workspace';

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
        <button
          ref={menuButtonRef}
          type="button"
          className="mobile-menu-btn"
          onClick={onMobileNavToggle}
          aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={mobileNavOpen}
          aria-controls="primary-navigation"
        >
          <Menu size={24} aria-hidden="true" />
        </button>
      )}

      <div className="navbar-spacer"></div>

      <div className="navbar-actions">
        {!isLanding && (
          <button
            type="button"
            className="command-palette-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('urc:open-command-palette'))}
            aria-label="Open quick navigation and search"
            title="Quick navigation (Command or Control K)"
          >
            <Search size={16} aria-hidden="true" />
            <span>Quick find</span>
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
        )}
        {/* Label, icon, and subtext all advertise the DESTINATION (what the
            click does), so the control never reads as a contradictory mix of
            current-state name and switch-action hint. */}
        <button className="theme-toggle-btn" onClick={toggleThemeMode} title={mounted ? nextThemeLabel : 'Switching theme...'} type="button">
          {mounted ? (themeMode === 'dark' ? <Sun size={17} /> : <Moon size={17} />) : <div style={{width: 17, height: 17}} />}
          <span className="theme-toggle-copy">
            <strong>{mounted ? (themeMode === 'dark' ? 'Light mode' : 'Dark mode') : 'Theme'}</strong>
            <span>{mounted ? (themeMode === 'dark' ? 'Switch to light surfaces' : 'Switch to dark surfaces') : 'Loading...'}</span>
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
              {/* Return to the page the visitor was on. Without a redirect the
                  hosted Clerk surface carries no return target, and a user who
                  signs in from /compare lands on the default page instead. */}
              <SignInButton fallbackRedirectUrl={location || '/'}>
                <button className="nav-auth-btn nav-auth-btn-secondary" type="button">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton fallbackRedirectUrl={location || '/'}>
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
          <span className="auth-config-status" title="Authentication is not configured for this deployment">Authentication unavailable</span>
        )}
      </div>
    </header>
  );
}

function Breadcrumbs() {
  const location = usePathname();
  // Same public-visitor rule as the sidebar logo (readiness F-11).
  const { isSignedIn } = useUser();
  if (!location || location === '/') return null;

  let trail: Array<{ label: string; href?: string }>;
  if (location.startsWith('/filing/')) {
    trail = [{ label: 'Research', href: '/search' }, { label: 'Filing viewer' }];
  } else if (location.startsWith('/company/')) {
    // The dossier renders its own breadcrumb with the company name
    return null;
  } else {
    const entry = findProductRoute(location);
    if (!entry) return null;
    trail = [{ label: entry.group }, { label: entry.label }];
  }

  return (
    <nav aria-label="Breadcrumb" style={{ padding: '10px 24px 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
      <Link href={isSignedIn ? '/dashboard' : '/'} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Home</Link>
      {trail.map((crumb, index) => (
        <span key={crumb.label}>
          <span style={{ margin: '0 6px' }}>/</span>
          {crumb.href ? (
            <Link href={crumb.href} style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>{crumb.label}</Link>
          ) : (
            // Weight and colour say "you are here" to the eye; aria-current says
            // it to everyone else.
            <span
              aria-current={index === trail.length - 1 ? 'page' : undefined}
              style={{ color: index === trail.length - 1 ? 'var(--text-primary)' : undefined, fontWeight: index === trail.length - 1 ? 600 : 400 }}
            >
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(wasOpen => {
      if (wasOpen) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      return false;
    });
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  return (
    <div className={`app-wrapper ${isLanding ? 'is-landing' : 'has-sidebar'} ${!isLanding && isChatOpen ? 'has-copilot' : ''}`}>
      <Sidebar mobileOpen={mobileNavOpen} onMobileClose={closeMobileNav} />
      {mobileNavOpen && <button type="button" className="mobile-nav-overlay" aria-label="Close navigation" onClick={closeMobileNav} />}
      <div
        className="main-content"
        // Keep every non-drawer surface in this subtree. A modal mobile drawer
        // must hide the page, global command palette, AND fixed memo tray from
        // keyboard and assistive-technology users, not only cover them.
        inert={mobileNavOpen ? true : undefined}
        aria-hidden={mobileNavOpen ? true : undefined}
      >
        <CommandPalette />
        <Navbar mobileNavOpen={mobileNavOpen} onMobileNavToggle={() => setMobileNavOpen(open => !open)} menuButtonRef={menuButtonRef} />
        {!isLanding && <Breadcrumbs />}
        <main className="page-content">
          {children}
        </main>
        {!isLanding && <MemoTray />}
      </div>
    </div>
  );
}
