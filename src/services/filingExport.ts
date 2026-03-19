function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absolutizeResourceUrls(doc: Document, sourceUrl: string): void {
  doc.querySelectorAll('[src]').forEach(node => {
    const current = node.getAttribute('src');
    if (!current || current.startsWith('data:') || current.startsWith('javascript:')) return;
    try {
      node.setAttribute('src', new URL(current, sourceUrl).toString());
    } catch {
      // Ignore malformed resource paths.
    }
  });

  doc.querySelectorAll('[href]').forEach(node => {
    const current = node.getAttribute('href');
    if (!current || current.startsWith('javascript:')) return;
    try {
      node.setAttribute('href', new URL(current, sourceUrl).toString());
    } catch {
      // Ignore malformed link paths.
    }
  });
}

function sanitizeFilingHtml(html: string, sourceUrl: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  doc.querySelectorAll('script, style, noscript, iframe, form, button').forEach(node => node.remove());
  absolutizeResourceUrls(doc, sourceUrl);
  doc.querySelectorAll('[style]').forEach(node => node.removeAttribute('style'));
  doc.querySelectorAll('[class]').forEach(node => node.removeAttribute('class'));
  doc.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));

  const bodyHtml = doc.body?.innerHTML?.trim();
  if (bodyHtml) {
    return bodyHtml;
  }

  return `<pre>${escapeHtml(doc.body?.textContent || html)}</pre>`;
}

function writeLoadingShell(printWindow: Window, title: string): void {
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body {
            margin: 0;
            font-family: Georgia, "Times New Roman", serif;
            background: #ffffff;
            color: #111827;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          .loading-shell {
            text-align: center;
            padding: 24px;
          }
          .loading-shell h1 {
            margin: 0 0 10px;
            font-size: 20px;
          }
          .loading-shell p {
            margin: 0;
            color: #4b5563;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="loading-shell">
          <h1>${escapeHtml(title)}</h1>
          <p>Preparing clean print view...</p>
        </div>
      </body>
    </html>
  `);
  printWindow.document.close();
}

export function createPrintWindow(title: string): Window | null {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    return null;
  }

  writeLoadingShell(printWindow, title);
  return printWindow;
}

export function renderCleanPrintView(printWindow: Window, title: string, html: string, sourceUrl: string): void {
  const sanitized = sanitizeFilingHtml(html, sourceUrl);
  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body {
            font-family: Georgia, "Times New Roman", serif;
            color: #111827;
            margin: 0;
            background: #ffffff;
          }
          header {
            padding: 18px 28px 10px;
            border-bottom: 1px solid #d1d5db;
          }
          h1 {
            font-size: 20px;
            margin: 0 0 4px;
          }
          p {
            margin: 0 0 6px;
            line-height: 1.55;
          }
          main {
            padding: 24px 28px 56px;
            line-height: 1.6;
            font-size: 14px;
          }
          table {
            border-collapse: collapse;
            width: 100%;
            margin: 18px 0;
            page-break-inside: avoid;
          }
          th, td {
            border: 1px solid #d1d5db;
            padding: 6px 8px;
            vertical-align: top;
          }
          a {
            color: #1d4ed8;
            text-decoration: none;
          }
          img {
            max-width: 100%;
            height: auto;
          }
          .meta {
            color: #4b5563;
            font-size: 12px;
          }
          .meta a {
            word-break: break-all;
          }
          @media print {
            header {
              position: static;
            }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>${escapeHtml(title)}</h1>
          <p class="meta">Clean print view for PDF export</p>
          <p class="meta">Source: <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceUrl)}</a></p>
        </header>
        <main>${sanitized}</main>
      </body>
    </html>
  `);
  printWindow.document.close();
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 350);
}

export function openCleanPrintView(title: string, html: string, sourceUrl: string): boolean {
  const printWindow = createPrintWindow(title);
  if (!printWindow) {
    return false;
  }

  renderCleanPrintView(printWindow, title, html, sourceUrl);
  return true;
}
