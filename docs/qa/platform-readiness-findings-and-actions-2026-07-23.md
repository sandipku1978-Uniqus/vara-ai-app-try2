# Platform Readiness Findings and Action Report

**Assessment date:** July 23, 2026  
**Assessed revision:** `9c6471f6473ac9f6fad2a87bdace0c9d59d15420`  
**Production URL:** https://uniqus-research.vercel.app  
**Release decision:** **NO-GO for general production; acceptable for controlled internal QA only**

## 1. Executive summary

The production deployment is available and matches the latest `main` revision. The core engineering checks are strong: 764 unit tests pass, TypeScript and lint are clean, the production build completes, and the deterministic route, neutral-visitor, and Boolean browser suites pass.

Those green checks do not yet establish production readiness. The live revision was deployed while its GitHub CI run was red, two high-severity production dependency findings remain, production uses a Clerk development instance, entitlement enforcement is not configured, and browser-facing routes fall back to the Supabase service-role key because the restricted web key is absent. The strict UI/accessibility audit fails 20 of 25 route contracts. The latest accuracy gate predates the current revision and failed its then-required threshold. Several Boolean-search guarantees also remain contradicted by the current execution path.

The immediate objective should be to close the security and release-control blockers, then make the remaining search guarantees true and test them through the real UI. Production promotion should remain blocked until the acceptance checklist in section 6 is green.

## 2. What is currently healthy

| Area | Evidence | Status |
|---|---|---|
| Source/deployment parity | Local `HEAD`, `origin/main`, and production all resolve to `9c6471f` | Green |
| Unit regression suite | 72 files, 764 tests passed | Green |
| Static engineering checks | TypeScript, ESLint, and Next.js production build passed | Green |
| Build output | 47 pages generated successfully | Green |
| Route smoke | 24/24 deterministic route checks passed locally | Green |
| Neutral-visitor fixtures | 19/19 checks passed locally | Green within fixture scope |
| Boolean browser fixtures | 5/5 checks passed locally | Green within fixture scope |
| Public availability | `/`, `/support`, `/privacy`, and `/terms` return HTTP 200 with good baseline response times | Green |
| Baseline headers | HSTS, `nosniff`, frame, referrer, and permissions policies are present | Green/partial |

Important limitation: the browser suites use a localhost authentication bypass, and the Boolean suite mocks SEC-facing requests. They do not prove production authentication, production data access, or live-corpus Boolean correctness.

## 3. Findings

### P0 — Release blockers

#### F-01 — Production dependency security gate is red

- The current CI run fails `npm audit --omit=dev`.
- Production includes `next@16.2.10` and `sharp@0.34.5`, producing two high-severity findings.
- The Next.js advisory is especially relevant because [`src/proxy.ts`](../../src/proxy.ts) is the authentication and entitlement boundary.
- Updating Next.js alone may not remove the Sharp finding; the dependency tree needs a compatible Sharp version at or above the fixed range.

**Risk:** a known security defect exists in the exact artifact currently serving production.

#### F-02 — Production authentication is using a development Clerk instance

- The live sign-in experience displays **Development mode** and uses the `settling-puma-25.accounts.dev` domain.
- Browser console output explicitly warns that development keys should not be used in production.
- `CLERK_RESEARCH_FEATURE` is absent, so signed-in access is not protected by the intended research entitlement.
- Direct product deep links do not present a consistent production-grade first-party access journey: a browser is sent to the development Clerk domain, while clients without the development-browser context receive a generic protected-route 404.

**Risk:** usage limits, trust failure, inconsistent onboarding, and missing commercial/authorization enforcement.

#### F-03 — Web routes are not using the least-privilege Supabase credential

- `URC_SUPABASE_WEB_KEY` is absent in the live build.
- Web handlers consequently fall back to the service-role key.

**Risk:** a web-facing path has broader database authority than intended.

#### F-04 — Production deployment is not gated by CI

- The live Vercel deployment completed before the GitHub CI run finished and failed.
- `main` has no branch protection.
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) does not run Playwright.
- Vercel therefore promotes code even when dependency, browser, or accuracy checks are red or absent.

**Risk:** a failing release candidate can automatically become production.

#### F-05 — Inline auditor syntax can change Boolean meaning in the Search UI

