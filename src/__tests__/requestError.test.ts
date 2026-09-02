import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeRequestError } from '../lib/request-error';
import { onRequestError } from '../instrumentation';

describe('describeRequestError', () => {
  it('records the error identity, the route context, and the path without its query', () => {
    const error = Object.assign(new RangeError('too deep'), { digest: 'digest-123' });

    const line = describeRequestError(
      error,
      { path: '/search?q=secret%20terms&__clerk_db_jwt=token', method: 'get' },
      { routerKind: 'App Router', routePath: '/search', routeType: 'render', renderSource: 'server-rendering' },
    );

    expect(line).toEqual({
      kind: 'unhandled-request-error',
      method: 'GET',
      path: '/search',
      routePath: '/search',
      routeType: 'render',
      renderSource: 'server-rendering',
      errorName: 'RangeError',
      errorMessage: 'too deep',
      digest: 'digest-123',
      stack: expect.stringContaining('RangeError: too deep'),
    });
    expect(JSON.stringify(line)).not.toContain('secret');
    expect(JSON.stringify(line)).not.toContain('token');
  });

  it('tolerates non-Error throwables and missing context', () => {
    const line = describeRequestError('a string was thrown', { path: '/api/x#frag', method: 'POST' }, {});

    expect(line).toMatchObject({
      method: 'POST',
      path: '/api/x',
      routePath: null,
      routeType: null,
      renderSource: null,
      errorName: 'NonError',
      errorMessage: 'a string was thrown',
      digest: null,
      stack: null,
    });
  });

  it('bounds every free-text field', () => {
    const error = new Error('m'.repeat(5_000));
    error.stack = 's'.repeat(10_000);

    const line = describeRequestError(error, { path: `/${'p'.repeat(2_000)}`, method: 'GET' }, {});

    expect(line.errorMessage.length).toBe(300);
    expect(line.stack?.length).toBe(1_500);
    expect(line.path.length).toBe(512);
  });
});

describe('instrumentation.onRequestError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits exactly one structured error line', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await onRequestError(
      new Error('render failed'),
      { path: '/dashboard?tab=alerts', method: 'GET', headers: { cookie: 'must-never-be-logged' } },
      { routerKind: 'App Router', routePath: '/dashboard', routeType: 'render', renderSource: 'react-server-components', revalidateReason: undefined },
    );

    expect(error).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(error.mock.calls[0][0])) as Record<string, unknown>;
    expect(line).toMatchObject({ kind: 'unhandled-request-error', path: '/dashboard', errorMessage: 'render failed' });
    expect(JSON.stringify(line)).not.toContain('must-never-be-logged');
    expect(JSON.stringify(line)).not.toContain('tab=alerts');
  });
});
