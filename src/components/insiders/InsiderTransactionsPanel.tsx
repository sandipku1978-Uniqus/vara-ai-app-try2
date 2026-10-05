'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import DataTable, { type ColumnDef } from '../tables/DataTable';
import ResultsToolbar from '../tables/ResultsToolbar';
import CiteButton from '../memo/CiteButton';
import { passageKey } from '../../services/memoTray';
import type { InsiderTransactionsResult } from '../../services/insiderTransactions';
import {
  NOT_REPORTED,
  insiderCoverageLine,
  toOwnerRows,
  toTransactionRows,
  type InsiderOwnerRow,
  type InsiderTransactionRow,
} from './insiderFormat';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; result: InsiderTransactionsResult };

function formatReadAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function transactionExcerpt(row: InsiderTransactionRow): string {
  return `${row.owner} (${row.relationship}): ${row.code}; ${row.acquiredDisposed} ${row.sharesText} shares of ${row.security} `
    + `on ${row.date} at ${row.priceText}; owned after ${row.ownedAfterText} (${row.ownership}). Form ${row.form} filed ${row.filedAt}, accession ${row.accession}.`;
}

const noteStyle: React.CSSProperties = { color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.5, margin: '0 0 8px' };

/**
 * Flat Form 3/4/5 transaction table for one issuer, read from
 * GET /api/insiders/transactions. Shared by the Insiders page and the company
 * dossier so both state the same coverage.
 */
