/**
 * Action-level coverage traceability (remediation handoff WP8).
 *
 * Every action in UI_PAGE_CONTRACTS must map to EXECUTABLE evidence — an exact
 * Playwright {file,title} identity whose runtime result CI verifies — or carry
 * an owned manual exception with an expiry date. Exceptions are a debt register,
 * not a pass: when BURN_DOWN_DATE arrives, every remaining exception turns
 * the suite red by design. Burning them down means writing the behavior
 * archetype tests (navigation, form/Enter parity, combobox, chips, sort,
 * retry identity, export, dialogs, …), not editing the date.
 *
 * HONESTY RULE: automated-full means the complete interaction and observable
 * outcome are asserted. Automated-partial names both what is proved and the
 * remaining outcome gap. Page smoke and the control census never count as
 * action coverage by themselves.
 */

export const BURN_DOWN_DATE = '2026-09-30';

export type UiActionEvidence =
  | { kind: 'automated-full'; specs: readonly { file: string; title: string }[] }
  | {
      kind: 'automated-partial';
      specs: readonly { file: string; title: string }[];
      covered: string;
      gap: string;
      owner: string;
      expires: string;
    }
  | { kind: 'manual-exception'; owner: string; reason: string; expires: string };

export interface UiActionTestReference {
  file: string;
  title: string;
}

