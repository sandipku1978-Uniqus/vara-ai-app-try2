import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function migration(name: string): string {
  return readFileSync(resolve(process.cwd(), 'db', 'migrations', name), 'utf8').toLowerCase();
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
});
