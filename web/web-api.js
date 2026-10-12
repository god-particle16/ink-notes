// Browser replacement for the desktop (Electron) file/export bridge.
(() => {
  const safe = n => (n || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-');
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  }
  const base = n => n.replace(/\.[^.]+$/, '');

  // IndexedDB autosave (bigger than localStorage's ~5 MB limit)
  const idb = () => new Promise((res, rej) => {
    const q = indexedDB.open('inknotes', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
  });
  async function kv(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode), r = fn(t.objectStore('kv'));
      t.oncomplete = () => { db.close(); res(r && r.result); }; t.onerror = () => { db.close(); rej(t.error); };
    });
  }

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
    async saveNote(text, name) {
      const file = safe(name) + '.inknote', blob = new Blob([text], { type: 'application/json' });
      if (window.showSaveFilePicker) {
        try {
          const h = await showSaveFilePicker({ suggestedName: file, types: [{ description: 'InkNotes note', accept: { 'application/json': ['.inknote'] } }] });
          const w = await h.createWritable(); await w.write(blob); await w.close(); return base(h.name);
        } catch (e) { if (e && e.name === 'AbortError') return null; }
      }
      download(blob, file); return base(file);
    },
    openNote() {
      return new Promise(res => {
        const i = document.createElement('input'); i.type = 'file'; i.accept = '.inknote,.json';
        i.onchange = async () => { const f = i.files[0]; res(f ? { name: base(f.name), text: await f.text() } : null); };
        i.addEventListener('cancel', () => res(null)); i.click();
      });
    },
    async exportPdf(images, name) {
      const pages = []; for (const u of images) pages.push(await toJpeg(u));
      download(new Blob([buildPdf(pages)], { type: 'application/pdf' }), safe(name) + '.pdf'); return true;
    },
    async exportPng(dataUrl, name) {
      const b = await (await fetch(dataUrl)).blob(); download(b, safe(name) + '.png'); return true;
    },
    async autosave(text) { try { await kv('readwrite', s => s.put(text, 'autosave')); } catch (e) {} },
    async loadAutosave() { try { return (await kv('readonly', s => s.get('autosave'))) || null; } catch (e) { return null; } }
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
