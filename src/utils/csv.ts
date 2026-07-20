export interface CsvColumn {
  key: string;
  label?: string;
  header?: string;
}

/** Encode a cell as inert CSV text, including in spreadsheet applications. */
export function escapeCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value).replace(/\0/g, '');
  if (/^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsvRows(rows: readonly (readonly unknown[])[]): string {
  return rows.map(row => row.map(escapeCsvCell).join(',')).join('\r\n');
}

export function buildCsv<T>(data: readonly T[], columns: readonly CsvColumn[]): string {
  const header = columns.map(column => escapeCsvCell(column.label || column.header || column.key));
  const rows = data.map(row => columns.map(column => (
    escapeCsvCell((row as Record<string, unknown>)[column.key])
  )));
  return [header.join(','), ...rows.map(row => row.join(','))].join('\r\n');
}
