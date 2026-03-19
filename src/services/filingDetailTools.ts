export interface DisclosureDiffSummary {
  currentBlockCount: number;
  previousBlockCount: number;
  retainedCount: number;
  addedCount: number;
  removedCount: number;
  addedBlocks: string[];
  removedBlocks: string[];
}

export interface ExtractedTable {
  title: string;
  rows: string[][];
}

function normalizeBlock(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9%$.,;:()/'"&-]+/gi, ' ')
    .trim();
}

function trimBlock(value: string, maxLength = 420): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function shouldKeepLine(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length < 24) return false;
  return /\s/.test(trimmed);
}

function splitDisclosureBlocks(text: string): string[] {
  const lines = text
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(shouldKeepLine);

  const blocks: string[] = [];
  let buffer = '';

  for (const line of lines) {
    const headingLike = line.length <= 90 && /^[A-Z0-9 .,&()/'"-]+$/.test(line);
    const candidate = buffer ? `${buffer} ${line}` : line;

    if (headingLike && buffer) {
      if (buffer.split(' ').length >= 8) {
        blocks.push(buffer);
      }
      buffer = line;
      continue;
    }

    buffer = candidate;

    if (buffer.length >= 420) {
      if (buffer.split(' ').length >= 8) {
        blocks.push(buffer);
      }
      buffer = '';
    }
  }

  if (buffer && buffer.split(' ').length >= 8) {
    blocks.push(buffer);
  }

  const seen = new Set<string>();
  return blocks.filter(block => {
    const normalized = normalizeBlock(block);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

export function buildDisclosureDiff(currentText: string, previousText: string): DisclosureDiffSummary {
  const currentBlocks = splitDisclosureBlocks(currentText).slice(0, 1800);
  const previousBlocks = splitDisclosureBlocks(previousText).slice(0, 1800);

  const currentMap = new Map(currentBlocks.map(block => [normalizeBlock(block), block]));
  const previousMap = new Map(previousBlocks.map(block => [normalizeBlock(block), block]));

  const addedBlocks = currentBlocks
    .filter(block => !previousMap.has(normalizeBlock(block)))
    .slice(0, 10)
    .map(block => trimBlock(block));

  const removedBlocks = previousBlocks
    .filter(block => !currentMap.has(normalizeBlock(block)))
    .slice(0, 10)
    .map(block => trimBlock(block));

  const retainedCount = currentBlocks.filter(block => previousMap.has(normalizeBlock(block))).length;

  return {
    currentBlockCount: currentBlocks.length,
    previousBlockCount: previousBlocks.length,
    retainedCount,
    addedCount: Math.max(currentBlocks.length - retainedCount, 0),
    removedCount: Math.max(previousBlocks.length - retainedCount, 0),
    addedBlocks,
    removedBlocks,
  };
}

function cleanCellText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function findTableTitle(table: HTMLTableElement, index: number): string {
  const titleCandidates: string[] = [];
  let node: Element | null = table.previousElementSibling;
  let steps = 0;

  while (node && steps < 4) {
    const text = cleanCellText(node.textContent || '');
    if (text.length >= 4 && text.length <= 120) {
      titleCandidates.push(text);
      break;
    }
    node = node.previousElementSibling;
    steps += 1;
  }

  return titleCandidates[0] || `Table ${index + 1}`;
}

export function extractTablesFromHtml(html: string): ExtractedTable[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const tables = Array.from(doc.querySelectorAll('table'));

  return tables
    .map((table, index) => {
      const rows = Array.from(table.querySelectorAll('tr'))
        .map(row =>
          Array.from(row.querySelectorAll('th, td'))
            .map(cell => cleanCellText(cell.textContent || ''))
            .filter((_, cellIndex, array) => cellIndex < array.length)
        )
        .filter(row => row.some(Boolean));

      return {
        title: findTableTitle(table, index),
        rows,
      };
    })
    .filter(table => table.rows.length >= 2 && table.rows.some(row => row.length >= 2));
}

function escapeCsvCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function tablesToCsv(tables: ExtractedTable[]): string {
  return tables
    .flatMap((table, index) => {
      const lines: string[] = [];
      lines.push(escapeCsvCell(`${table.title} (${index + 1}/${tables.length})`));
      table.rows.forEach(row => {
        lines.push(row.map(cell => escapeCsvCell(cell)).join(','));
      });
      lines.push('');
      return lines;
    })
    .join('\r\n');
}

export function downloadTextFile(filename: string, contents: string, mimeType: string): void {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
