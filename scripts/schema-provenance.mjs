#!/usr/bin/env node

/**
 * Compute the repository's canonical database-migration identity.
 *
 * A version number proves only which filename was last. This manifest also
 * binds every migration payload, in order, with SHA-256. A migration carrying
 * its own database stamp would otherwise create a self-referential hash, so
 * exactly its explicitly marked checksum literal is replaced with 64 zeroes
 * in the canonical form. Every other byte — including executable SQL after
 * the stamp marker — remains covered. CRLF is normalized to LF so the
 * identity is stable across checkouts.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKSUM_ALGORITHM = 'sha256-v2';
export const PROVENANCE_MARKER = '-- BEGIN URC PROVENANCE STAMP';
export const CHECKSUM_VALUE_MARKER = '-- URC CHAIN CHECKSUM VALUE';

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonicalMigrationPayload(source) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const stampMarkerCount = normalized.split(PROVENANCE_MARKER).length - 1;
  if (stampMarkerCount === 0) return normalized;
  if (stampMarkerCount !== 1) {
    throw new Error(`migration must contain exactly one ${PROVENANCE_MARKER} marker`);
  }

  const stampMarkerIndex = normalized.indexOf(PROVENANCE_MARKER);
  const checksumMarkerCount = normalized.split(CHECKSUM_VALUE_MARKER).length - 1;
  if (checksumMarkerCount !== 1) {
    throw new Error(`stamped migration must contain exactly one ${CHECKSUM_VALUE_MARKER} marker`);
  }

  const checksumMarkerIndex = normalized.indexOf(CHECKSUM_VALUE_MARKER);
  if (checksumMarkerIndex < stampMarkerIndex) {
    throw new Error(`${CHECKSUM_VALUE_MARKER} must follow ${PROVENANCE_MARKER}`);
  }

  const checksumLiteralPattern = new RegExp(
    `(${CHECKSUM_VALUE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*\\n[ \\t]*')([0-9a-f]{64})(')`,
    'g'
  );
  const matches = [...normalized.matchAll(checksumLiteralPattern)];
  if (matches.length !== 1) {
    throw new Error(`${CHECKSUM_VALUE_MARKER} must be followed by one lowercase 64-character checksum literal`);
  }

  return normalized.replace(checksumLiteralPattern, `$1${'0'.repeat(64)}$3`);
}

export function calculateSchemaProvenance(migrationsDirectory) {
  const files = readdirSync(migrationsDirectory)
    .filter(name => /^\d{3}_.+\.sql$/.test(name))
    .sort();

  if (files.length === 0) {
    throw new Error(`no numbered SQL migrations found in ${migrationsDirectory}`);
  }

  const migrations = files.map(filename => ({
    filename,
    checksum: sha256(canonicalMigrationPayload(readFileSync(resolve(migrationsDirectory, filename), 'utf8'))),
  }));
  const chainMaterial = migrations
    .map(({ filename, checksum }) => `${filename}\t${checksum}\n`)
    .join('');

  return {
    schemaVersion: files.at(-1).slice(0, 3),
    schemaMigrationCount: files.length,
    schemaChainChecksum: sha256(chainMaterial),
    schemaChecksumAlgorithm: CHECKSUM_ALGORITHM,
    migrations,
  };
}

function main() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(scriptDirectory, '..');
  const directoryArgIndex = process.argv.indexOf('--migrations-dir');
  const migrationsDirectory = directoryArgIndex >= 0
    ? resolve(process.argv[directoryArgIndex + 1] ?? '')
    : resolve(repositoryRoot, 'db', 'migrations');
  const provenance = calculateSchemaProvenance(migrationsDirectory);
  const fieldArgIndex = process.argv.indexOf('--field');

  if (fieldArgIndex >= 0) {
    const field = process.argv[fieldArgIndex + 1];
    if (!field || !(field in provenance) || field === 'migrations') {
      throw new Error(`unknown scalar provenance field: ${field ?? '(missing)'}`);
    }
    process.stdout.write(`${provenance[field]}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(provenance, null, 2)}\n`);
}

const invokedDirectly = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
