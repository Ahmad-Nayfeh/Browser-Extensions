// Minimal PDF writer: one JPEG image per page. No library needed.
function makePdf(pages /* [{ jpeg: Uint8Array, w: px, h: px }] */) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let size = 0;
  const push = (data) => { const b = typeof data === "string" ? enc.encode(data) : data; chunks.push(b); size += b.length; };
  const obj = (n, body) => { offsets[n] = size; push(`${n} 0 obj\n`); body(); push("\nendobj\n"); };

  const PAGE_W = 595; // A4 width in points
  const n = pages.length;
  // objects: 1 catalog, 2 pages, then per page i: 3+3i page, 4+3i content, 5+3i image
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] >>`));
  pages.forEach((p, i) => {
    const ph = Math.round((p.h * PAGE_W) / p.w);
    obj(3 + 3 * i, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${ph}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`));
    const content = `q ${PAGE_W} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(4 + 3 * i, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(5 + 3 * i, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push("\nendstream");
    });
  });
  const total = 3 + 3 * n;
  const xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let i = 1; i < total; i++) push(String(offsets[i]).padStart(10, "0") + " 00000 n \n");
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks, { type: "application/pdf" });
}
