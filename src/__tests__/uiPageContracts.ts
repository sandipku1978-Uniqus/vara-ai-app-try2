export type UiPageKind = 'product' | 'landing' | 'internal' | 'dynamic';
export type UiPageAccess = 'public' | 'authenticated' | 'internal';

export interface UiActionContract {
  /** Stable identifier used by manual, browser, and future E2E test implementations. */
  id: string;
  /** The visitor-visible control or interaction to exercise. */
  interaction: string;
  /** The observable result that proves the interaction did its job. */
  expectedOutcome: string;
}

export interface UiContentContract {
  /** Stable identifier for a required page/content assertion, never a control. */
  id: string;
  /** The content a visitor must be able to find and read. */
  assertion: string;
  /** The observable wording or structure that proves the content contract. */
  expectedContent: string;
}

export interface UiPageContract {
  id: string;
  kind: UiPageKind;
  access: UiPageAccess;
  routePattern: string;
  representativePath: string;
  sourceFiles: readonly string[];
  intendedJob: string;
  actions: readonly UiActionContract[];
  contentChecks?: readonly UiContentContract[];
}

/**
 * Product-level QA contract for every rendered UI route.
 *
 * This deliberately describes observable outcomes rather than implementation
 * details. Browser tests can consume the same IDs while the product remains
 * free to change markup, component boundaries, and styling.
 */
