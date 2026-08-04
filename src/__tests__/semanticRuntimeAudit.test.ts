import { describe, expect, it } from 'vitest';
import {
  reconcileFailedRequests,
  type FailedRequest,
  type RequestIdentity,
} from '../../tests/e2e/semantic-runtime-audit';

const aborted = (url: string, method = 'GET'): FailedRequest => ({
  method,
  url,
  errorText: 'net::ERR_ABORTED',
});

const succeeded = (url: string, method = 'GET'): RequestIdentity => ({ method, url });

describe('semantic runtime request reconciliation', () => {
  const filingUrl = 'http://127.0.0.1:4337/api/sec-proxy?path=filing.htm';

  it('suppresses only an aborted request with an exact successful method-and-URL twin', () => {
    expect(reconcileFailedRequests(
      [aborted(filingUrl)],
      [succeeded(filingUrl)],
    )).toEqual([]);
  });

  it('retains a unique abort with no successful twin', () => {
    const failure = aborted(filingUrl);
    expect(reconcileFailedRequests([failure], [])).toEqual([failure]);
  });

  it('retains aborts when only the method or query scope differs', () => {
    const methodMismatch = aborted(filingUrl, 'POST');
    const queryMismatch = aborted(`${filingUrl}&document=2`);

    expect(reconcileFailedRequests(
      [methodMismatch, queryMismatch],
      [succeeded(filingUrl)],
    )).toEqual([methodMismatch, queryMismatch]);
  });

  it('retains non-abort network failures even when an identical request succeeds', () => {
    const reset: FailedRequest = {
      method: 'GET',
      url: filingUrl,
      errorText: 'net::ERR_CONNECTION_RESET',
    };

    expect(reconcileFailedRequests([reset], [succeeded(filingUrl)])).toEqual([reset]);
  });
});