- [`src/views/SearchPage.tsx`](../../src/views/SearchPage.tsx) extracts `auditor:` before validating the complete expression.
- `lease OR auditor:KPMG` can therefore be reduced to text query `lease` plus a global KPMG filter—effectively `lease AND KPMG`.
- The shared service compiler rejects the original unsafe form, but the UI mutates the expression before that guard receives it.

**Risk:** the platform can return a materially different result set than the user requested.

#### F-06 — Required OR branches can be requested but not evaluated

- [`src/services/filingResearch.ts`](../../src/services/filingResearch.ts) continues requesting required branches after the first branch fills the display limit.
- Its inner validation loop still runs only while `filteredResults.length < displayLimit`.
- A later branch may therefore be recorded as requested while none of its branch-exclusive candidates can enter the result set.

**Risk:** Boolean OR recall remains incomplete on broad/saturated searches.

#### F-07 — Coverage and request-budget guarantees are not yet truthful end to end

- Missing upstream coverage can still default to complete.
- The normal `/api/es-search` path emits `pageCoverage` while the client reads `candidateCoverage`.
- Document-fetch failures are typed, but `validationComplete` does not exclude all unvalidated failures or cancellation before the coverage callback is emitted.
- The advertised 60-page limit counts calls to `searchEdgarFilings()`, not the individual EFTS pages that the helper may issue.

**Risk:** the UI can overstate completeness, and one run can exceed its advertised upstream request budget.

#### F-08 — Cancellation and latest-request-wins are incomplete

- Request identity is scoped by research session rather than globally to the newest visible search.
- A query that creates a new session does not necessarily invalidate an older session's in-flight updates.
- Abort signals are checked between phases, but are not carried through every candidate-search and filing-hydration request.

**Risk:** stale results, coverage, errors, or route state can overwrite a newer search; abandoned work can continue consuming SEC capacity.

#### F-09 — Current production accuracy has not passed an accuracy gate

- No accuracy workflow has run against `9c6471f`.
- The latest available run is from July 20 and scored 894/950, or 94.1%, below its then-required 97% threshold.
- Auditor-facet class B scored 74.0%; text-search class C scored 87.3%; many failures were HTTP 502 responses.
- The workflow source now uses a lower threshold, but that threshold change has not been validated against the current revision and should be explicitly approved rather than silently treated as readiness.

**Risk:** the production search/data pipeline has no current objective accuracy proof.

### P1 — Must close before external launch

#### F-10 — Strict UI/accessibility gate fails 20 of 25 routes

- Only five routes pass the strict semantic census.
- The audit found 86 unresolved ARIA references across 16 routes; 65 are action buttons targeting a missing `#urc-copilot-panel`.
- Seven routes expose duplicate `<main>` landmarks.
- Filing Detail and Design Gallery lack an H1.
- Support and Design Gallery include unnamed visible controls.
- Comparison and Filing Detail produced local console findings; some are development/CSP-sandbox specific and should be reconfirmed against a production build.

**Risk:** assistive-technology failures, ambiguous document structure, and avoidable release regressions.

#### F-11 — Public visitor and authentication journey is not production-grade

- The landing page itself is healthy, but its primary actions lead into development-mode authentication.
- Public Support exposes a complete authenticated application sidebar; signed-out visitors selecting those links are immediately pushed into authentication.
- Support logo and Home breadcrumb point to `/dashboard`, not the public homepage.
- The PWA manifest starts at `/dashboard`, which is not a useful signed-out entry point.

**Risk:** neutral visitors experience an unexpected access wall and development infrastructure instead of a polished conversion path.

#### F-12 — Public legal and support content is incomplete

- [`src/app/terms/page.tsx`](../../src/app/terms/page.tsx) describes the terms as baseline text that should be replaced or supplemented before production use.
- [`src/app/privacy/page.tsx`](../../src/app/privacy/page.tsx) says deployment-specific retention, access, deletion, data-location, and privacy-contact information must be documented, but that information is absent.
- Support provides a usage guide but no contact or escalation channel.
- Public Support repeats some Boolean guarantees that the current execution path does not satisfy.

**Risk:** legal, operational, and product-truth gaps reduce user trust and complicate support.

#### F-13 — Vercel project linkage is duplicated and inconsistent

- The custom production domain is served by project `vara-ai-app`.
- The repository's local `.vercel/project.json` points to a separate `vara-ai-app-try2` project.
- Both projects auto-deploy the same Git revision, but the duplicate lacks complete production authentication configuration.

