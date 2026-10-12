// Minimal PDF writer: one full-page JPEG per A4 page, no libraries.
(function (root) {
  function buildPdf(pages) {            // pages: [{bytes:Uint8Array, w, h}]
    const enc = new TextEncoder(), chunks = [], off = [];
    let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    const obj = (n, body) => { off[n] = len; push(n + ' 0 obj\n'); body(); push('endobj\n'); };
    const PW = 595.28, PH = 841.89, N = 2 + pages.length * 3;
    push('%PDF-1.4\n');
    obj(1, () => push('<</Type/Catalog/Pages 2 0 R>>\n'));
    obj(2, () => push('<</Type/Pages/Count ' + pages.length + '/Kids[' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + ']>>\n'));
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
      obj(pg, () => push('<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' + PW + ' ' + PH + ']/Resources<</XObject<</Im0 ' + im + ' 0 R>>>>/Contents ' + ct + ' 0 R>>\n'));
      const c = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q';
      obj(ct, () => push('<</Length ' + c.length + '>>\nstream\n' + c + '\nendstream\n'));
      obj(im, () => {
        push('<</Type/XObject/Subtype/Image/Width ' + p.w + '/Height ' + p.h + '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' + p.bytes.length + '>>\nstream\n');
        push(p.bytes); push('\nendstream\n');
      });
    });
    const xref = len;
    let x = 'xref\n0 ' + (N + 1) + '\n0000000000 65535 f \n';
    for (let n = 1; n <= N; n++) x += String(off[n]).padStart(10, '0') + ' 00000 n \n';
    push(x + 'trailer\n<</Size ' + (N + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF\n');
    const out = new Uint8Array(len); let p = 0;
    chunks.forEach(c => { out.set(c, p); p += c.length; });
    return out;
  }
  root.buildPdf = buildPdf;
  if (typeof module !== 'undefined') module.exports = { buildPdf };
})(typeof window !== 'undefined' ? window : globalThis);