export const UI_PAGE_CONTRACTS = [
  {
    id: 'landing',
    kind: 'landing',
    access: 'public',
    routePattern: '/',
    representativePath: '/',
    sourceFiles: ['src/app/page.tsx', 'src/views/LandingPage.tsx'],
    intendedJob: 'Explain the evidence-ledger product to a first-time visitor and give them a clear route into research or monitoring.',
    actions: [
      { id: 'landing.submit-search', interaction: 'Enter a research question in the hero search and submit it.', expectedOutcome: 'The visitor is taken to the Research Workbench with the entered question preserved for research.' },
      { id: 'landing.open-dashboard', interaction: 'Activate the dashboard call to action.', expectedOutcome: 'The application navigates to the monitoring dashboard, or requests sign-in before that protected destination.' },
      { id: 'landing.explore-capabilities', interaction: 'Activate the capabilities link.', expectedOutcome: 'The page scrolls to the capability overview so the visitor can understand the available research lanes.' },
      { id: 'landing.open-capability', interaction: 'Activate a capability group card.', expectedOutcome: 'The application opens the product route named by that capability rather than a placeholder destination.' },
      { id: 'landing.open-legal-help', interaction: 'Activate each Support, Privacy, and Terms footer link.', expectedOutcome: 'Each footer link opens its matching public information page without requiring an authenticated session.' },
    ],
  },
  {
    id: 'dashboard',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/dashboard',
    representativePath: '/dashboard',
    sourceFiles: ['src/app/dashboard/page.tsx', 'src/views/Dashboard.tsx'],
    intendedJob: 'Provide a compact monitoring overview of watched companies, recent filings, saved research alerts, and available next actions.',
    actions: [
      { id: 'dashboard.add-watch-company', interaction: 'Choose a company from the watchlist company search.', expectedOutcome: 'The selected company is added once to the browser-local watchlist and its filing activity is loaded.' },
      { id: 'dashboard.open-company-research', interaction: 'Activate a watched company row.', expectedOutcome: 'The Research Workbench opens with that company ticker supplied as the research query.' },
      { id: 'dashboard.remove-watch-company', interaction: 'Activate the remove control on a watched company.', expectedOutcome: 'Only the selected company is removed and the remaining watchlist is retained.' },
      { id: 'dashboard.open-recent-filing', interaction: 'Activate a recent filing row.', expectedOutcome: 'The exact selected filing opens, preserving its issuer, form, filing date, accession number, and source document rather than falling back to a generic issuer search.' },
      { id: 'dashboard.check-saved-alert', interaction: 'Activate Check now for a saved alert.', expectedOutcome: 'The alert reruns with its saved criteria and exposes a progress or completion state.' },
      { id: 'dashboard.open-or-remove-alert', interaction: 'Activate Open or Remove on a saved alert.', expectedOutcome: 'Open restores the alert criteria in research, while Remove deletes only that saved alert.' },
    ],
  },
  {
    id: 'earnings',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/earnings',
    representativePath: '/earnings',
    sourceFiles: ['src/app/earnings/page.tsx', 'src/views/EarningsTranscripts.tsx'],
    intendedJob: 'Find official earnings-release exhibits and let a researcher move from filtered results to the source filing.',
    actions: [
      { id: 'earnings.run-search', interaction: 'Set earnings filters and submit the search.', expectedOutcome: 'Matching official earnings-release exhibit rows replace the initial state and reflect the submitted criteria.' },
      { id: 'earnings.open-result-source', interaction: 'Activate View on a search result.', expectedOutcome: 'The official SEC source opens in a separate tab without replacing the research state.' },
      { id: 'earnings.open-recent-filing', interaction: 'Activate a recent earnings-release card.', expectedOutcome: 'The selected filing opens in the application filing viewer with its filing locator intact.' },
      { id: 'earnings.retry-failure', interaction: 'Activate a retry control after search or recent-source failure.', expectedOutcome: 'The failed request is attempted again and its loading, success, or error state is updated.' },
    ],
  },
  {
    id: 'research-workbench',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/search',
    representativePath: '/search',
    sourceFiles: ['src/app/search/page.tsx', 'src/views/SearchPage.tsx'],
    intendedJob: 'Search SEC filing evidence, refine and sort results, inspect a selected document, and preserve useful research state.',
    actions: [
      { id: 'research-workbench.run-search', interaction: 'Enter a query, choose semantic or Boolean mode, apply filters, and submit.', expectedOutcome: 'A new research session runs with the visible mode and filters and presents matching filing evidence or a truthful empty state.' },
      { id: 'research-workbench.manage-search-sessions', interaction: 'Select and close tabs in the open research search strip.', expectedOutcome: 'Selecting restores that session, while closing removes only that session and chooses a valid remaining tab.' },
      { id: 'research-workbench.toggle-panels', interaction: 'Collapse and expand the filter rail or query panel.', expectedOutcome: 'The chosen panel changes visibility while its current inputs and search results remain intact.' },
      { id: 'research-workbench.choose-company-suggestion', interaction: 'Choose a company suggestion shown beneath the query.', expectedOutcome: 'The suggestion resolves into the query context without submitting an unintended company.' },
      { id: 'research-workbench.save-alert', interaction: 'Activate Save Alert with valid query or filter criteria.', expectedOutcome: 'The complete search criteria are stored as a browser-local alert that can be reopened from the dashboard.' },
      { id: 'research-workbench.sort-and-page', interaction: 'Change result sort and use previous or next pagination.', expectedOutcome: 'The result order or visible page changes while selection remains within the valid result set.' },
      { id: 'research-workbench.select-result', interaction: 'Activate a result row.', expectedOutcome: 'The evidence detail pane updates to the selected filing and displays its available excerpt and metadata.' },
      { id: 'research-workbench.open-filing', interaction: 'Activate Open filing for the selected result.', expectedOutcome: 'The selected SEC document opens in the internal filing viewer using its CIK, accession number, and document path.' },
      { id: 'research-workbench.open-issuer-or-source', interaction: 'Activate Issuer dossier or the external source link.', expectedOutcome: 'Issuer dossier opens the matching company page; source opens the matching official SEC document.' },
      { id: 'research-workbench.open-assistant-or-help', interaction: 'Activate Ask AI or the full-help control.', expectedOutcome: 'Ask AI opens the research assistant and help navigates to guidance without discarding the current URL-backed search.' },
    ],
  },
  {
    id: 'comment-letters',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/comment-letters',
    representativePath: '/comment-letters',
    sourceFiles: ['src/app/comment-letters/page.tsx', 'src/views/CommentLetters.tsx'],
    intendedJob: 'Search SEC staff comment-letter text, inspect complete review episodes, and trace every result to official correspondence.',
    actions: [
      { id: 'comment-letters.run-search', interaction: 'Enter letter text, optionally choose a company and form scope, then search.', expectedOutcome: 'Matching comment-letter passages appear with company, filing, episode, and source context tied to the submitted criteria.' },
      { id: 'comment-letters.apply-example-or-form', interaction: 'Choose a sample query chip or form filter.', expectedOutcome: 'The visible criteria update and an already-active search reruns with the newly selected scope.' },
      { id: 'comment-letters.expand-thread', interaction: 'Activate a result or episode thread expander.', expectedOutcome: 'The complete available staff-and-company conversation expands in place and can be collapsed again.' },
      { id: 'comment-letters.generate-summary', interaction: 'Activate Generate AI summary for an episode.', expectedOutcome: 'A summary grounded in the loaded conversation appears, or a specific retryable error is shown.' },
      { id: 'comment-letters.open-issuer-or-edgar', interaction: 'Activate the issuer dossier or EDGAR source link.', expectedOutcome: 'The issuer link opens the matching dossier and the EDGAR link opens the matching official letter index.' },
      { id: 'comment-letters.retry-source', interaction: 'Activate a retry control for corpus, episode, search, or summary failure.', expectedOutcome: 'Only the failed operation reruns and reports its next observable state without clearing unrelated criteria.' },
    ],
  },
  {
    id: 'exhibits',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/exhibits',
    representativePath: '/exhibits',
    sourceFiles: ['src/app/exhibits/page.tsx', 'src/views/ExhibitSearch.tsx'],
    intendedJob: 'Search material contracts and other SEC filing exhibits by type and research terms, with direct access to filing evidence.',
    actions: [
      { id: 'exhibits.choose-types', interaction: 'Toggle one or more exhibit-type chips.', expectedOutcome: 'The selected state accurately reflects the exhibit types that the next search will include.' },
      { id: 'exhibits.run-search', interaction: 'Submit exhibit search criteria.', expectedOutcome: 'The results table displays matching official exhibit filings and preserves the submitted type scope.' },
      { id: 'exhibits.open-result-source', interaction: 'Activate View on an exhibit result.', expectedOutcome: 'The result’s official SEC document opens in a separate tab.' },
      { id: 'exhibits.open-recent-filing', interaction: 'Activate a recent exhibit card.', expectedOutcome: 'The corresponding filing opens in the application filing viewer.' },
      { id: 'exhibits.retry-failure', interaction: 'Retry a failed exhibit search or recent-source request.', expectedOutcome: 'The relevant official-source request reruns and updates only that region’s status.' },
    ],
  },
  {
    id: 'no-action-letters',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/no-action-letters',
    representativePath: '/no-action-letters',
    sourceFiles: ['src/app/no-action-letters/page.tsx', 'src/views/NoActionLetters.tsx'],
    intendedJob: 'Locate official SEC no-action responses by topic or requester and provide an unambiguous path to the source material.',
    actions: [
      { id: 'no-action-letters.run-search', interaction: 'Enter a topic or requester and submit the official-source search.', expectedOutcome: 'The table updates to matching SEC no-action responses or explains truthfully that none were returned.' },
      { id: 'no-action-letters.open-source', interaction: 'Activate View for a response.', expectedOutcome: 'The exact official SEC response opens in a separate tab.' },
      { id: 'no-action-letters.retry-source', interaction: 'Activate Retry official source after a load failure.', expectedOutcome: 'The query is sent again and the prior failure is replaced by loading, results, or a current error.' },
    ],
  },
  {
    id: 'benchmarking',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/compare',
    representativePath: '/compare',
    sourceFiles: ['src/app/compare/page.tsx', 'src/views/Benchmarking.tsx'],
    intendedJob: 'Compare issuer financials, filing language, and audit attributes across a selected peer cohort and export defensible results.',
    actions: [
      { id: 'benchmarking.add-or-remove-company', interaction: 'Add a company to the comparison or remove an existing column.', expectedOutcome: 'The peer set changes by exactly that issuer and all comparison views use the same resulting cohort.' },
      { id: 'benchmarking.switch-view', interaction: 'Switch among Financials, Text diff, and Audit matrix.', expectedOutcome: 'The selected comparison surface becomes active without losing companies, years, or fetched evidence.' },
      { id: 'benchmarking.choose-years-or-section', interaction: 'Select company years or a filing section.', expectedOutcome: 'The comparison recalculates against the visible years or section and clearly identifies missing evidence.' },
      { id: 'benchmarking.build-peer-group', interaction: 'Activate the quick peer-group control.', expectedOutcome: 'Relevant peers are resolved from available company metadata and added without duplicating existing issuers.' },
      { id: 'benchmarking.generate-summary-or-memo', interaction: 'Generate an AI comparison or cohort report.', expectedOutcome: 'The result is grounded in the loaded cohort evidence and exposes a retry path when generation fails.' },
      { id: 'benchmarking.export-results', interaction: 'Activate CSV or spreadsheet export.', expectedOutcome: 'A file downloads containing the currently visible cohort, periods, labels, and comparison values.' },
    ],
  },
  {
    id: 'accounting-analytics',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/accounting-analytics',
    representativePath: '/accounting-analytics',
    sourceFiles: ['src/app/accounting-analytics/page.tsx', 'src/views/AccountingAnalytics.tsx'],
    intendedJob: 'Compare standardized accounting ratios for selected public companies using their available SEC XBRL facts.',
    actions: [
      { id: 'accounting-analytics.add-company', interaction: 'Choose a company from the company search.', expectedOutcome: 'The issuer is added once and its available XBRL-derived accounting metrics are loaded into the comparison.' },
      { id: 'accounting-analytics.remove-company', interaction: 'Activate Remove for a compared company.', expectedOutcome: 'Only that company and its ratio column are removed from the analytics view.' },
      { id: 'accounting-analytics.retry-facts', interaction: 'Activate Retry after company-facts loading fails.', expectedOutcome: 'The selected cohort’s XBRL facts are requested again and the analytics state is refreshed.' },
    ],
  },
  {
    id: 'esg-research',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/esg',
    representativePath: '/esg',
    sourceFiles: ['src/app/esg/page.tsx', 'src/views/ESGResearch.tsx'],
    intendedJob: 'Research ESG disclosure frameworks, compare issuer disclosure coverage, and inspect sustainability-related filing signals.',
    actions: [
      { id: 'esg-research.switch-section', interaction: 'Switch among Frameworks, Heatmap, and filing-signal sections.', expectedOutcome: 'The chosen ESG research surface becomes active while previously loaded issuer context remains available.' },
      { id: 'esg-research.open-framework-source', interaction: 'Activate a policy or framework source card.', expectedOutcome: 'The cited official framework resource opens in a separate tab.' },
      { id: 'esg-research.manage-heatmap-companies', interaction: 'Add or remove an issuer in the ESG heatmap.', expectedOutcome: 'The heatmap updates only the requested issuer column and preserves the remaining comparison set.' },
      { id: 'esg-research.inspect-topic', interaction: 'Activate a disclosure topic or framework mapping.', expectedOutcome: 'The relevant topic detail expands and identifies the evidence or mapping behind the displayed status.' },
      { id: 'esg-research.filter-signals', interaction: 'Filter recent filing candidates and load matching disclosure signals.', expectedOutcome: 'The candidate list reflects the company filter and does not present unrelated issuers as matches.' },
      { id: 'esg-research.summarize-or-open-filing', interaction: 'Generate a release summary or activate Open source filing.', expectedOutcome: 'The summary is tied to that release, while Open source filing navigates to the matching internal filing record.' },
    ],
  },
  {
    id: 'board-profiles',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/boards',
    representativePath: '/boards',
    sourceFiles: ['src/app/boards/page.tsx', 'src/views/BoardProfiles.tsx'],
    intendedJob: 'Review and compare available board, diversity, and compensation disclosure for a selected issuer cohort.',
    actions: [
      { id: 'board-profiles.load-target', interaction: 'Enter and resolve a target company ticker.', expectedOutcome: 'The target issuer’s available proxy-derived board information loads with a clear missing-data state when unavailable.' },
      { id: 'board-profiles.manage-comparison', interaction: 'Add, choose, or remove a comparison company.', expectedOutcome: 'The visible target changes or the cohort updates without duplicating companies or discarding unrelated entries.' },
      { id: 'board-profiles.switch-view', interaction: 'Switch among Directors, Diversity, and Compensation.', expectedOutcome: 'The requested disclosure view becomes active for the current target company.' },
      { id: 'board-profiles.retry-company', interaction: 'Activate Retry after target-company data fails.', expectedOutcome: 'The current ticker is fetched again and the failure region moves to a current loading, result, or error state.' },
    ],
  },
  {
    id: 'insider-trading',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/insiders',
    representativePath: '/insiders',
    sourceFiles: ['src/app/insiders/page.tsx', 'src/views/InsiderTrading.tsx'],
    intendedJob: 'Monitor Form 3, 4, and 5 filings for a researcher-selected set of public companies.',
    actions: [
      { id: 'insider-trading.add-company', interaction: 'Choose a company from the company search.', expectedOutcome: 'The issuer is added once and its recent insider filings are loaded into the combined results table.' },
      { id: 'insider-trading.remove-company', interaction: 'Activate Remove for a monitored issuer.', expectedOutcome: 'The issuer and only its associated filing rows are removed from the current monitor.' },
      { id: 'insider-trading.open-source', interaction: 'Activate View on an insider filing row.', expectedOutcome: 'The exact official filing source opens in a separate tab.' },
    ],
  },
  {
    id: 'accounting-standards',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/accounting',
    representativePath: '/accounting',
    sourceFiles: ['src/app/accounting/page.tsx', 'src/views/AccountingHub.tsx'],
    intendedJob: 'Combine accounting disclosure research, standards references, a local checklist, and grounded technical-accounting guidance.',
    actions: [
      { id: 'accounting-standards.switch-section', interaction: 'Switch among Research, Standards, Checklist, and AI guidance.', expectedOutcome: 'The selected accounting workspace becomes active without clearing state held by the other workspaces.' },
      { id: 'accounting-standards.run-disclosure-search', interaction: 'Choose semantic or Boolean mode, enter a disclosure query, and submit.', expectedOutcome: 'Matching filing disclosures are returned under the selected search mode with source-identifying context.' },
      { id: 'accounting-standards.save-alert-or-memo', interaction: 'Save the current research alert or generate a memo from loaded results.', expectedOutcome: 'The alert preserves the research criteria, while the memo is generated only from the loaded evidence.' },
      { id: 'accounting-standards.open-topic-source', interaction: 'Filter standards topics and activate a topic or FASB source link.', expectedOutcome: 'The chosen official standards reference opens and is not represented as locally reproduced authoritative text.' },
      { id: 'accounting-standards.manage-checklist', interaction: 'Add, edit, complete, or delete a checklist item.', expectedOutcome: 'Only the requested browser-local checklist item changes and its saved state survives a view switch.' },
      { id: 'accounting-standards.ask-guidance', interaction: 'Enter a technical accounting question and submit it.', expectedOutcome: 'Grounded guidance is displayed with appropriate source context, or a specific retryable failure appears.' },
    ],
  },
  {
    id: 'securities-regulation',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/regulation',
    representativePath: '/regulation',
    sourceFiles: ['src/app/regulation/page.tsx', 'src/views/SecRegulation.tsx'],
    intendedJob: 'Search official SEC rules, releases, and staff guidance while keeping the source category explicit.',
    actions: [
      { id: 'securities-regulation.choose-source', interaction: 'Switch between Rules and releases and Staff guidance.', expectedOutcome: 'The source category and its results change together, and stale text from the previous category is cleared.' },
      { id: 'securities-regulation.run-search', interaction: 'Enter a regulation topic and submit.', expectedOutcome: 'Official SEC resources matching the selected category and query appear in the results table.' },
      { id: 'securities-regulation.open-source', interaction: 'Activate View on a regulation result.', expectedOutcome: 'The exact official SEC rule, release, or guidance source opens in a separate tab.' },
      { id: 'securities-regulation.retry-source', interaction: 'Activate Retry official source after failure.', expectedOutcome: 'The current category and query are fetched again without silently changing scope.' },
    ],
  },
  {
    id: 'sec-enforcement',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/enforcement',
    representativePath: '/enforcement',
    sourceFiles: ['src/app/enforcement/page.tsx', 'src/views/SECEnforcement.tsx'],
    intendedJob: 'Browse current SEC litigation releases and quickly narrow them by party name or release number.',
    actions: [
      { id: 'sec-enforcement.filter-releases', interaction: 'Enter a party name or litigation-release number in the filter.', expectedOutcome: 'The already-loaded official release rows narrow immediately to records matching the entered text.' },
      { id: 'sec-enforcement.open-source', interaction: 'Activate View on a litigation release.', expectedOutcome: 'The exact official SEC litigation release opens in a separate tab.' },
      { id: 'sec-enforcement.retry-source', interaction: 'Activate Retry official source after the feed fails.', expectedOutcome: 'The official litigation-release feed is requested again and the page reports its current state.' },
    ],
  },
  {
    id: 'ipo-center',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/ipo',
    representativePath: '/ipo',
    sourceFiles: ['src/app/ipo/page.tsx', 'src/views/IPOCenter.tsx'],
    intendedJob: 'Monitor registration statements, benchmark IPO evidence, and run section-specific analysis against a chosen filing.',
    actions: [
      { id: 'ipo-center.switch-section', interaction: 'Switch among Pipeline, Benchmarking, and Drafting.', expectedOutcome: 'The selected IPO workflow becomes active without corrupting loaded pipeline or analyzer state.' },
      { id: 'ipo-center.open-analyzer', interaction: 'Activate Analyze registration statement.', expectedOutcome: 'The filing finder opens and provides a clear path back to the IPO Center.' },
      { id: 'ipo-center.find-and-select-filing', interaction: 'Search by company, ticker, or keyword and choose a result.', expectedOutcome: 'The selected S-1 or F-1 filing text loads and its issuer and official source remain visible.' },
      { id: 'ipo-center.run-analysis', interaction: 'Choose an analysis section or run all analyses.', expectedOutcome: 'Each requested analysis is grounded in the selected filing evidence and reports individual progress or failure.' },
      { id: 'ipo-center.open-sec-source', interaction: 'Activate the SEC source control for the selected filing.', expectedOutcome: 'The exact registration statement opens on SEC.gov in a separate tab.' },
      { id: 'ipo-center.save-or-export-pipeline', interaction: 'Save the current pipeline search or export loaded rows.', expectedOutcome: 'Save retains the search in the browser; Export downloads the currently loaded official-source rows.' },
      { id: 'ipo-center.analyze-pipeline-row', interaction: 'Activate Analyze for a pipeline filing.', expectedOutcome: 'The analyzer opens with that filing selected rather than requiring a second search.' },
    ],
  },
  {
    id: 'mna-research',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/mna',
    representativePath: '/mna',
    sourceFiles: ['src/app/mna/page.tsx', 'src/views/MAResearch.tsx'],
    intendedJob: 'Screen transaction filings and extract comparable deal details or clauses from selected official filing evidence.',
    actions: [
      { id: 'mna-research.switch-view', interaction: 'Switch between Deal screener and Clause extraction.', expectedOutcome: 'The requested transaction workflow becomes active without discarding already loaded data in the other view.' },
      { id: 'mna-research.load-deals', interaction: 'Load or retry transaction filings in the screener.', expectedOutcome: 'Matching official transaction filings appear or a current, retryable source error is shown.' },
      { id: 'mna-research.extract-deal-details', interaction: 'Activate Extract details on a deal filing.', expectedOutcome: 'Structured details appear for that filing and remain traceable to its accession and SEC source.' },
      { id: 'mna-research.find-clause-filing', interaction: 'Search for a clause source filing and select a candidate.', expectedOutcome: 'The chosen filing becomes the explicit extraction target with its identity visible.' },
      { id: 'mna-research.extract-clause', interaction: 'Choose a clause type and activate Extract Clause.', expectedOutcome: 'The requested clause text is extracted from the selected filing or a specific retryable error is displayed.' },
      { id: 'mna-research.open-sec-source', interaction: 'Activate a deal filing’s official source link.', expectedOutcome: 'The matching SEC filing record opens in a separate tab.' },
    ],
  },
  {
    id: 'exempt-offerings',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/exempt-offerings',
    representativePath: '/exempt-offerings',
    sourceFiles: ['src/app/exempt-offerings/page.tsx', 'src/views/ExemptOfferings.tsx'],
    intendedJob: 'Search and review Form D exempt-offering filings with direct access to the official filing evidence.',
    actions: [
      { id: 'exempt-offerings.run-search', interaction: 'Submit the exempt-offering search criteria.', expectedOutcome: 'Matching Form D or D/A rows appear with their official filing metadata.' },
      { id: 'exempt-offerings.open-result-source', interaction: 'Activate View on a search result.', expectedOutcome: 'The exact official SEC filing opens in a separate tab.' },
      { id: 'exempt-offerings.open-recent-filing', interaction: 'Activate a recent exempt-offering card.', expectedOutcome: 'The filing opens in the internal filing viewer with the correct filing locator.' },
      { id: 'exempt-offerings.retry-failure', interaction: 'Retry a failed search or recent-filings request.', expectedOutcome: 'Only the failed operation reruns and exposes its next loading, success, or error state.' },
    ],
  },
  {
    id: 'adv-registrations',
    kind: 'product',
    access: 'authenticated',
    routePattern: '/adv-registrations',
    representativePath: '/adv-registrations',
    sourceFiles: ['src/app/adv-registrations/page.tsx', 'src/views/ADVRegistrations.tsx'],
    intendedJob: 'Locate investment-adviser registration records by firm name, CRD number, or SEC number and link to the official record.',
    actions: [
      { id: 'adv-registrations.run-search', interaction: 'Enter a firm identifier and submit the search.', expectedOutcome: 'Matching adviser registration records are displayed with enough identity information to distinguish firms.' },
      { id: 'adv-registrations.open-source', interaction: 'Activate View on an adviser record.', expectedOutcome: 'The corresponding official IAPD record opens in a separate tab.' },
      { id: 'adv-registrations.retry-search', interaction: 'Activate Retry after a search failure.', expectedOutcome: 'The same firm query is submitted again and the current outcome replaces the previous error.' },
    ],
  },
  {
    id: 'support-center',
    kind: 'product',
    access: 'public',
    routePattern: '/support',
    representativePath: '/support',
    sourceFiles: ['src/app/support/page.tsx', 'src/views/SupportCenter.tsx'],
    intendedJob: 'Help visitors understand current product capabilities, find task guidance, and navigate to the relevant working surface.',
    actions: [
      { id: 'support-center.filter-guidance', interaction: 'Enter terms in the support search field.', expectedOutcome: 'Visible guidance narrows to sections matching the query and clearly handles a query with no matches.' },
      { id: 'support-center.open-summary-route', interaction: 'Activate a research or comparison summary card.', expectedOutcome: 'The corresponding working product route opens rather than a documentation placeholder.' },
      { id: 'support-center.jump-to-section', interaction: 'Activate an in-page section link.', expectedOutcome: 'The viewport moves to the named guidance section and the URL fragment identifies it.' },
      { id: 'support-center.open-feature-route', interaction: 'Activate a feature link within guidance.', expectedOutcome: 'The exact product route described by the link opens, requesting sign-in if required.' },
    ],
  },
  {
    id: 'privacy',
    kind: 'product',
    access: 'public',
    routePattern: '/privacy',
    representativePath: '/privacy',
    sourceFiles: ['src/app/privacy/page.tsx', 'src/app/privacy/PrivacyControls.tsx'],
    intendedJob: 'Explain data use in plain language and let a visitor make or change the optional analytics-consent choice.',
    actions: [
      // The original wording ("the status confirms analytics are allowed")
      // assumed every deployment has analytics configured. Most do not —
      // PrivacyControls reports "disabled for this deployment" whenever
      // NEXT_PUBLIC_POSTHOG_ENABLED/KEY are absent, which is the default and
      // what CI runs. Demanding the old wording would have required the page
      // to claim analytics was running when it was not.
      { id: 'privacy.allow-analytics', interaction: 'Activate Allow analytics.', expectedOutcome: 'Consent is stored durably as granted, and the live status region reports the outcome without overstating it — confirming analytics is allowed where the deployment has it configured, and that it is unavailable where it does not.' },
      { id: 'privacy.decline-analytics', interaction: 'Activate Decline analytics, including after previously allowing it.', expectedOutcome: 'Consent is stored durably as denied, overwriting any previous grant, and the live status region confirms optional analytics is disabled.' },
      { id: 'privacy.return-home', interaction: 'Activate Return to Uniqus Research Center.', expectedOutcome: 'The public landing page opens without requiring authentication.' },
    ],
  },
  {
    id: 'terms',
    kind: 'product',
    access: 'public',
    routePattern: '/terms',
    representativePath: '/terms',
    sourceFiles: ['src/app/terms/page.tsx'],
    intendedJob: 'State the baseline terms, research limitations, and source-verification responsibilities before product use.',
    contentChecks: [
      { id: 'terms.review-limitations', assertion: 'Read the professional-advice and source-verification sections.', expectedContent: 'The page clearly states that generated research does not replace professional advice or review of underlying sources.' },
    ],
    actions: [
      { id: 'terms.return-home', interaction: 'Activate Return to Uniqus Research Center.', expectedOutcome: 'The public landing page opens without requiring authentication.' },
    ],
  },
  {
    id: 'design-gallery',
    kind: 'internal',
    access: 'internal',
    routePattern: '/design-gallery',
    representativePath: '/design-gallery',
    sourceFiles: ['src/app/design-gallery/page.tsx'],
    intendedJob: 'Serve as a non-indexed visual acceptance surface for the evidence-ledger tokens and representative component states.',
    actions: [
      { id: 'design-gallery.review-component-states', interaction: 'Inspect search, tokens, evidence rows, detail panels, buttons, and status treatments.', expectedOutcome: 'The gallery presents the intended evidence-ledger component states together without relying on live product data.' },
      { id: 'design-gallery.exercise-static-controls', interaction: 'Attempt to activate the gallery’s token, evidence-link, memo, and citation specimens.', expectedOutcome: 'Production visitors cannot reach the internal gallery; in development, every nonfunctional specimen is explicitly marked as illustrative and is not exposed as an actionable button or link.' },
    ],
  },
  {
    id: 'company-dossier',
    kind: 'dynamic',
    access: 'authenticated',
    routePattern: '/company/[ticker]',
    representativePath: '/company/AAPL',
    sourceFiles: ['src/app/company/[ticker]/page.tsx', 'src/app/company/[ticker]/DossierTabs.tsx'],
    intendedJob: 'Resolve an issuer and consolidate its identity, filings, comment-letter history, auditor context, and financial facts.',
    actions: [
      { id: 'company-dossier.navigate-breadcrumbs', interaction: 'Activate Home or Research in the breadcrumb.', expectedOutcome: 'The selected dashboard or Research Workbench route opens without producing an invalid company URL.' },
      { id: 'company-dossier.switch-view', interaction: 'Switch among dossier tabs.', expectedOutcome: 'The requested issuer dataset becomes visible while the resolved issuer identity remains unchanged.' },
      { id: 'company-dossier.open-filing-source', interaction: 'Activate an official filing source in the filings view.', expectedOutcome: 'The exact SEC filing document for this issuer opens in a separate tab.' },
      { id: 'company-dossier.open-comment-thread', interaction: 'Activate a comment-letter episode.', expectedOutcome: 'Comment Letters opens with this issuer and thread encoded in the destination URL.' },
      { id: 'company-dossier.retry-dataset', interaction: 'Retry comment-letter history or XBRL facts after failure.', expectedOutcome: 'Only the failed issuer dataset is fetched again and the other dossier data remains available.' },
    ],
  },
  {
    id: 'filing-detail',
    kind: 'dynamic',
    access: 'authenticated',
    routePattern: '/filing/[...slug]',
    representativePath: '/filing/0000320193_0000320193-23-000106_aapl-20230930.htm',
    sourceFiles: ['src/app/filing/[...slug]/page.tsx', 'src/views/FilingDetail.tsx'],
    intendedJob: 'Read a specific SEC filing, navigate its sections, capture evidence, and export or trace work back to the official document.',
    actions: [
      { id: 'filing-detail.return-to-search', interaction: 'Activate the return-to-search control from an error or header state.', expectedOutcome: 'The Research Workbench opens at a safe first-party destination rather than an arbitrary return URL.' },
      { id: 'filing-detail.search-or-highlight', interaction: 'Use filing search or highlight controls on loaded filing text.', expectedOutcome: 'Matching text is identified in the document and navigation remains within valid matches.' },
      { id: 'filing-detail.copy-link-or-citation', interaction: 'Activate copy-link or citation controls.', expectedOutcome: 'The clipboard receives a usable filing reference tied to the current document or selected evidence.' },
      { id: 'filing-detail.export-document-data', interaction: 'Activate table CSV extraction or clean PDF export.', expectedOutcome: 'The requested artifact is produced from the current filing and reports a clear failure if extraction is unavailable.' },
      { id: 'filing-detail.save-watchlist', interaction: 'Activate Save filing to watchlist.', expectedOutcome: 'The current issuer is added to the browser-local watchlist without duplicating an existing entry.' },
      { id: 'filing-detail.open-sec-source', interaction: 'Activate Open filing on SEC.gov.', expectedOutcome: 'The exact official SEC document opens in a separate tab.' },
      { id: 'filing-detail.use-tools-panel', interaction: 'Open the tools panel and switch among Contents, Metadata, and Tools.', expectedOutcome: 'The selected panel becomes active, focus remains usable, and closing the panel returns to the filing.' },
      { id: 'filing-detail.navigate-section', interaction: 'Activate a detected table-of-contents section.', expectedOutcome: 'The filing scrolls to the matching section or presents a truthful retry state when detection failed.' },
      { id: 'filing-detail.manage-note', interaction: 'Save or remove an annotation for selected filing text.', expectedOutcome: 'The note is stored or removed only for the current filing evidence and the notes list updates immediately.' },
      { id: 'filing-detail.open-assistant', interaction: 'Activate Ask AI for the loaded filing.', expectedOutcome: 'The assistant opens with the active filing available as context without changing the source document.' },
    ],
  },
] as const satisfies readonly UiPageContract[];

