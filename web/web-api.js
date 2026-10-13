// File export helpers for the browser (backup files, PDF, PNG).
(() => {
  const safe = n => (n || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-');
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  }
  const base = n => n.replace(/\.[^.]+$/, '');

  const toJpeg = url => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0);
      c.toBlob(async b => res({ bytes: new Uint8Array(await b.arrayBuffer()), w: c.width, h: c.height }), 'image/jpeg', .92);
    };
    im.onerror = rej; im.src = url;
  });

  window.api = {
    async saveNote(text, name) {          // .inknote backup file
      const file = safe(name) + '.inknote', blob = new Blob([text], { type: 'application/json' });
      if (window.showSaveFilePicker) {
        try {
          const h = await showSaveFilePicker({ suggestedName: file, types: [{ description: 'InkNotes note', accept: { 'application/json': ['.inknote'] } }] });
          const w = await h.createWritable(); await w.write(blob); await w.close(); return base(h.name);
        } catch (e) { if (e && e.name === 'AbortError') return null; }
      }
      download(blob, file); return base(file);
    },
    async exportPdf(images, name) {
      const pages = []; for (const u of images) pages.push(await toJpeg(u));
      download(new Blob([buildPdf(pages)], { type: 'application/pdf' }), safe(name) + '.pdf'); return true;
    },
    async exportPng(dataUrl, name) {
      const b = await (await fetch(dataUrl)).blob(); download(b, safe(name) + '.png'); return true;
    }
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
