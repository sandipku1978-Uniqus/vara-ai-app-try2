import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'db', 'migrations', name), 'utf8').toLowerCase();
}

interface SchemaProvenance {
  schemaVersion: string;
  schemaMigrationCount: number;
  schemaChainChecksum: string;
  schemaChecksumAlgorithm: string;
  migrations: Array<{ filename: string; checksum: string }>;
}

function schemaProvenance(migrationsDirectory?: string): SchemaProvenance {
  const args = [resolve(process.cwd(), 'scripts', 'schema-provenance.mjs')];
  if (migrationsDirectory) args.push('--migrations-dir', migrationsDirectory);
  return JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8' })) as SchemaProvenance;
}

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : runtimeSources(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe('database security migration chain', () => {
  it('keeps production request code isolated from service-role credentials', () => {
    const sourceRoot = resolve(process.cwd(), 'src');
    const restrictedClientPath = resolve(sourceRoot, 'lib', 'supabase-web.ts');
    const restrictedClient = readFileSync(restrictedClientPath, 'utf8');
    const companyPagePath = resolve(sourceRoot, 'app', 'company', '[ticker]', 'page.tsx');
    const companyPage = readFileSync(companyPagePath, 'utf8');

    expect(restrictedClient).toContain("process.env.URC_SUPABASE_WEB_KEY");
    expect(companyPage).toContain("getWebSupabase()");
    for (const file of runtimeSources(sourceRoot)) {
      if (file === restrictedClientPath) continue;
      expect(
        readFileSync(file, 'utf8'),
        `${relative(sourceRoot, file)} must not read service-role credentials`
      ).not.toMatch(/URC_SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it('limits the privileged cache-writer helper to the three audited server routes', () => {
    const sourceRoot = resolve(process.cwd(), 'src');
    const callers = runtimeSources(sourceRoot)
      .filter(file => readFileSync(file, 'utf8').includes('getCacheWriterSupabase'))
      .map(file => relative(sourceRoot, file))
      .sort();

    expect(callers).toEqual([
      'app/api/boolean-validate/route.ts',
      'app/api/filing-text/route.ts',
      'app/api/letters/summary/route.ts',
      'lib/supabase-web.ts',
    ]);
  });

  it('010 references only RPC signatures that still exist after earlier drops', () => {
    const sql = migration('010_web_role_security.sql');

    expect(sql).not.toContain('urc_search_letters(text, text, date, date, integer, integer)');
    expect(sql).not.toContain('urc_recent_threads(integer, integer)');
    expect(sql).not.toContain('urc_recent_threads(integer, integer, text)');
    expect(sql).toContain('urc_search_letters(text, text, date, date, integer, integer, text)');
    expect(sql).toContain('urc_recent_threads(integer, integer, text, bigint)');
    expect(sql).toMatch(
      /create or replace function public\.urc_refresh_current_auditors\(\)[\s\S]*set search_path = pg_catalog[\s\S]*refresh materialized view concurrently public\.urc_current_auditors_mat/
    );
  });

  it('011 restores least-privilege grants after replacing functions', () => {
    const sql = migration('011_comment_letter_integrity.sql');
    const statsCreate = sql.indexOf('create function public.urc_data_stats()');
    const statsRevoke = sql.indexOf('revoke all on function public.urc_data_stats()', statsCreate);
    const statsGrant = sql.indexOf('grant execute on function public.urc_data_stats() to urc_web, service_role', statsRevoke);
    const threadRevoke = sql.indexOf('revoke all on function public.urc_thread_letters()');
    const threadGrant = sql.indexOf('grant execute on function public.urc_thread_letters() to service_role', threadRevoke);

    expect(statsCreate).toBeGreaterThanOrEqual(0);
    expect(statsRevoke).toBeGreaterThan(statsCreate);
    expect(statsGrant).toBeGreaterThan(statsRevoke);
    expect(threadRevoke).toBeGreaterThanOrEqual(0);
    expect(threadGrant).toBeGreaterThan(threadRevoke);
  });

  it('021 exposes checksum-grade provenance through a least-privilege RPC', () => {
    const sql = migration('021_schema_chain_provenance.sql');

    expect(sql).toContain('create or replace function urc_schema_provenance() returns jsonb');
    expect(sql).toContain('set search_path = pg_catalog, public');
    expect(sql).toContain('revoke all on function urc_schema_provenance() from public');
    expect(sql).toContain('grant execute on function urc_schema_provenance() to anon, service_role');
  });

  it('023 verifies observable live contracts before stamping and exposes raw evidence only to service_role', () => {
    const sql = migration('023_live_schema_contract_attestation.sql');
    const relationChecks = sql.indexOf('required relation kinds and rls boundaries');
    const semanticChecks = sql.indexOf('function signatures and semantic forward-fix markers');
    const privilegeChecks = sql.indexOf('least privilege and role-level work budget');
    const evidenceFunction = sql.indexOf('create or replace function public.urc_schema_contract_evidence()');
    const stamp = sql.indexOf('-- begin urc provenance stamp');

    expect(relationChecks).toBeGreaterThanOrEqual(0);
    expect(semanticChecks).toBeGreaterThan(relationChecks);
    expect(privilegeChecks).toBeGreaterThan(semanticChecks);
    expect(evidenceFunction).toBeGreaterThan(privilegeChecks);
    expect(stamp).toBeGreaterThan(evidenceFunction);
    expect(sql).toContain('add column if not exists source_validation_version smallint');
    expect(sql).toContain("('urc_filing_text', 'source_validation_version')");
    expect(sql).toContain("from pg_catalog.pg_class c");
    expect(sql).toContain("pg_catalog.pg_get_functiondef");
    expect(sql).toContain("pg_catalog.has_schema_privilege('anon', 'public', 'create')");
    expect(sql).toContain("pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'update')");
    expect(sql).toContain("pg_catalog.has_table_privilege('authenticated', 'public.' || relation_name, 'select')");
    expect(sql).toContain("pg_catalog.has_table_privilege('urc_web', 'public.' || relation_name, 'insert')");
    expect(sql).toContain("'authenticatedexecute', pg_catalog.has_function_privilege('authenticated', p.oid, 'execute')");
    expect(sql).toContain("'urcwebexecute', pg_catalog.has_function_privilege('urc_web', p.oid, 'execute')");
    expect(sql).toContain('current_user <> registry_owner');
    expect(sql).toContain('alter default privileges revoke execute on functions');
    expect(sql).toContain('from public, anon, authenticated, urc_web');
    expect(sql).toContain('pg_catalog.pg_default_acl');
    expect(sql).toContain('pg_catalog.acldefault');
    expect(sql).toContain("'defaultprivileges'");
    expect(sql).toContain("revoke all on function public.urc_schema_contract_evidence()\n  from public, anon, authenticated");
    expect(sql).toContain("grant execute on function public.urc_schema_contract_evidence()\n  to service_role");
    expect(sql).toContain("if has_function_privilege('anon', 'public.urc_schema_contract_evidence()', 'execute')");
    // Keep the SQL alias distinct from the PL/pgSQL `required record` used by
    // the following loop. Reusing that name makes PostgreSQL resolve the
    // alias as an unassigned record and abort migration 023.
    expect(sql).toContain(
      "]) as candidate(signature)\n  where pg_catalog.to_regprocedure(candidate.signature) is null;"
    );
    expect(sql).not.toContain(
      "]) as required(signature)\n  where pg_catalog.to_regprocedure(required.signature) is null;"
    );
    expect(sql).toContain(
      "chr(39) || chr(39),\n    chr(39)"
    );
  });

  it('022 resolves only unambiguous date-effective ordinary-issuer Form AP evidence', () => {
    const sql = migration('022_temporal_auditor_attribution.sql');

    expect(sql).toContain('create materialized view if not exists public.urc_auditor_periods_mat');
    expect(sql).toContain("'issuer, other than employee benefit plan or investment company'");
    expect(sql).toContain("then 'ambiguous'");
    expect(sql).toContain("then 'unsupported_entity_scope'");
    expect(sql).toContain("then 'coverage_pending'");
    expect(sql).toContain('create or replace function public.urc_resolve_filing_auditors(p_filings jsonb)');
    expect(sql).toContain('jsonb_array_length(p_filings) > 5000');
    expect(sql).toContain('grant execute on function public.urc_resolve_filing_auditors(jsonb)');
    expect(sql).toMatch(
      /create or replace function public\.urc_refresh_auditor_periods\(\)[\s\S]*security definer[\s\S]*set search_path = pg_catalog[\s\S]*refresh materialized view concurrently public\.urc_auditor_periods_mat/
    );
    expect(sql).toContain("a.resolution_status = ''resolved''");
    expect(sql).toMatch(
      /create or replace view public\.urc_current_auditors as[\s\S]*from public\.urc_auditor_periods_mat[\s\S]*resolution_status = 'resolved'/
    );
    expect(sql).not.toContain('urc_current_auditors_mat a on a.issuer_cik = f.cik');
  });

  it('requires the chain head to stamp the exact canonical migration identity', () => {
    const provenance = schemaProvenance();
    const head = provenance.migrations.at(-1);
    expect(head).toBeDefined();
    const sql = migration(head!.filename);

    expect(provenance).toMatchObject({
      schemaChecksumAlgorithm: 'sha256-v2',
    });
    expect(provenance.schemaVersion).toBe(head!.filename.slice(0, 3));
    expect(provenance.schemaMigrationCount).toBe(provenance.migrations.length);
    expect(provenance.schemaChainChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(sql).toContain('-- begin urc provenance stamp');
    expect(sql).toContain(`'${provenance.schemaVersion}'`);
    expect(sql).toContain(`${provenance.schemaMigrationCount}`);
    expect(sql).toContain(`'${provenance.schemaChainChecksum}'`);
    expect(sql).toContain(`'${provenance.schemaChecksumAlgorithm}'`);
  });

  it('hashes SQL appended after the stamp while normalizing only its checksum literal', () => {
    const temporaryMigrations = mkdtempSync(join(tmpdir(), 'urc-schema-provenance-'));
    try {
      cpSync(resolve(process.cwd(), 'db', 'migrations'), temporaryMigrations, { recursive: true });
      const baseline = schemaProvenance(temporaryMigrations);
      const head = baseline.migrations.at(-1)!;
      const headPath = resolve(temporaryMigrations, head.filename);
      const original = readFileSync(headPath, 'utf8');

      // The stored checksum is necessarily self-referential and is the one
      // exact literal canonicalization is allowed to ignore.
      writeFileSync(
        headPath,
        original.replace(baseline.schemaChainChecksum, 'f'.repeat(64)),
        'utf8'
      );
      const restamped = schemaProvenance(temporaryMigrations);
      expect(restamped.schemaChainChecksum).toBe(baseline.schemaChainChecksum);
      expect(restamped.migrations.at(-1)?.checksum).toBe(head.checksum);

      // Executable SQL after the marker used to be invisible. It must now
      // alter both the migration payload checksum and the aggregate identity.
      appendFileSync(headPath, '\nselect pg_advisory_unlock_all();\n', 'utf8');
      const appended = schemaProvenance(temporaryMigrations);
      expect(appended.migrations.at(-1)?.checksum).not.toBe(head.checksum);
      expect(appended.schemaChainChecksum).not.toBe(baseline.schemaChainChecksum);
    } finally {
      rmSync(temporaryMigrations, { recursive: true, force: true });
    }
  });
});