export interface UiContentEvidence {
  kind: 'content-contract';
  specs: readonly UiActionTestReference[];
}

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
  'landing.submit-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'hero search carries the visitor query into research' }] },
  'landing.open-dashboard': { kind: 'automated-full', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'landing action "Go to Dashboard" has a meaningful destination' }] },
  'landing.explore-capabilities': { kind: 'automated-full', specs: [{ file: 'tests/e2e/neutral-visitor.spec.ts', title: 'coverage control scrolls to the promised section' }] },
  'landing.open-capability': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'landing action "Open Research" has a meaningful destination' },
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'landing action "See Benchmarking" has a meaningful destination' },
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'landing action "Explore Governance" has a meaningful destination' },
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'landing action "Review Specialty Tools" has a meaningful destination' },
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'landing action "Open Support Center" has a meaningful destination' },
  ] },
  'landing.open-legal-help': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'footer link "Support" opens the correct public page' },
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'footer link "Privacy" opens the correct public page' },
    { file: 'tests/e2e/neutral-visitor.spec.ts', title: 'footer link "Terms" opens the correct public page' },
  ] },
  'dashboard.add-watch-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/watchlist.spec.ts', title: 'dashboard.add-watch-company adds a chosen issuer exactly once' }] },
  'dashboard.open-company-research': { kind: 'automated-full', specs: [{ file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'dashboard.open-company-research supplies the activated ticker to the Research Workbench' }] },
  'dashboard.remove-watch-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/watchlist.spec.ts', title: 'dashboard.remove-watch-company removes only the chosen issuer' }] },
  'dashboard.open-recent-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'dashboard.open-recent-filing opens the exact selected filing identity' }] },
  'dashboard.check-saved-alert': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/critical-actions.spec.ts', title: 'research-workbench.save-alert and dashboard.check-saved-alert round-trip' },
    { file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'dashboard.check-saved-alert rejects an unmeasured run without replacing prior alert evidence' },
  ] },
  'dashboard.open-or-remove-alert': { kind: 'automated-full', specs: [{ file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'dashboard.open-or-remove-alert restores exact criteria and removes only the chosen alert' }] },
  'earnings.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'earnings.run-search returns earnings-release exhibit rows' }] },
  'earnings.open-result-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'earnings.open-result-source links each earnings row to its official exhibit' }] },
  'earnings.open-recent-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'earnings.open-recent-filing opens the exact recent release in the filing viewer' }] },
  'earnings.retry-failure': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'earnings.retry-failure repeats the failed recent request and replaces its error' }] },
  'research-workbench.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/boolean-search.spec.ts', title: 'a disjoint OR returns the union, not the intersection' }] },
  'research-workbench.manage-search-sessions': { kind: 'automated-full', specs: [{ file: 'tests/e2e/research-workbench-interactions.spec.ts', title: 'research-workbench.manage-search-sessions restores and closes only the chosen search' }] },
  'research-workbench.toggle-panels': { kind: 'automated-full', specs: [{ file: 'tests/e2e/research-workbench-interactions.spec.ts', title: 'research-workbench.toggle-panels preserves criteria and results through collapse round trips' }] },
  'research-workbench.choose-company-suggestion': { kind: 'automated-full', specs: [{ file: 'tests/e2e/research-workbench-interactions.spec.ts', title: 'research-workbench.choose-company-suggestion chooses the exact issuer without submitting a neighboring company' }] },
  'research-workbench.save-alert': { kind: 'automated-full', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'research-workbench.save-alert and dashboard.check-saved-alert round-trip' }] },
  'research-workbench.sort-and-page': { kind: 'automated-full', specs: [{ file: 'tests/e2e/research-workbench-interactions.spec.ts', title: 'research-workbench.sort-and-page preserves every unique filing across sort and Previous/Next boundaries' }] },
  'research-workbench.select-result': { kind: 'automated-full', specs: [{ file: 'tests/e2e/research-workbench-interactions.spec.ts', title: 'research-workbench.select-result updates the evidence preview to the exact chosen filing' }] },
  'research-workbench.open-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'research-workbench.open-filing reaches the exact selected filing workspace' }] },
  'research-workbench.open-issuer-or-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/research-workbench-interactions.spec.ts', title: 'research-workbench.open-issuer-or-source targets the chosen issuer and exact SEC document' }] },
  'research-workbench.open-assistant-or-help': { kind: 'automated-full', specs: [{ file: 'tests/e2e/research-workbench-interactions.spec.ts', title: 'research-workbench.open-assistant-or-help preserves a URL-backed search through both guidance paths' }] },
  'comment-letters.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'comment-letters.run-search renders matches from the letter corpus' }] },
  'comment-letters.apply-example-or-form': { kind: 'automated-full', specs: [{ file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'comment-letters.apply-example-or-form applies the example and reruns an active search in the selected form scope' }] },
  'comment-letters.expand-thread': { kind: 'automated-full', specs: [{ file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'comment-letters.expand-thread expands only the activated sibling result and collapses it again' }] },
  'comment-letters.generate-summary': { kind: 'automated-full', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'comment-letters.generate-summary POSTs only on explicit click and renders labeled output' }] },
  'comment-letters.open-issuer-or-edgar': { kind: 'automated-full', specs: [{ file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'comment-letters.open-issuer-or-edgar opens the matching official index and issuer route' }] },
  'comment-letters.retry-source': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'comment-letters.retry-source retries the corpus without clearing draft criteria' },
    { file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'comment-letters.retry-source reruns the same failed search scope and replaces its error' },
    { file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'comment-letters.retry-source retries only a failed conversation and retains the active search' },
    { file: 'tests/e2e/dashboard-comment-letter-interactions.spec.ts', title: 'comment-letters.retry-source retries summary generation without clearing source evidence' },
  ] },
  'exhibits.choose-types': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exhibits.choose-types re-filters collected rows without another SEC search' }] },
  'exhibits.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exhibits.run-search returns exhibit rows and preserves the submitted type scope' }] },
  'exhibits.open-result-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exhibits.open-result-source links each exhibit row to its official document' }] },
  'exhibits.open-recent-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exhibits.open-recent-filing opens the exact recent exhibit in the filing viewer' }] },
  'exhibits.retry-failure': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exhibits.retry-failure repeats the failed recent request and replaces its error' }] },
  'no-action-letters.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/official-source-interactions.spec.ts', title: 'no-action-letters.run-search repeats the official query and displays only matching records' }] },
  'no-action-letters.open-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each scraped SEC index row by its document' }] },
  'no-action-letters.retry-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/official-source-interactions.spec.ts', title: 'no-action-letters.retry-source repeats the same criteria and replaces the failure' }] },
  'benchmarking.add-or-remove-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.add-or-remove-company keeps every comparison surface on the exact resulting cohort' }] },
  'benchmarking.switch-view': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.switch-view preserves companies, years, and fetched evidence across all surfaces' }] },
  'benchmarking.choose-years-or-section': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.choose-years-or-section recalculates the visible period and disclosure target' }] },
  'benchmarking.build-peer-group': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.build-peer-group adds only matching non-duplicate SIC peers' }] },
  'benchmarking.generate-summary-or-memo': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.generate-summary-or-memo retries a failed grounded comparison and builds the cohort memo' }] },
  'benchmarking.verify-sections': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.verify-sections marks sections only from filing text, surfaces a rate limit with retry, and exports states with accessions' }] },
  'benchmarking.export-results': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.export-results downloads the visible cohort periods labels and values' },
    { file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'benchmarking.verify-sections marks sections only from filing text, surfaces a rate limit with retry, and exports states with accessions' },
  ] },
  'accounting-analytics.add-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'accounting-analytics.add-company and accounting-analytics.remove-company keep XBRL columns exact' }] },
  'accounting-analytics.remove-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'accounting-analytics.add-company and accounting-analytics.remove-company keep XBRL columns exact' }] },
  'accounting-analytics.retry-facts': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'accounting-analytics.retry-facts repeats the selected issuer request and replaces failure' }] },
  'esg-research.switch-section': { kind: 'automated-full', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'ESG research sections activate exclusively and preserve sibling surface state' }] },
  'esg-research.open-framework-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'esg-research.open-framework-source opens the exact official framework in a separate tab' }] },
  'esg-research.manage-heatmap-companies': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'esg-research.manage-heatmap-companies changes only the requested issuer column' }] },
  'esg-research.inspect-topic': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'esg-research.inspect-topic expands issuer-specific ratings and their evidence source' }] },
  'esg-research.filter-signals': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'esg-research.filter-signals retries SEC and excludes unrelated issuers' }] },
  'esg-research.summarize-or-open-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'esg-research.summarize-or-open-filing retries a release summary and opens its exact filing' }] },
  'board-profiles.load-target': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'board-profiles.load-target resolves the requested issuer and states missing data honestly' }] },
  'board-profiles.manage-comparison': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'board-profiles.manage-comparison adds chooses and removes without disturbing neighbours' }] },
  'board-profiles.switch-view': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'board-profiles.switch-view activates issuer-specific directors diversity and compensation' }] },
  'board-profiles.retry-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'board-profiles.retry-company re-fetches the current ticker and replaces the failure' }] },
  'insider-trading.add-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'insider-trading.add-company and insider-trading.remove-company keep only associated filing rows' }] },
  'insider-trading.remove-company': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'insider-trading.add-company and insider-trading.remove-company keep only associated filing rows' }] },
  'insider-trading.open-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/governance-analytics-interactions.spec.ts', title: 'insider-trading.open-source opens the exact official filing without losing the monitor' }] },
  'accounting-standards.switch-section': { kind: 'automated-full', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'accounting workspaces activate exclusively and preserve sibling surface state' }] },
  'accounting-standards.run-disclosure-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'accounting-standards.run-disclosure-search returns source-identifiable Boolean filing evidence' }] },
  'accounting-standards.save-alert-or-memo': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'accounting-standards.save-alert-or-memo preserves criteria and grounds the memo in loaded rows' }] },
  'accounting-standards.open-topic-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names FASB and framework sources by their standard' }] },
  'accounting-standards.manage-checklist': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'accounting-standards.manage-checklist changes only the chosen local item and survives a view switch' }] },
  'accounting-standards.ask-guidance': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'accounting-standards.ask-guidance submits the exact question and labels source-oriented guidance' }] },
  'securities-regulation.choose-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'securities-regulation.choose-source and securities-regulation.run-search keep category, query, and results aligned' }] },
  'securities-regulation.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'securities-regulation.choose-source and securities-regulation.run-search keep category, query, and results aligned' }] },
  'securities-regulation.open-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each scraped SEC index row by its document' }] },
  'securities-regulation.retry-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'securities-regulation.retry-source repeats the unchanged category and query and replaces the error' }] },
  'sec-enforcement.filter-releases': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'sec-enforcement.filter-releases narrows loaded releases without refetching the official feed' }] },
  'sec-enforcement.open-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each scraped SEC index row by its document' }] },
  'sec-enforcement.retry-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'sec-enforcement.retry-source requests the feed again and replaces its failure state' }] },
  'ipo-center.switch-section': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'ipo-center.switch-section preserves loaded pipeline evidence across every workflow' }] },
  'ipo-center.open-analyzer': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'ipo-center.open-analyzer opens the filing finder and provides a working return path' }] },
  'ipo-center.find-and-select-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'ipo-center.find-and-select-filing and ipo-center.open-sec-source preserve the exact registration statement identity' }] },
  'ipo-center.run-analysis': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'ipo-center.run-analysis grounds the chosen section in the selected filing evidence' }] },
  'ipo-center.open-sec-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'ipo-center.find-and-select-filing and ipo-center.open-sec-source preserve the exact registration statement identity' }] },
  'ipo-center.save-or-export-pipeline': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'ipo-center.save-or-export-pipeline saves criteria and downloads the loaded official rows' }] },
  'ipo-center.analyze-pipeline-row': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'ipo-center.analyze-pipeline-row selects that row without a second filing search' }] },
  'mna-research.switch-view': { kind: 'automated-full', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'M&A workflows activate exclusively and preserve sibling surface state' }] },
  'mna-research.load-deals': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'mna-research.load-deals and mna-research.open-sec-source expose matching official transaction rows' }] },
  'mna-research.extract-deal-details': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'mna-research.extract-deal-details displays structured output traceable to the same row' }] },
  'mna-research.find-clause-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'mna-research.find-clause-filing and mna-research.extract-clause keep the selected source explicit' }] },
  'mna-research.extract-clause': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'mna-research.find-clause-filing and mna-research.extract-clause keep the selected source explicit' }] },
  'mna-research.open-sec-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'mna-research.load-deals and mna-research.open-sec-source expose matching official transaction rows' }] },
  'exempt-offerings.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exempt-offerings.run-search returns Form D rows with their filing metadata' }] },
  'exempt-offerings.open-result-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-search-surfaces.spec.ts', title: 'exempt-offerings.open-result-source links each Form D row to its official filing' }] },
  'exempt-offerings.open-recent-filing': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'exempt-offerings.open-recent-filing opens the exact card in the internal filing viewer' }] },
  'exempt-offerings.retry-failure': { kind: 'automated-full', specs: [{ file: 'tests/e2e/transaction-page-interactions.spec.ts', title: 'exempt-offerings.retry-failure reruns only the failed recent operation and replaces its error' }] },
  'adv-registrations.run-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'adv-registrations.run-search displays distinguishing IAPD registration identity' }] },
  'adv-registrations.open-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each IAPD record by its firm' }] },
  'adv-registrations.retry-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/reference-page-interactions.spec.ts', title: 'adv-registrations.retry-search resubmits the same firm query and replaces the error' }] },
  'support-center.filter-guidance': { kind: 'automated-full', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'support-center.filter-guidance narrows the guide and says so when nothing matches' }] },
  'support-center.open-summary-route': { kind: 'automated-full', specs: [{ file: 'tests/e2e-auth/authentication.spec.ts', title: 'support-center.open-summary-route opens the product route, not a documentation placeholder' }] },
  'support-center.jump-to-section': { kind: 'automated-full', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'support-center.jump-to-section moves to the named section and names it in the URL' }] },
  'support-center.open-feature-route': { kind: 'automated-full', specs: [{ file: 'tests/e2e-auth/authentication.spec.ts', title: 'support-center.open-feature-route opens the exact route named by the link' }] },
  'privacy.allow-analytics': { kind: 'automated-full', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.allow-analytics stores consent as granted and reports it truthfully' }] },
  'privacy.decline-analytics': { kind: 'automated-full', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.decline-analytics stores consent as denied and reports it truthfully' }] },
  'privacy.return-home': { kind: 'automated-full', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.return-home and terms.return-home reach the public landing without sign-in' }] },
  'terms.return-home': { kind: 'automated-full', specs: [{ file: 'tests/e2e/public-pages.spec.ts', title: 'privacy.return-home and terms.return-home reach the public landing without sign-in' }] },
  'design-gallery.review-component-states': { kind: 'automated-full', specs: [{ file: 'tests/e2e/design-gallery-interactions.spec.ts', title: 'design-gallery.review-component-states presents the full static evidence-ledger state matrix' }] },
  // The separate production not-found test is an environment safety boundary,
  // not execution evidence for a UI action. Map only the test that actually
  // exercises the illustrative controls.
  'design-gallery.exercise-static-controls': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/design-gallery-interactions.spec.ts', title: 'design-gallery.exercise-static-controls keeps every illustrative specimen non-interactive' },
  ] },
  'company-dossier.navigate-breadcrumbs': { kind: 'automated-full', specs: [{ file: 'tests/e2e/company-dossier-interactions.spec.ts', title: 'company-dossier.navigate-breadcrumbs routes Home and Research without corrupting issuer identity' }] },
  'company-dossier.switch-view': { kind: 'automated-full', specs: [{ file: 'tests/e2e/company-dossier-interactions.spec.ts', title: 'company-dossier.switch-view activates each issuer dataset and preserves resolved identity' }] },
  'company-dossier.open-filing-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/company-dossier-interactions.spec.ts', title: 'company-dossier.open-filing-source opens the exact SEC document in a separate tab' }] },
  'company-dossier.open-comment-thread': { kind: 'automated-full', specs: [{ file: 'tests/e2e/company-dossier-interactions.spec.ts', title: 'company-dossier.open-comment-thread carries the exact issuer and episode identity' }] },
  'company-dossier.retry-dataset': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/company-dossier-interactions.spec.ts', title: 'company-dossier.retry-dataset retries only comment-letter history and preserves filing identity' },
    { file: 'tests/e2e/company-dossier-interactions.spec.ts', title: 'company-dossier.retry-dataset retries only XBRL facts and preserves loaded comment history' },
  ] },
  'filing-detail.return-to-search': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.return-to-search restores an approved workbench URL and rejects an external return target' }] },
  'filing-detail.search-or-highlight': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.search-or-highlight marks only matching loaded filing text' }] },
  'filing-detail.copy-link-or-citation': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.copy-link-or-citation copies a current-document reference through primary and fallback clipboard paths' }] },
  'filing-detail.export-document-data': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.export-document-data downloads current-filing tables and opens a clean current-filing print view' }] },
  'filing-detail.save-watchlist': { kind: 'automated-full', specs: [{ file: 'tests/e2e/watchlist.spec.ts', title: 'filing-detail.save-watchlist saves the filing issuer without duplicating it' }] },
  'filing-detail.open-sec-source': { kind: 'automated-full', specs: [{ file: 'tests/e2e/critical-actions.spec.ts', title: 'filing-detail.open-sec-source links to the authoritative SEC document' }] },
  'filing-detail.use-tools-panel': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.use-tools-panel keeps one keyboard-operable panel active and returns to the document after close' }] },
  'filing-detail.navigate-section': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.navigate-section scrolls the document to the exact detected section' }] },
  'filing-detail.manage-note': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.manage-note persists and isolates selected evidence, then removes it durably' }] },
  'filing-detail.open-assistant': { kind: 'automated-full', specs: [{ file: 'tests/e2e/filing-detail-interactions.spec.ts', title: 'filing-detail.open-assistant retains the source and uses the active filing as action context' }] },
  'global.sidebar-navigation': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.sidebar-navigation opens each destination and marks it as the current page' }] },
  'global.sidebar-collapse': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.sidebar-collapse changes density only, and the preference outlives navigation and reload' }] },
  'global.mobile-navigation': { kind: 'automated-full', specs: [{ file: 'tests/e2e/mobile-navigation.spec.ts', title: 'global.mobile-navigation traps focus, inerts the page, and restores focus after every close path' }] },
  'global.breadcrumb-navigation': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.breadcrumb-navigation exposes the current location and reaches its ancestors' }] },
  'global.quick-find': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.quick-find filters, keyboard-selects one route, and restores focus on Escape' }] },
  'global.theme-preference': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-chrome.spec.ts', title: 'global.theme-preference applies immediately, names the next appearance, and survives reload' }] },
  // Proven by tests/e2e-auth/, which serves the app with URC_E2E_BYPASS_AUTH
  // OFF against a real Clerk development instance. The main suite cannot
  // observe any of this: it runs behind the bypass, where nothing is
  // protected. Requires the Clerk test secrets (docs/pending-keys-checklist
  // section 6) and runs only from push-only auth-lifecycle.yml after protected
  // main accepts the exact revision; PR authentication checks stay secretless.
  'global.authentication': { kind: 'automated-full', specs: [
    { file: 'tests/e2e-auth/authentication.spec.ts', title: 'public Sign In and Get Started controls open Clerk identity surfaces with their return target' },
    { file: 'tests/e2e-auth/authentication.spec.ts', title: 'signing in reaches the protected route, and signing out removes access again' },
  ] },
  'global.copilot-panel': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-workspace-interactions.spec.ts', title: 'global.copilot-panel manages focus, executes grounded runs, switches views, revisits history, and opens citations' }] },
  'global.memo-tray': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-workspace-interactions.spec.ts', title: 'global.memo-tray persists only intended evidence, exports labelled artifacts, drafts, and confirms clearing' }] },
  'global.results-table': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-workspace-interactions.spec.ts', title: 'global.results-table sorts both directions and paginates without skipping or duplicating rows' }] },
  'global.results-toolbar': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-workspace-interactions.spec.ts', title: 'global.results-toolbar exports and copies the visible scope and tells Copilot its exact evidence bound' }] },
  'global.lookup-fields': { kind: 'automated-full', specs: [{ file: 'tests/e2e/global-workspace-interactions.spec.ts', title: 'global.lookup-fields select official company, entity, SIC, and auditor suggestions and clear parent state' }] },
  'global.tabs': { kind: 'automated-full', specs: [{ file: 'tests/e2e/view-switching.spec.ts', title: 'global.tabs keeps one tab selected, tabbable, and honestly associated' }] },
  'global.external-source-links': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names, secures, and preserves state on SEC links' },
    { file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names each IAPD record by its firm' },
    { file: 'tests/e2e/external-source-links.spec.ts', title: 'global.external-source-links names FASB and framework sources by their standard' },
  ] },
  'global.async-and-retry': { kind: 'automated-full', specs: [
    { file: 'tests/e2e/global-workspace-interactions.spec.ts', title: 'global.async-and-retry distinguishes loading, failure, empty, and partial success while retrying the same criteria' },
    { file: 'tests/e2e/global-workspace-interactions.spec.ts', title: 'global.async-and-retry allows only the newest overlapping request to update the view' },
  ] },
};

