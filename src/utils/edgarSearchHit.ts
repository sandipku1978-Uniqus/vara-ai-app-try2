import type { EdgarSearchHit } from '../services/secApi';

/**
 * Framework-neutral EDGAR hit parsing. It used to live beside the
 * `useEdgarSearch` hook, a 'use client' module — which made every service that
 * mapped a hit (filingResearch) unusable from a route handler, where a client
 * module's exports become client references that throw when called. The hook
 * re-exports this function so existing imports keep working.
 */
function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

function resolvePrimaryDocument(hit: EdgarSearchHit, src: EdgarSearchHit['_source']): string {
  if (src?.primary_document) {
    return src.primary_document;
  }

  const idParts = hit._id.split(':');
  if (idParts.length > 2) {
    return idParts.slice(2).join(':').replace(/_/g, '/');
  }

  if (idParts.length > 1) {
    return idParts[1];
  }

  return '';
}

/**
 * Parse a standard EDGAR search hit into a normalized filing object.
 */
export function parseSearchHit(hit: EdgarSearchHit) {
  const src = hit._source;
  const entityName = (src?.display_names?.[0] || src?.entity_name || '').replace(/\s*\(CIK\s+\d+\)/, '').trim();
  const filingFormType = src?.form || src?.root_forms?.[0] || src?.file_type || '';
  const documentType = src?.file_type || filingFormType || '';
  return {
    entityName,
    fileDate: src?.file_date || '',
    formType: filingFormType,
    documentType,
    accessionNumber: src?.adsh || '',
    cik: firstString(src?.ciks).replace(/^0+/, ''),
    primaryDocument: resolvePrimaryDocument(hit, src),
    description: src?.file_description || documentType || '',
  };
}
