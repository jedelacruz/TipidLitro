// PDF text extraction with coordinates (pdf.js), used to rebuild DOE price tables.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let pdfjsPromise;
const loadPdfjs = () => (pdfjsPromise ||= import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href));

/**
 * @returns {Promise<Array<{page:number, items:Array<{x:number,y:number,w:number,cx:number,s:string}>}>>}
 */
export async function pdfPages(buffer) {
  const pdfjs = await loadPdfjs();
  const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    standardFontDataUrl: pathToFileURL(path.join(pkgDir, 'standard_fonts') + path.sep).href,
    cMapUrl: pathToFileURL(path.join(pkgDir, 'cmaps') + path.sep).href,
    cMapPacked: true,
    verbosity: 0,
    isEvalSupported: false,
  });
  const doc = await task.promise;
  const pages = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        const s = (it.str || '').replace(/\s+/g, ' ').trim();
        if (!s) continue;
        const x = it.transform[4]; const y = it.transform[5]; const w = it.width || 0;
        items.push({ x, y, w, cx: x + w / 2, s });
      }
      pages.push({ page: p, items });
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

/** Group items into visual rows (descending y) using a y tolerance. */
export function toRows(items, tol = 2.5) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tol);
    if (row) row.items.push(it); else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b.y - a.y);
}

export const rowText = (row) => row.items.map((i) => i.s).join(' ');
export const pageText = (page) => toRows(page.items).map(rowText).join('\n');