export default function InsiderTransactionsPanel({ cik, companyLabel }: { cik: string | number; companyLabel: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    fetch(`/api/insiders/transactions?cik=${encodeURIComponent(String(cik))}`, { signal: controller.signal })
      .then(async response => {
        const payload = await response.json().catch(() => null) as (InsiderTransactionsResult & { error?: string }) | null;
        if (!response.ok || !payload || !Array.isArray(payload.transactions)) {
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }
        setState({ status: 'ready', result: payload });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({
          status: 'error',
          message: `SEC insider transactions could not be read for ${companyLabel}${error instanceof Error && error.message ? ` (${error.message})` : ''}.`,
        });
      });
    return () => controller.abort();
  }, [cik, companyLabel, reloadKey]);

  const retry = useCallback(() => setReloadKey(key => key + 1), []);

  const result = state.status === 'ready' ? state.result : null;
  const transactionRows = useMemo(() => (result ? toTransactionRows(result.cik, result.transactions) : []), [result]);
  const ownerRows = useMemo(() => (result ? toOwnerRows(result.owners) : []), [result]);
  const issuerName = result?.issuer.name || companyLabel;

  const transactionColumns: ColumnDef<InsiderTransactionRow>[] = [
    { key: 'date', header: 'Date', sortable: true },
    { key: 'owner', header: 'Owner', sortable: true },
    { key: 'relationship', header: 'Relationship', sortable: true },
    { key: 'security', header: 'Security', sortable: true },
    { key: 'code', header: 'Code', sortable: true },
    { key: 'acquiredDisposed', header: 'A/D', sortable: true },
    { key: 'shares', header: 'Shares', align: 'right', sortable: true, render: row => row.sharesText },
    { key: 'price', header: 'Price', align: 'right', sortable: true, render: row => row.priceText },
    { key: 'ownedAfter', header: 'Owned after', align: 'right', sortable: true, render: row => row.ownedAfterText },
    { key: 'ownership', header: 'Direct/indirect', sortable: true },
    {
      key: 'filingUrl', header: 'Filing', render: row => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
          <a
            href={row.filingUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View Form ${row.form} filed ${row.filedAt} (accession ${row.accession}) on SEC.gov`}
            style={{ color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            Form {row.form} · {row.filedAt} <ExternalLink size={12} aria-hidden="true" />
          </a>
          <CiteButton
            compact
            citation={{
              kind: 'filing',
              cik: result?.cik ?? String(cik),
              accessionNumber: row.accession,
              company: issuerName,
              form: row.form,
              fileDate: row.filedAt,
              section: 'Insider transaction',
              passageKey: passageKey(transactionExcerpt(row)),
              excerpt: transactionExcerpt(row),
              sourceUrl: row.filingUrl,
            }}
          />
        </span>
      ),
    },
  ];

  const transactionExport = useMemo(() => transactionRows.map(row => ({
    date: row.date,
    owner: row.owner,
    relationship: row.relationship,
    security: row.security,
    code: row.code,
    acquiredDisposed: row.acquiredDisposed,
    shares: row.shares ?? NOT_REPORTED,
    price: row.price ?? NOT_REPORTED,
    ownedAfter: row.ownedAfter ?? NOT_REPORTED,
    ownership: row.ownership,
    form: row.form,
    filedAt: row.filedAt,
    accession: row.accession,
    filingUrl: row.filingUrl,
  })), [transactionRows]);
  const transactionExportColumns = [
    { key: 'date', header: 'Transaction date' },
    { key: 'owner', header: 'Owner' },
    { key: 'relationship', header: 'Relationship' },
    { key: 'security', header: 'Security' },
    { key: 'code', header: 'Code' },
    { key: 'acquiredDisposed', header: 'Acquired/disposed' },
    { key: 'shares', header: 'Shares' },
    { key: 'price', header: 'Price per share' },
    { key: 'ownedAfter', header: 'Owned after' },
    { key: 'ownership', header: 'Direct/indirect' },
    { key: 'form', header: 'Form' },
    { key: 'filedAt', header: 'Filed' },
    { key: 'accession', header: 'Accession' },
    { key: 'filingUrl', header: 'SEC filing URL' },
  ];

  const ownerColumns: ColumnDef<InsiderOwnerRow>[] = [
    { key: 'owner', header: 'Owner', sortable: true },
    { key: 'relationship', header: 'Relationship', sortable: true },
    { key: 'netOpenMarket', header: 'Net open-market shares (P/S)', align: 'right', sortable: true, render: row => row.netOpenMarketText },
    { key: 'netAllCodes', header: 'Net shares, all codes', align: 'right', sortable: true, render: row => row.netAllCodesText },
    { key: 'lastTransaction', header: 'Last transaction', sortable: true },
    { key: 'filingsCount', header: 'Filings', align: 'right', sortable: true },
  ];
  const ownerExport = useMemo(() => ownerRows.map(row => ({
    owner: row.owner,
    relationship: row.relationship,
    netOpenMarket: row.netOpenMarket ?? 'no transactions',
    netAllCodes: row.netAllCodes ?? 'no transactions',
    lastTransaction: row.lastTransaction,
    filingsCount: row.filingsCount,
    transactionsCount: row.transactionsCount,
    rowsWithoutShares: row.rowsWithoutShares,
  })), [ownerRows]);
  const ownerExportColumns = [
    { key: 'owner', header: 'Owner' },
    { key: 'relationship', header: 'Relationship' },
    { key: 'netOpenMarket', header: 'Net open-market shares (P/S)' },
    { key: 'netAllCodes', header: 'Net shares, all codes' },
    { key: 'lastTransaction', header: 'Last transaction' },
    { key: 'filingsCount', header: 'Filings' },
    { key: 'transactionsCount', header: 'Transactions' },
    { key: 'rowsWithoutShares', header: 'Rows without shares' },
  ];

  if (state.status === 'loading') {
    return (
      <div role="status" style={{ textAlign: 'center', padding: '28px 16px', color: 'var(--text-muted)' }}>
        <Loader2 size={20} className="spinner" style={{ marginBottom: '6px' }} aria-hidden="true" />
        <div>Reading Form 3/4/5 ownership filings for {companyLabel} from SEC…</div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div role="alert" style={{ padding: '16px', color: 'var(--status-error)', background: 'var(--status-error-bg)', border: '1px solid color-mix(in srgb, var(--status-error) 35%, var(--border-color))', borderRadius: '4px' }}>
        <p style={{ margin: '0 0 8px' }}>{state.message}</p>
        <button type="button" className="secondary-btn" onClick={retry}>Retry insider transactions</button>
      </div>
    );
  }

  const { coverage } = state.result;
  return (
    <section aria-label={`Insider transactions for ${issuerName}`}>
      <div data-testid="insider-coverage" style={{ padding: '8px 12px', marginBottom: '12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--surface-subtle)' }}>
        <p style={noteStyle}>
          <strong>Source:</strong> SEC submissions (recent filings window) and each filing&apos;s ownership XML, read {formatReadAt(coverage.fetchedAt)}.{' '}
          {insiderCoverageLine(coverage)}
          {coverage.newestFiledAt && coverage.oldestFiledAt ? ` Filings requested span ${coverage.oldestFiledAt} to ${coverage.newestFiledAt}.` : ''}
        </p>
        {!coverage.complete && (
          <p style={{ ...noteStyle, color: 'var(--status-warning)' }}>
            Partial: not every requested filing was read, so the tables below omit what the failed or unattempted filings report.
          </p>
        )}
        {coverage.rowsWithoutShares > 0 && (
          <p style={noteStyle}>
            {coverage.rowsWithoutShares.toLocaleString('en-US')} transaction row{coverage.rowsWithoutShares === 1 ? '' : 's'} disclosed no share count and {coverage.rowsWithoutShares === 1 ? 'is' : 'are'} shown as &ldquo;not reported&rdquo;; net figures exclude {coverage.rowsWithoutShares === 1 ? 'it' : 'them'}.
          </p>
        )}
        {coverage.filingsFailed.length > 0 && (
          <details style={noteStyle}>
            <summary>Filings that could not be read ({coverage.filingsFailed.length})</summary>
            <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
              {coverage.filingsFailed.map(failure => (
                <li key={failure.accession}>{failure.accession}: {failure.reason}</li>
              ))}
            </ul>
          </details>
        )}
        {coverage.filingsAboutOtherIssuers.length > 0 && (
          <details style={noteStyle}>
            <summary>Filings about other issuers, excluded ({coverage.filingsAboutOtherIssuers.length})</summary>
            <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
              {coverage.filingsAboutOtherIssuers.map(other => (
                <li key={other.accession}>{other.accession}: {other.issuerName} (CIK {other.issuerCik})</li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <h3 style={{ fontSize: '0.95rem', fontWeight: 650, color: 'var(--text-primary)', margin: '0 0 6px' }}>Owner summary</h3>
      <p style={noteStyle}>{coverage.aggregationNote}</p>
      {ownerRows.length > 0 ? (
        <>
          <ResultsToolbar data={ownerExport} columns={ownerExportColumns} label="insider owner summary" />
          <DataTable columns={ownerColumns} data={ownerRows} pageSize={10} rowKey={row => row.id} />
        </>
      ) : (
        <p style={{ ...noteStyle, color: 'var(--text-muted)' }}>No reporting owners in the parsed filings.</p>
      )}

      <h3 style={{ fontSize: '0.95rem', fontWeight: 650, color: 'var(--text-primary)', margin: '18px 0 6px' }}>Transactions</h3>
      {transactionRows.length > 0 ? (
        <>
          <ResultsToolbar data={transactionExport} columns={transactionExportColumns} label="insider transactions" />
          <DataTable columns={transactionColumns} data={transactionRows} pageSize={25} rowKey={row => row.id} />
        </>
      ) : (
        <p style={{ ...noteStyle, color: 'var(--text-muted)' }}>
          The parsed filings report no transactions (holdings-only Form 3/5 rows are not listed as transactions).
        </p>
      )}
    </section>
  );
}
