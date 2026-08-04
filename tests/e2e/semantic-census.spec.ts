import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { ALL_ROUTE_CONTRACTS, type RouteContract } from './route-contracts';
import { installSemanticAuditFixtures } from './semantic-audit-fixtures';
import {
  reconcileFailedRequests,
  type FailedRequest,
  type RequestIdentity,
} from './semantic-runtime-audit';

interface ControlRecord {
  selector: string;
  tag: string;
  name: string;
  type: string | null;
  href: string | null;
  title: string | null;
  disabled: boolean;
  ariaControls: string | null;
  ariaExpanded: string | null;
  ariaPressed: string | null;
}

interface RouteAudit {
  path: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  mainCount: number;
  h1Count: number;
  controls: ControlRecord[];
  unnamedControls: ControlRecord[];
  duplicateIds: string[];
  invalidAriaReferences: Array<{ selector: string; attribute: string; target: string }>;
  horizontalOverflowPixels: number;
  overflowCandidates: Array<{ selector: string; left: number; right: number; width: number }>;
  consoleErrors: string[];
  sandboxEnforcements: string[];
  pageErrors: string[];
  failedFirstPartyRequests: string[];
  embeddedSecDocumentHazards: string[];
  issues: string[];
}

const strictAudit = process.env.QA_STRICT_AUDIT === '1';
const publicOnly = process.env.QA_PUBLIC_ONLY === '1';

function listenForRuntimeProblems(page: Page) {
  const consoleErrors: string[] = [];
  const sandboxEnforcements: string[] = [];
  const pageErrors: string[] = [];
  const failedFirstPartyRequests: FailedRequest[] = [];
  const successfulRequests: RequestIdentity[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const locationUrl = message.location().url;
    let expectedSandboxEnforcement = false;
    try {
      const location = new URL(locationUrl);
      const currentPage = new URL(page.url());
      expectedSandboxEnforcement = location.origin === currentPage.origin
        && location.pathname === '/api/sec-proxy'
        && /^Blocked script execution in '.+' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/.test(text);
    } catch {
      // A malformed console location is not an expected browser security signal.
    }
    if (expectedSandboxEnforcement) sandboxEnforcements.push(text);
    else consoleErrors.push(text);
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (!response.ok()) return;
    const request = response.request();
    successfulRequests.push({ method: request.method(), url: request.url() });
  });
  page.on('requestfailed', request => {
    try {
      const requestUrl = new URL(request.url());
      const pageUrl = new URL(page.url());
      if (requestUrl.origin === pageUrl.origin) {
        failedFirstPartyRequests.push({
          method: request.method(),
          url: request.url(),
          errorText: request.failure()?.errorText || 'failed',
        });
      }
    } catch {
      // Ignore malformed third-party URLs; the browser has already rejected them.
    }
  });

  return { consoleErrors, sandboxEnforcements, pageErrors, failedFirstPartyRequests, successfulRequests };
}

