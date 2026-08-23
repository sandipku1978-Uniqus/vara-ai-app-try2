/**
 * Independently inspect the live database contract through the service-only
 * urc_schema_contract_evidence() RPC.
 *
 * The public /api/version endpoint reports the chain identity declared by the
 * database. This probe is deliberately separate: protected-main evaluator
 * code checks raw live catalog facts, ACLs, indexes, and function definitions
 * rather than trusting the declaration alone.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { normalizeSupabaseOrigin, supabaseOriginFingerprint } from '../../src/lib/database-origin';

type JsonRecord = Record<string, unknown>;

export interface ExpectedSchemaIdentity {
  schemaVersion: string;
  schemaMigrationCount: number;
  schemaChainChecksum: string;
  schemaChecksumAlgorithm: string;
}

const REQUIRED_RELATIONS: Record<string, { kind: string; rls?: boolean }> = {
  urc_sec_filings: { kind: 'r', rls: true },
  urc_sec_auditors: { kind: 'r', rls: true },
  urc_sec_companies: { kind: 'r', rls: true },
  urc_comment_letters: { kind: 'r', rls: true },
  urc_filing_text: { kind: 'r', rls: true },
  urc_thread_summaries: { kind: 'r', rls: true },
  urc_schema_version: { kind: 'r', rls: true },
  urc_current_auditors: { kind: 'v' },
  urc_current_auditors_mat: { kind: 'm' },
  urc_filing_year_form: { kind: 'm' },
  urc_auditor_periods_mat: { kind: 'm' },
};

const REQUIRED_COLUMNS: Record<string, string[]> = {
  urc_sec_filings: ['accession', 'cik', 'root_form', 'date_filed'],
  urc_sec_auditors: [
    'form_filing_id', 'issuer_cik', 'firm_canonical', 'is_latest',
    'audit_report_date', 'filing_date', 'fiscal_period_end',
    'audit_report_type', 'audit_fund_series',
  ],
  urc_comment_letters: [
    'fts', 'review_key', 'identifier_checked_at', 'content_next_retry_at',
  ],
  urc_filing_text: [
    'cik', 'accession', 'document', 'text', 'fetched_at', 'source_validation_version',
  ],
  urc_thread_summaries: ['thread_id', 'input_coverage'],
  urc_schema_version: [
    'version', 'migration_count', 'chain_checksum', 'checksum_algorithm',
  ],
  urc_auditor_periods_mat: [
    'issuer_cik', 'effective_from', 'effective_to', 'form_filing_ids',
    'auditor_candidates', 'audit_report_types', 'resolution_status',
    'firm_canonical', 'audit_report_date', 'fiscal_period_ends',
  ],
};

const REQUIRED_INDEXES: Record<string, { relation: string; fragments: string[] }> = {
  urc_sec_filings_form_date_idx: {
    relation: 'urc_sec_filings', fragments: ['root_form', 'date_filed desc'],
  },
  urc_sec_filings_cik_date_idx: {
    relation: 'urc_sec_filings', fragments: ['cik', 'date_filed desc'],
  },
  urc_sec_filings_date_accession_idx: {
    relation: 'urc_sec_filings', fragments: ['date_filed desc', 'accession'],
  },
  urc_letters_fts_idx: {
    relation: 'urc_comment_letters', fragments: ['using gin', 'fts'],
  },
  urc_current_auditors_mat_pk: {
    relation: 'urc_current_auditors_mat', fragments: ['unique index', 'issuer_cik'],
  },
  urc_filing_year_form_pk: {
    relation: 'urc_filing_year_form', fragments: ['unique index', 'year', 'root_form'],
  },
  urc_sec_auditors_temporal_idx: {
    relation: 'urc_sec_auditors', fragments: ['issuer_cik', 'audit_report_date', 'is_latest'],
  },
  urc_auditor_periods_mat_pk: {
    relation: 'urc_auditor_periods_mat', fragments: ['unique index', 'issuer_cik', 'effective_from'],
  },
  urc_auditor_periods_mat_firm_idx: {
    relation: 'urc_auditor_periods_mat',
    fragments: ['firm_canonical', 'effective_from', 'effective_to', "resolution_status = 'resolved'"],
  },
};

const REQUIRED_VIEW_FRAGMENTS: Record<string, string[]> = {
  urc_current_auditors: [
    'urc_auditor_periods_mat',
    'effective_to is null',
    "resolution_status = 'resolved'",
  ],
  urc_auditor_periods_mat: [
    'lead(',
    'resolution_status',
    'coverage_pending',
    'unsupported_entity_scope',
    'ambiguous',
    'issuer, other than employee benefit plan or investment company',
  ],
};

interface FunctionRequirement {
  name: string;
  arguments: string;
  anonExecute: boolean;
  serviceExecute: boolean;
  searchPath: string;
  securityDefiner?: boolean;
  definitionFragments?: string[];
}

const FUNCTION_REQUIREMENTS: FunctionRequirement[] = [
  {
    name: 'urc_search_filings',
    arguments: 'text[],date,date,text,text,text,integer,integer,bigint',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
    definitionFragments: [
      'public.urc_auditor_periods_mat',
      'f.date_filed >= a.effective_from',
      'f.date_filed < a.effective_to',
      "a.resolution_status = ''resolved''",
      'f.root_form = any($1)',
      'least(greatest(coalesce(p_limit, 20), 1), 100)',
      'order by f.date_filed desc, f.accession',
    ],
  },
  {
    name: 'urc_search_letters',
    arguments: 'text,text,date,date,integer,integer,text',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
    definitionFragments: [
      'order by l.date_filed desc, l.accession, l.cik',
      'limit 10001',
      'limit 1000',
      'least(greatest(p_limit, 1), 100)',
      'least(greatest(p_offset, 0), 1000)',
    ],
  },
  {
    name: 'urc_resolve_filing_auditors',
    arguments: 'jsonb',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
    definitionFragments: [
      'jsonb_array_length(p_filings) > 5000',
      'r.file_date >= a.effective_from',
      'r.file_date < a.effective_to',
      'no_prior_form_ap_report',
      'latest_pcaob_reported_issuer_audit_firm_on_or_before_sec_filing_date',
    ],
  },
  {
    name: 'urc_recent_threads',
    arguments: 'integer,integer,text,bigint',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_thread_detail',
    arguments: 'text',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_data_stats',
    arguments: '',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_filing_scope_stats',
    arguments: 'text[],date,date,bigint',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_schema_version',
    arguments: '',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_schema_provenance',
    arguments: '',
    anonExecute: true,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_refresh_current_auditors',
    arguments: '',
    anonExecute: false,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog',
    securityDefiner: true,
  },
  {
    name: 'urc_refresh_auditor_periods',
    arguments: '',
    anonExecute: false,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog',
    securityDefiner: true,
    definitionFragments: ['refresh materialized view concurrently public.urc_auditor_periods_mat'],
  },
  {
    // 024. ANALYZE requires table ownership, which neither the web nor the
    // service role holds, so this is SECURITY DEFINER and service-role only —
    // the same shape as the two refresh routines above. It must be declared
    // here as well as in schemaContractFixture: this list is the contract,
    // the fixture is the simulated live inventory, and an undeclared
    // SECURITY DEFINER function is reported as a backdoor.
    name: 'urc_refresh_data_stats',
    arguments: '',
    anonExecute: false,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog',
    securityDefiner: true,
    definitionFragments: ['analyze public.urc_sec_filings'],
  },
  {
    name: 'urc_companies_needing_sic',
    arguments: 'integer',
    anonExecute: false,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_thread_letters',
    arguments: '',
    anonExecute: false,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
  {
    name: 'urc_schema_contract_evidence',
    arguments: '',
    anonExecute: false,
    serviceExecute: true,
    searchPath: 'search_path=pg_catalog, public',
  },
];

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function normalized(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim()
    : '';
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const item = value as JsonRecord;
    return `{${Object.keys(item).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(item[key])}`
    )).join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

export function schemaEvidenceSha256(evidence: unknown): string {
  return createHash('sha256').update(canonicalJson(evidence)).digest('hex');
}

function functionKey(item: JsonRecord): string {
  return `${String(item.name || '')}(${normalized(item.identityArguments).split(' ').join('')})`;
}

function expectedFunctionKey(item: FunctionRequirement): string {
  return `${item.name}(${item.arguments.split(' ').join('')})`;
}

export function assessSchemaContractEvidence(
  input: unknown,
  expected: ExpectedSchemaIdentity,
): string[] {
  const evidence = record(input);
  if (!evidence) return ['schema contract RPC returned no evidence object'];

  const problems: string[] = [];
  const registry = record(evidence.registry);
  if (!registry) {
    problems.push('live registry evidence is missing');
  } else {
    const comparisons: Array<[keyof ExpectedSchemaIdentity, string, unknown]> = [
      ['schemaVersion', 'version', registry.version],
      ['schemaMigrationCount', 'migrationCount', registry.migrationCount],
      ['schemaChainChecksum', 'chainChecksum', registry.chainChecksum],
      ['schemaChecksumAlgorithm', 'checksumAlgorithm', registry.checksumAlgorithm],
    ];
    for (const [expectedField, observedField, observed] of comparisons) {
      if (observed !== expected[expectedField]) {
        problems.push(`live registry ${observedField} ${String(observed ?? 'null')} differs from expected ${String(expected[expectedField])}`);
      }
    }
  }

  const rolesEvidence = records(evidence.roles);
  const urcWebRolePresent = rolesEvidence.some(role => role.name === 'urc_web');
  if (!urcWebRolePresent) problems.push('live urc_web role evidence is missing');
  const publicSchema = record(records(evidence.schemas).find(item => item.name === 'public'));
  if (!publicSchema) {
    problems.push('live public schema privilege evidence is missing');
  } else {
    const schemaRoles = new Map(records(publicSchema.roles).map(item => [String(item.name), item]));
    const anonSchema = schemaRoles.get('anon');
    const authenticatedSchema = schemaRoles.get('authenticated');
    const serviceSchema = schemaRoles.get('service_role');
    if (!anonSchema || anonSchema.usage !== true || anonSchema.create !== false) {
      problems.push('live anon role must have USAGE and no CREATE on the public schema');
    }
    if (!authenticatedSchema || authenticatedSchema.create !== false) {
      problems.push('live authenticated role retains or lacks evidence for public-schema CREATE denial');
    }
    if (!serviceSchema || serviceSchema.usage !== true) {
      problems.push('live service_role lacks public-schema USAGE');
    }
    if (urcWebRolePresent) {
      const webSchema = schemaRoles.get('urc_web');
      if (!webSchema || webSchema.usage !== true || webSchema.create !== false) {
        problems.push('live urc_web role must have USAGE and no CREATE on the public schema');
      }
    }
  }

  const defaultPrivileges = records(evidence.defaultPrivileges);
  const defaultObjectTypes = new Set(defaultPrivileges.map(item => normalized(item.objectType)));
  for (const objectType of ['r', 's', 'f']) {
    if (!defaultObjectTypes.has(objectType)) {
      problems.push(`effective default-privilege evidence is missing object type ${objectType}`);
    }
  }
  for (const privilege of defaultPrivileges) {
    const grantee = normalized(privilege.grantee);
    if (['public', 'anon', 'authenticated', 'urc_web'].includes(grantee)) {
      problems.push(
        `future public-schema object type ${String(privilege.objectType)} grants ${String(privilege.privilege)} to ${String(privilege.grantee)}`,
      );
    }
  }

  const relationRows = records(evidence.relations);
  const relations = new Map(relationRows.map(item => [String(item.name), item]));
  const requiredRelationNames = new Set(Object.keys(REQUIRED_RELATIONS));
  const seenRelationNames = new Set<string>();
  for (const relation of relationRows) {
    const name = String(relation.name || '');
    if (!/^urc_[a-z0-9_]+$/.test(name)) {
      problems.push(`live relation inventory contains invalid name ${name || '(missing)'}`);
      continue;
    }
    if (seenRelationNames.has(name)) problems.push(`live relation inventory duplicates ${name}`);
    seenRelationNames.add(name);
    if (relation.authenticatedSelect !== false) {
      problems.push(`authenticated SELECT denial is absent on inventoried relation ${name}`);
    }
    if (requiredRelationNames.has(name)) continue;

    for (const [role, field] of [
      ['anon', 'anonSelect'],
      ['urc_web', 'urcWebSelect'],
    ] as const) {
      if (relation[field] !== false) {
        problems.push(`unexpected relation ${name} is readable by ${role}`);
      }
    }
    for (const [role, prefix] of [
      ['anon', 'anon'],
      ['authenticated', 'authenticated'],
      ['urc_web', 'urcWeb'],
    ] as const) {
      for (const operation of ['Insert', 'Update', 'Delete'] as const) {
        if (relation[`${prefix}${operation}`] !== false) {
          problems.push(`unexpected relation ${name} lacks ${role} ${operation.toUpperCase()} denial`);
        }
      }
    }
  }
  for (const [name, requirement] of Object.entries(REQUIRED_RELATIONS)) {
    const relation = relations.get(name);
    if (!relation) {
      problems.push(`required live relation ${name} is missing`);
      continue;
    }
    if (relation.kind !== requirement.kind) {
      problems.push(`live relation ${name} has kind ${String(relation.kind)}, expected ${requirement.kind}`);
    }
    if (requirement.rls && relation.rls !== true) {
      problems.push(`live table ${name} does not enforce RLS`);
    }
    if (relation.anonSelect !== true) problems.push(`anon cannot SELECT required relation ${name}`);
    for (const privilege of ['anonInsert', 'anonUpdate', 'anonDelete'] as const) {
      if (relation[privilege] !== false) {
        problems.push(`anon ${privilege.slice(4).toUpperCase()} denial is absent on ${name}`);
      }
    }
    for (const privilege of ['authenticatedInsert', 'authenticatedUpdate', 'authenticatedDelete'] as const) {
      if (relation[privilege] !== false) {
        problems.push(`authenticated ${privilege.slice(13).toUpperCase()} denial is absent on ${name}`);
      }
    }
    if (urcWebRolePresent) {
      if (relation.urcWebSelect !== true) problems.push(`urc_web cannot SELECT required relation ${name}`);
      for (const privilege of ['urcWebInsert', 'urcWebUpdate', 'urcWebDelete'] as const) {
        if (relation[privilege] !== false) {
          problems.push(`urc_web ${privilege.slice(6).toUpperCase()} denial is absent on ${name}`);
        }
      }
    }
    if (requirement.kind === 'm' && relation.populated !== true) {
      problems.push(`required materialized view ${name} is not populated`);
    }
  }

  const columns = new Set(records(evidence.columns).map(item => `${String(item.relation)}.${String(item.name)}`));
  for (const [relation, names] of Object.entries(REQUIRED_COLUMNS)) {
    for (const name of names) {
      if (!columns.has(`${relation}.${name}`)) problems.push(`required live column ${relation}.${name} is missing`);
    }
  }

  const indexes = new Map(records(evidence.indexes).map(item => [String(item.name), item]));
  for (const [name, requirement] of Object.entries(REQUIRED_INDEXES)) {
    const index = indexes.get(name);
    if (!index) {
      problems.push(`required live index ${name} is missing`);
      continue;
    }
    if (index.valid !== true || index.ready !== true) problems.push(`live index ${name} is not valid and ready`);
    if (index.relation !== requirement.relation) {
      problems.push(`live index ${name} is attached to ${String(index.relation)}, expected ${requirement.relation}`);
    }
    const definition = normalized(index.definition);
    for (const fragment of requirement.fragments) {
      if (!definition.includes(normalized(fragment))) problems.push(`live index ${name} lacks contract fragment: ${fragment}`);
    }
  }

  const views = new Map(records(evidence.views).map(item => [String(item.name), item]));
  for (const [name, fragments] of Object.entries(REQUIRED_VIEW_FRAGMENTS)) {
    const view = views.get(name);
    if (!view) {
      problems.push(`required live view definition ${name} is missing`);
      continue;
    }
    const definition = normalized(view.definition);
    for (const fragment of fragments) {
      if (!definition.includes(normalized(fragment))) problems.push(`live view ${name} lacks contract fragment: ${fragment}`);
    }
  }

  const functionRows = records(evidence.functions);
  const functions = new Map(functionRows.map(item => [functionKey(item), item]));
  const functionRequirements = new Map(FUNCTION_REQUIREMENTS.map(item => [expectedFunctionKey(item), item]));
  const seenFunctionKeys = new Set<string>();
  for (const fn of functionRows) {
    const key = functionKey(fn);
    if (!/^urc_[a-z0-9_]+\([^)]*\)$/.test(key)) {
      problems.push(`live function inventory contains invalid identity ${key || '(missing)'}`);
      continue;
    }
    if (seenFunctionKeys.has(key)) problems.push(`live function inventory duplicates ${key}`);
    seenFunctionKeys.add(key);
    if (fn.authenticatedExecute !== false) {
      problems.push(`live function ${key} authenticated EXECUTE is ${String(fn.authenticatedExecute)}, expected false`);
    }
    if (functionRequirements.has(key)) continue;
    if (fn.anonExecute !== false) problems.push(`unexpected live function ${key} is executable by anon`);
    if (fn.urcWebExecute !== false) problems.push(`unexpected live function ${key} is executable by urc_web`);
    if (fn.securityDefiner !== false) problems.push(`unexpected live function ${key} is SECURITY DEFINER`);
  }
  for (const requirement of FUNCTION_REQUIREMENTS) {
    const key = expectedFunctionKey(requirement);
    const fn = functions.get(key);
    if (!fn) {
      problems.push(`required live function ${key} is missing`);
      continue;
    }
    if (fn.anonExecute !== requirement.anonExecute) {
      problems.push(`live function ${key} anon EXECUTE is ${String(fn.anonExecute)}, expected ${requirement.anonExecute}`);
    }
    if (fn.authenticatedExecute !== false) {
      problems.push(`live function ${key} authenticated EXECUTE is ${String(fn.authenticatedExecute)}, expected false`);
    }
    if (urcWebRolePresent && fn.urcWebExecute !== requirement.anonExecute) {
      problems.push(
        `live function ${key} urc_web EXECUTE is ${String(fn.urcWebExecute)}, expected ${requirement.anonExecute}`
      );
    }
    if (fn.serviceExecute !== requirement.serviceExecute) {
      problems.push(`live function ${key} service-role EXECUTE is ${String(fn.serviceExecute)}, expected ${requirement.serviceExecute}`);
    }
    const expectedSecurityDefiner = requirement.securityDefiner ?? false;
    if (fn.securityDefiner !== expectedSecurityDefiner) {
      problems.push(`live function ${key} security-definer is ${String(fn.securityDefiner)}, expected ${expectedSecurityDefiner}`);
    }
    const config = Array.isArray(fn.config) ? fn.config.map(String) : [];
    if (!config.map(normalized).includes(normalized(requirement.searchPath))) {
      problems.push(`live function ${key} lacks pinned ${requirement.searchPath}`);
    }
    if (requirement.anonExecute && config.some(setting => normalized(setting).startsWith('statement_timeout='))) {
      problems.push(`live public read function ${key} overrides the role statement timeout`);
    }
    const definition = normalized(fn.definition);
    for (const fragment of requirement.definitionFragments || []) {
      if (!definition.includes(normalized(fragment))) {
        problems.push(`live function ${key} lacks contract fragment: ${fragment}`);
      }
    }
  }

  const anon = record(rolesEvidence.find(item => item.name === 'anon'));
  const anonConfig = Array.isArray(anon?.config) ? anon.config.map(normalized) : [];
  if (!anon || !anonConfig.includes('statement_timeout=20s')) {
    problems.push('live anon role lacks the bounded statement_timeout=20s contract');
  }

  const policies = records(evidence.policies);
  for (const [relationName, requirement] of Object.entries(REQUIRED_RELATIONS)) {
    if (!requirement.rls) continue;
    const hasPublicReadPolicy = policies.some(policy => {
      if (policy.relation !== relationName) return false;
      if (normalized(policy.permissive) !== 'permissive') return false;
      if (!['select', 'all'].includes(normalized(policy.command))) return false;
      const roles = Array.isArray(policy.roles) ? policy.roles.map(normalized) : [];
      if (!roles.includes('anon') && !roles.includes('public')) return false;
      return ['true', '(true)'].includes(normalized(policy.qual));
    });
    if (!hasPublicReadPolicy) {
      problems.push(`live RLS table ${relationName} lacks an unconditional permissive anon SELECT policy`);
    }
  }

  const extensions = new Set(records(evidence.extensions).map(item => String(item.name)));
  if (!extensions.has('pg_trgm')) problems.push('required pg_trgm extension is missing');

  return problems;
}

async function main() {
  const out = arg('--out') || 'schema-contract-report.json';
  const expected: ExpectedSchemaIdentity = {
    schemaVersion: arg('--expect-schema') || process.env.EXPECTED_SCHEMA_VERSION || '',
    schemaMigrationCount: Number(arg('--expect-migration-count') || process.env.EXPECTED_SCHEMA_MIGRATION_COUNT),
    schemaChainChecksum: (arg('--expect-schema-checksum') || process.env.EXPECTED_SCHEMA_CHAIN_CHECKSUM || '').toLowerCase(),
    schemaChecksumAlgorithm: arg('--expect-checksum-algorithm') || process.env.EXPECTED_SCHEMA_CHECKSUM_ALGORITHM || '',
  };
  const evidencePath = arg('--evidence');
  const rawUrl = process.env.URC_SUPABASE_URL?.trim() || '';
  const url = normalizeSupabaseOrigin(rawUrl) || '';
  const serviceKey = (process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim() || '';
  const problems: string[] = [];

  if (!evidencePath && (!url || !url.startsWith('https://'))) {
    problems.push('URC_SUPABASE_URL must be an HTTPS origin without credentials, path, query, or fragment');
  }
  if (!evidencePath && !serviceKey) problems.push('URC_SUPABASE_SERVICE_KEY is required for the service-only live contract probe');
  if (!/^\d{3,}$/.test(expected.schemaVersion)) problems.push('expected schema version is invalid');
  if (!Number.isInteger(expected.schemaMigrationCount) || expected.schemaMigrationCount < 1) {
    problems.push('expected schema migration count is invalid');
  }
  if (!/^[0-9a-f]{64}$/.test(expected.schemaChainChecksum)) problems.push('expected schema checksum is invalid');
  if (expected.schemaChecksumAlgorithm !== 'sha256-v2') problems.push('expected checksum algorithm must be sha256-v2');

  let evidence: JsonRecord | null = null;
  if (problems.length === 0) {
    if (evidencePath) {
      try {
        const parsed = JSON.parse(readFileSync(evidencePath, 'utf8')) as unknown;
        evidence = record(record(parsed)?.evidence) || record(parsed);
      } catch (error) {
        problems.push(`schema contract evidence file failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      try {
        const db = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }),
          },
        });
        const { data, error } = await db.rpc('urc_schema_contract_evidence');
        if (error) problems.push(`live schema contract RPC failed: ${error.message}`);
        else evidence = record(data);
      } catch (error) {
        problems.push(`live schema contract probe failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (evidence) problems.push(...assessSchemaContractEvidence(evidence, expected));
  else if (problems.length === 0) problems.push('live schema contract RPC returned no evidence object');

  const limitations = [
    'This proves selected live catalog, ACL, index, and function-definition contracts at probe time; it does not prove that every historical migration executed byte-for-byte.',
    'This does not attest corpus completeness, data freshness, query-plan choice, or production latency; separate accuracy and performance suites cover those dimensions.',
  ];
  const report = {
    generatedAt: new Date().toISOString(),
    expected,
    databaseFingerprint: evidencePath ? null : supabaseOriginFingerprint(url),
    observedEvidenceSha256: evidence
      ? schemaEvidenceSha256(evidence)
      : null,
    evidence,
    limitations,
    problems,
    pass: problems.length === 0,
  };
  writeFileSync(out, JSON.stringify(report, null, 2));
  process.stdout.write(`Live schema contract evidence → ${out}\n`);
  for (const problem of problems) process.stderr.write(`  ✗ ${problem}\n`);
  if (problems.length > 0) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`schema contract probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
