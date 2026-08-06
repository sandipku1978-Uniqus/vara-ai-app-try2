/**
 * GET /api/filing-ai/catalog — the governed rule catalog.
 *
 * Served from the server so the rule board screen shows what the engine will
 * actually execute, including which rules have a deployed predicate binding.
 * A rule listed as governed but not bound is a rule that will be subtracted
 * from coverage on every run, and the board needs to see that.
 */

import { NextResponse } from 'next/server';

import { requireApiAccess } from '../../../../lib/api-auth';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { catalogSummary, loadCatalog, RULE_STATUS_LADDER } from '../../../../lib/filing-ai/catalog';
import { getBinding } from '../../../../lib/filing-ai/bindings';

export async function GET(request: Request) {
  const access = await requireApiAccess();
  if (access.response) return access.response;

  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'filing-ai-catalog' });
  if (!rate.allowed) return rateLimitResponse(rate);

  const catalog = loadCatalog();
  const rules = catalog.rules.map(rule => {
    const binding = getBinding(rule.rule_id, rule.layer, rule.build_wave);
    return {
      ...rule,
      predicate: binding.predicate,
      unbound_reason: binding.predicate === 'unbound' ? binding.reason : null,
    };
  });

  return NextResponse.json(
    {
      ok: true,
      summary: catalogSummary(),
      status_ladder: RULE_STATUS_LADDER,
      rules,
    },
    // The catalog changes only on deploy, so a short shared cache is safe and
    // keeps the rule board screen instant.
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  );
}
