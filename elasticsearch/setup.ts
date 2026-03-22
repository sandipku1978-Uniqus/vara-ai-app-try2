/**
 * Creates the sec-filings index in Elastic Cloud with the correct mapping.
 *
 * Usage:
 *   npx tsx elasticsearch/setup.ts
 *
 * Requires ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY env vars.
 */

import { createElasticClient, ES_INDEX } from './config.js';

const MAPPING = {
  settings: {
    number_of_shards: 2,
    number_of_replicas: 1,
    analysis: {
      analyzer: {
        filing_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'stop', 'snowball'],
        },
      },
    },
    'index.max_result_window': 50000,
  },
  mappings: {
    properties: {
      // ── Core identifiers ──
      cik: { type: 'keyword' },
      ciks: { type: 'keyword' },
      adsh: { type: 'keyword' },
      file_num: { type: 'keyword' },
      primary_document: { type: 'keyword' },

      // ── Company info ──
      entity_name: {
        type: 'text',
        analyzer: 'filing_analyzer',
        fields: { keyword: { type: 'keyword' } },
      },
      display_names: {
        type: 'text',
        analyzer: 'filing_analyzer',
        fields: { keyword: { type: 'keyword' } },
      },
      tickers: { type: 'keyword' },

      // ── Filing metadata ──
      form: { type: 'keyword' },
      root_forms: { type: 'keyword' },
      file_type: { type: 'keyword' },
      file_date: { type: 'date', format: 'yyyy-MM-dd' },
      file_description: {
        type: 'text',
        analyzer: 'filing_analyzer',
      },

      // ── Classification ──
      sics: { type: 'keyword' },
      sic_description: {
        type: 'text',
        fields: { keyword: { type: 'keyword' } },
      },
      inc_states: { type: 'keyword' },
      biz_locations: { type: 'keyword' },
      exchange: { type: 'keyword' },
      state_of_incorporation: { type: 'keyword' },
      fiscal_year_end: { type: 'keyword' },

      // ── Pre-extracted signals (indexed at ingestion time) ──
      auditor: { type: 'keyword' },
      accelerated_status: { type: 'keyword' },

      // ── Full-text content ──
      content: {
        type: 'text',
        analyzer: 'filing_analyzer',
        index_options: 'offsets', // enables highlighting
      },

      // ── Ingestion tracking ──
      indexed_at: { type: 'date' },
    },
  },
};

async function main() {
  const client = createElasticClient();

  console.log(`Checking if index "${ES_INDEX}" exists...`);
  const exists = await client.indices.exists({ index: ES_INDEX });

  if (exists) {
    console.log(`Index "${ES_INDEX}" already exists.`);
    const response = await client.cat.indices({ index: ES_INDEX, format: 'json' });
    const info = response[0];
    console.log(`  Docs: ${info?.['docs.count'] || 'unknown'}`);
    console.log(`  Size: ${info?.['store.size'] || 'unknown'}`);
    console.log('\nTo recreate, delete the index first:');
    console.log(`  curl -X DELETE "$ELASTICSEARCH_URL/${ES_INDEX}" -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY"`);
    return;
  }

  console.log(`Creating index "${ES_INDEX}"...`);
  await client.indices.create({
    index: ES_INDEX,
    ...MAPPING,
  });

  console.log(`Index "${ES_INDEX}" created successfully.`);
  console.log('\nMapping summary:');
  console.log('  - content: full-text filing body (analyzed with snowball stemming)');
  console.log('  - auditor: pre-extracted at index time (keyword, instant filtering)');
  console.log('  - accelerated_status: pre-extracted at index time (keyword)');
  console.log('  - form, sics, cik, exchange: keyword fields for exact filtering');
  console.log('  - file_date: date field for range queries');
  console.log('  - max_result_window: 50,000 (allows deep pagination)');
  console.log('\nNext step: run the ingestion pipeline:');
  console.log('  npx tsx elasticsearch/ingest.ts');
}

main().catch(error => {
  console.error('Setup failed:', error.message || error);
  process.exit(1);
});
