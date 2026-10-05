/**
 * Where saved research lives, said truthfully for the current deployment.
 *
 * Account storage (migration 026) only holds research once the routes answer:
 * before the signing secret is provisioned they return 503 and every store
 * keeps working in the browser alone. The product copy therefore follows
 * getUserDataStatus(): only the 'server' mode — the account answered and the
 * local copy was hydrated from it — may say research is saved to the account
 * and shared across devices. Every other mode (signed out, connecting,
 * unavailable) keeps the browser-local wording, which is what is true then.
 */

import type { UserDataStatus } from '../../services/userData';

export interface ResearchStorageCopy {
  accountSynced: boolean;
  landingBenchmarkingDescription: string;
  landingPlatformDescription: string;
  landingWorkflowStorage: string;
  supportAlertsAndAnnotationsNote: string;
  supportResearchTabsNote: string;
  supportAnnotationsNote: string;
  supportDashboardSummary: string;
  supportDashboardAlertsStep: string;
  supportDashboardNote: string;
  supportAccountingSummary: string;
  supportStorageFaqAnswer: string;
  supportSidebarNote: string;
}

const BROWSER_LOCAL: ResearchStorageCopy = {
  accountSynced: false,
  landingBenchmarkingDescription:
    'Use dedicated workspaces for peer benchmarking, watchlist filing-volume charts, and browser-local saved searches.',
  landingPlatformDescription:
    'Use the integrated copilot and support center within an individual, browser-local research workflow.',
  landingWorkflowStorage: 'Saved research state remains browser-local.',
  supportAlertsAndAnnotationsNote:
    'Saved alerts and annotations are browser-local. They help with repeat research but are not shared across devices.',
  supportResearchTabsNote:
    'Research sessions are saved in the current browser and can be restored there; they are not shared across devices.',
  supportAnnotationsNote: 'Annotations are stored locally in the current browser.',
  supportDashboardSummary:
    'The Dashboard shows filing activity for your browser-local watchlist, local saved-search alerts, and watchlist-scoped charts.',
  supportDashboardAlertsStep: 'Use local saved-search alerts to open or manually re-check frequent queries.',
  supportDashboardNote:
    'Dashboard data refreshes when you navigate to the page. Watchlist items and alerts are browser-local.',
  supportAccountingSummary:
    'The Accounting Research Hub combines a standards-topic directory, SEC filing research, result-set memos, and a browser-local checklist. Accounting Analytics compares financial ratios for selected companies.',
  supportStorageFaqAnswer:
    'Both are stored locally in the browser. They are useful for your own workflow on the same machine, but they are not shared across devices and do not send background notifications.',
  supportSidebarNote: 'Annotations and saved alerts are local to the current browser.',
};

const ACCOUNT_SYNCED: ResearchStorageCopy = {
  accountSynced: true,
  landingBenchmarkingDescription:
    'Use dedicated workspaces for peer benchmarking, watchlist filing-volume charts, and saved searches kept with your account.',
  landingPlatformDescription:
    'Use the integrated copilot and support center within an individual research workflow whose saved work is kept with your account.',
  landingWorkflowStorage: 'Saved research is saved to your account and shared across the devices you sign in from.',
  supportAlertsAndAnnotationsNote:
    'Saved alerts and annotations are saved to your account and shared across the devices you sign in from. They are filed under the active project; open Projects to see one project’s work together.',
  supportResearchTabsNote:
    'Research tabs are saved to your account and can be restored on any device you sign in from, up to eight open tabs.',
  supportAnnotationsNote: 'Annotations are saved to your account and appear on every device you sign in from.',
  supportDashboardSummary:
    'The Dashboard shows filing activity for your watchlist, your saved-search alerts, and watchlist-scoped charts. The watchlist and alerts are saved to your account.',
  supportDashboardAlertsStep: 'Use saved-search alerts to open or manually re-check frequent queries.',
  supportDashboardNote:
    'Dashboard data refreshes when you navigate to the page. Watchlist items and alerts are saved to your account and shared across devices.',
  supportAccountingSummary:
    'The Accounting Research Hub combines a standards-topic directory, SEC filing research, result-set memos, and a review checklist saved to your account. Accounting Analytics compares financial ratios for selected companies.',
  supportStorageFaqAnswer:
    'Both are saved to your account and shared across the devices you sign in from. Neither sends background notifications.',
  supportSidebarNote: 'Annotations, saved alerts and research tabs are saved to your account.',
};

/** Copy for one storage state. */
export function researchStorageCopy(accountSynced: boolean): ResearchStorageCopy {
  return accountSynced ? ACCOUNT_SYNCED : BROWSER_LOCAL;
}

/** Account wording only once the account actually answered (mode 'server'). */
export function isResearchAccountSynced(status: Pick<UserDataStatus, 'mode'>): boolean {
  return status.mode === 'server';
}
