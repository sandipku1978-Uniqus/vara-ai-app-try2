/**
 * Evidence Ledger — Phase 1 component gallery.
 *
 * Living reference for the redesign foundations (see the handoff bundle in
 * docs/). Every component here uses ONLY the .el-scope tokens — no legacy
 * variables — so this page is the acceptance surface for the token system
 * before any product route migrates. Sample data is real in shape (Organon,
 * accessions, dates) but static; freshness/verification badges in product
 * routes must bind to /api/stats and facet-store cross-checks.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import '../../styles/evidence-ledger.css';

export const metadata: Metadata = {
  title: 'Evidence Ledger — component gallery',
  robots: { index: false, follow: false },
};

const sampleRows = [
  {
    company: 'Organon & Co.', ticker: 'OGN', form: '10-K', filed: '2026-02-24',
    section: 'Item 1A · Risk Factors', verified: true,
    excerpt:
      '“Risks related to our announced merger with Sun Pharmaceutical Industries, including the failure to complete the transaction on the anticipated timeline, could adversely affect our business, results of operations, and stock price.”',
    selected: true,
  },
  {
    company: 'Organon & Co.', ticker: 'OGN', form: '10-K/A', filed: '2025-11-10',
    section: 'Item 9A · Controls', verified: true,
    excerpt:
      '“Management identified a material weakness in internal control over financial reporting related to the design of certain information technology general controls.”',
    selected: false,
  },
  {
    company: 'Organon & Co.', ticker: 'OGN', form: '8-K', filed: '2026-06-11',
    section: 'Item 1.01 · Material Agreement', verified: true,
    excerpt:
      '“On June 11, 2026, the Company entered into an Agreement and Plan of Merger with Sun Pharmaceutical Industries Ltd. and its wholly owned subsidiary.”',
    selected: false,
  },
];

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--el-space-8)' }}>
      <h2 className="el-panel-title" style={{ marginBottom: 'var(--el-space-1)' }}>{title}</h2>
      {note ? (
        <p style={{ color: 'var(--el-ink-muted)', fontSize: 'var(--el-text-sm)', marginBottom: 'var(--el-space-3)' }}>{note}</p>
      ) : null}
      {children}
    </section>
  );
}

function SpecimenNotice({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p
      id={id}
      data-gallery-specimen-notice
      style={{
        alignItems: 'center',
        color: 'var(--el-ink-muted)',
        display: 'flex',
        fontSize: 'var(--el-text-sm)',
        gap: 'var(--el-space-2)',
        margin: '0 0 var(--el-space-2)',
      }}
    >
      <span className="el-badge el-badge-neutral">Illustrative specimen</span>
      <span>{children}</span>
    </p>
  );
}

export default function DesignGalleryPage() {
  // Internal design reference only. In production it would show any signed-in
  // user fabricated filing rows carrying "verified" badges — the one thing
  // this product must never do.
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <div className="el-scope el-gallery" style={{ minHeight: '100vh', padding: 'var(--el-space-8)' }}>
      <div style={{ maxWidth: '1180px', margin: '0 auto' }}>
        <div data-gallery-fixture-disclosure role="note" style={{ maxWidth: '1180px', margin: '0 auto var(--el-space-4)', padding: 'var(--el-space-2) var(--el-space-3)', border: '1px dashed var(--el-rule-strong)', color: 'var(--el-ink-secondary)', fontSize: 'var(--el-text-sm)' }}>
          Design reference with STATIC SAMPLE DATA — the filings, excerpts and verification badges below are fabricated for component review and must not be cited. Control-shaped specimens are illustrative and intentionally perform no action.
        </div>
        <header style={{ marginBottom: 'var(--el-space-8)', borderBottom: '1px solid var(--el-rule-strong)', paddingBottom: 'var(--el-space-4)' }}>
          <h1 style={{ fontSize: 'var(--el-text-xl)', fontWeight: 700, letterSpacing: '-0.01em', margin: 0 }}>
            Evidence Ledger — component gallery
          </h1>
          <div style={{ color: 'var(--el-ink-secondary)', marginTop: 'var(--el-space-1)' }}>
            Phase 1 foundations. Color carries state; the serif voice is reserved for source documents; rules replace shadows.
          </div>
        </header>

        <Section title="Command bar" note="52px, single query surface. Focus ring is the only plum on an idle screen.">
          <SpecimenNotice id="gallery-command-specimen">Read-only query surface; use the Research Workbench for a live search.</SpecimenNotice>
          <div className="el-query-bar">
            <span aria-hidden style={{ color: 'var(--el-ink-faint)' }}>⌕</span>
            <input aria-describedby="gallery-command-specimen" aria-label="Search companies, filings, topics, or standards" placeholder="Search companies, filings, topics, or standards… (⌘K)" readOnly />
            <span className="el-badge el-badge-neutral">All sources</span>
          </div>
        </Section>

        <Section title="Filter tokens" note="Compact, removable, one row. Filters collapse behind the query bar after the first search.">
          <SpecimenNotice id="gallery-filter-specimen">Removal marks demonstrate token anatomy; they are not controls on this reference page.</SpecimenNotice>
          <div style={{ display: 'flex', gap: 'var(--el-space-2)', flexWrap: 'wrap' }}>
            {['Forms: 10-K, 10-K/A', '2010 → today', 'Issuer: Organon & Co.', 'Auditor: PwC'].map(t => (
              <span key={t} className="el-token" aria-describedby="gallery-filter-specimen">
                {t}
                <span aria-hidden="true" className="el-gallery-static-control" data-gallery-static-control="filter-remove">✕</span>
              </span>
            ))}
          </div>
        </Section>

        <Section
          title="Evidence table"
          note="44px default rhythm, selected row uses the plum wash + inset rule. Match reason and source status on every row; excerpt is the serif voice."
        >
          <SpecimenNotice id="gallery-evidence-specimen">Company and section treatments show link styling only; they do not navigate.</SpecimenNotice>
          <div className="el-panel" style={{ overflow: 'hidden' }}>
            <table className="el-table">
              <thead>
                <tr>
                  <th style={{ width: '220px' }}>Company</th>
                  <th style={{ width: '80px' }}>Form</th>
                  <th style={{ width: '110px' }}>Filed</th>
                  <th style={{ width: '210px' }}>Matched section</th>
                  <th>Excerpt</th>
                </tr>
              </thead>
              <tbody>
                {sampleRows.map(row => (
                  <tr key={row.filed + row.form} className={row.selected ? 'el-selected' : undefined} data-gallery-selected={row.selected || undefined}>
                    <td>
                      <span aria-describedby="gallery-evidence-specimen" className="el-link el-gallery-static-control" data-gallery-static-control="evidence-company">{row.company}</span>
                      <div className="el-mono" style={{ color: 'var(--el-ink-muted)' }}>{row.ticker}</div>
                    </td>
                    <td className="el-mono">{row.form}</td>
                    <td className="el-mono">{row.filed}</td>
                    <td>
                      <span aria-describedby="gallery-evidence-specimen" className="el-link el-gallery-static-control" data-gallery-static-control="evidence-section">{row.section}</span>
                      <div style={{ marginTop: 'var(--el-space-1)' }}>
                        <span className="el-badge el-badge-verified" data-gallery-state="verified">✓ Verified source</span>
                      </div>
                    </td>
                    <td><div className="el-excerpt">{row.excerpt}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="State vocabulary" note="Five meanings, five colors, no atmosphere.">
          <div style={{ display: 'flex', gap: 'var(--el-space-2)', flexWrap: 'wrap' }}>
            <span className="el-badge el-badge-verified" data-gallery-vocabulary="verified">✓ Verified source</span>
            <span className="el-badge el-badge-citation" data-gallery-vocabulary="citation">§ Citation</span>
            <span className="el-badge el-badge-review" data-gallery-vocabulary="review">Review required</span>
            <span className="el-badge el-badge-risk" data-gallery-vocabulary="risk">Material weakness</span>
            <span className="el-badge el-badge-neutral" data-gallery-vocabulary="neutral">SEC EDGAR · updated 6 min ago</span>
          </div>
        </Section>

        <Section title="Citation chip + memo actions" note="Add-to-memo and copy-citation are first-class on every evidence-bearing row.">
          <SpecimenNotice id="gallery-citation-specimen">Citation and memo treatments are non-interactive examples on this page.</SpecimenNotice>
          <div style={{ display: 'flex', gap: 'var(--el-space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="el-citation-chip">
              <span className="el-mono">OGN 10-K · 2026-02-24 · Item 1A</span>
              <span aria-describedby="gallery-citation-specimen" className="el-link el-gallery-static-control" data-gallery-static-control="open-source">Open source</span>
            </span>
            <span aria-describedby="gallery-citation-specimen" className="el-btn el-btn-primary el-gallery-static-control" data-gallery-static-control="memo-action">Add to memo</span>
            <span aria-describedby="gallery-citation-specimen" className="el-btn el-btn-secondary el-gallery-static-control" data-gallery-static-control="copy-citation">Copy citation</span>
          </div>
        </Section>

        <Section
          title="AI synthesis block"
          note="Labeled, sourced, reviewable — docked in flow, never floating over the work. Confidence renders only when a real basis exists."
        >
          <SpecimenNotice id="gallery-synthesis-specimen">Source references demonstrate citation styling and do not open documents.</SpecimenNotice>
          <div className="el-synthesis" style={{ maxWidth: '640px' }}>
            <div className="el-synthesis-header">
              <span>Summarize evidence</span>
              <span style={{ marginLeft: 'auto' }} className="el-badge el-badge-neutral">3 sources</span>
              <span className="el-badge el-badge-review">Awaiting review</span>
            </div>
            <div className="el-synthesis-body">
              Organon expanded merger-related risk disclosure in its FY2025 10-K following the June 2026 Sun
              Pharmaceutical agreement, and separately disclosed an ITGC material weakness in the 10-K/A.{' '}
              <span aria-describedby="gallery-synthesis-specimen" className="el-link el-gallery-static-control" data-gallery-static-control="citation-reference">[1]</span>{' '}
              <span aria-describedby="gallery-synthesis-specimen" className="el-link el-gallery-static-control" data-gallery-static-control="citation-reference">[2]</span>{' '}
              <span aria-describedby="gallery-synthesis-specimen" className="el-link el-gallery-static-control" data-gallery-static-control="citation-reference">[3]</span>
            </div>
          </div>
        </Section>

        <Section title="Empty, error, and loading states" note="An empty state always says WHAT was searched and why nothing matched — silent zeros are design defects.">
          <div style={{ display: 'grid', gap: 'var(--el-space-3)', maxWidth: '640px' }}>
            <div className="el-state" data-gallery-state-treatment="empty">
              <strong>No filings matched.</strong> Searched EDGAR full text for{' '}
              <span className="el-mono">“climate remediation”</span> within 10-K and 10-Q, 2010 → today, scoped to
              Organon &amp; Co. (CIK 1821825). Try removing the form filter or widening the date range.
            </div>
            <div className="el-state el-state-error" data-gallery-state-treatment="error">
              <strong>EDGAR did not respond.</strong> The last attempt returned HTTP 503 at 11:42 AM. Results shown are
              from the facet store (fresh as of 10:30 AM). Retry.
            </div>
            <div className="el-panel" data-gallery-state-treatment="loading" aria-label="Loading state specimen" style={{ padding: 'var(--el-space-3)', display: 'grid', gap: 'var(--el-space-2)' }}>
              <div className="el-skeleton" style={{ width: '40%' }} />
              <div className="el-skeleton" style={{ width: '90%' }} />
              <div className="el-skeleton" style={{ width: '75%' }} />
            </div>
          </div>
        </Section>

        <Section title="Type & spacing specimens" note="Tabular numerals everywhere; source serif ≤ 75ch; no marketing sizes inside the application.">
          <div className="el-panel" style={{ padding: 'var(--el-space-4)', display: 'grid', gap: 'var(--el-space-3)', maxWidth: '640px' }}>
            <div style={{ fontSize: 'var(--el-text-xl)', fontWeight: 700 }}>Page title 22 — Issuer dossier</div>
            <div style={{ fontSize: 'var(--el-text-lg)', fontWeight: 650 }}>Panel title 18 — Filing history</div>
            <div>UI default 14 — table cells, controls, navigation</div>
            <div style={{ fontSize: 'var(--el-text-sm)', color: 'var(--el-ink-secondary)' }}>Secondary 12.8 — metadata, captions</div>
            <div className="el-excerpt">Source serif 16 — “We develop and use AI systems that may produce incorrect or unintended outcomes.”</div>
            <div className="el-mono">Mono — 0001821825 · 0001104659-26-018395 · OGN</div>
          </div>
        </Section>
      </div>
    </div>
  );
}
