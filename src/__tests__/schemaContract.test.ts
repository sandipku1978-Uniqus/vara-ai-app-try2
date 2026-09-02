import { describe, expect, it } from 'vitest';
import {
  assessSchemaContractEvidence,
  schemaEvidenceSha256,
  type ExpectedSchemaIdentity,
} from '../../scripts/accuracy/schema-contract';

const expected: ExpectedSchemaIdentity = {
  schemaVersion: '023',
  schemaMigrationCount: 25,
  schemaChainChecksum: 'a'.repeat(64),
  schemaChecksumAlgorithm: 'sha256-v2',
};

function validEvidence() {
  const relations = [
    ['urc_sec_filings', 'r', true],
    ['urc_sec_auditors', 'r', true],
    ['urc_sec_companies', 'r', true],
    ['urc_comment_letters', 'r', true],
    ['urc_filing_text', 'r', true],
    ['urc_thread_summaries', 'r', true],
    ['urc_schema_version', 'r', true],
    ['urc_current_auditors', 'v', false],
    ['urc_current_auditors_mat', 'm', false],
    ['urc_filing_year_form', 'm', false],
    ['urc_auditor_periods_mat', 'm', false],
  ].map(([name, kind, rls]) => ({
    name,
    kind,
    rls,
    populated: true,
    anonSelect: true,
    anonInsert: false,
    anonUpdate: false,
    anonDelete: false,
    authenticatedSelect: false,
    authenticatedInsert: false,
    authenticatedUpdate: false,
    authenticatedDelete: false,
    urcWebSelect: true,
    urcWebInsert: false,
    urcWebUpdate: false,
    urcWebDelete: false,
  }));

  const requiredColumns: Record<string, string[]> = {
    urc_sec_filings: ['accession', 'cik', 'root_form', 'date_filed'],
    urc_sec_auditors: [
      'form_filing_id', 'issuer_cik', 'firm_canonical', 'is_latest',
      'audit_report_date', 'filing_date', 'fiscal_period_end',
      'audit_report_type', 'audit_fund_series',
    ],
    urc_comment_letters: ['fts', 'review_key', 'identifier_checked_at', 'content_next_retry_at'],
    urc_filing_text: [
      'cik', 'accession', 'document', 'text', 'fetched_at', 'source_validation_version',
    ],
    urc_thread_summaries: ['thread_id', 'input_coverage'],
    urc_schema_version: ['version', 'migration_count', 'chain_checksum', 'checksum_algorithm'],
    urc_auditor_periods_mat: [
      'issuer_cik', 'effective_from', 'effective_to', 'form_filing_ids',
      'auditor_candidates', 'audit_report_types', 'resolution_status',
      'firm_canonical', 'audit_report_date', 'fiscal_period_ends',
    ],
  };
  const columns = Object.entries(requiredColumns).flatMap(([relation, names]) => (
    names.map(name => ({ relation, name }))
  ));

  const indexFixtures = [
    ['urc_sec_filings_form_date_idx', 'create index on x (root_form, date_filed desc)'],
    ['urc_sec_filings_cik_date_idx', 'create index on x (cik, date_filed desc)'],
    ['urc_sec_filings_date_accession_idx', 'create index on x (date_filed desc, accession)'],
    ['urc_letters_fts_idx', 'create index on x using gin (fts)'],
    ['urc_current_auditors_mat_pk', 'create unique index on x (issuer_cik)'],
    ['urc_filing_year_form_pk', 'create unique index on x (year, root_form)'],
    ['urc_sec_auditors_temporal_idx', 'create index on x (issuer_cik, audit_report_date) where is_latest'],
    ['urc_auditor_periods_mat_pk', 'create unique index on x (issuer_cik, effective_from)'],
    ['urc_auditor_periods_mat_firm_idx', `create index on x (firm_canonical, issuer_cik, effective_from, effective_to)
      where resolution_status = 'resolved'`],
  ];
  const indexRelations: Record<string, string> = {
    urc_sec_filings_form_date_idx: 'urc_sec_filings',
    urc_sec_filings_cik_date_idx: 'urc_sec_filings',
    urc_sec_filings_date_accession_idx: 'urc_sec_filings',
    urc_letters_fts_idx: 'urc_comment_letters',
    urc_current_auditors_mat_pk: 'urc_current_auditors_mat',
    urc_filing_year_form_pk: 'urc_filing_year_form',
    urc_sec_auditors_temporal_idx: 'urc_sec_auditors',
    urc_auditor_periods_mat_pk: 'urc_auditor_periods_mat',
    urc_auditor_periods_mat_firm_idx: 'urc_auditor_periods_mat',
  };
  const indexes = indexFixtures.map(([name, definition]) => ({
    name,
    relation: indexRelations[name],
    definition,
    valid: true,
    ready: true,
  }));

  const views = [
    {
      name: 'urc_current_auditors',
      kind: 'v',
      definition: `select from urc_auditor_periods_mat
        where effective_to is null and resolution_status = 'resolved'`,
    },
    {
      name: 'urc_auditor_periods_mat',
      kind: 'm',
      definition: `lead(audit_report_date) resolution_status coverage_pending
        unsupported_entity_scope ambiguous
        issuer, other than employee benefit plan or investment company`,
    },
  ];

  function fn(
    name: string,
    identityArguments: string,
    options: {
      anon?: boolean;
      authenticated?: boolean;
      urcWeb?: boolean;
      service?: boolean;
      searchPath?: string;
      securityDefiner?: boolean;
      definition?: string;
    } = {},
  ) {
    return {
      name,
      identityArguments,
      anonExecute: options.anon ?? true,
      authenticatedExecute: options.authenticated ?? false,
      urcWebExecute: options.urcWeb ?? options.anon ?? true,
      serviceExecute: options.service ?? true,
      securityDefiner: options.securityDefiner ?? false,
      config: [options.searchPath ?? 'search_path=pg_catalog, public'],
      definition: options.definition ?? '',
    };
  }

  const functions = [
    fn('urc_search_filings', 'text[], date, date, text, text, text, integer, integer, bigint', {
      definition: `public.urc_auditor_periods_mat f.date_filed >= a.effective_from
        f.date_filed < a.effective_to a.resolution_status = ''resolved''
        f.root_form = any($1) least(greatest(coalesce(p_limit, 20), 1), 100)
        order by f.date_filed desc, f.accession`,
    }),
    fn('urc_search_letters', 'text, text, date, date, integer, integer, text', {
      definition: `order by l.date_filed desc, l.accession, l.cik limit 10001 limit 1000
        least(greatest(p_limit, 1), 100) least(greatest(p_offset, 0), 1000)`,
    }),
    fn('urc_resolve_filing_auditors', 'jsonb', {
      definition: `jsonb_array_length(p_filings) > 5000 r.file_date >= a.effective_from
        r.file_date < a.effective_to no_prior_form_ap_report
        latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date`,
    }),
    fn('urc_recent_threads', 'integer, integer, text, bigint'),
    fn('urc_thread_detail', 'text'),
    fn('urc_data_stats', ''),
    fn('urc_filing_scope_stats', 'text[], date, date, bigint'),
    fn('urc_schema_version', ''),
    fn('urc_schema_provenance', ''),
    fn('urc_refresh_current_auditors', '', {
      anon: false, urcWeb: false, searchPath: 'search_path=pg_catalog', securityDefiner: true,
    }),
    fn('urc_refresh_auditor_periods', '', {
      anon: false,
      urcWeb: false,
      searchPath: 'search_path=pg_catalog',
      securityDefiner: true,
      definition: 'refresh materialized view concurrently public.urc_auditor_periods_mat',
    }),
    // 024 — service-role-only ANALYZE, see migration 024_data_stats_freshness.
    fn('urc_refresh_data_stats', '', {
      anon: false,
      urcWeb: false,
      searchPath: 'search_path=pg_catalog',
      securityDefiner: true,
      definition: 'analyze public.urc_sec_filings',
    }),
    fn('urc_refresh_filing_year_form', '', {
      anon: false,
      urcWeb: false,
      searchPath: 'search_path=pg_catalog',
      securityDefiner: true,
      definition: 'refresh materialized view concurrently public.urc_filing_year_form',
    }),
    fn('urc_companies_needing_sic', 'integer', { anon: false, urcWeb: false }),
    fn('urc_thread_letters', '', { anon: false, urcWeb: false }),
    fn('urc_schema_contract_evidence', '', { anon: false, urcWeb: false }),
  ];

  return {
    registry: {
      version: expected.schemaVersion,
      migrationCount: expected.schemaMigrationCount,
      chainChecksum: expected.schemaChainChecksum,
      checksumAlgorithm: expected.schemaChecksumAlgorithm,
    },
    schemas: [{
      name: 'public',
      roles: [
        { name: 'anon', usage: true, create: false },
        { name: 'authenticated', usage: true, create: false },
        { name: 'urc_web', usage: true, create: false },
        { name: 'service_role', usage: true, create: false },
      ],
    }],
    defaultPrivileges: [
      { owner: 'postgres', objectType: 'r', grantee: 'postgres', privilege: 'INSERT', grantable: false },
      { owner: 'postgres', objectType: 'S', grantee: 'postgres', privilege: 'USAGE', grantable: false },
      { owner: 'postgres', objectType: 'f', grantee: 'postgres', privilege: 'EXECUTE', grantable: false },
    ],
    relations,
    columns,
    views,
    indexes,
    functions,
    roles: [
      { name: 'anon', config: ['statement_timeout=20s'] },
      { name: 'authenticated', config: [] },
      { name: 'urc_web', config: ['statement_timeout=20s'] },
      { name: 'service_role', config: ['statement_timeout=600s'] },
    ],
    extensions: [{ name: 'pg_trgm', version: '1.6' }],
    policies: relations
      .filter(relation => relation.rls)
      .map(relation => ({
        relation: relation.name,
        name: 'anon_read',
        permissive: 'PERMISSIVE',
        roles: ['anon'],
        command: 'SELECT',
        qual: 'true',
        withCheck: null,
      })),
  };
}

