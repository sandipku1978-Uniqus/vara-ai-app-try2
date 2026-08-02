import type { Page, Route } from '@playwright/test';

/**
 * Deterministic stand-ins for the SEC index pages that Securities Regulation,
 * No-Action Letters, and SEC Enforcement scrape through /api/sec-proxy.
 *
 * These surfaces parse real SEC HTML (see parseRulemakingIndex,
 * parseStaffGuidanceIndex, parseNoActionIndex in src/services/officialSources.ts
 * and parseLitigationReleases in src/services/secApi.ts), so a generic stub
 * yields "no parseable entries" and the pages render their honest failure
 * state instead of rows. Each document below carries the exact structure its
 * parser looks for, and every fixture supplies TWO entries — one row can never
 * prove that source links are distinguishable from each other.
 */

export const RULEMAKING = [
  { href: '/rules-regulations/proposed-rule-33-11000', title: 'Climate-Related Disclosures for Investors', file: 'S7-10-26', status: 'Proposed', date: '2026-03-02' },
  { href: '/rules-regulations/final-rule-34-99000', title: 'Shortening the Settlement Cycle', file: 'S7-05-26', status: 'Final', date: '2026-04-14' },
];

export const STAFF_GUIDANCE = [
  { href: '/rules-regulations/staff-guidance/cf-disclosure-topic-11', title: 'Disclosure Guidance Topic No. 11: Non-GAAP Measures' },
  { href: '/rules-regulations/staff-guidance/cf-disclosure-topic-12', title: 'Disclosure Guidance Topic No. 12: Segment Reporting' },
];

// parseNoActionIndex drops any entry whose <li> text lacks a full
// "Month D, YYYY" date, so the date belongs in the item text, not the title.
export const NO_ACTION = [
  { href: '/rules-regulations/no-action/2026/acme-corp-030426-14a8.pdf', title: 'Acme Corp (Rule 14a-8 shareholder proposal)', date: 'March 4, 2026' },
  { href: '/rules-regulations/no-action/2026/borealis-fund-041826-exemptive.pdf', title: 'Borealis Fund exemptive relief request', date: 'April 18, 2026' },
];

export const LITIGATION = [
  { href: '/enforcement-litigation/litigation-releases/lr-26101', title: 'SEC v. Halloway Capital Partners', number: 'LR-26101', date: '2026-05-11' },
  { href: '/enforcement-litigation/litigation-releases/lr-26102', title: 'SEC v. Trenton Ridge Advisors', number: 'LR-26102', date: '2026-05-18' },
];

/** parseRulemakingIndex: tbody tr > a.info-button, .regulation-node-title, time. */
function rulemakingHtml(): string {
  const rows = RULEMAKING.map(r => `
    <tr>
      <td><time>${r.date}</time></td>
      <td>${r.file}</td>
      <td>
        <span class="regulation-node-title">${r.title}</span>
        <a class="info-button" href="${r.href}"><span class="info-button__top">${r.status} Rule</span></a>
        <span class="regulation-node-metadata">Release under the Securities Exchange Act.</span>
        <span class="division">Corporation Finance</span>
      </td>
    </tr>`).join('');
  return `<html><body><table><tbody>${rows}</tbody></table></body></html>`;
}

/** parseStaffGuidanceIndex: a .field--name-field-text container of a[href]. */
function staffGuidanceHtml(): string {
  const items = STAFF_GUIDANCE.map(g => `<li><a href="${g.href}">${g.title}</a></li>`).join('');
  return `<html><body><div class="field--name-field-text"><h2>Division of Corporation Finance</h2><ul>${items}</ul></div></body></html>`;
}

/** parseNoActionIndex: a #wexchron container of li > a[href]. */
function noActionHtml(): string {
  const items = NO_ACTION.map(n => `<li><a href="${n.href}">${n.title}</a> (${n.date})</li>`).join('');
  return `<html><body><div id="wexchron"><ul>${items}</ul></div></body></html>`;
}

/** parseLitigationReleases: tbody tr containing an /litigation-releases/lr- anchor. */
function litigationHtml(): string {
  const rows = LITIGATION.map(l => `
    <tr>
      <td><time>${l.date}</time></td>
      <td>
        <span class="view-table_subfield_release_number"><span class="view-table_subfield_value">${l.number}</span></span>
        <a href="${l.href}">${l.title}</a>
      </td>
    </tr>`).join('');
  return `<html><body><table><tbody>${rows}</tbody></table></body></html>`;
}

/**
 * Route every SEC-proxy read these three surfaces make. Unknown paths return a
 * minimal document rather than an error: fetchSecRulemaking follows each rule
 * to scrape its effective date, and that secondary read must not fail the page.
 */
export async function installOfficialSourceFixtures(page: Page): Promise<void> {
  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const path = new URL(route.request().url()).searchParams.get('path') || '';
    let body = '<html><body><p>Effective Date: June 1, 2026.</p></body></html>';
    if (path.includes('rulemaking-activity')) body = rulemakingHtml();
    else if (path.includes('staff-guidance')) body = staffGuidanceHtml();
    else if (path.includes('no-action') || path.includes('noaction')) body = noActionHtml();
    else if (path.includes('litigation-releases')) body = litigationHtml();
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
}
