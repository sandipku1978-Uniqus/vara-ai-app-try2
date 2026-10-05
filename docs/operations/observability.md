# Observability runbook

How the platform tells you something is wrong, and what to do when it does.
Written for the September 2026 audit finding "nobody is paged; every signal
ends in console output."

## What the code emits

Every server signal is one JSON object per line on stdout/stderr, keyed by
`kind`. Lines never carry query strings, request bodies, filing text, issuer
names, user identities, headers, or credentials.

| `kind` | Emitted by | Level | Meaning |
| --- | --- | --- | --- |
| `route` | every `/api/*` handler (`withRouteObservability`) | info (`status < 500`) / error | One line per request: `route`, `method`, `status`, `outcome`, `elapsedMs`, `correlationId`, `vercelId` |
| `route-failure` | same wrapper | error | A handler threw. `errorName`, `errorMessage`, bounded `stack`; the client received a 500 envelope with the same `correlationId` (499 / `cancelled` when the client went away) |
| `unhandled-request-error` | `src/instrumentation.ts` (`onRequestError`) | error | Next caught an error outside a wrapped handler: rendering, server actions, the proxy. `path` (no query), `routePath`, `routeType`, `digest` |
| `db-failure` | `dbErrorResponse` in `lib/db-observability` | error | A Supabase RPC failed. `errorClass` is the operational verdict: `permission` and `missing-rpc` are **deployment defects** (code and schema drifted); `statement-timeout` and `rate-limited` heal by themselves |
| `sec-upstream-failure` | `lib/sec-upstream` and the SEC routes | error | SEC answered with a throttle/block/outage status, an error page, a bad redirect, or timed out. `upstream`, `host`, `path`, `status`, `reason` |
| `ai-usage` | `recordAiUsage` in `lib/ai-usage` (claude, compare, stream, letters/summary) | info | One line per model request: `model` (registry id, e.g. `anthropic/claude-sonnet-5.5`), `provider` (the registry provider that answered: `anthropic`, `openai`, `google`, …; `null` when the route did not report one), `reasoningEffort` (the effort the call ran at, `null` when none was chosen), `outcome` (`completed` / `not-billed` / `unknown`), `calls`, `reservedTokens`, measured `inputTokens` / `outputTokens` / cache counts, `reasoningTokens` (the part of `outputTokens` spent reasoning, `null` when the provider does not report it), `webSearchCalls` (billable provider web-search tool uses, `null` when none were reported), `billableTokens` (input-rate weighted, plus 1,000 default-model tokens per web search and any web-retrieval call made on another model for this request), `adjustmentTokens` (the refund or overage applied to the daily budget), `userKey` (a hash, not the user ID) |
| `client-error` | `POST /api/client-error` | error | An unhandled browser error, with Next's `digest` when the cause was server-side |
| `route-completion` | `stats`, `letters`, `es-search` | info | Older per-route completion line with row counts; superseded by `route`, kept for its counts |

`outcome` on a `route` line is one of `success`, `denied` (401/403),
`rate-limited` (429), `client-error` (other 4xx), `error` (5xx returned
deliberately), `failure` (thrown), `cancelled`.

The `correlationId` on a `route` line is the same value returned to the
client in the `x-correlation-id` header and in every JSON error envelope, and
the same value on any `db-failure` or `sec-upstream-failure` line the request
produced. A user report that quotes it can be joined to the server side in
one query.

### Reading AI spend

Sum `billableTokens` on `ai-usage` lines per day (and per `userKey` or
`route`) for measured spend; `reservedTokens` minus `adjustmentTokens` is
what the daily budget actually charged. Lines with `outcome: "unknown"`
(timeouts, client aborts) carry no measurement and keep their conservative
reservation — a rising share of them is itself a signal that calls are
outrunning their 165 s timeout.

Group by `model` and `provider` to see which models users actually pick,
and by `reasoningEffort` to see what effort costs: `reasoningTokens` is
already inside `outputTokens`, so do not add it twice. `webSearchCalls`
counts searches the answering model ran itself (native search); a request
whose model cannot search natively pays for a separate retrieval call
(Perplexity Sonar, or GPT-5.6 Luna when the gateway refuses Sonar under zero
data retention), and that charge is folded into the same line's
`billableTokens` rather than written as a second line.

### Which models the deployment can run

