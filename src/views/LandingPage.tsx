'use client';

import { type FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  ArrowRight,
  BarChart2,
  Bot,
  Briefcase,
  Building2,
  ChevronRight,
  Globe,
  LifeBuoy,
  LayoutDashboard,
  Search,
  Shield,
  TrendingUp,
} from 'lucide-react';
import { URCBrandLockup } from '../components/brand/URCBrand';
import { BRAND } from '../config/brand';
import { ENFORCEMENT_LANDING_CAPABILITY } from '../config/enforcement';
import './LandingPage.css';

const audienceLabels = [
  'Legal teams',
  'Finance leaders',
  'Compliance officers',
  'Accounting teams',
  'Corp dev',
  'Investor relations',
] as const;

const proofPoints = [
  {
    icon: Search,
    title: 'Consulting-grade discovery',
    copy: 'Natural-language and Boolean research with form, date, SIC, and section-level context.',
  },
  {
    icon: Bot,
    title: 'Source-grounded AI assistance',
    copy: 'Summaries, filing Q&A, S-1 analysis, and clause extraction use selected source evidence and require source review.',
  },
  {
    icon: Building2,
    title: 'Specialist workspaces',
    copy: 'Benchmarking, governance, regulation, IPO, M&A, exhibits, and offerings in one product.',
  },
] as const;

const capabilityGroups = [
  {
    icon: Search,
    tone: 'cobalt',
    eyebrow: 'Research & Filing Analysis',
    title: 'Search, parse, and interrogate filings',
    description:
      'Run natural-language or Boolean research, keep work in tabbed sessions, and move through parsed sections instead of losing context.',
    modules: [
      'Research Workbench',
      'Filing detail viewer and annotations',
      'Section parsing and highlights',
      'Year-over-year redlines',
    ],
    route: '/search',
    cta: 'Open Research',
  },
  {
    icon: BarChart2,
    tone: 'amber',
    eyebrow: 'Benchmarking & Monitoring',
    title: 'Compare peers and keep themes on watch',
    description:
      'Use dedicated workspaces for peer benchmarking, watchlist filing-volume charts, and browser-local saved searches.',
    modules: [
      'Disclosure Benchmarking Matrix',
      'Overview dashboard',
      'Watchlists and saved alerts',
      'Accounting analytics and earnings',
    ],
    route: '/compare',
    cta: 'See Benchmarking',
  },
  {
    icon: Globe,
    tone: 'mint',
    eyebrow: 'Governance & Standards',
    title: 'Cover ESG, boards, insiders, and accounting',
    description:
      'Stay inside one environment while moving from technical accounting research to governance intelligence and sustainability frameworks.',
    modules: [
      'ESG Research Center',
      'Accounting Research Hub',
      'Board profiles and compensation',
      'Insider trading',
    ],
    route: '/esg',
    cta: 'Explore Governance',
  },
  {
    icon: Shield,
    tone: 'coral',
    eyebrow: 'Regulation & Transactions',
    title: 'Handle letters, rules, deals, and IPO work',
    description:
      'Specialized workspaces cover SEC correspondence, litigation releases and civil actions, S-1 analysis, M&A research, exhibits, exempt offerings, and ADV registrations.',
    modules: [
      'Regulation, comment letters, and no-action letters',
      ENFORCEMENT_LANDING_CAPABILITY,
      'IPO Center and S-1 analyzer',
      'M&A, exhibits, offerings, and ADV',
    ],
    route: '/regulation',
    cta: 'Review Specialty Tools',
  },
  {
    icon: LifeBuoy,
    tone: 'slate',
    eyebrow: 'Platform & Enablement',
    title: 'Make individual research easier to repeat',
    description:
      'Use the integrated copilot and support center within an individual, browser-local research workflow.',
    modules: [
      'URC Copilot',
      'Source-grounded Copilot prompts',
      'Support Center workflow guides',
      'Unified navigation across workspaces',
    ],
    route: '/support',
    cta: 'Open Support Center',
  },
] as const;

const workflowSteps = [
  {
    icon: Search,
    title: 'Find the signal',
    copy: 'Start with natural-language or Boolean search and refine by form, date, SIC, and topic.',
  },
  {
    icon: BarChart2,
    title: 'Compare the language',
    copy: 'Move into disclosure benchmarking, watchlist filing charts, or redlines to see what changed.',
  },
  {
    icon: Bot,
    title: 'Extract with AI',
    copy: 'Generate summaries, analyze S-1s, compare clauses, and ask filing questions using selected source evidence.',
  },
  {
    icon: TrendingUp,
    title: 'Keep the question alive',
    copy: 'Move next into the dedicated monitoring, governance, regulation, IPO, or M&A workspace.',
  },
] as const;

const marqueeModules = [
  'Research Workbench',
  'Benchmarking Matrix',
  'Overview Dashboard',
  'Accounting Hub',
  'ESG Research',
  'Board Profiles',
  'Insider Trading',
  'Securities Regulation',
  'Comment Letters',
  'SEC Litigation Releases',
  'IPO Center',
  'M&A Research',
  'Exhibits & Agreements',
  'Support Center',
] as const;

