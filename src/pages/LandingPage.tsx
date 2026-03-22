import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart2,
  Bot,
  Briefcase,
  Building2,
  ChevronRight,
  Code,
  Globe,
  LayoutDashboard,
  Search,
  Shield,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
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
    title: 'Live filing discovery',
    copy: 'Natural-language and Boolean research with form, date, SIC, and section-level context.',
  },
  {
    icon: Bot,
    title: 'AI in the workflow',
    copy: 'Summaries, filing Q&A, S-1 analysis, and clause extraction stay tied to the source material.',
  },
  {
    icon: Building2,
    title: 'Specialty workspaces',
    copy: 'Benchmarking, governance, regulation, IPO, M&A, exhibits, offerings, and API delivery in one product.',
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
      'Jump from search into benchmarking, filing-volume trends, watchlists, and saved alerts without rebuilding your analysis from scratch.',
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
      'Specialized workspaces cover SEC correspondence, enforcement, S-1 analysis, M&A research, exhibits, exempt offerings, and ADV registrations.',
    modules: [
      'Regulation, comment letters, and no-action letters',
      'SEC enforcement tracking',
      'IPO Center and S-1 analyzer',
      'M&A, exhibits, offerings, and ADV',
    ],
    route: '/regulation',
    cta: 'Review Specialty Tools',
  },
  {
    icon: Code,
    tone: 'slate',
    eyebrow: 'Platform & Enablement',
    title: 'Operationalize research across the team',
    description:
      'Use the integrated copilot, API portal, and support center to turn one-off research into a repeatable operating workflow.',
    modules: [
      'Vara Copilot',
      'API Data Integration Portal',
      'Support Center workflow guides',
      'Unified navigation across workspaces',
    ],
    route: '/api-portal',
    cta: 'Visit The API Portal',
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
    copy: 'Move into disclosure benchmarking, dashboard trends, or redlines to see what changed.',
  },
  {
    icon: Bot,
    title: 'Extract with AI',
    copy: 'Generate summaries, analyze S-1s, compare clauses, and ask filing questions without leaving the source.',
  },
  {
    icon: TrendingUp,
    title: 'Keep the question alive',
    copy: 'Expand into monitoring, governance, regulation, IPO, M&A, or API workflows with context intact.',
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
  'SEC Enforcement',
  'IPO Center',
  'M&A Research',
  'Exhibits & Agreements',
  'API Portal',
] as const;

// This visual follows the imagegen art direction for an editorial "SEC research control room"
// until a generated hero asset can be dropped in.
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
  const repeatedModules = [...marqueeModules, ...marqueeModules];

  return (
    <div className="landing-signal" aria-hidden="true">
      <div className="landing-signal__mesh" />
      <div className="landing-signal__orb landing-signal__orb--one" />
      <div className="landing-signal__orb landing-signal__orb--two" />

      <div className="landing-signal-card landing-signal-card--workspace">
        <div className="landing-window-controls">
          <span />
          <span />
          <span />
        </div>
        <p className="landing-signal-card__eyebrow">Research Workbench</p>
        <h3>Search, compare, and route the next step without losing context.</h3>

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
        <p className="landing-signal-card__eyebrow">AI Brief</p>
        <h4>What the assistant can surface quickly</h4>
        <ul className="landing-brief-list">
          <li>Peer language is converging around AI governance and vendor concentration.</li>
          <li>Redline mode exposes new cyber and model-risk disclosure blocks immediately.</li>
          <li>Best next stops: Benchmarking, IPO Center, and Enforcement.</li>
        </ul>
      </div>

      <div className="landing-signal-card landing-signal-card--matrix">
        <p className="landing-signal-card__eyebrow">Benchmark Matrix</p>
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
                {row.peers.map(peer => (
                  <span
                    key={`${row.topic}-${peer.label}-${peer.tone}`}
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
        <p className="landing-signal-card__eyebrow">Live Signal</p>
        <div className="landing-pulse-chart">
          {pulseBars.map((height, index) => (
            <span key={`${height}-${index}`} style={{ height: `${height}%` }} />
          ))}
        </div>
        <p className="landing-pulse-caption">
          Filing volume, watchlists, and trending themes stay one click away.
        </p>
      </div>

      <div className="landing-marquee">
        <div className="landing-marquee__track">
          {repeatedModules.map((module, index) => (
            <span key={`${module}-${index}`} className="landing-marquee__pill">
              {module}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(query.trim() ? `/search?q=${encodeURIComponent(query)}` : '/search');
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
            <Sparkles size={16} />
            <span>SEC intelligence for legal, finance, and compliance teams</span>
          </div>

          <h1 className="landing-title">
            Make SEC research feel like
            <span> momentum, not friction.</span>
          </h1>

          <p className="landing-subtitle">
            Vara combines live EDGAR discovery, peer benchmarking, AI extraction, governance
            research, and transaction workspaces in one high-context product.
          </p>

          <form className="landing-search" onSubmit={handleSearch}>
            <Search className="landing-search__icon" size={18} />
            <input
              type="text"
              placeholder="Search filings, risk factors, clauses, rule topics, or S-1 names..."
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            <button type="submit" className="landing-search__button">
              Start Research
              <ArrowRight size={16} />
            </button>
          </form>

          <div className="landing-actions">
            <button
              type="button"
              className="landing-secondary-button"
              onClick={() => navigate('/dashboard')}
            >
              <LayoutDashboard size={16} />
              Open Dashboard
            </button>
            <button type="button" className="landing-link-button" onClick={scrollToCapabilities}>
              Explore Platform Coverage
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
          <h2>A platform that covers the whole SEC workflow.</h2>
          <p>
            From the first filing search to the last disclosure comparison, every major
            research lane already has a dedicated workspace.
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
                  onClick={() => navigate(group.route)}
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
          <p className="landing-section__eyebrow">How Vara Works</p>
          <h2>Research loops that keep teams in flow.</h2>
          <p>
            Start with search, move to benchmarking, pull AI help in context, and expand into
            monitoring, governance, or transactions without resetting your work.
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
              onClick={() => navigate('/search')}
            >
              <Search size={16} />
              Start in Research
            </button>
            <button
              type="button"
              className="landing-secondary-button"
              onClick={() => navigate('/dashboard')}
            >
              <LayoutDashboard size={16} />
              View Dashboard
            </button>
            <button
              type="button"
              className="landing-tertiary-button"
              onClick={() => navigate('/ipo')}
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
            <VaraLogo size={18} />
            Vara AI
          </div>
          <div className="landing-footer__links">
            <span>&copy; 2026 Vara AI Inc.</span>
            <a href="/support">Support</a>
            <a href="/support">Privacy</a>
            <a href="/support">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function VaraLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="vara-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
      </defs>
      <path d="M3 4h4.5L12 18 16.5 4H21l-7.5 18h-3L3 4z" fill="url(#vara-grad)" opacity="0.9" />
      <path d="M3 4h4.5L12 18 16.5 4H21l-7.5 18h-3L3 4z" fill="none" stroke="white" strokeWidth="0.5" opacity="0.4" />
    </svg>
  );
}