/**
 * Canonical, JSON-serializable action-to-test mapping consumed by the
 * Playwright execution-evidence validator. Keeping this projection beside the
 * coverage inventory prevents a second manifest from silently drifting while
 * still giving CI a bounded machine-readable contract of exact file/title
 * identities (never source substrings).
 */
export const UI_ACTION_TEST_MAP: Readonly<Record<string, readonly UiActionTestReference[]>> =
  Object.freeze(Object.fromEntries(
    Object.entries(UI_ACTION_COVERAGE)
      .filter((entry): entry is [string, Exclude<UiActionEvidence, { kind: 'manual-exception' }>] =>
        entry[1].kind !== 'manual-exception')
      .map(([actionId, evidence]) => [actionId, evidence.specs] as const)
  ));

/**
 * Required static/content assertions are tracked separately so a page.goto
 * plus text expectations can never be presented as control execution.
 */
export const UI_CONTENT_COVERAGE: Readonly<Record<string, UiContentEvidence>> = Object.freeze({
  'terms.review-limitations': {
    kind: 'content-contract',
    specs: [{
      file: 'tests/e2e/public-pages.spec.ts',
      title: 'terms.review-limitations states the professional-advice limitation',
    }],
  },
});

export const UI_CONTENT_TEST_MAP: Readonly<Record<string, readonly UiActionTestReference[]>> =
  Object.freeze(Object.fromEntries(
    Object.entries(UI_CONTENT_COVERAGE)
      .map(([contentId, evidence]) => [contentId, evidence.specs] as const)
  ));
