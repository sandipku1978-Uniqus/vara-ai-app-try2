import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRODUCT_ROUTES, findProductRoute } from '../config/routes';
import { UI_GLOBAL_ACTION_CONTRACTS, UI_PAGE_CONTRACTS } from './uiPageContracts';

const sorted = (values: readonly string[]) => [...values].sort((a, b) => a.localeCompare(b));

describe('UI page QA contracts', () => {
  it('covers the 21 registered product routes and four explicit non-product pages', () => {
    const productContracts = UI_PAGE_CONTRACTS.filter(contract => contract.kind === 'product');
    const nonProductPatterns = UI_PAGE_CONTRACTS
      .filter(contract => contract.kind !== 'product')
      .map(contract => contract.routePattern);

    expect(PRODUCT_ROUTES).toHaveLength(21);
    expect(productContracts).toHaveLength(PRODUCT_ROUTES.length);
    expect(sorted(productContracts.map(contract => contract.routePattern)))
      .toEqual(sorted(PRODUCT_ROUTES.map(route => route.path)));
    expect(sorted(nonProductPatterns)).toEqual(sorted([
      '/',
      '/design-gallery',
      '/company/[ticker]',
      '/filing/[...slug]',
    ]));
    expect(UI_PAGE_CONTRACTS).toHaveLength(25);
  });

  it('uses unique page, route, representative-path, and action identifiers', () => {
    const pageIds = UI_PAGE_CONTRACTS.map(contract => contract.id);
    const routePatterns = UI_PAGE_CONTRACTS.map(contract => contract.routePattern);
    const representativePaths = UI_PAGE_CONTRACTS.map(contract => contract.representativePath);
    const actionIds = [
      ...UI_PAGE_CONTRACTS.flatMap(contract => contract.actions.map(action => action.id)),
      ...UI_GLOBAL_ACTION_CONTRACTS.map(action => action.id),
    ];

    expect(new Set(pageIds).size).toBe(pageIds.length);
    expect(new Set(routePatterns).size).toBe(routePatterns.length);
    expect(new Set(representativePaths).size).toBe(representativePaths.length);
    expect(new Set(actionIds).size).toBe(actionIds.length);
  });

  it('defines observable contracts for shared controls and state transitions', () => {
    expect(UI_GLOBAL_ACTION_CONTRACTS.length).toBeGreaterThanOrEqual(15);

    for (const action of UI_GLOBAL_ACTION_CONTRACTS) {
      expect(action.id.startsWith('global.'), action.id).toBe(true);
      expect(action.interaction.trim().length, `${action.id} interaction`).toBeGreaterThan(20);
      expect(action.expectedOutcome.trim().length, `${action.id} expected outcome`).toBeGreaterThan(40);
    }
  });

  it('defines a useful job and observable, nonempty, distinct outcomes for every page', () => {
    for (const contract of UI_PAGE_CONTRACTS) {
      expect(contract.intendedJob.trim().length, `${contract.id} intended job`).toBeGreaterThan(40);
      expect(contract.actions.length, `${contract.id} action count`).toBeGreaterThanOrEqual(2);

      const outcomes = contract.actions.map(action => action.expectedOutcome.trim());
      expect(new Set(outcomes).size, `${contract.id} distinct outcomes`).toBe(outcomes.length);

      for (const action of contract.actions) {
        expect(action.id.startsWith(`${contract.id}.`), `${action.id} page prefix`).toBe(true);
        expect(action.interaction.trim().length, `${action.id} interaction`).toBeGreaterThan(20);
        expect(action.expectedOutcome.trim().length, `${action.id} expected outcome`).toBeGreaterThan(30);
      }
    }
  });

  it('provides concrete representative paths for both dynamic route shapes', () => {
    const dynamicContracts = UI_PAGE_CONTRACTS.filter(contract => contract.kind === 'dynamic');
    expect(dynamicContracts.map(contract => contract.routePattern)).toEqual([
      '/company/[ticker]',
      '/filing/[...slug]',
    ]);

    const company = dynamicContracts.find(contract => contract.routePattern === '/company/[ticker]');
    const filing = dynamicContracts.find(contract => contract.routePattern === '/filing/[...slug]');

    expect(company?.representativePath).toMatch(/^\/company\/[A-Za-z0-9.-]+$/);
    expect(filing?.representativePath).toMatch(/^\/filing\/[^/]+(?:\/[^/]+)*$/);
    expect(company?.representativePath).not.toContain('[');
    expect(filing?.representativePath).not.toContain('[');
    expect(findProductRoute(company!.representativePath)?.path).toBe('/company');
    expect(findProductRoute(filing!.representativePath)?.path).toBe('/filing');
  });

  it('keeps static representative paths aligned with their route contracts', () => {
    for (const contract of UI_PAGE_CONTRACTS.filter(contract => contract.kind !== 'dynamic')) {
      expect(contract.representativePath, contract.id).toBe(contract.routePattern);
    }
  });

  it('references source files that exist in the repository', () => {
    for (const contract of UI_PAGE_CONTRACTS) {
      expect(contract.sourceFiles.length, `${contract.id} source file count`).toBeGreaterThan(0);
      for (const sourceFile of contract.sourceFiles) {
        expect(sourceFile.startsWith('src/'), `${contract.id}: ${sourceFile}`).toBe(true);
        expect(existsSync(resolve(process.cwd(), sourceFile)), `${contract.id}: ${sourceFile}`).toBe(true);
      }
    }
  });
});
