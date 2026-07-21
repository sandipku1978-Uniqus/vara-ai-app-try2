'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import './DataTable.css';

export interface Column<T> {
  key: string;
  label?: string;
  header?: string;
  render?: (row: T, idx: number) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
}

export type ColumnDef<T> = Column<T>;

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  pageSize?: number;
  emptyMessage?: string;
  rowKey?: (row: T, idx: number) => string;
}

export default function DataTable<T extends Record<string, any>>({
  columns, data, pageSize = 15, emptyMessage = 'No results found.', rowKey
}: DataTableProps<T>) {
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sortCol) return data;
    return [...data].sort((a, b) => {
      const va = a[sortCol] ?? '';
      const vb = b[sortCol] ?? '';
      const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    setPage(0);
  }, [data]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
    setPage(0);
  };

  return (
    <div className="data-table-wrapper">
      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(col => {
                // A render-only column (a link, an action button, a badge)
                // sorts by its raw underlying value — accession, URL, boolean —
                // which is meaningless to a user. Such columns are sortable
                // only when they explicitly opt in; plain data columns stay
                // sortable by default.
                const isSortable = col.sortable === true || (col.sortable === undefined && !col.render);
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={!isSortable || sortCol !== col.key ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending'}
                    style={{ textAlign: col.align || 'left', width: col.width }}
                  >
                    {!isSortable ? (
                      <span className="dt-th-content">{col.label || col.header}</span>
                    ) : (
                      <button type="button" className="dt-sort-button" onClick={() => handleSort(col.key)}>
                        <span>{col.label || col.header}</span>
                        {sortCol === col.key && (
                          sortDir === 'asc' ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />
                        )}
                      </button>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr><td colSpan={columns.length} className="dt-empty">{emptyMessage}</td></tr>
            ) : paged.map((row, idx) => (
              <tr
                key={rowKey ? rowKey(row, page * pageSize + idx) : page * pageSize + idx}
              >
                {columns.map(col => (
                  <td key={col.key} style={{ textAlign: col.align || 'left' }}>
                    {col.render ? col.render(row, page * pageSize + idx) : row[col.key] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="dt-pagination">
          <span className="dt-page-info">
            Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="dt-page-btns">
            <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} aria-hidden="true" /></button>
            <span>Page {page + 1} of {totalPages}</span>
            <button type="button" aria-label="Next page" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} aria-hidden="true" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