// Static illustrative product preview; none of the rows, ratings, or bars below
// are live data.
function LandingSignalCanvas() {
  const resultRows = [
    {
      form: 'S-1',
      company: 'Arm Holdings',
      detail: 'Risk Factors mapped to AI regulation, export controls, and IP concentration.',
    },
    {
      form: '10-K',
      company: 'NVIDIA',
      detail: 'Item 1A and MD&A lined up for redline review and peer benchmarking.',
    },
    {
      form: '8-K / Ex. 2.1',
      company: 'Cisco',
      detail: 'Deal documents ready for AI clause extraction and transactional screening.',
    },
  ] as const;

  const benchmarkRows = [
    {
      topic: 'AI governance',
      peers: [
        { label: 'Expanded', tone: 'strong' },
        { label: 'Standard', tone: 'medium' },
        { label: 'Emerging', tone: 'light' },
      ],
    },
    {
      topic: 'Cybersecurity',
      peers: [
        { label: 'Expanded', tone: 'strong' },
        { label: 'Expanded', tone: 'strong' },
        { label: 'Standard', tone: 'medium' },
      ],
    },
    {
      topic: 'Supply chain',
      peers: [
        { label: 'Standard', tone: 'medium' },
        { label: 'Emerging', tone: 'light' },
        { label: 'Expanded', tone: 'strong' },
      ],
    },
  ] as const;

  const pulseBars = [32, 44, 38, 58, 49, 62, 74, 69, 82] as const;
  const coverageTags = ['10-K & 10-Q', 'S-1 & IPO', 'Comment letters', 'M&A clauses'] as const;

  return (
    <div className="landing-signal" aria-hidden="true">
      <div className="landing-signal-card landing-signal-card--workspace">
        <p className="landing-signal-card__eyebrow">Illustrative Research Workbench</p>
        <h3>Preview search, comparison, and the next research step.</h3>

        <div className="landing-signal-query">
          <Search size={16} />
          <span>AI regulation risk factors in recent tech S-1s</span>
        </div>

        <div className="landing-signal-results">
          {resultRows.map(row => (
            <div key={`${row.company}-${row.form}`} className="landing-signal-result">
              <span className="landing-signal-result__form">{row.form}</span>
              <div className="landing-signal-result__body">
                <strong>{row.company}</strong>
                <p>{row.detail}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="landing-chip-row">
          {coverageTags.map(tag => (
            <span key={tag} className="landing-chip">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="landing-signal-card landing-signal-card--brief">
        <p className="landing-signal-card__eyebrow">Illustrative AI Brief</p>
        <h4>What the assistant can surface quickly</h4>
        <ul className="landing-brief-list">
          <li>Peer language is converging around AI governance and vendor concentration.</li>
          <li>Redline mode exposes new cyber and model-risk disclosure blocks immediately.</li>
          <li>Best next stops: Benchmarking, IPO Center, and SEC Litigation Releases.</li>
        </ul>
      </div>

      <div className="landing-signal-card landing-signal-card--matrix">
        <p className="landing-signal-card__eyebrow">Illustrative Benchmark Matrix</p>
        <div className="landing-matrix-head">
          <span>AAPL</span>
          <span>MSFT</span>
          <span>NVDA</span>
        </div>

        <div className="landing-matrix-grid">
          {benchmarkRows.map(row => (
            <div key={row.topic} className="landing-matrix-row">
              <span className="landing-matrix-topic">{row.topic}</span>
              <div className="landing-matrix-peer-grid">
                {row.peers.map((peer, peerIndex) => (
                  <span
                    key={`${row.topic}-${peerIndex}`}
                    className={`landing-matrix-cell landing-matrix-cell--${peer.tone}`}
                  >
                    {peer.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="landing-signal-card landing-signal-card--pulse">
        <p className="landing-signal-card__eyebrow">Illustrative Workflow Preview</p>
        <div className="landing-pulse-chart">
          {pulseBars.map((height, index) => (
            <span key={`${height}-${index}`} style={{ height: `${height}%` }} />
          ))}
        </div>
        <p className="landing-pulse-caption">
          Sample bars preview where watchlist filing volume and saved searches appear.
        </p>
      </div>

      <div className="landing-marquee">
        <div className="landing-marquee__track">
          {marqueeModules.map(module => (
            <span key={module} className="landing-marquee__pill">
              {module}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useRouter();
  const [query, setQuery] = useState('');

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate.push(query.trim() ? `/search?q=${encodeURIComponent(query)}` : '/search');
  };

  const scrollToCapabilities = () => {
    document.getElementById('landing-capabilities')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  return (
    <div className="landing-container">
      <section className="landing-hero">
        <div className="landing-hero__copy">
          <div className="landing-kicker">
            <span>Uniqus product for SEC intelligence, benchmarking, and transaction research</span>
          </div>

          <h1 className="landing-title">
            Move from SEC question to
            <span> client-ready insight faster.</span>
          </h1>

          <p className="landing-subtitle">
            {BRAND.productName} combines live EDGAR discovery, peer benchmarking, AI extraction,
            governance research, and transaction workspaces in one browser-based research interface.
          </p>

          <form className="landing-search" onSubmit={handleSearch}>
            <Search className="landing-search__icon" size={18} />
            <input
              type="text"
              // A placeholder is not an accessible name — label the field so
              // screen readers announce it (mobile a11y contract).
              aria-label="Search filings, risk factors, clauses, or rule topics"
              /* Short enough to render whole in the hero field — the longer copy
                 was being clipped mid-phrase ("...clauses, rule"). */
              placeholder="Search filings, risk factors, or clauses..."
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            <button type="submit" className="landing-search__button">
              Start Research
              <ArrowRight size={16} />
            </button>
          </form>

          {/* One primary action (the search above) and one "learn more" link.
              Task-based entry points (Dashboard, IPO) live in the closing
              section, so the hero doesn't compete with itself. */}
          <div className="landing-actions">
            <button type="button" className="landing-link-button" onClick={scrollToCapabilities}>
              See what it covers
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="landing-proof-grid">
            {proofPoints.map(point => {
              const Icon = point.icon;
              return (
                <article key={point.title} className="landing-proof-card">
                  <div className="landing-proof-card__icon">
                    <Icon size={18} />
                  </div>
                  <div>
                    <h3>{point.title}</h3>
                    <p>{point.copy}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <LandingSignalCanvas />
      </section>

      <section className="landing-audience-strip">
        <div className="landing-audience-strip__content">
          <span className="landing-audience-strip__label">Built for</span>
          <div className="landing-audience-strip__items">
            {audienceLabels.map(label => (
              <span key={label} className="landing-audience-strip__pill">
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section--capabilities" id="landing-capabilities">
        <div className="landing-section__header">
          <p className="landing-section__eyebrow">Platform Coverage</p>
          <h2>Dedicated workspaces for common SEC research workflows.</h2>
          <p>
            Move among filing search, disclosure comparison, governance, accounting,
            regulation, and transaction-focused tools.
          </p>
        </div>

        <div className="landing-capability-grid">
          {capabilityGroups.map(group => {
            const Icon = group.icon;
            return (
              <article
                key={group.title}
                className={`landing-capability-card landing-capability-card--${group.tone}`}
              >
                <div className="landing-capability-card__icon">
                  <Icon size={20} />
                </div>
                <p className="landing-capability-card__eyebrow">{group.eyebrow}</p>
                <h3>{group.title}</h3>
                <p className="landing-capability-card__description">{group.description}</p>

                <ul className="landing-module-list">
                  {group.modules.map(module => (
                    <li key={module}>{module}</li>
                  ))}
                </ul>

                <button
                  type="button"
                  className="landing-card-link"
                  onClick={() => navigate.push(group.route)}
                >
                  {group.cta}
                  <ArrowRight size={16} />
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="landing-section landing-section--workflow">
        <div className="landing-section__header">
          <p className="landing-section__eyebrow">How URC Works</p>
          <h2>A repeatable path through individual research.</h2>
          <p>
            Start with search, move to benchmarking, use AI against selected evidence, and
            continue in a specialist workspace. Saved research state remains browser-local.
          </p>
        </div>

        <div className="landing-step-grid">
          {workflowSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <article key={step.title} className="landing-step-card">
                <div className="landing-step-card__topline">
                  <span className="landing-step-card__index">0{index + 1}</span>
                  <div className="landing-step-card__icon">
                    <Icon size={18} />
                  </div>
                </div>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="landing-section landing-section--cta">
        <div className="landing-cta-card">
          <div className="landing-cta-card__copy">
            <p className="landing-section__eyebrow">Jump In</p>
            <h2>Start where the question is hottest.</h2>
            <p>
              Open research for a filing question, head to the dashboard for monitoring, or
              jump straight into IPO analysis.
            </p>
          </div>

          <div className="landing-cta-actions">
            <button
              type="button"
              className="landing-search__button landing-search__button--compact"
              onClick={() => navigate.push('/search')}
            >
              <Search size={16} />
              Open Research Workbench
            </button>
            <button
              type="button"
              className="landing-secondary-button"
              onClick={() => navigate.push('/dashboard')}
            >
              <LayoutDashboard size={16} />
              Go to Dashboard
            </button>
            <button
              type="button"
              className="landing-tertiary-button"
              onClick={() => navigate.push('/ipo')}
            >
              <Briefcase size={16} />
              Open IPO Center
            </button>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer__content">
          <div className="landing-footer__brand">
            <URCBrandLockup size={18} tone="light" showParent />
          </div>
          <div className="landing-footer__links">
            <span>&copy; 2026 {BRAND.productName}</span>
            <a href="/support">Support</a>
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