async function auditRoute(page: Page, contract: RouteContract): Promise<RouteAudit> {
  const runtime = listenForRuntimeProblems(page);
  const response = await page.goto(contract.path, {
    waitUntil: 'domcontentloaded',
    timeout: contract.note ? 60_000 : 30_000,
  });
  expect(response, `${contract.path} should produce a response before it is audited`).not.toBeNull();

  await expect(page.getByRole('heading', {
    level: contract.headingLevel,
    name: contract.heading,
  })).toBeVisible();

  // Let hydration-driven controls and short client fetches settle without
  // waiting for third-party sources that may intentionally remain active.
  await page.waitForTimeout(300);

  const failedFirstPartyRequests = reconcileFailedRequests(
    runtime.failedFirstPartyRequests,
    runtime.successfulRequests,
  ).map(failure => {
    const requestUrl = new URL(failure.url);
    return `${failure.method} ${requestUrl.pathname}: ${failure.errorText}`;
  });

  const dom = await page.evaluate(() => {
    const visible = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const style = getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const selectorFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 4) {
        const parent = current.parentElement;
        const siblings = parent ? Array.from(parent.children).filter(child => child.tagName === current!.tagName) : [];
        const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
        parts.unshift(`${current.tagName.toLowerCase()}${suffix}`);
        current = parent;
      }
      return parts.join(' > ');
    };

    const normalizedText = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
    const accessibleName = (element: Element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const value = labelledBy
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent || '')
          .join(' ');
        if (normalizedText(value)) return normalizedText(value);
      }
      const ariaLabel = element.getAttribute('aria-label');
      if (normalizedText(ariaLabel)) return normalizedText(ariaLabel);

      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        const labels = Array.from(element.labels || []).map(label => label.textContent || '').join(' ');
        if (normalizedText(labels)) return normalizedText(labels);
        if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) {
          if (normalizedText(element.value)) return normalizedText(element.value);
        }
      }

      if (element instanceof HTMLImageElement && normalizedText(element.alt)) return normalizedText(element.alt);
      const ownText = normalizedText(element.textContent);
      if (ownText) return ownText;
      return normalizedText(element.getAttribute('title'));
    };

    const controls = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]'))
      .filter(visible)
      .map(element => ({
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        name: accessibleName(element),
        type: element.getAttribute('type'),
        href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null,
        title: element.getAttribute('title'),
        disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
        ariaControls: element.getAttribute('aria-controls'),
        ariaExpanded: element.getAttribute('aria-expanded'),
        ariaPressed: element.getAttribute('aria-pressed'),
      }));

    const ids = Array.from(document.querySelectorAll('[id]')).map(element => element.id).filter(Boolean);
    const idCounts = new Map<string, number>();
    ids.forEach(id => idCounts.set(id, (idCounts.get(id) || 0) + 1));
    const duplicateIds = Array.from(idCounts.entries()).filter(([, count]) => count > 1).map(([id]) => id);

    const referenceAttributes = [
      'aria-controls',
      'aria-describedby',
      'aria-labelledby',
      'aria-owns',
      'aria-activedescendant',
      'aria-details',
      'aria-errormessage',
    ];
    const invalidAriaReferences: Array<{ selector: string; attribute: string; target: string }> = [];
    for (const element of Array.from(document.querySelectorAll(referenceAttributes.map(attribute => `[${attribute}]`).join(',')))) {
      for (const attribute of referenceAttributes) {
        const value = element.getAttribute(attribute)?.trim();
        if (!value) continue;
        for (const target of value.split(/\s+/)) {
          if (!document.getElementById(target)) {
            invalidAriaReferences.push({ selector: selectorFor(element), attribute, target });
          }
        }
      }
    }

    const viewportWidth = document.documentElement.clientWidth;
    const overflowCandidates = Array.from(document.body.querySelectorAll('*'))
      .filter(visible)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { selector: selectorFor(element), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter(rect => rect.left < -2 || rect.right > viewportWidth + 2)
      .sort((a, b) => Math.max(b.right - viewportWidth, -b.left) - Math.max(a.right - viewportWidth, -a.left))
      .slice(0, 20);

    // Chromium reports blocked execution in a sandboxed frame as a console
    // error even when the sandbox is the intended control. Keep that signal in
    // the audit attachment, but independently fail if the SEC proxy ever
    // delivers executable markup into the embedded document.
    const embeddedSecDocumentHazards: string[] = [];
    for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[src*="/api/sec-proxy"]'))) {
      const frameDocument = frame.contentDocument;
      if (!frameDocument) continue;
      const executableTags = frameDocument.querySelectorAll('script, iframe, object, embed').length;
      if (executableTags) embeddedSecDocumentHazards.push(`${executableTags} executable/nested tag(s)`);
      const eventHandlers = Array.from(frameDocument.querySelectorAll('*')).reduce(
        (count, element) => count + Array.from(element.attributes).filter(attribute => /^on/i.test(attribute.name)).length,
        0
      );
      if (eventHandlers) embeddedSecDocumentHazards.push(`${eventHandlers} inline event handler(s)`);
      const executableUrls = Array.from(frameDocument.querySelectorAll('[href], [src]')).filter(element =>
        /^(?:javascript|vbscript):/i.test(element.getAttribute('href') || element.getAttribute('src') || '')
      ).length;
      if (executableUrls) embeddedSecDocumentHazards.push(`${executableUrls} executable URL(s)`);
    }

    return {
      title: document.title,
      viewport: { width: viewportWidth, height: document.documentElement.clientHeight },
      mainCount: document.querySelectorAll('main').length,
      h1Count: document.querySelectorAll('h1').length,
      controls,
      unnamedControls: controls.filter(control => !control.name),
      duplicateIds,
      invalidAriaReferences,
      horizontalOverflowPixels: Math.max(0, document.documentElement.scrollWidth - viewportWidth),
      overflowCandidates,
      embeddedSecDocumentHazards,
    };
  });

  const issues: string[] = [];
  if (dom.mainCount !== 1) issues.push(`Expected one main landmark; found ${dom.mainCount}.`);
  if (dom.h1Count !== 1) issues.push(`Expected one H1; found ${dom.h1Count}.`);
  if (dom.unnamedControls.length) issues.push(`${dom.unnamedControls.length} visible interactive control(s) have no accessible name: ${JSON.stringify(dom.unnamedControls.slice(0, 4))}`);
  if (dom.duplicateIds.length) issues.push(`${dom.duplicateIds.length} duplicate DOM id(s) found.`);
  if (dom.invalidAriaReferences.length) issues.push(`${dom.invalidAriaReferences.length} ARIA ID reference(s) do not resolve: ${JSON.stringify(dom.invalidAriaReferences.slice(0, 6))}`);
  if (dom.horizontalOverflowPixels > 2) issues.push(`Document overflows horizontally by ${dom.horizontalOverflowPixels}px.`);
  if (dom.embeddedSecDocumentHazards.length) issues.push(`Embedded SEC document contains executable markup: ${dom.embeddedSecDocumentHazards.join(', ')}.`);
  if (runtime.consoleErrors.length) issues.push(`${runtime.consoleErrors.length} console error(s) observed.`);
  if (runtime.pageErrors.length) issues.push(`${runtime.pageErrors.length} uncaught page error(s) observed.`);
  if (failedFirstPartyRequests.length) issues.push(`${failedFirstPartyRequests.length} first-party request(s) failed.`);

  return {
    path: contract.path,
    url: page.url(),
    ...dom,
    consoleErrors: runtime.consoleErrors,
    sandboxEnforcements: runtime.sandboxEnforcements,
    pageErrors: runtime.pageErrors,
    failedFirstPartyRequests,
    issues,
  };
}

