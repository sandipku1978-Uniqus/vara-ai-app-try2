import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseMarkdownToDocx(markdown: string) {
  const children: Paragraph[] = [];
  
  const blocks = markdown.split('\n\n');
  
  for (const block of blocks) {
    if (!block.trim()) continue;
    
    // Heading 2
    if (block.startsWith('## ')) {
      children.push(new Paragraph({
        text: block.replace('## ', '').trim(),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 }
      }));
      continue;
    }

    // Heading 3
    if (block.startsWith('### ')) {
      children.push(new Paragraph({
        text: block.replace('### ', '').trim(),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 300, after: 100 }
      }));
      continue;
    }

    // List items
    if (block.startsWith('- ') || block.startsWith('* ') || /^[0-9]+\./.test(block)) {
      const items = block.split('\n');
      for (const item of items) {
        if (!item.trim()) continue;
        const cleanItem = item.replace(/^[-*]\s+/, '').replace(/^[0-9]+\.\s+/, '');
        children.push(new Paragraph({
          text: cleanItem,
          bullet: { level: 0 },
          spacing: { after: 100 }
        }));
      }
      continue;
    }

    // Standard paragraph with possible inline bold
    const paragraphChildren: TextRun[] = [];
    const parts = block.split(/(\*\*.*?\*\*)/g);
    
    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**')) {
        paragraphChildren.push(new TextRun({
          text: part.slice(2, -2),
          bold: true
        }));
      } else {
        paragraphChildren.push(new TextRun({
          text: part
        }));
      }
    }
    
    children.push(new Paragraph({
      children: paragraphChildren,
      spacing: { after: 200 }
    }));
  }
  
  return children;
}

export async function generateMemoDocx(markdown: string, tickers: string[], section: string) {
  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: `Disclosure Comparison Memo: ${section}`,
          heading: HeadingLevel.TITLE,
          spacing: { after: 200 }
        }),
        new Paragraph({
          children: [
            new TextRun({ text: "Entities Compared: ", bold: true }),
            new TextRun({ text: tickers.join(', ') })
          ],
          spacing: { after: 400 }
        }),
        ...parseMarkdownToDocx(markdown)
      ],
    }]
  });

  const blob = await Packer.toBlob(doc);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeSection = section.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'comparison';
  a.download = `Uniqus_Comparison_${safeSection}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Markdown → HTML (lightweight, for print-view PDF export)          */
/* ------------------------------------------------------------------ */

function markdownToHtml(md: string): string {
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Unordered list items
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr/>');

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*?<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Simple table support: | col | col |
  html = html.replace(
    /(?:^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+))/gm,
    (_match, headerRow: string, _sep: string, bodyRows: string) => {
      const headers = headerRow.split('|').filter((c: string) => c.trim());
      const rows = bodyRows.trim().split('\n').map((r: string) => r.split('|').filter((c: string) => c.trim()));
      let table = '<table><thead><tr>';
      for (const h of headers) table += `<th>${h.trim()}</th>`;
      table += '</tr></thead><tbody>';
      for (const row of rows) {
        table += '<tr>';
        for (const cell of row) table += `<td>${cell.trim()}</td>`;
        table += '</tr>';
      }
      table += '</tbody></table>';
      return table;
    }
  );

  // Paragraphs from double newlines
  html = html
    .split('\n\n')
    .map(block => {
      const t = block.trim();
      if (!t) return '';
      if (/^<(?:h[1-6]|ul|ol|pre|hr|table)/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br/>')}</p>`;
    })
    .join('');

  return html;
}

/**
 * Generate a PDF from markdown analysis — opens a styled print view.
 */
export function createMemoPrintWindow(): Window | null {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;

  try {
    printWindow.opener = null;
    if (printWindow.opener !== null) {
      printWindow.close();
      return null;
    }
  } catch {
    printWindow.close();
    return null;
  }

  return printWindow;
}

export function generateMemoPdf(markdown: string, tickers: string[], section: string): void {
  const title = `Uniqus Research Center - ${section} Comparison: ${tickers.join(' vs ')}`;
  const htmlContent = markdownToHtml(markdown);

  const printWindow = createMemoPrintWindow();
  if (!printWindow) return;

  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a2e; line-height: 1.6; }
    h1 { font-size: 24px; border-bottom: 2px solid #482879; padding-bottom: 12px; color: #482879; }
    h2 { font-size: 18px; color: #482879; margin-top: 24px; }
    h3 { font-size: 15px; color: #333; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; font-size: 13px; }
    th { background: #f4f0f8; color: #482879; }
    ul, ol { padding-left: 24px; }
    li { margin-bottom: 4px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .brand { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
    .date { font-size: 12px; color: #888; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <span class="brand">Uniqus Research Center</span>
    <span class="date">${new Date().toLocaleDateString()}</span>
  </div>
  <h1>${escapeHtml(section)} - ${escapeHtml(tickers.join(' vs '))}</h1>
  ${htmlContent}
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
}
