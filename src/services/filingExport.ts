function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SAFE_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'b', 'blockquote', 'br', 'caption', 'code',
  'col', 'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img',
  'li', 'main', 'mark', 'ol', 'p', 'pre', 's', 'section', 'small', 'span',
  'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time',
  'tr', 'u', 'ul',
]);
const REMOVE_WITH_CONTENT = new Set([
  'applet', 'audio', 'base', 'button', 'canvas', 'embed', 'form', 'frame',
  'frameset', 'iframe', 'input', 'link', 'math', 'meta', 'noscript', 'object',
  'option', 'script', 'select', 'source', 'style', 'svg', 'template', 'textarea',
  'track', 'video',
]);
const COMMON_ATTRIBUTES = new Set(['dir', 'lang', 'title']);
const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href']),
  img: new Set(['alt', 'height', 'src', 'title', 'width']),
  col: new Set(['span', 'width']),
  td: new Set(['colspan', 'headers', 'height', 'rowspan', 'width']),
  th: new Set(['colspan', 'headers', 'height', 'rowspan', 'scope', 'width']),
  time: new Set(['datetime']),
};

function isSecHost(hostname: string): boolean {
  return hostname === 'sec.gov' || hostname.endsWith('.sec.gov');
}

function safeFilingUrl(value: string, sourceUrl: string, image: boolean): string | null {
  if (image && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) {
    return value;
  }
  try {
    const url = new URL(value, sourceUrl);
    if (url.protocol !== 'https:' || !isSecHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeFilingHtml(html: string, sourceUrl: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const elements = Array.from(doc.body?.querySelectorAll('*') || []).reverse();
  for (const element of elements) {
    const tag = element.tagName.toLowerCase();
    if (REMOVE_WITH_CONTENT.has(tag)) {
      element.remove();
      continue;
    }
    if (!SAFE_TAGS.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const tagAttributes = TAG_ATTRIBUTES[tag] || new Set<string>();
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (!COMMON_ATTRIBUTES.has(name) && !tagAttributes.has(name)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (tag === 'a') {
      const current = element.getAttribute('href');
      const href = current ? safeFilingUrl(current, sourceUrl, false) : null;
      if (href) {
        element.setAttribute('href', href);
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      } else {
        element.removeAttribute('href');
      }
    }
    if (tag === 'img') {
      const current = element.getAttribute('src');
      const src = current ? safeFilingUrl(current, sourceUrl, true) : null;
      if (src) element.setAttribute('src', src);
      else element.removeAttribute('src');
    }
  }

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
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https://sec.gov https://*.sec.gov; script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'" />
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
  // Opening a same-origin empty document gives us a usable WindowProxy. Passing
  // `noopener` as a feature commonly returns null even when the browser opens a
  // tab, so isolate the inert window synchronously before writing any content.
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    return null;
  }

  try {
    printWindow.opener = null;
  } catch {
    printWindow.close();
    return null;
  }
  if (printWindow.opener !== null) {
    printWindow.close();
    return null;
  }

  writeLoadingShell(printWindow, title);
  return printWindow;
}

export function renderCleanPrintView(printWindow: Window, title: string, html: string, sourceUrl: string): void {
  const sanitized = sanitizeFilingHtml(html, sourceUrl);
  const safeSourceUrl = safeFilingUrl(sourceUrl, 'https://www.sec.gov/', false);
  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: https://sec.gov https://*.sec.gov; script-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'" />
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
          <p class="meta">Source: ${safeSourceUrl ? `<a href="${escapeHtml(safeSourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeSourceUrl)}</a>` : 'SEC source URL unavailable'}</p>
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
