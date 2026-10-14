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

  let pdfP = null;      // pdf.js is only needed when exporting, so it is fetched on first use
  const loadPdf = () => window.buildPdf ? Promise.resolve() : (pdfP || (pdfP = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'pdf.js'; s.onload = res; s.onerror = () => { pdfP = null; rej(new Error('pdf')); };
    document.head.appendChild(s);
  })));

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
      try { await loadPdf(); } catch (e) { return false; }
      const pages = []; for (const u of images) pages.push(await toJpeg(u));
      download(new Blob([buildPdf(pages)], { type: 'application/pdf' }), safe(name) + '.pdf'); return true;
    },
    async exportPng(dataUrl, name) {
      const b = await (await fetch(dataUrl)).blob(); download(b, safe(name) + '.png'); return true;
    }
  };

  // Offline cache. Registered after the page has loaded so it never competes with it. When a new version is published the page
  // reloads itself, but never while a note is open (it waits until you go back to the notes).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const sw = navigator.serviceWorker, hadController = !!sw.controller;
    let updated = false;
    const maybeReload = () => {
      if (!updated || /^#\/note\//.test(location.hash)) return;     // never while a note is open
      Promise.resolve(window.InkApp && InkApp.save()).catch(() => {}).then(() => location.reload());
    };
    sw.addEventListener('controllerchange', () => { if (hadController) { updated = true; maybeReload(); } });
    addEventListener('hashchange', maybeReload);
    addEventListener('load', () => sw.register('sw.js').catch(() => {}));
  }
})();