`GET /api/ai/models` (authenticated, 60 requests a minute per user) returns
the registry (`src/lib/ai-models.ts`) filtered to the models this deployment
can call right now, the `defaultModelId` (`ANTHROPIC_MODEL` when it is a
registry id and is listed, otherwise the first available model), and
`gateway: { configured, listing, checkedAt }`. `listing` is `live` (the
gateway's public `/v1/models` was just read), `cached` (KV copy, one hour),
`unavailable` (the listing could not be read, so only the default model is
offered rather than guessing), or `not-configured` (no gateway key: only the
default model runs, directly on Anthropic, and with no key at all the list
is empty). A selector that shows only the default model on a gateway
deployment is the signal to check `listing`. The route is
`route: "ai/models"` on `route` lines; a listing failure also writes
`[ai/models] gateway listing unavailable` to stderr.

## The health endpoint

`GET /api/health` is public and needs no session. It answers **200** when the
platform can serve product requests and **503** when it cannot:

```json
{
  "ok": true,
  "status": "ok",
  "checkedAt": "2026-09-02T16:00:00.000Z",
  "sha": "…", "deploymentId": "…", "environment": "production",
  "checks": {
    "database": { "ok": true, "latencyMs": 84, "schemaVersion": "025" },
    "kv":       { "configured": true, "ok": true, "latencyMs": 21 },
    "ai":       { "configured": true, "path": "gateway", "keys": ["VERCEL_AI_GATEWAY_KEY", "ANTHROPIC_API_KEY"] }
  }
}
```

- `database` is the restricted `urc_web` read of schema provenance with a
  1.5 s budget. Failing it means every data route is failing too.
- `kv` probes the Upstash store behind the rate limiters and the SEC request
  pacer with a 1 s budget. In production a configured-but-unreachable store
  means every authenticated route is answering 503 (the limiters fail closed
  by design), and a missing store means SEC fetches are refused, so both are
  reported as `ok: false`.
- `ai.configured` only says whether a model key is present: a gateway key
  (`VERCEL_AI_GATEWAY_KEY` or `AI_GATEWAY_API_KEY`) or `ANTHROPIC_API_KEY`.
  `ai.path` is `gateway` (every registry model can run), `anthropic-direct`
  (only the default model, directly on Anthropic) or `none`, and `ai.keys`
  names the key variables that are set — names only, never values. It never
  calls the model and does not affect the 200/503 verdict.

A passing response is cacheable for 30 s; a failing one is never cached. The
endpoint is limited per instance (60 requests per minute per address) and
never touches KV to do so, so a KV incident cannot make the health check
itself unavailable. `/api/version` (release provenance) uses the same
per-instance limiter for the same reason.

## Setting up the drain, the alerts, and the monitor

These need the Vercel project owner; nothing in the repository can do them.

1. **Log drain.** Vercel → project **uniqus-research** → Settings → *Log
   Drains* (or Integrations → Better Stack / Axiom / Datadog). Choose JSON
   delivery, sources *Function* and *Edge*, environment *Production*. Every
   line above arrives as a JSON object with the fields listed, so the drain
   can filter on `kind` directly. Log Drains are a Pro-plan feature; the Pro
   plan is already required by the 300 s `maxDuration` the summary routes
   use.
2. **Three alerts** in the drain provider, each notifying the on-call email
   and phone:

   | Alert | Condition | Meaning / response |
   | --- | --- | --- |
   | Deployment defect | any `db-failure` with `errorClass` in (`permission`, `missing-rpc`), or any `unhandled-request-error` | Code and schema drifted, or a render is throwing. Roll back the deployment, then apply the missing migration (`db/migrations/`, checked against `/api/version`) and redeploy |
   | Error rate | more than 10 `route` lines with `status >= 500` **or** any `route-failure` in 5 minutes | Read the lines' `errorName`/`errorClass`; `statement-timeout` clusters mean a query outgrew its 20 s budget (narrow it or add an index); `unexpected` means a bug — the `correlationId` finds the request |
   | SEC throttling | more than 5 `sec-upstream-failure` lines with `reason` in (`http-status` with status 403/429, `error-page`) in 10 minutes | SEC is rate-limiting this deployment. Do not retry harder: check the pacer (`kv` probe in `/api/health`), confirm the User-Agent still declares a contact, and wait; document searches degrade to "unavailable — retry" rather than to wrong results |

3. **Uptime monitor.** Any external monitor (Better Stack Uptime, UptimeRobot,
   Checkly) polling `https://uniqus-research.vercel.app/api/health` every
   60 s, alerting on any non-200 response or on a body that does not contain
   `"ok":true`, after 2 consecutive failures. Point it at the custom domain
   once the production Clerk cutover lands.

## Reading a report

1. Ask for the correlation ID (every error toast and JSON envelope carries
   it) or the time and route.
2. In the drain: `correlationId = "<id>"`. You get the `route` line (status,
   elapsed) plus any `db-failure` / `sec-upstream-failure` / `route-failure`
   line it produced.
3. Without a drain: `vercel logs uniqus-research --since 1h | grep <id>`.
4. `db-failure` with `permission` or `missing-rpc` → compare `/api/version`'s
   `schemaVersion` with the latest file in `db/migrations/`; the fix is the
   migration, not a retry.

## Local verification

```bash
npx vitest run src/__tests__/routeObservability.test.ts src/__tests__/healthRoute.test.ts src/__tests__/localRateLimit.test.ts src/__tests__/requestError.test.ts src/__tests__/secUpstreamFailureLog.test.ts
```

Then `npm run dev` and `curl -i http://localhost:3000/api/health` — expect
`x-correlation-id` on the response and one `{"kind":"route",…}` line in the
dev server output.