/** Shared controls are specified once and exercised on representative pages. */
export const UI_GLOBAL_ACTION_CONTRACTS = [
  { id: 'global.sidebar-navigation', interaction: 'Activate every destination in the primary sidebar.', expectedOutcome: 'Each link opens the route named by its accessible label, marks that route current, and preserves normal link behaviors such as opening in a new tab.' },
  { id: 'global.sidebar-collapse', interaction: 'Collapse and expand the desktop sidebar.', expectedOutcome: 'The sidebar changes density without hiding navigation from assistive technology, and the preference survives a page navigation and reload.' },
  { id: 'global.mobile-navigation', interaction: 'Open and close mobile navigation using its trigger, overlay, close control, and Escape.', expectedOutcome: 'Focus enters the drawer, background content is unavailable while open, and focus returns to the trigger after every close path.' },
  { id: 'global.breadcrumb-navigation', interaction: 'Activate Home and any linked breadcrumb ancestor.', expectedOutcome: 'Each breadcrumb reaches the visitor-appropriate parent destination and the current location is exposed as the current page.' },
  { id: 'global.quick-find', interaction: 'Open Quick find by button and keyboard shortcut, filter options, navigate with the keyboard, and choose a result.', expectedOutcome: 'The palette opens as a labelled dialog, the chosen route or company opens exactly once, Escape closes it, and focus returns to the opener.' },
  { id: 'global.theme-preference', interaction: 'Activate the light or dark appearance control and reload the application.', expectedOutcome: 'The document theme changes immediately, the control describes the next action accurately, and the selected theme survives reload.' },
  { id: 'global.authentication', interaction: 'Activate Sign in, Get started, account, and sign-out controls from public and protected destinations.', expectedOutcome: 'Authentication uses the production identity surface, preserves the exact intended return URL, and removes protected access after sign-out.' },
  { id: 'global.copilot-panel', interaction: 'Open and close the Copilot, submit a prompt, switch response views, revisit a run, and activate each evidence citation type.', expectedOutcome: 'Focus is managed, each request exposes progress and a grounded result or retryable error, and every actionable citation reaches its represented evidence.' },
  { id: 'global.memo-tray', interaction: 'Open the memo tray, add or remove evidence, edit a note, copy or export it, generate a draft, and clear the tray.', expectedOutcome: 'The browser-local evidence ledger updates only the intended item, persists as disclosed, produces the labelled artifact, and confirms destructive clearing.' },
  { id: 'global.results-table', interaction: 'Sort each sortable column and move through result pages.', expectedOutcome: 'Rows are ordered by the selected column and direction, pagination never skips or duplicates rows, and the table remains clearly named.' },
  { id: 'global.results-toolbar', interaction: 'Export CSV, copy results, and send results to Copilot.', expectedOutcome: 'Export and copy contain the visible result scope, while Copilot states and receives the exact bounded evidence scope rather than implying more rows were analyzed.' },
  { id: 'global.lookup-fields', interaction: 'Use company, entity, SIC, and auditor suggestions with pointer and keyboard, then clear the selection.', expectedOutcome: 'The intended option is selected with complete combobox semantics, clearing notifies the parent state, and no hidden filter remains active.' },
  { id: 'global.tabs', interaction: 'Change and close tabs using pointer, Arrow keys, Home, End, Enter, and Space where applicable.', expectedOutcome: 'Exactly one tab is selected and tabbable, every controlled panel relationship is valid, and focus survives selection or removal.' },
  { id: 'global.external-source-links', interaction: 'Activate representative SEC, IAPD, FASB, and framework source links.', expectedOutcome: 'Each link names enough row context, opens the exact official source safely, and leaves the current research state available.' },
  { id: 'global.async-and-retry', interaction: 'Exercise loading, success, legitimate-empty, partial-data, failure, and retry states for every remote action.', expectedOutcome: 'The control keeps a stable name, only the latest request can update the view, failures are not presented as factual absence, and Retry repeats the same criteria.' },
] as const satisfies readonly UiActionContract[];
