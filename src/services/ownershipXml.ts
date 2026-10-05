/** Server-only, pure ownership XML parsing. Never resolves external entities. */
import { parseHTML } from 'linkedom';
import { isValidIsoDate } from '../lib/api-query';

export interface InsiderOwner { name: string | null; cik: string | null }
export interface InsiderRelationship {
  isDirector: boolean | null;
  isOfficer: boolean | null;
  isTenPercentOwner: boolean | null;
  isOther: boolean | null;
  officerTitle: string | null;
}
export interface OwnershipTransaction {
  reportingOwner: InsiderOwner;
  relationship: InsiderRelationship;
  jointFiling: boolean;
  security: string | null;
  derivative: boolean;
  transactionDate: string | null;
  code: string | null;
  acquiredDisposed: 'A' | 'D' | null;
  shares: number | null;
  pricePerShare: number | null;
  sharesOwnedAfter: number | null;
  direct: boolean | null;
  natureOfOwnership: string | null;
  footnoteIds: string[];
  underlyingSecurity?: string | null;
  underlyingShares?: number | null;
  exercisePrice?: number | null;
}
export interface ParsedOwnershipXml {
  issuer: { cik: string | null; name: string | null; tradingSymbol: string | null };
  formType: string;
  reportingOwners: Array<{ owner: InsiderOwner; relationship: InsiderRelationship }>;
  transactions: OwnershipTransaction[];
  holdingsRowsSkipped: number;
}

export class OwnershipXmlError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

function text(node: Element, selector: string): string | null {
  return node.querySelector(selector)?.textContent?.trim() || null;
}
function value(node: Element, tag: string): string | null { return text(node, `${tag} > value`); }
function number(node: Element, tag: string): number | null {
  const raw = value(node, tag);
  if (raw === null) return null; // A footnote alone is not a numeric disclosure.
  const normalized = raw.replace(/,/g, '');
  if (!/^[+-]?(?:(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(Number(normalized))) {
    throw new OwnershipXmlError(`invalid-number:${tag}`);
  }
  return Number(normalized);
}
function flag(node: Element, tag: string): boolean | null {
  const raw = text(node, tag)?.toLowerCase();
  if (raw === undefined) return null;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new OwnershipXmlError(`invalid-flag:${tag}`);
}
function cik(raw: string | null): string | null {
  if (raw === null) return null;
  if (!/^\d{1,10}$/.test(raw) || Number(raw) === 0) throw new OwnershipXmlError('invalid-owner-or-issuer-cik');
  return String(Number(raw));
}

/** linkedom's HTML parser is tolerant; reject truncated/unbalanced XML before
 * parsing so parse failure cannot masquerade as an omitted numeric disclosure. */
function assertBalancedXml(xml: string): void {
  const stack: string[] = [];
  const tags = xml.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<[^>]*>/g) ?? [];
  for (const token of tags) {
    if (/^<\?|^<!--|^<!\[CDATA\[/.test(token)) continue;
    if (token.startsWith('<!')) throw new OwnershipXmlError('unsupported-xml-declaration');
    const match = token.match(/^<(\/?)\s*([\w:.-]+)/);
    if (!match) throw new OwnershipXmlError('malformed-ownership-xml');
    if (match[1]) {
      if (stack.pop() !== match[2]) throw new OwnershipXmlError('malformed-ownership-xml');
    } else if (!/\/\s*>$/.test(token)) stack.push(match[2]);
  }
  if (stack.length) throw new OwnershipXmlError('malformed-ownership-xml');
}

export function parseOwnershipXml(xml: string): ParsedOwnershipXml {
  if (!/<ownershipDocument(?:\s|>)/i.test(xml)) throw new OwnershipXmlError('not-ownership-xml');
  const { document } = parseHTML(xml);
  const root = document.documentElement;
  if (root?.tagName.toLowerCase() !== 'ownershipdocument') throw new OwnershipXmlError('not-ownership-xml');
  assertBalancedXml(xml);
  const formType = text(root, 'documentType');
  if (!formType || !/^[345](?:\/A)?$/.test(formType)) throw new OwnershipXmlError('invalid-ownership-form');
  const reportingOwners = Array.from(root.querySelectorAll('reportingOwner')).map(node => {
    const owner = { name: text(node, 'rptOwnerName'), cik: cik(text(node, 'rptOwnerCik')) };
    if (!owner.name && !owner.cik) throw new OwnershipXmlError('missing-reporting-owner');
    return { owner, relationship: {
      isDirector: flag(node, 'isDirector'), isOfficer: flag(node, 'isOfficer'),
      isTenPercentOwner: flag(node, 'isTenPercentOwner'), isOther: flag(node, 'isOther'),
      officerTitle: text(node, 'officerTitle'),
    } };
  });
  if (!reportingOwners.length) throw new OwnershipXmlError('missing-reporting-owner');
  const issuer = { cik: cik(text(root, 'issuerCik')), name: text(root, 'issuerName'), tradingSymbol: text(root, 'issuerTradingSymbol') };
  if (!issuer.cik || !issuer.name) throw new OwnershipXmlError('missing-issuer');
  const transactions: OwnershipTransaction[] = [];
  for (const node of Array.from(root.querySelectorAll('nonDerivativeTransaction, derivativeTransaction'))) {
    const derivative = node.tagName.toLowerCase() === 'derivativetransaction';
    const transactionDate = value(node, 'transactionDate');
    if (transactionDate !== null && !isValidIsoDate(transactionDate)) throw new OwnershipXmlError('invalid-transaction-date');
    const ad = value(node, 'transactionAcquiredDisposedCode');
    const di = value(node, 'directOrIndirectOwnership');
    if (ad !== null && ad !== 'A' && ad !== 'D') throw new OwnershipXmlError('invalid-acquired-disposed');
    if (di !== null && di !== 'D' && di !== 'I') throw new OwnershipXmlError('invalid-direct-indirect');
    const common = {
      security: value(node, 'securityTitle'), derivative, transactionDate,
      code: text(node, 'transactionCode'), acquiredDisposed: ad as 'A' | 'D' | null,
      shares: number(node, 'transactionShares'), pricePerShare: number(node, 'transactionPricePerShare'),
      sharesOwnedAfter: number(node, 'sharesOwnedFollowingTransaction'),
      direct: di === null ? null : di === 'D', natureOfOwnership: value(node, 'natureOfOwnership'),
      footnoteIds: [...new Set(Array.from(node.querySelectorAll('footnoteId')).map(n => n.getAttribute('id')).filter((id): id is string => Boolean(id)))],
      ...(derivative ? {
        underlyingSecurity: value(node, 'underlyingSecurityTitle'), underlyingShares: number(node, 'underlyingSecurityShares'),
        exercisePrice: number(node, 'conversionOrExercisePrice'),
      } : {}),
    };
    // Joint filings deliberately repeat each transaction for EVERY owner. These
    // rows describe reported ownership, not independently additive issuer trades.
    for (const { owner, relationship } of reportingOwners) {
      transactions.push({ ...common, reportingOwner: owner, relationship, jointFiling: reportingOwners.length > 1 });
    }
  }
  return { issuer, formType, reportingOwners, transactions,
    holdingsRowsSkipped: root.querySelectorAll('nonDerivativeHolding, derivativeHolding').length };
}
