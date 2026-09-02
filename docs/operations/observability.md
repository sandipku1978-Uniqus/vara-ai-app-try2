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
    "ai":       { "configured": true }
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
- `ai.configured` only says whether a model key is present. It never calls
  the model.

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
