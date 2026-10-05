/**
 * Rebuild src/data/fasb/asu-index-snapshot.json — the saved copy the ASU
 * index serves when fasb.org refuses the server (Cloudflare bot protection
 * blocks non-browser clients, including Vercel functions).
 *
 * The inputs are the three FASB listing payloads, saved from a normal browser
 * session on fasb.org (the API allows cross-origin reads, so a fetch from the
 * browser console against these URLs returns the JSON):
 *
 *   issued.json     https://api.fasb.org/api/pagination/22/394009/1/100/All/NONE/NONE
 *   effective.json  https://api.fasb.org/api/pagination/22/394105/1/100/All/Type/ASU-Effective%20Dates
 *   proposed.json   https://api.fasb.org/api/pagination/22/393996/1/100/All/NONE/NONE
 *
 * Usage: npx tsx scripts/fasb/build-asu-snapshot.ts <dir-with-the-three-files> <read-at-iso>
 *
 * The snapshot stores what the parser read from each page plus its record
 * counts, so the index can say exactly what a saved copy covers and when it
 * was read.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  parseEffectiveDates,
  parseIssuedListing,
  parseProposedListing,
  type AsuSnapshot,
} from '../../src/services/asuIndex';

const [dir, readAt] = process.argv.slice(2);
if (!dir || !readAt || Number.isNaN(Date.parse(readAt))) {
  console.error('Usage: npx tsx scripts/fasb/build-asu-snapshot.ts <dir> <read-at-iso>');
  process.exit(1);
}

const load = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), 'utf8'));

const snapshot: AsuSnapshot = {
  readAt: new Date(readAt).toISOString(),
  issued: parseIssuedListing(load('issued.json')),
  effective: parseEffectiveDates(load('effective.json')),
  proposed: parseProposedListing(load('proposed.json')),
};

for (const [name, listing] of Object.entries({ issued: snapshot.issued, effective: snapshot.effective, proposed: snapshot.proposed })) {
  if (!listing.complete) {
    console.error(`${name}: read ${listing.recordsRead} of ${listing.totalRecords} records — refusing to save a partial snapshot.`);
    process.exit(1);
  }
}

const out = resolve(process.cwd(), 'src/data/fasb/asu-index-snapshot.json');
writeFileSync(out, `${JSON.stringify(snapshot)}\n`);
console.log(`Wrote ${out}: ${snapshot.issued.records.length} issued, ${snapshot.effective.records.length} with effective dates, ${snapshot.proposed.records.length} proposed.`);