test.describe('semantic and interaction census', () => {
  test.describe.configure({ timeout: 75_000 });

  const productionBuild = Boolean(process.env.QA_BASE_URL) || process.env.PW_PROD_BUILD === '1';
  const censusContracts = ALL_ROUTE_CONTRACTS.filter(
    // The design gallery 404s in every production build (fabricated sample
    // data must never be served); there is nothing to census there.
    contract => !(productionBuild && contract.path === '/design-gallery')
  );
  for (const contract of censusContracts) {
    test(`${contract.path} produces an actionable accessibility and UI audit`, async ({ page }, testInfo) => {
      test.skip(publicOnly && !contract.public, 'QA_PUBLIC_ONLY excludes authenticated product routes.');
      await installSemanticAuditFixtures(page, contract.path);
      const audit = await auditRoute(page, contract);
      await testInfo.attach(`semantic-audit-${contract.path.replace(/[^a-z0-9]+/gi, '-') || 'home'}.json`, {
        body: Buffer.from(JSON.stringify(audit, null, 2)),
        contentType: 'application/json',
      });

      testInfo.annotations.push({
        type: audit.issues.length ? 'audit-findings' : 'audit-clean',
        description: audit.issues.length ? audit.issues.join(' ') : 'No census issues detected.',
      });

      // Audit mode inventories every visible control and reports usability
      // debt without turning the basic route suite red. Teams can promote all
      // findings to release gates with QA_STRICT_AUDIT=1.
      if (strictAudit) {
        expect(audit.issues, audit.issues.join('\n')).toEqual([]);
      }
    });
  }
});
