export interface FilingTextSelection {
  text: string;
  sourceLength: number;
  selectedLength: number;
  complete: boolean;
}

/**
 * Selects evidence from across a long filing instead of silently taking only
 * its beginning. Keyword hits are sampled at their first, middle, and last
 * occurrence, then remaining slots are spread evenly through the document.
 */
export function selectFilingText(
  source: string,
  terms: string[],
  maxChars = 50_000,
): FilingTextSelection {
  const text = source.trim();
  if (text.length <= maxChars) {
    return { text, sourceLength: text.length, selectedLength: text.length, complete: true };
  }

  const lower = text.toLowerCase();
  const primaryCenters: number[] = [];
  const secondaryCenters: number[] = [];
  for (const rawTerm of new Set(terms.map(term => term.trim().toLowerCase()).filter(Boolean))) {
    const first = lower.indexOf(rawTerm);
    if (first < 0) continue;
    const last = lower.lastIndexOf(rawTerm);
    const middle = lower.indexOf(rawTerm, Math.floor((first + last) / 2));
    primaryCenters.push(first);
    secondaryCenters.push(last);
    if (middle >= 0) secondaryCenters.push(middle);
  }

  const maxSegments = 20;
  const centers = new Set<number>([0, text.length - 1, ...primaryCenters.slice(0, maxSegments - 2)]);
  for (const center of secondaryCenters) {
    if (centers.size >= maxSegments) break;
    centers.add(center);
  }
  for (let index = 1; index < maxSegments - 1 && centers.size < maxSegments; index += 1) {
    centers.add(Math.floor((text.length - 1) * index / (maxSegments - 1)));
  }
  const chosen = [...centers].sort((a, b) => a - b);

  const segmentSize = Math.max(300, Math.floor((maxChars - 3_500) / chosen.length));
  const ranges = chosen
    .map(center => ({
      start: Math.max(0, center - Math.floor(segmentSize / 2)),
      end: Math.min(text.length, center + Math.ceil(segmentSize / 2)),
    }))
    .sort((a, b) => a.start - b.start)
    .reduce<Array<{ start: number; end: number }>>((merged, range) => {
      const previous = merged[merged.length - 1];
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
      else merged.push(range);
      return merged;
    }, []);

  const excerpts = ranges.map((range, index) =>
    `[Excerpt ${index + 1}; source characters ${range.start + 1}-${range.end}]\n${text.slice(range.start, range.end)}`);
  const header = `[Selected evidence from across a ${text.length.toLocaleString()}-character filing.]`;
  const evidenceBudget = Math.max(maxChars - header.length - 2, 0);
  const selected = excerpts
    .join('\n\n[... intervening filing text omitted ...]\n\n')
    .slice(0, evidenceBudget);
  return {
    text: `${header}\n\n${selected}`,
    sourceLength: text.length,
    selectedLength: selected.length,
    complete: false,
  };
}
