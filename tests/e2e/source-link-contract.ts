import { expect, type Page } from '@playwright/test';

/**
 * The shared rules for an external source link (global.external-source-links
 * and its per-page counterparts). Extracted so any surface that renders
 * official-source links can be held to the same contract rather than each
 * spec inventing its own weaker version.
 */

/** Names that identify no source at all when heard out of visual context. */
const CONTEXTLESS_NAMES = new Set([
  '', 'view', 'open', 'link', 'here', 'click here', 'read more', 'more',
  'source', 'details', 'sec.gov', 'iapd', 'sec', 'edgar', 'view source',
  'open source', 'external link',
]);

export interface ExternalLink {
  href: string;
  target: string;
  rel: string;
  name: string;
}

/**
 * Every cross-origin anchor on the page, with the name a screen reader would
 * announce. These anchors have no nested widgets, so aria-label ?? title ??
 * trimmed text content is a faithful accessible name.
 */
export async function collectExternalLinks(page: Page): Promise<ExternalLink[]> {
  return page.$$eval('a[href]', anchors =>
    anchors
      .filter(a => {
        const href = a.getAttribute('href') || '';
        if (!/^https?:\/\//i.test(href)) return false;
        try {
          // The Next.js dev-server badge injects its own nextjs.org anchor. It
          // is absent from the production build CI runs (PW_PROD_BUILD), but
          // it would otherwise fail these rules during local iteration.
          if (/(^|\.)nextjs\.org$/i.test(new URL(href).hostname)) return false;
          return new URL(href).origin !== window.location.origin;
        } catch {
          return false;
        }
      })
      .map(a => ({
        href: a.getAttribute('href') || '',
        target: a.getAttribute('target') || '',
        rel: a.getAttribute('rel') || '',
        name: (
          a.getAttribute('aria-label') ||
          a.getAttribute('title') ||
          a.textContent ||
          ''
        ).replace(/\s+/g, ' ').trim(),
      }))
  );
}

export function assertSourceLinkContract(links: ExternalLink[], surface: string, officialHost: RegExp) {
  expect(links.length, `${surface}: rendered no external source links to check`).toBeGreaterThan(0);

  for (const link of links) {
    // Opens the exact official source — not a search page, not a redirector.
    expect(link.href, `${surface}: "${link.name}" does not point at an official source`).toMatch(officialHost);

    // Leaves the current research state available: the research surface must
    // survive activation rather than being navigated away from.
    expect(link.target, `${surface}: "${link.name}" (${link.href}) would replace the research view`).toBe('_blank');

    // Safely: never hand window.opener to the target document.
    expect(
      /noopener|noreferrer/.test(link.rel),
      `${surface}: "${link.name}" (${link.href}) opens a new tab without noopener/noreferrer`
    ).toBe(true);

    // Names enough row context to be actionable on its own.
    expect(
      CONTEXTLESS_NAMES.has(link.name.toLowerCase()),
      `${surface}: a source link is named "${link.name}", which identifies no source`
    ).toBe(false);
    expect(link.name.length, `${surface}: source link name "${link.name}" is too short to identify a source`).toBeGreaterThan(8);
  }

  // The core of "names enough row context": links that go to DIFFERENT
  // documents must be distinguishable by name alone. Repeated links to the
  // same href may legitimately share a name.
  const nameByHref = new Map<string, string>();
  for (const link of links) nameByHref.set(link.href, link.name);
  const namesForDistinctHrefs = [...nameByHref.values()].map(name => name.toLowerCase());
  const duplicates = namesForDistinctHrefs.filter((name, i) => namesForDistinctHrefs.indexOf(name) !== i);
  expect(
    [...new Set(duplicates)],
    `${surface}: these names are reused across links that open DIFFERENT sources, so they cannot be told apart`
  ).toEqual([]);
}
