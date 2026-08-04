import { generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  candidateRequestHeaders,
  canonicalVercelCandidateOrigin,
} from '../../scripts/accuracy/request';
import {
  hasStagedProductionReleaseGateAccess,
  RELEASE_GATE_API_METHOD_PATHS,
  RELEASE_GATE_HEADER,
} from '../lib/release-gate-auth';
import { parseReleaseGateNotAfter } from '../lib/release-gate-window';

const releaseKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateKey = releaseKeys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const publicKey = releaseKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

describe('renewable staged-production credentials', () => {
  const host = 'candidate-credential-test.vercel.app';
  const deploymentId = 'dpl_credential_test';
  const sha = 'c'.repeat(40);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T12:00:00Z'));
    vi.stubEnv('CANDIDATE_URL', `https://${host}`);
    vi.stubEnv('CANDIDATE_DEPLOYMENT_ID', deploymentId);
    vi.stubEnv('EXPECTED_SHA', sha);
    vi.stubEnv('URC_RELEASE_GATE_PRIVATE_KEY', privateKey);
    vi.stubEnv('URC_RELEASE_GATE_PUBLIC_KEY', publicKey);
    vi.stubEnv('URC_RELEASE_GATE_NOT_AFTER', '2026-08-04T16:00:00.000Z');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    vi.stubEnv('VERCEL_URL', host);
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', deploymentId);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', sha);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  function requestHeaders(pathname = '/api/es-search', method = 'GET'): Headers {
    return new Headers({ host, ...candidateRequestHeaders(pathname, method) });
  }

  it('signs a token that only the exact candidate, pathname, and method accept', async () => {
    const headers = requestHeaders();
    expect(headers.get(RELEASE_GATE_HEADER)).toMatch(/^v3\./);
    await expect(hasStagedProductionReleaseGateAccess(headers, '/api/es-search', 'GET')).resolves.toBe(true);
    await expect(hasStagedProductionReleaseGateAccess(headers, '/api/filing-text', 'GET')).resolves.toBe(false);
    await expect(hasStagedProductionReleaseGateAccess(headers, '/api/claude', 'GET')).resolves.toBe(false);
    await expect(hasStagedProductionReleaseGateAccess(headers, '/api/es-search', 'POST')).resolves.toBe(false);

    const filingTextHeaders = requestHeaders('/api/filing-text', 'GET');
    await expect(hasStagedProductionReleaseGateAccess(filingTextHeaders, '/api/filing-text', 'GET')).resolves.toBe(true);
    await expect(hasStagedProductionReleaseGateAccess(filingTextHeaders, '/api/boolean-validate', 'POST')).resolves.toBe(false);

    const booleanHeaders = requestHeaders('/api/boolean-validate', 'POST');
    await expect(hasStagedProductionReleaseGateAccess(booleanHeaders, '/api/boolean-validate', 'POST')).resolves.toBe(true);
    await expect(hasStagedProductionReleaseGateAccess(booleanHeaders, '/api/boolean-validate', 'GET')).resolves.toBe(false);

    const secEftsHeaders = requestHeaders('/api/sec-efts', 'GET');
    await expect(hasStagedProductionReleaseGateAccess(secEftsHeaders, '/api/sec-efts', 'GET')).resolves.toBe(true);
    await expect(hasStagedProductionReleaseGateAccess(secEftsHeaders, '/api/sec-efts', 'POST')).resolves.toBe(false);

    const enrichPostHeaders = requestHeaders('/api/enrich', 'POST');
    await expect(hasStagedProductionReleaseGateAccess(enrichPostHeaders, '/api/enrich', 'POST')).resolves.toBe(true);
    await expect(hasStagedProductionReleaseGateAccess(enrichPostHeaders, '/api/enrich', 'GET')).resolves.toBe(false);

    vi.stubEnv('VERCEL_DEPLOYMENT_ID', 'dpl_other');
    await expect(hasStagedProductionReleaseGateAccess(headers, '/api/es-search', 'GET')).resolves.toBe(false);
  });

  it('keeps the release bridge to the exact seven method/path pairs', () => {
    expect([...RELEASE_GATE_API_METHOD_PATHS]).toEqual([
      'GET /api/es-search',
      'GET /api/letters',
      'GET /api/enrich',
      'POST /api/enrich',
      'GET /api/filing-text',
      'POST /api/boolean-validate',
      'GET /api/sec-efts',
    ]);
    for (const [pathname, method] of [
      ['/api/version', 'GET'],
      ['/support', 'GET'],
      ['/dashboard', 'GET'],
      ['/api/es-search', 'POST'],
      ['/api/boolean-validate', 'GET'],
      ['/api/claude', 'POST'],
    ]) {
      expect(candidateRequestHeaders(pathname, method)[RELEASE_GATE_HEADER]).toBeUndefined();
    }
  });

  it('emits the Vercel bypass only for the exact independently trusted candidate origin', () => {
    const candidateOrigin = `https://${host}`;
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'candidate-bypass-secret');
    vi.stubEnv('TRUSTED_CANDIDATE_ORIGIN', candidateOrigin);

    expect(
      candidateRequestHeaders('/support', 'GET', { requestOrigin: candidateOrigin })[
        'x-vercel-protection-bypass'
      ],
    ).toBe('candidate-bypass-secret');
    expect(candidateRequestHeaders('/support', 'GET')['x-vercel-protection-bypass']).toBeUndefined();
    expect(
      candidateRequestHeaders('/support', 'GET', {
        requestOrigin: 'https://attacker-controlled.vercel.app',
      })['x-vercel-protection-bypass'],
    ).toBeUndefined();
    expect(
      candidateRequestHeaders('/support', 'GET', {
        requestOrigin: candidateOrigin,
        trustedOrigin: 'https://different-candidate.vercel.app',
      })['x-vercel-protection-bypass'],
    ).toBeUndefined();
  });

  it('rejects non-canonical and lookalike Vercel origins before considering a bypass', () => {
    expect(canonicalVercelCandidateOrigin(`https://${host}`)).toBe(`https://${host}`);
    expect(canonicalVercelCandidateOrigin(`https://${host}/`)).toBe(`https://${host}`);
    for (const raw of [
      `http://${host}`,
      `https://${host}:8443`,
      `https://user:password@${host}`,
      `https://${host}/api/version`,
      `https://${host}?next=attacker`,
      'https://candidate.vercel.app.attacker.example',
      'https://nested.candidate.vercel.app',
      'https://-candidate.vercel.app',
    ]) {
      expect(canonicalVercelCandidateOrigin(raw)).toBeNull();
    }
  });

  it('normalizes ISO, epoch-seconds, and epoch-millisecond not-after values', () => {
    const epochSeconds = Math.floor(Date.parse('2026-08-04T16:00:00.000Z') / 1_000);
    expect(parseReleaseGateNotAfter('2026-08-04T16:00:00.000Z')).toBe(epochSeconds);
    expect(parseReleaseGateNotAfter(String(epochSeconds))).toBe(epochSeconds);
    expect(parseReleaseGateNotAfter(String(epochSeconds * 1_000))).toBe(epochSeconds);
    expect(parseReleaseGateNotAfter('not-a-date')).toBeNull();
  });

  it('renews after the prior HTTP token expires', async () => {
    const oldHeaders = requestHeaders();
    vi.advanceTimersByTime(6 * 60 * 1000);
    await expect(hasStagedProductionReleaseGateAccess(oldHeaders, '/api/es-search', 'GET')).resolves.toBe(false);
    await expect(hasStagedProductionReleaseGateAccess(requestHeaders(), '/api/es-search', 'GET')).resolves.toBe(true);
  });

  it('rejects a signed alternate Vercel alias that is not this deployment VERCEL_URL', async () => {
    const aliasHost = 'public-production-alias.vercel.app';
    vi.stubEnv('CANDIDATE_URL', `https://${aliasHost}`);
    const aliasHeaders = new Headers({
      host: aliasHost,
      ...candidateRequestHeaders('/api/es-search', 'GET'),
    });

    await expect(
      hasStagedProductionReleaseGateAccess(aliasHeaders, '/api/es-search', 'GET'),
    ).resolves.toBe(false);
  });

  it('rejects an exact-candidate token sent with a different request Host', async () => {
    const headers = requestHeaders();
    headers.set('host', 'public-production-alias.vercel.app');

    await expect(
      hasStagedProductionReleaseGateAccess(headers, '/api/es-search', 'GET'),
    ).resolves.toBe(false);
  });

  it('never emits a credential without a valid P-256 private key', () => {
    vi.stubEnv('URC_RELEASE_GATE_PRIVATE_KEY', 'not-a-pkcs8-key');
    expect(candidateRequestHeaders('/api/es-search', 'GET')[RELEASE_GATE_HEADER]).toBeUndefined();
  });

  it('cannot mint a credential from the verifier public key alone', () => {
    vi.stubEnv('URC_RELEASE_GATE_PRIVATE_KEY', '');
    expect(candidateRequestHeaders('/api/es-search', 'GET')[RELEASE_GATE_HEADER]).toBeUndefined();
  });

  it('fails closed for a missing, expired, far-future, or token-shorter not-after window', async () => {
    const headers = requestHeaders();
    for (const notAfter of [
      '',
      '2026-08-04T11:59:59.000Z',
      '2026-08-05T12:00:00.000Z',
      '2026-08-04T12:02:00.000Z',
    ]) {
      vi.stubEnv('URC_RELEASE_GATE_NOT_AFTER', notAfter);
      await expect(
        hasStagedProductionReleaseGateAccess(headers, '/api/es-search', 'GET'),
      ).resolves.toBe(false);
    }
  });
});
