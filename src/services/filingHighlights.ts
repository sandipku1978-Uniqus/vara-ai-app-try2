function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildHighlightRegex(terms: string[]): RegExp | null {
  if (terms.length === 0) return null;

  const pattern = terms
    .map(term => {
      const escaped = escapeRegExp(term.trim());
      if (!escaped) return '';
      return term.includes(' ') ? escaped : `\\b${escaped}\\b`;
    })
    .filter(Boolean)
    .join('|');

  return pattern ? new RegExp(`(${pattern})`, 'gi') : null;
}

export function clearDocumentHighlights(doc: Document | null | undefined): void {
  if (!doc?.body) {
    return;
  }

  const marks = Array.from(doc.querySelectorAll('mark[data-vara-search-hit]'));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(doc.createTextNode(mark.textContent || ''), mark);
  }
  doc.body.normalize();
}

export function highlightDocumentSearchTerms(doc: Document, terms: string[], maxHighlights = 36): HTMLElement[] {
  clearDocumentHighlights(doc);

  const regex = buildHighlightRegex(terms);
  if (!regex || !doc.body) return [];

  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentElement = node.parentElement;
      if (!parentElement) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'MARK'].includes(parentElement.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return (node.textContent || '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });

  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  const marks: HTMLElement[] = [];

  for (const textNode of textNodes) {
    if (marks.length >= maxHighlights) break;
    const text = textNode.textContent || '';
    regex.lastIndex = 0;
    if (!regex.test(text)) {
      continue;
    }

    const fragment = doc.createDocumentFragment();
    const parts = text.split(regex);
    let didReplace = false;

    for (const part of parts) {
      if (!part) continue;
      regex.lastIndex = 0;
      if (regex.test(part) && marks.length < maxHighlights) {
        const mark = doc.createElement('mark');
        mark.setAttribute('data-vara-search-hit', 'true');
        mark.textContent = part;
        mark.style.background = 'rgba(250, 204, 21, 0.55)';
        mark.style.color = '#111827';
        mark.style.padding = '0 2px';
        mark.style.borderRadius = '3px';
        fragment.appendChild(mark);
        marks.push(mark);
        didReplace = true;
      } else {
        fragment.appendChild(doc.createTextNode(part));
      }
    }

    if (didReplace && textNode.parentNode) {
      textNode.parentNode.replaceChild(fragment, textNode);
    }
  }

  return marks;
}
