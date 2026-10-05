import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : runtimeSources(path);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
  });
}

describe('search continuation job security boundaries', () => {
  it('limits the user-object writer to the search-job server module', () => {
    const sourceRoot = resolve(process.cwd(), 'src');
    const callers = runtimeSources(sourceRoot)
      .filter(file => readFileSync(file, 'utf8').includes('getUserWriterSupabase'))
      .map(file => relative(sourceRoot, file))
      .sort();
    expect(callers).toEqual([
      // 029: the scheduled alert evaluator's store (urc_alert_eval_* RPCs).
      'app/api/alerts/_server/store.ts',
      'app/api/search-jobs/_server/http.ts',
      'lib/supabase-web.ts',
    ]);
  });

  it('keeps migration 028 closed to every web identity and free of definer functions', () => {
    const sql = readFileSync(resolve(process.cwd(), 'db', 'migrations', '028_search_continuation_jobs.sql'), 'utf8')
      .toLowerCase()
      .split('\n')
      .filter(line => !line.trim().startsWith('--'))
      .join('\n');
    // Owner-scoped records: no grant of any kind to web identities.
    expect(sql).not.toMatch(/grant [^;]* to [^;]*\b(anon|authenticated|urc_web)\b/);
    expect(sql).toContain('revoke all on public.urc_search_jobs from public, anon, authenticated');
    expect(sql).toContain('revoke all on public.urc_search_job_hits from public, anon, authenticated');
    // A replay of 014's read sweep cannot reopen the rows.
    expect(sql).toContain('as restrictive for all to anon, authenticated using (false) with check (false)');
    // The release-evidence evaluator treats an undeclared definer as a backdoor.
    expect(sql).not.toContain('security definer');
    // Exactly one running job per owner, enforced by the database.
    expect(sql).toMatch(/create unique index if not exists urc_search_jobs_one_running_per_owner\s+on public\.urc_search_jobs \(owner_user_id\) where status = 'running'/);
    // Every function pins its search_path.
    const functions = sql.match(/create or replace function[\s\S]*?\nas \$\$/g) ?? [];
    expect(functions.length).toBeGreaterThanOrEqual(10);
    for (const fn of functions) expect(fn).toContain('set search_path = pg_catalog, public');
  });

  it('scopes every owner-facing function by owner and every worker write by lease', () => {
    const sql = readFileSync(resolve(process.cwd(), 'db', 'migrations', '028_search_continuation_jobs.sql'), 'utf8');
    for (const name of ['urc_search_job_get', 'urc_search_job_list', 'urc_search_job_hits_page', 'urc_search_job_cancel']) {
      const body = sql.slice(sql.indexOf(`function public.${name}(`));
      expect(body.slice(0, body.indexOf('$$;'))).toMatch(/owner_user_id = p_owner_user_id/);
    }
    for (const name of ['urc_search_job_advance', 'urc_search_job_release', 'urc_search_job_hits_lookup']) {
      const body = sql.slice(sql.indexOf(`function public.${name}(`));
      expect(body.slice(0, body.indexOf('$$;'))).toMatch(/lease_token = p_lease_token/);
    }
  });
});
