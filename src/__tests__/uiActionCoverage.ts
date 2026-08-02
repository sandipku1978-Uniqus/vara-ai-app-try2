/**
 * Action-level coverage traceability (remediation handoff WP8).
 *
 * Every action in UI_PAGE_CONTRACTS must map to EXECUTABLE evidence — a real
 * Playwright spec whose title the meta-test verifies exists — or carry an
 * owned manual exception with an expiry date. Exceptions are a debt register,
 * not a pass: when BURN_DOWN_DATE arrives, every remaining exception turns
 * the suite red by design. Burning them down means writing the behavior
 * archetype tests (navigation, form/Enter parity, combobox, chips, sort,
 * retry identity, export, dialogs, …), not editing the date.
 *
 * HONESTY RULE: an 'automated' entry may only reference a spec that actually
 * exercises the action's behavior. Page-level smoke (route renders an H1) and
 * the census audit (controls exist) do NOT count as action coverage.
 */

export const BURN_DOWN_DATE = '2026-09-30';

export type UiActionEvidence =
  | { kind: 'automated'; specs: readonly { file: string; title: string }[] }
  | { kind: 'manual-exception'; owner: string; reason: string; expires: string };

/**
 * Actions whose failure would silently corrupt research output or leak
 * authority — these may not carry exceptions past BURN_DOWN_DATE, and the
 * meta-test reports them separately so the burn-down starts here.
 */
export const CRITICAL_ACTION_IDS: readonly string[] = [
  'research-workbench.run-search',
  'research-workbench.open-filing',
  'research-workbench.save-alert',
  'dashboard.check-saved-alert',
  'comment-letters.run-search',
  'comment-letters.generate-summary',
  'filing-detail.open-sec-source',
  'global.authentication',
  'global.external-source-links',
];