**Risk:** deployments, environment variables, aliases, and rollback actions can be applied to the wrong project.

#### F-14 — Content Security Policy is incomplete

- Baseline security headers exist, but production does not return a Content Security Policy header.

**Risk:** the browser has less protection against injected or unexpectedly loaded content than the rest of the security posture implies.

### P2 — Operational hygiene

#### F-15 — Expected local development server was not running

- `localhost:3033` returned `ECONNREFUSED` during the readiness check.
- The automated browser checks used a temporary isolated server and stopped it afterward.

**Risk:** shared local verification instructions and actual developer state can diverge.

## 4. Prioritized action plan

| ID | Priority | Owner role | Action | Acceptance criterion |
|---|---:|---|---|---|
| A-01 | P0 | Platform engineering | Upgrade Next.js and resolve Sharp to non-vulnerable compatible versions; review the lockfile rather than applying a blind audit fix | `npm audit --omit=dev` reports no high or critical findings; unit, type, lint, build, and browser gates remain green |
| A-02 | P0 | Identity/platform | Replace Clerk development keys with production keys and configure `CLERK_RESEARCH_FEATURE` | No Development mode banner/warning; entitled user succeeds; authenticated but unentitled user is denied; signed-out deep links preserve and restore their destination |
| A-03 | P0 | Data/security | Configure `URC_SUPABASE_WEB_KEY` and verify web handlers never fall back to the service-role credential in production | Production startup/build fails closed if the restricted key is missing; route tests prove least-privilege access |
| A-04 | P0 | Release engineering | Require green CI before Vercel promotion; protect `main`; use immutable preview acceptance before production promotion | A deliberately failing check cannot deploy to production; rollback target and accepted SHA are recorded |
| A-05 | P0 | Search engineering | Compile and validate the complete Boolean query before extracting any structured field, or remove inline `auditor:` and use Advanced Filters only | UI and service both reject unsafe OR/NOT auditor composition with zero retrieval requests; no expression is silently rewritten |
| A-06 | P0 | Search engineering | Allocate validation capacity per required OR branch or round-robin branch candidates before filling surplus display rows | A saturated broad branch cannot hide a known branch-exclusive accession; exact union fixture passes |
| A-07 | P0 | Search/data engineering | Canonicalize one coverage schema, treat unknown/failure/cancel as partial, and count actual upstream page/document requests | `complete=true` occurs only for an exhausted run; injected 404/415/429/timeout/cancel remain partial; measured requests remain within the stated cap |
| A-08 | P0 | Frontend/search engineering | Introduce a page-global latest-run token and propagate `AbortSignal` through search, retry waits, filing hydration, and every Boolean-capable caller | Under delayed responses, only the newest query may update rows, route, coverage, notices, or errors; superseded network work aborts |
| A-09 | P0 | QA/release engineering | Put deterministic Playwright, strict semantic checks, and Boolean journeys in required CI | CI runs route, visitor, Boolean, and strict semantic suites; artifacts are uploaded on failure |
| A-10 | P0 | Data/QA | Run the accuracy gate against the accepted revision and investigate class B/C and 502 failures | Current SHA meets the explicitly approved threshold; recommended minimum is the previously required 97%, with any reduction documented and approved |
| A-11 | P1 | Frontend/accessibility | Repair broken ARIA targets, duplicate main landmarks, missing H1s, and unnamed controls | Strict semantic census passes 25/25 route contracts; no unresolved ARIA targets or unnamed visible controls |
| A-12 | P1 | Product/identity | Make public-to-auth transitions explicit and first-party; point public Home/logo/PWA entry to a useful public page | Landing actions explain access requirements; signed-out deep links show sign-in rather than a generic 404; PWA starts on a viable route |
| A-13 | P1 | Legal/product | Replace baseline Terms and complete Privacy disclosures; add a support contact/escalation path | Legal approval recorded; production pages contain operator-specific terms, retention/deletion/location/contact details, and support channel |
| A-14 | P1 | Platform engineering | Consolidate the two Vercel projects and align local project linkage, aliases, and environment variables | One authoritative project owns production; documented deploy/preview/rollback commands target it |
| A-15 | P1 | Security/platform | Add and validate an application-appropriate CSP | CSP is present in production and enforced without breaking Clerk, SEC content display, exports, or required application assets |
| A-16 | P2 | Developer experience | Document the supported local port/start command and add a quick health check | A developer can start the app and run smoke tests from a clean checkout using documented commands |

