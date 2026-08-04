import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/accuracy-gate.yml'),
  'utf8',
);
const verifier = readFileSync(
  resolve(process.cwd(), 'scripts/accuracy/verify-candidate.ts'),
  'utf8',
);
const releaseAuth = readFileSync(
  resolve(process.cwd(), 'src/lib/release-gate-auth.ts'),
  'utf8',
);
const releaseWindow = readFileSync(
  resolve(process.cwd(), 'src/lib/release-gate-window.ts'),
  'utf8',
);
const consolidator = readFileSync(
  resolve(process.cwd(), 'scripts/accuracy/consolidate.ts'),
  'utf8',
);
const qualityVerifier = readFileSync(
  resolve(process.cwd(), 'scripts/accuracy/verify-quality-runs.ts'),
  'utf8',
);
const candidateSecurityHeaders = readFileSync(
  resolve(process.cwd(), 'scripts/accuracy/security-headers.ts'),
  'utf8',
);
const candidateRequest = readFileSync(
  resolve(process.cwd(), 'scripts/accuracy/request.ts'),
  'utf8',
);

describe('release workflow trust boundary', () => {
  it('never lets a caller choose executable evaluator code', () => {
    expect(workflow).not.toContain('workflow_call:');
    expect(workflow).not.toContain('expected_sha:');
    expect(workflow).toContain('if [ "$GITHUB_REF" != "refs/heads/main" ]');
    expect(workflow).toContain('ref: ${{ github.sha }}');
    expect(workflow).toContain('ref: ${{ needs.trusted-dispatch.outputs.sha }}');
  });

  it('requires exact-path CI and CodeQL push runs for the evaluator SHA before candidate testing', () => {
    const qualityStep = workflow.indexOf('scripts/accuracy/verify-quality-runs.ts');
    const candidateStep = workflow.indexOf('scripts/accuracy/verify-candidate.ts');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('security-events: read');
    expect(qualityStep).toBeGreaterThan(0);
    expect(candidateStep).toBeGreaterThan(qualityStep);
    expect(workflow).toContain("if: steps.quality.outcome == 'success'");
    expect(workflow).toContain('--quality-attestation quality-attestation.json');
    expect(workflow).toContain('quality-attestation.json');
    expect(qualityVerifier).toContain("'.github/workflows/ci.yml'");
    expect(qualityVerifier).toContain("'.github/workflows/codeql.yml'");
    expect(qualityVerifier).toContain("'.github/workflows/auth-lifecycle.yml'");
    expect(qualityVerifier).toContain("run.event === 'push'");
    expect(qualityVerifier).toContain("run.head_branch === 'main'");
    expect(qualityVerifier).toContain("run.status === 'completed'");
    expect(qualityVerifier).toContain("run.conclusion === 'success'");
    expect(qualityVerifier).toContain("CODE_SCANNING_REF = 'refs/heads/main'");
    expect(qualityVerifier).toContain("BLOCKING_CODE_SCANNING_SEVERITIES = ['critical', 'high']");
    expect(qualityVerifier).toContain("state: 'open'");
    expect(qualityVerifier).toContain('analysisBefore');
    expect(qualityVerifier).toContain('analysisAfter');
    expect(consolidator).toContain('CodeQL exact-ref inventory contains');
  });

  it('downloads browser and authentication action evidence only from the exact attested run IDs', () => {
    const qualityStep = workflow.indexOf('scripts/accuracy/verify-quality-runs.ts');
    const runBindingStep = workflow.indexOf('Bind UI evidence to the exact attested quality runs');
    const browserDownload = workflow.indexOf('Download exact-SHA browser action evidence');
    const authDownload = workflow.indexOf('Download exact-SHA authentication action evidence');
    const candidateStep = workflow.indexOf('scripts/accuracy/verify-candidate.ts');

    expect(runBindingStep).toBeGreaterThan(qualityStep);
    expect(browserDownload).toBeGreaterThan(runBindingStep);
    expect(authDownload).toBeGreaterThan(browserDownload);
    expect(candidateStep).toBeGreaterThan(authDownload);
    expect(workflow).toContain('actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131');
    expect(workflow).toContain("ci_run_id=$(select_run_id '.github/workflows/ci.yml')");
    expect(workflow).toContain("auth_run_id=$(select_run_id '.github/workflows/auth-lifecycle.yml')");
    expect(workflow).toContain('run-id: ${{ steps.ui_evidence_runs.outputs.ci_run_id }}');
    expect(workflow).toContain('run-id: ${{ steps.ui_evidence_runs.outputs.auth_run_id }}');
    expect(workflow).toContain('name: ui-action-evidence-browser-${{ needs.trusted-dispatch.outputs.sha }}');
    expect(workflow).toContain('name: ui-action-evidence-auth-${{ needs.trusted-dispatch.outputs.sha }}');
    expect(workflow).toContain("steps.ui_browser_evidence.outcome == 'success'");
    expect(workflow).toContain("steps.ui_auth_evidence.outcome == 'success'");
    expect(workflow).toContain('--ui-browser ui-action-evidence/browser/ui-action-evidence-browser.json');
    expect(workflow).toContain('--ui-auth ui-action-evidence/auth/ui-action-evidence-auth.json');
  });

  it('installs trusted dependencies before any secret is placed in a process environment', () => {
    const install = workflow.indexOf('npm ci --ignore-scripts');
    const firstSecret = workflow.indexOf('${{ secrets.');
    expect(install).toBeGreaterThan(0);
    expect(firstSecret).toBeGreaterThan(install);
    expect(workflow).toContain('environment: release-candidate');
    expect(workflow).not.toMatch(/\bnpx tsx\b/);
    expect(workflow).toContain('npx --no-install tsx');
  });

  it('uses asymmetric renewable signing and contains no repository promotion command', () => {
    expect(workflow).toContain('URC_RELEASE_GATE_PRIVATE_KEY');
    expect(workflow).not.toContain('URC_RELEASE_GATE_SIGNING_KEY');
    expect(workflow).not.toContain('URC_RELEASE_GATE_TOKEN');
    expect(workflow).not.toContain('URC_ACCURACY_COOKIE');
    expect(workflow).not.toContain('URC_ACCURACY_AUTHORIZATION');
    expect(workflow).not.toMatch(/\bvercel\s+(?:deploy|promote|--prod)\b/);
    expect(workflow).toContain('Candidate evidence passed — operator promotion pending');
    expect(workflow).toContain('This is not promotion authorization');
    expect(workflow).not.toContain('name: Production promotion authorized');
    expect(workflow).not.toContain('echo "Accuracy evidence passed for deployment ${{ inputs.deployment_id }}');
    expect(workflow).toContain('echo "Accuracy evidence passed for deployment $CANDIDATE_DEPLOYMENT_ID');
    expect(releaseAuth).toContain('URC_RELEASE_GATE_PUBLIC_KEY');
    expect(releaseWindow).toContain('URC_RELEASE_GATE_NOT_AFTER');
    expect(releaseAuth).toContain('process.env.VERCEL_URL');
    expect(releaseAuth).not.toContain('URC_RELEASE_GATE_PRIVATE_KEY');
  });

  it('accepts only an unaliased staged Production build from the exact GitHub source', () => {
    expect(workflow).toContain('EXPECTED_REPOSITORY_ID: ${{ github.repository_id }}');
    expect(workflow).toContain('--expect-repository-id "$EXPECTED_REPOSITORY_ID"');
    expect(workflow).toContain('group: release-accuracy');
    expect(workflow).not.toContain('group: release-accuracy-${{ inputs.deployment_id }}');

    expect(verifier).toContain("endpoint.searchParams.set('withGitRepoInfo', 'true')");
    expect(verifier).toContain("target !== 'production'");
    expect(verifier).toContain("readySubstate !== 'STAGED'");
    expect(verifier).toContain('aliasAssigned !== false');
    expect(verifier).toContain('project.autoAssignCustomDomains !== false');
    expect(verifier).toContain("String(link?.productionBranch || '') !== 'main'");
    expect(verifier).toContain('deployment.prebuilt !== false');
    expect(workflow).toContain('--min-not-after-seconds 7200');
    expect(workflow).toContain('--min-not-after-seconds 300');
    expect(verifier).toContain('MAX_RELEASE_GATE_WINDOW_SECONDS');
    expect(verifier).not.toContain('meta?.githubCommitSha');
  });

  it('never sends the Vercel bypass before the requested origin is bound to passing preflight evidence', () => {
    const verifierTrustGate = verifier.indexOf('if (base && problems.length === 0)');
    const verifierCandidateRead = verifier.indexOf("candidateRequestHeaders('/api/version', 'GET', {");
    const candidateStep = workflow.indexOf('Verify canonical immutable candidate before testing');
    const trustedOutput = workflow.indexOf('echo "trusted_origin=$trusted_origin" >> "$GITHUB_OUTPUT"');
    const consolidationStep = workflow.indexOf('Consolidate fail-closed release evidence');
    const consolidationBlock = workflow.slice(consolidationStep, workflow.indexOf('Upload immutable release evidence'));

    expect(verifierTrustGate).toBeGreaterThan(0);
    expect(verifierCandidateRead).toBeGreaterThan(verifierTrustGate);
    expect(trustedOutput).toBeGreaterThan(candidateStep);
    expect(workflow).toContain('(.problems | length) == 0');
    expect(workflow).toContain('TRUSTED_CANDIDATE_ORIGIN: ${{ steps.candidate.outputs.trusted_origin }}');
    expect(consolidationBlock).toContain('if: always()');
    expect(consolidationBlock).toContain('TRUSTED_CANDIDATE_ORIGIN: ${{ steps.candidate.outputs.trusted_origin }}');
    expect(consolidationBlock).toContain(
      "VERCEL_AUTOMATION_BYPASS_SECRET: ${{ steps.candidate.outcome == 'success' && secrets.VERCEL_AUTOMATION_BYPASS_SECRET || '' }}",
    );
    expect(candidateRequest).toContain('requestOrigin === trustedOrigin');
    expect(candidateRequest).toContain('canonicalVercelCandidateOrigin(trust.requestOrigin)');
    expect(consolidator).toContain('trustedCandidateOriginForFinalRead');
    expect(consolidator).toContain('if (!trustedOrigin) return null');
    expect(consolidator).not.toContain('async function fetchVersion(base: string)');
  });

  it('independently probes the live schema and binds it to start, finish, and final application evidence', () => {
    const schemaStep = workflow.indexOf('scripts/accuracy/schema-contract.ts');
    const consolidateStep = workflow.indexOf('scripts/accuracy/consolidate.ts');
    expect(schemaStep).toBeGreaterThan(workflow.indexOf('Re-attest staged candidate after the long sweep'));
    expect(consolidateStep).toBeGreaterThan(schemaStep);
    expect(workflow).toContain('--schema-contract schema-contract-report.json');
    expect(workflow).toContain('schema-contract-report.json');
    expect(verifier).toContain('application.schemaDatabaseFingerprint');
    expect(consolidator).toContain('candidateFinal');
    expect(consolidator).toContain('schemaContract');
    expect(consolidator).toContain('finalVersion?.schemaDatabaseFingerprint');
  });

  it('records enforced security headers from every immutable-candidate response archetype', () => {
    const securityStep = workflow.indexOf('scripts/accuracy/security-headers.ts');
    const longSweep = workflow.indexOf('Full ticker coverage sweep');
    expect(securityStep).toBeGreaterThan(workflow.indexOf('scripts/accuracy/probe-auth.ts'));
    expect(longSweep).toBeGreaterThan(securityStep);
    expect(workflow).toContain("steps.security_headers.outcome == 'success'");
    expect(workflow).toContain('--security-headers security-header-report.json');
    expect(workflow).toContain('security-header-report.json');
    for (const archetype of [
      'public-html',
      'public-api',
      'not-found',
      'protected-route',
      'typed-bad-request',
    ]) {
      expect(candidateSecurityHeaders).toContain(`'${archetype}'`);
    }
    expect(candidateSecurityHeaders).toContain("path: '/api/es-search?size=0'");
    expect(candidateSecurityHeaders).toContain('acceptedStatuses: [400]');
    expect(candidateSecurityHeaders).toContain("const requestHeaders = candidateRequestHeaders(probePathname, 'GET', { requestOrigin: base })");
    expect(candidateSecurityHeaders).not.toContain("? '/api/es-search'");
    expect(candidateSecurityHeaders).toContain('acceptedStatuses: PROTECTED_AUTH_BOUNDARY_STATUSES');
    expect(candidateSecurityHeaders).toContain("production CSP permits 'unsafe-eval'");
  });
});
