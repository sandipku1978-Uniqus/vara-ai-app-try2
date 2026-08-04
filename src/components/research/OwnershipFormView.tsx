import type { OwnershipDocument, OwnershipTransaction } from '../../utils/ownershipForm';
import { describeTransactionCode } from '../../utils/ownershipForm';

/**
 * Inline rendering for Forms 3/4/5 (ownership documents). These filings are
 * XML-only in the archive, so the embedded HTML viewer has nothing to show —
 * the app used to dead-end on "cannot be previewed inline" and link to raw
 * XML. The parsed table IS the filing's content; the SEC-rendered view stays
 * one click away as the official source.
 */

function formatShares(raw: string): string {
  if (!raw) return '—';
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : raw;
}

function formatPrice(raw: string): string {
  if (!raw) return '—';
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? `$${numeric.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : raw;
}

function FootnoteRefs({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <sup style={{ color: 'var(--text-muted)' }}>
      {' '}({ids.map(id => id.replace(/^F/, '')).join(',')})
    </sup>
  );
}

function TransactionTable({ rows, derivative, caption }: { rows: OwnershipTransaction[]; derivative: boolean; caption: string }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
      <table className="ownership-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <caption style={{ textAlign: 'left', fontWeight: 600, padding: '6px 0', color: 'var(--text-primary)' }}>{caption}</caption>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--input-border)', color: 'var(--text-muted)', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px' }}>Security</th>
            <th style={{ padding: '6px 8px' }}>Date</th>
            <th style={{ padding: '6px 8px' }}>Transaction</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Shares</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Price</th>
            <th style={{ padding: '6px 8px' }}>A/D</th>
            <th style={{ padding: '6px 8px', textAlign: 'right' }}>Owned after</th>
            <th style={{ padding: '6px 8px' }}>Ownership</th>
            {derivative && <th style={{ padding: '6px 8px' }}>Exercise / expiry</th>}
            {derivative && <th style={{ padding: '6px 8px' }}>Underlying</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const codeLabel = describeTransactionCode(row.code);
            return (
              <tr key={index} style={{ borderBottom: '1px solid var(--input-border)' }}>
                <td style={{ padding: '6px 8px' }}>{row.securityTitle || '—'}<FootnoteRefs ids={row.footnoteIds} /></td>
                <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{row.transactionDate || '—'}</td>
                <td style={{ padding: '6px 8px' }}>
                  {row.code ? <strong>{row.code}</strong> : '—'}
                  {codeLabel ? <span style={{ color: 'var(--text-muted)' }}> · {codeLabel}</span> : null}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatShares(row.shares)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatPrice(row.pricePerShare)}</td>
                <td style={{ padding: '6px 8px' }}>{row.acquiredDisposed === 'A' ? 'Acquired' : row.acquiredDisposed === 'D' ? 'Disposed' : '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{formatShares(row.sharesOwnedAfter)}</td>
                <td style={{ padding: '6px 8px' }}>
                  {row.ownershipForm === 'D' ? 'Direct' : row.ownershipForm === 'I' ? 'Indirect' : '—'}
                  {row.natureOfOwnership ? <span style={{ color: 'var(--text-muted)' }}> · {row.natureOfOwnership}</span> : null}
                </td>
                {derivative && (
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {[row.exercisePrice ? `@ ${formatPrice(row.exercisePrice)}` : '', row.exerciseDate, row.expirationDate ? `→ ${row.expirationDate}` : '']
                      .filter(Boolean).join(' ') || '—'}
                  </td>
                )}
                {derivative && (
                  <td style={{ padding: '6px 8px' }}>
                    {row.underlyingTitle || '—'}
                    {row.underlyingShares ? ` (${formatShares(row.underlyingShares)})` : ''}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function OwnershipFormView({ document: form }: { document: OwnershipDocument }) {
  const formLabel = form.documentType ? `Form ${form.documentType}` : 'Ownership form';
  return (
    <div className="ownership-form-view" style={{ padding: '16px 20px', overflowY: 'auto' }}>
      <div style={{ marginBottom: '14px' }}>
        <h3 style={{ margin: '0 0 4px' }}>
          {formLabel} — {form.issuerName || 'Unknown issuer'}
          {form.issuerTradingSymbol ? ` (${form.issuerTradingSymbol})` : ''}
        </h3>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          Period: {form.periodOfReport || '—'} · Issuer CIK {form.issuerCik || '—'}
        </div>
      </div>

      {form.reportingOwners.map((owner, index) => {
        const roles = [
          owner.isDirector ? 'Director' : '',
          owner.isOfficer ? (owner.officerTitle ? `Officer — ${owner.officerTitle}` : 'Officer') : '',
          owner.isTenPercentOwner ? '10% owner' : '',
          owner.isOther ? 'Other' : '',
        ].filter(Boolean).join(' · ');
        return (
          <div key={index} style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
            <strong>{owner.name || 'Reporting person'}</strong>
            {owner.location ? <span style={{ color: 'var(--text-muted)' }}> — {owner.location}</span> : null}
            {roles ? <div style={{ color: 'var(--text-secondary)' }}>{roles}</div> : null}
          </div>
        );
      })}

      <TransactionTable rows={form.nonDerivative} derivative={false} caption="Table I — Non-derivative securities" />
      <TransactionTable rows={form.derivative} derivative caption="Table II — Derivative securities" />

      {form.footnotes.length > 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Footnotes</strong>
          <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {form.footnotes.map(note => (
              <li key={note.id} style={{ marginBottom: '4px' }}>{note.text}</li>
            ))}
          </ol>
        </div>
      )}
      {form.remarks && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Remarks:</strong> {form.remarks}
        </p>
      )}
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '12px' }}>
        Rendered from the filing&apos;s ownership XML. Verify against the official SEC rendering via “View on SEC.gov”.
      </p>
    </div>
  );
}