## 5. Recommended implementation sequence

1. **Freeze uncontrolled production promotion.** Add branch protection and require the existing CI check before further production changes.
2. **Close security/configuration blockers.** Complete A-01 through A-03 and consolidate Vercel ownership under A-14.
3. **Close search correctness blockers.** Complete A-05 through A-08, including adversarial tests that fail against the current implementation.
4. **Make the test evidence release-grade.** Complete A-09 and run A-10 on the exact preview SHA proposed for production.
5. **Finish visitor-facing readiness.** Complete A-11 through A-13 and A-15.
6. **Promote an accepted immutable preview.** Run the full checklist below, record the results, then promote the same SHA without rebuilding from a different source state.

## 6. Production acceptance checklist

The platform is ready for a general production release only when every required item is checked.

### Security and access

- [ ] Production dependency audit has no high or critical findings.
- [ ] Clerk uses production keys and no development warning or development account domain.
- [ ] Signed-out, entitled, and unentitled access paths pass.
- [ ] `CLERK_RESEARCH_FEATURE` is enforced.
- [ ] Restricted Supabase web credential is present; no web service-role fallback occurs.
- [ ] CSP and existing baseline security headers pass production verification.

### Search correctness and capacity

- [ ] Inline auditor semantics cannot rewrite OR/NOT meaning.
- [ ] Saturated disjoint OR fixtures return the exact union.
- [ ] Invalid, unsupported, and negative-only expressions issue zero retrieval requests.
- [ ] Failure, unknown coverage, deadline, request cap, or cancellation can never report complete coverage.
- [ ] Actual candidate-page and unique-document request counts stay within the advertised limits.
- [ ] Older searches cannot overwrite any state belonging to a newer search.
- [ ] Live authenticated Boolean canary passes without self-induced 429 responses.

### Automated evidence

- [ ] Unit, typecheck, lint, and production build pass on the release SHA.
- [ ] Route smoke and neutral-visitor suites pass.
- [ ] Expanded Boolean browser suite passes through the real Search UI.
- [ ] Strict semantic/accessibility census passes 25/25 routes.
- [ ] Accuracy gate passes against the release SHA at the explicitly approved threshold.
- [ ] Authenticated preview smoke validates search, filing detail, evidence navigation, and one representative workflow from each major route family.

### Product and operations

- [ ] Production Terms and Privacy copy is approved and deployment-specific.
- [ ] A visible support/contact path exists.
- [ ] One documented Vercel project owns production and rollback.
- [ ] The accepted preview SHA, test results, migration/config checklist, and rollback target are recorded.
- [ ] Vercel cannot promote a red CI revision.

## 7. Evidence references

- Production: https://uniqus-research.vercel.app
- Current failed CI run: https://github.com/sandipku1978-Uniqus/vara-ai-app-try2/actions/runs/30032879471
- Last available failed accuracy run: https://github.com/sandipku1978-Uniqus/vara-ai-app-try2/actions/runs/29780203510
- CI definition: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)
- Accuracy definition: [`.github/workflows/accuracy-gate.yml`](../../.github/workflows/accuracy-gate.yml)
- Boolean remediation plan: [`docs/qa/boolean-search-remediation-plan-2026-07-21.md`](boolean-search-remediation-plan-2026-07-21.md)
- Site interaction audit design: [`docs/qa/full-site-interaction-audit-2026-07-21.md`](full-site-interaction-audit-2026-07-21.md)
- Boolean utilities: [`src/utils/booleanSearch.ts`](../../src/utils/booleanSearch.ts)
- Search execution: [`src/services/filingResearch.ts`](../../src/services/filingResearch.ts)
- Search UI: [`src/views/SearchPage.tsx`](../../src/views/SearchPage.tsx)
- Browser configuration: [`playwright.config.ts`](../../playwright.config.ts)

## 8. Assessment limitations

- No authenticated production account was used, so real production authorization and signed-in workflows remain unverified.
- Local authenticated browser tests used the repository's localhost-only bypass.
- Boolean browser journeys used deterministic API fixtures and do not prove live SEC-corpus behavior.
- The latest accuracy evidence predates the assessed revision.
- The comparison-page development chunk error requires confirmation against a production-build server before being classified as a production defect.
- This assessment was read-only except for creating this report; no application code, environment variables, deployment configuration, or production state was changed.