describe('independent live schema contract assessment', () => {
  it('accepts complete raw catalog evidence that matches the declared identity', () => {
    expect(assessSchemaContractEvidence(validEvidence(), expected)).toEqual([]);
  });

  it('fails on registry, index, and function-semantic drift', () => {
    const evidence = validEvidence();
    evidence.registry.chainChecksum = 'b'.repeat(64);
    evidence.indexes = evidence.indexes.filter(index => index.name !== 'urc_auditor_periods_mat_pk');
    const search = evidence.functions.find(fn => fn.name === 'urc_search_filings')!;
    search.definition = 'select from public.urc_current_auditors_mat';

    const problems = assessSchemaContractEvidence(evidence, expected);
    expect(problems).toEqual(expect.arrayContaining([
      expect.stringContaining('live registry chainChecksum'),
      expect.stringContaining('required live index urc_auditor_periods_mat_pk is missing'),
      expect.stringContaining('urc_search_filings'),
    ]));
  });

  it('fails if the service-only evidence function becomes anonymously executable', () => {
    const evidence = validEvidence();
    evidence.functions.find(fn => fn.name === 'urc_schema_contract_evidence')!.anonExecute = true;

    expect(assessSchemaContractEvidence(evidence, expected)).toContain(
      'live function urc_schema_contract_evidence() anon EXECUTE is true, expected false'
    );
  });

  it('fails on authenticated or urc_web write and maintenance privilege drift', () => {
    const evidence = validEvidence();
    const filingText = evidence.relations.find(relation => relation.name === 'urc_filing_text')!;
    filingText.authenticatedUpdate = true;
    filingText.urcWebInsert = true;
    evidence.functions.find(fn => fn.name === 'urc_thread_letters')!.urcWebExecute = true;
    evidence.functions.find(fn => fn.name === 'urc_search_filings')!.authenticatedExecute = true;

    expect(assessSchemaContractEvidence(evidence, expected)).toEqual(expect.arrayContaining([
      'authenticated UPDATE denial is absent on urc_filing_text',
      'urc_web INSERT denial is absent on urc_filing_text',
      'live function urc_thread_letters() urc_web EXECUTE is true, expected false',
      'live function urc_search_filings(text[],date,date,text,text,text,integer,integer,bigint) authenticated EXECUTE is true, expected false',
    ]));
  });

  it('fails when filing-cache validation provenance is absent from the live schema', () => {
    const evidence = validEvidence();
    evidence.columns = evidence.columns.filter(column => !(
      column.relation === 'urc_filing_text' && column.name === 'source_validation_version'
    ));

    expect(assessSchemaContractEvidence(evidence, expected)).toContain(
      'required live column urc_filing_text.source_validation_version is missing'
    );
  });

  it('rejects unexpected inventoried URC backdoors outside the read allowlists', () => {
    const evidence = validEvidence();
    evidence.relations.push({
      name: 'urc_backdoor',
      kind: 'r',
      rls: false,
      populated: true,
      anonSelect: true,
      anonInsert: true,
      anonUpdate: false,
      anonDelete: false,
      authenticatedSelect: false,
      authenticatedInsert: false,
      authenticatedUpdate: false,
      authenticatedDelete: false,
      urcWebSelect: true,
      urcWebInsert: false,
      urcWebUpdate: false,
      urcWebDelete: false,
    });
    evidence.functions.push({
      name: 'urc_backdoor',
      identityArguments: '',
      anonExecute: true,
      authenticatedExecute: false,
      urcWebExecute: true,
      serviceExecute: true,
      securityDefiner: true,
      config: ['search_path=pg_catalog, public'],
      definition: 'select 1',
    });

    expect(assessSchemaContractEvidence(evidence, expected)).toEqual(expect.arrayContaining([
      'unexpected relation urc_backdoor is readable by anon',
      'unexpected relation urc_backdoor is readable by urc_web',
      'unexpected relation urc_backdoor lacks anon INSERT denial',
      'unexpected live function urc_backdoor() is executable by anon',
      'unexpected live function urc_backdoor() is executable by urc_web',
      'unexpected live function urc_backdoor() is SECURITY DEFINER',
    ]));
  });

  it('fails when RLS grants exist but no unconditional policy makes rows visible', () => {
    const evidence = validEvidence();
    evidence.policies = evidence.policies.filter(policy => policy.relation !== 'urc_sec_filings');

    expect(assessSchemaContractEvidence(evidence, expected)).toContain(
      'live RLS table urc_sec_filings lacks an unconditional permissive anon SELECT policy',
    );
  });

  it('fails when a public RPC widens the role-level statement budget', () => {
    const evidence = validEvidence();
    const recentThreads = evidence.functions.find(fn => fn.name === 'urc_recent_threads')!;
    recentThreads.config.push('statement_timeout=60s');

    expect(assessSchemaContractEvidence(evidence, expected)).toContain(
      'live public read function urc_recent_threads(integer,integer,text,bigint) overrides the role statement timeout',
    );
  });

  it('fails on public-schema CREATE or unsafe future-object defaults', () => {
    const evidence = validEvidence();
    evidence.schemas[0].roles.find(role => role.name === 'anon')!.create = true;
    evidence.defaultPrivileges.push({
      owner: 'postgres',
      objectType: 'f',
      grantee: 'PUBLIC',
      privilege: 'EXECUTE',
      grantable: false,
    });

    expect(assessSchemaContractEvidence(evidence, expected)).toEqual(expect.arrayContaining([
      'live anon role must have USAGE and no CREATE on the public schema',
      'future public-schema object type f grants EXECUTE to PUBLIC',
    ]));
  });

  it('produces a key-order-independent digest that changes with catalog drift', () => {
    const evidence = validEvidence();
    const reordered = Object.fromEntries(Object.entries(evidence).reverse());
    expect(schemaEvidenceSha256(reordered)).toBe(schemaEvidenceSha256(evidence));

    evidence.indexes = evidence.indexes.filter(index => index.name !== 'urc_auditor_periods_mat_firm_idx');
    expect(schemaEvidenceSha256(evidence)).not.toBe(schemaEvidenceSha256(reordered));
  });
});
