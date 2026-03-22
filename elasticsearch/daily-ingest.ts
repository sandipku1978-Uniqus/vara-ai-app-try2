/**
 * Daily incremental ingestion — indexes filings from the last N days.
 *
 * Usage:
 *   npx tsx elasticsearch/daily-ingest.ts          # Last 2 days (default)
 *   npx tsx elasticsearch/daily-ingest.ts --since 7  # Last 7 days
 *
 * Designed to run as a daily cron job.
 */

// Re-export the main ingest script with --since default
const days = process.argv.includes('--since')
  ? process.argv[process.argv.indexOf('--since') + 1]
  : '2';

// Inject --since if not already present
if (!process.argv.includes('--since')) {
  process.argv.push('--since', days);
}

import('./ingest.js');
