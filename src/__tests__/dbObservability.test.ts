import { describe, it, expect } from 'vitest';
import { classifyDbError } from '../lib/db-observability';

/**
 * Handoff WP0 item 5: database failures must keep a stable public class so
 * release automation can tell a healing outage from a deployment defect.
 */
describe('classifyDbError', () => {
  it('maps permission denial to a deployment-defect class, not an outage', () => {
    const result = classifyDbError({ code: '42501', message: 'permission denied for table urc_sec_filings' });
    expect(result.errorClass).toBe('permission');
    expect(result.status).toBe(500);
    // The public message never leaks SQL or relation names.
    expect(result.publicMessage).not.toMatch(/urc_|table|sql/i);
  });

  it('maps a missing/stale PostgREST RPC to missing-rpc', () => {
    expect(classifyDbError({ code: 'PGRST202', message: 'function not found' }).errorClass).toBe('missing-rpc');
  });

  it('maps statement timeout to 504', () => {
    const result = classifyDbError({ code: '57014', message: 'canceling statement due to statement timeout' });
    expect(result.errorClass).toBe('statement-timeout');
    expect(result.status).toBe(504);
  });

  it('defaults unknown codes to an unexpected 502 that disclaims the zero', () => {
    const result = classifyDbError({ code: 'XX000', message: 'boom' });
    expect(result.errorClass).toBe('unexpected');
    expect(result.status).toBe(502);
    expect(result.publicMessage).toMatch(/not a verified zero/i);
  });

  it('handles a null error object without throwing', () => {
    expect(classifyDbError(null).errorClass).toBe('unexpected');
  });
});