export const UI_ACTION_COVERAGE: Record<string, UiActionEvidence> = {
  'landing.submit-search': { kind: 'automated', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'hero search carries the visitor query into research' }] },
  'landing.open-dashboard': { kind: 'automated', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'has a meaningful destination' }] },
  'landing.explore-capabilities': { kind: 'automated', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'coverage control scrolls to the promised section' }] },
  'landing.open-capability': { kind: 'automated', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'has a meaningful destination' }] },
  'landing.open-legal-help': { kind: 'automated', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'opens the correct public page' }] },
  'dashboard.add-watch-company': { kind: 'automated', specs: [{ file: 'tests/e2e/watchlist.spec.ts', title: 'dashboard.add-watch-company adds a chosen issuer exactly once' }] },
  'dashboard.open-company-research': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the dashboard page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'dashboard.remove-watch-company': { kind: 'automated', specs: [{ file: 'tests/e2e/watchlist.spec.ts', title: 'dashboard.remove-watch-company removes only the chosen issuer' }] },
  'dashboard.open-recent-filing': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the dashboard page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'dashboard.check-saved-alert': { kind: 'automated', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'research-workbench.save-alert and dashboard.check-saved-alert round-trip' }] },
  'dashboard.open-or-remove-alert': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the dashboard page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'earnings.run-search': { kind: 'automated', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'earnings.run-search returns earnings-release exhibit rows' }] },
  'earnings.open-result-source': { kind: 'automated', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'earnings.open-result-source links each earnings row to its official exhibit' }] },
  'earnings.open-recent-filing': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the earnings page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'earnings.retry-failure': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the earnings page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'research-workbench.run-search': { kind: 'automated', specs: [{ file: 'tests/e2e/boolean-search.spec.ts', title: 'a disjoint OR returns the union, not the intersection' }] },
  'research-workbench.manage-search-sessions': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the research-workbench page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'research-workbench.toggle-panels': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the research-workbench page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'research-workbench.choose-company-suggestion': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the research-workbench page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'research-workbench.save-alert': { kind: 'automated', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'research-workbench.save-alert and dashboard.check-saved-alert round-trip' }] },
  'research-workbench.sort-and-page': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the research-workbench page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'research-workbench.select-result': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the research-workbench page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'research-workbench.open-filing': { kind: 'automated', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'research-workbench.open-filing reaches the exact selected filing workspace' }] },
  'research-workbench.open-issuer-or-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the research-workbench page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'research-workbench.open-assistant-or-help': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the research-workbench page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'comment-letters.run-search': { kind: 'automated', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'comment-letters.run-search renders matches from the letter corpus' }] },
  'comment-letters.apply-example-or-form': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the comment-letters page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'comment-letters.expand-thread': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the comment-letters page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'comment-letters.generate-summary': { kind: 'automated', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'comment-letters.generate-summary POSTs only on explicit click and renders labeled output' }] },
  'comment-letters.open-issuer-or-edgar': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the comment-letters page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'comment-letters.retry-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the comment-letters page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'exhibits.choose-types': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the exhibits page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'exhibits.run-search': { kind: 'automated', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exhibits.run-search returns exhibit rows and preserves the submitted type scope' }] },
  'exhibits.open-result-source': { kind: 'automated', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exhibits.open-result-source links each exhibit row to its official document' }] },
  'exhibits.open-recent-filing': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the exhibits page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'exhibits.retry-failure': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the exhibits page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'no-action-letters.run-search': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the no-action-letters page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'no-action-letters.open-source': { kind: 'automated', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each scraped SEC index row by its document' }] },
  'no-action-letters.retry-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the no-action-letters page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'benchmarking.add-or-remove-company': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the benchmarking page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'benchmarking.switch-view': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the benchmarking page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'benchmarking.choose-years-or-section': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the benchmarking page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'benchmarking.build-peer-group': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the benchmarking page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'benchmarking.generate-summary-or-memo': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the benchmarking page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'benchmarking.export-results': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the benchmarking page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'accounting-analytics.add-company': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the accounting-analytics page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'accounting-analytics.remove-company': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the accounting-analytics page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'accounting-analytics.retry-facts': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the accounting-analytics page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'esg-research.switch-section': { kind: 'automated', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'ESG research sections activate exclusively and preserve sibling surface state' }] },
  'esg-research.open-framework-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the esg-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'esg-research.manage-heatmap-companies': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the esg-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'esg-research.inspect-topic': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the esg-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'esg-research.filter-signals': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the esg-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'esg-research.summarize-or-open-filing': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the esg-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'board-profiles.load-target': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the board-profiles page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'board-profiles.manage-comparison': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the board-profiles page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'board-profiles.switch-view': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the board-profiles page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'board-profiles.retry-company': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the board-profiles page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'insider-trading.add-company': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the insider-trading page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'insider-trading.remove-company': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the insider-trading page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'insider-trading.open-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the insider-trading page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'accounting-standards.switch-section': { kind: 'automated', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'accounting workspaces activate exclusively and preserve sibling surface state' }] },
  'accounting-standards.run-disclosure-search': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the accounting-standards page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'accounting-standards.save-alert-or-memo': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the accounting-standards page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'accounting-standards.open-topic-source': { kind: 'automated', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names FASB and framework sources by their standard' }] },
  'accounting-standards.manage-checklist': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the accounting-standards page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'accounting-standards.ask-guidance': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the accounting-standards page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'securities-regulation.choose-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the securities-regulation page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'securities-regulation.run-search': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the securities-regulation page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'securities-regulation.open-source': { kind: 'automated', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each scraped SEC index row by its document' }] },
  'securities-regulation.retry-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the securities-regulation page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'sec-enforcement.filter-releases': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the sec-enforcement page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'sec-enforcement.open-source': { kind: 'automated', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each scraped SEC index row by its document' }] },
  'sec-enforcement.retry-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the sec-enforcement page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'ipo-center.switch-section': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the ipo-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'ipo-center.open-analyzer': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the ipo-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'ipo-center.find-and-select-filing': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the ipo-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'ipo-center.run-analysis': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the ipo-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'ipo-center.open-sec-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the ipo-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'ipo-center.save-or-export-pipeline': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the ipo-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'ipo-center.analyze-pipeline-row': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the ipo-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'mna-research.switch-view': { kind: 'automated', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'M&A workflows activate exclusively and preserve sibling surface state' }] },
  'mna-research.load-deals': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the mna-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'mna-research.extract-deal-details': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the mna-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'mna-research.find-clause-filing': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the mna-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'mna-research.extract-clause': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the mna-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'mna-research.open-sec-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the mna-research page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'exempt-offerings.run-search': { kind: 'automated', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exempt-offerings.run-search returns Form D rows with their filing metadata' }] },
  'exempt-offerings.open-result-source': { kind: 'automated', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exempt-offerings.open-result-source links each Form D row to its official filing' }] },
  'exempt-offerings.open-recent-filing': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the exempt-offerings page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'exempt-offerings.retry-failure': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the exempt-offerings page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'adv-registrations.run-search': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the adv-registrations page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'adv-registrations.open-source': { kind: 'automated', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each IAPD record by its firm' }] },
  'adv-registrations.retry-search': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the adv-registrations page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'support-center.filter-guidance': { kind: 'automated', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'support-center.filter-guidance narrows the guide and says so when nothing matches' }] },
  'support-center.open-summary-route': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the support-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'support-center.jump-to-section': { kind: 'automated', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'support-center.jump-to-section moves to the named section and names it in the URL' }] },
  'support-center.open-feature-route': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the support-center page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'privacy.allow-analytics': { kind: 'automated', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.allow-analytics stores consent as granted and reports it truthfully' }] },
  'privacy.decline-analytics': { kind: 'automated', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.decline-analytics stores consent as denied and reports it truthfully' }] },
  'privacy.return-home': { kind: 'automated', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.return-home and terms.return-home reach the public landing without sign-in' }] },
  'terms.review-limitations': { kind: 'automated', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'terms.review-limitations states the professional-advice limitation' }] },
  'terms.return-home': { kind: 'automated', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.return-home and terms.return-home reach the public landing without sign-in' }] },
  'design-gallery.review-component-states': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the design-gallery page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'design-gallery.exercise-static-controls': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the design-gallery page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'company-dossier.navigate-breadcrumbs': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the company-dossier page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'company-dossier.switch-view': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the company-dossier page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'company-dossier.open-filing-source': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the company-dossier page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'company-dossier.open-comment-thread': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the company-dossier page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'company-dossier.retry-dataset': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the company-dossier page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.return-to-search': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.search-or-highlight': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.copy-link-or-citation': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.export-document-data': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.save-watchlist': { kind: 'automated', specs: [{ file: 'tests/e2e/watchlist.spec.ts', title: 'filing-detail.save-watchlist saves the filing issuer without duplicating it' }] },
  'filing-detail.open-sec-source': { kind: 'automated', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'filing-detail.open-sec-source links to the authoritative SEC document' }] },
  'filing-detail.use-tools-panel': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.navigate-section': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.manage-note': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'filing-detail.open-assistant': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the filing-detail page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.sidebar-navigation': { kind: 'automated', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.sidebar-navigation opens each destination and marks it as the current page' }] },
  'global.sidebar-collapse': { kind: 'automated', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.sidebar-collapse changes density only, and the preference outlives navigation and reload' }] },
  'global.mobile-navigation': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.breadcrumb-navigation': { kind: 'automated', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.breadcrumb-navigation exposes the current location and reaches its ancestors' }] },
  'global.quick-find': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.theme-preference': { kind: 'automated', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.theme-preference applies immediately, names the next appearance, and survives reload' }] },
  // HARNESS BUILT, AWAITING CREDENTIALS. Was blocked two ways: the main e2e
  // webServer sets URC_E2E_BYPASS_AUTH (so proxy.ts protects nothing), and CI
  // holds no Clerk publishable key (so the Sign In / Get Started / account
  // controls never render). playwright.auth.config.ts + tests/e2e-auth/ now
  // serve the app with the bypass explicitly OFF against a real Clerk
  // development instance, and the non-blocking `auth-browser` CI job runs it.
  // Flip this to 'automated' pointing at tests/e2e-auth/authentication.spec.ts
  // ONLY once that job has actually gone green — the HONESTY RULE above
  // forbids claiming automation nobody has observed pass. Setup steps are in
  // docs/pending-keys-checklist.md section 6.
  'global.authentication': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'Harness built and merged (playwright.auth.config.ts + tests/e2e-auth/, non-blocking auth-browser CI job) but not yet exercised: it needs Clerk development-instance secrets (CLERK_PUBLISHABLE_KEY_TEST / CLERK_SECRET_KEY_TEST) on the repository. Verified empirically that with the bypass off and no secret key every route 500s, so the credentials are a hard prerequisite rather than a convenience. Steps in docs/pending-keys-checklist.md section 6; flip to automated once auth-browser is green.' },
  'global.copilot-panel': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.memo-tray': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.results-table': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.results-toolbar': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.lookup-fields': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
  'global.tabs': { kind: 'automated', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'global.tabs keeps one tab selected, tabbable, and honestly associated' }] },
  'global.external-source-links': { kind: 'automated', specs: [
    { file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names, secures, and preserves state on SEC links' },
    { file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each IAPD record by its firm' },
    { file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names FASB and framework sources by their standard' },
  ] },
  'global.async-and-retry': { kind: 'manual-exception', owner: 'urc-engineering', expires: BURN_DOWN_DATE, reason: 'No executable archetype test yet for the global page; verified in the 2026-07-21 manual interaction sweep, queued for the WP8 archetype burn-down.' },
};
