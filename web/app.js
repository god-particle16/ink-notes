// Notes home page + library (stored in the browser's IndexedDB). The editor itself lives in renderer.js.
(() => {
'use strict';
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('inknote.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('inknote.' + k, JSON.stringify(v)); } catch (e) {} }
};

// ---------- storage ----------
let dbp = null;
const db = () => dbp || (dbp = new Promise((res, rej) => {
  const q = indexedDB.open('inknotes', 2);
  q.onupgradeneeded = () => {
    const d = q.result;
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs');
  };
  q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); q.onblocked = () => rej(new Error('blocked'));
}));
async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode), r = fn(...stores.map(s => t.objectStore(s)));
    t.oncomplete = () => res(r instanceof IDBRequest ? r.result : r);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted'));
  });
}
const listMeta = () => run(['meta'], 'readonly', m => m.getAll());
const getMeta = id => run(['meta'], 'readonly', m => m.get(id));
const getDocText = id => run(['docs'], 'readonly', d => d.get(id));
const putMeta = meta => run(['meta'], 'readwrite', m => m.put(meta));
const putNote = (meta, text) => run(['meta', 'docs'], 'readwrite', (m, d) => { m.put(meta); return d.put(text, meta.id); });
const delNote = id => run(['meta', 'docs'], 'readwrite', (m, d) => { m.delete(id); return d.delete(id); });

let asked = false;   // ask the browser not to evict our data
const persistHint = () => { if (asked) return; asked = true; try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {} };

async function addDoc(o, name) {                // create a note from a parsed document
  const now = Date.now(), id = uid();
  const d = {
    app: 'InkNotes', version: 1, name: name || o.name || 'Untitled',
    pages: o.pages.map(p => ({ bg: p.bg || '#ffffff', pattern: p.pattern || 'none', strokes: p.strokes || [] }))
  };
  const meta = { id, name: d.name, created: now, updated: now, pages: d.pages.length, bg: d.pages[0].bg, thumb: InkEditor.thumbOf(d) };
  await putNote(meta, JSON.stringify(d));
  return meta;
}
async function migrateLegacy() {                // the first web version kept one autosaved note
  const d = await db();
  if (!d.objectStoreNames.contains('kv')) return;
  const text = await run(['kv'], 'readonly', k => k.get('autosave'));
  if (!text) return;
  try {
    const o = JSON.parse(text);
    if (o && Array.isArray(o.pages) && o.pages.some(p => (p.strokes || []).length)) await addDoc(o, o.name && o.name !== 'Untitled' ? o.name : 'My first note');
  } catch (e) {}
  await run(['kv'], 'readwrite', k => k.delete('autosave'));
}

// ---------- small UI helpers ----------
let tT = 0;
function toast(m) { const t = $('#gtoast'); t.textContent = m; t.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('show'), 2400); }
function ago(t) {
  const s = (Date.now() - t) / 1000; if (s < 45) return 'Just now';
  const m = Math.round(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.round(h / 24); if (d < 2) return 'Yesterday'; if (d < 7) return d + ' days ago';
  const dt = new Date(t);
  return dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: dt.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
function ask({ title, body, ok = 'OK', danger = false }) {   // modal dialog -> resolves with value or null
  return new Promise(resolve => {
    const ov = $('#dlg'), bd = ov.querySelector('.dbody'), okB = $('#dOk'), noB = $('#dCancel');
    $('#dTitle').textContent = title; bd.replaceChildren();
    const get = body ? body(bd) : () => true;
    okB.textContent = ok; okB.classList.toggle('danger', danger); okB.classList.toggle('primary', !danger);
    ov.hidden = false;
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); okB.click(); }
    };
    const done = v => { ov.hidden = true; okB.onclick = noB.onclick = ov.onpointerdown = null; document.removeEventListener('keydown', onKey, true); resolve(v); };
    okB.onclick = () => { const v = get(); if (v !== undefined && v !== false) done(v); };
    noB.onclick = () => done(null);
    ov.onpointerdown = e => { if (e.target === ov) done(null); };
    document.addEventListener('keydown', onKey, true);
    const f = bd.querySelector('input[type=text]'); if (f) { f.focus(); f.select(); } else okB.focus();
  });
}
const nameBody = (value, ph = 'Untitled') => bd => {
  const i = el('input', 'dinput'); i.type = 'text'; i.maxLength = 80; i.value = value; i.placeholder = ph; i.setAttribute('aria-label', 'Note name');
  bd.appendChild(i); return () => i.value.trim() || ph;
};
const PAPERS = ['#ffffff', '#fdf6e3', '#f1f5f9', '#e8f5e9', '#fff8b0', '#1a1b1f', '#0f1b2d', '#1f3d2b'];
const PATS = [['none', 'Blank'], ['lines', 'Ruled'], ['grid', 'Grid'], ['dots', 'Dotted']];
function newBody(bd) {
  const last = prefs.get('paper', { bg: '#ffffff', pattern: 'none' });
  let bg = last.bg, pat = last.pattern;
  const i = el('input', 'dinput'); i.type = 'text'; i.maxLength = 80; i.placeholder = 'Untitled note'; i.setAttribute('aria-label', 'Note name');
  const sw = el('div', 'swrow'), pt = el('div', 'segrow');
  bd.append(el('div', 'dlabel', 'Name'), i, el('div', 'dlabel', 'Paper colour'), sw, el('div', 'dlabel', 'Pattern'), pt);
  const paint = () => {
    sw.querySelectorAll('.pap').forEach(b => b.classList.toggle('on', b.dataset.v === bg));
    pt.querySelectorAll('.seg').forEach(b => b.classList.toggle('on', b.dataset.v === pat));
  };
  PAPERS.forEach(c => {
    const b = el('button', 'pap'); b.type = 'button'; b.dataset.v = c; b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Paper ' + c);
    b.onclick = () => { bg = c; paint(); }; sw.appendChild(b);
  });
  const cu = el('input', 'pcol'); cu.type = 'color'; cu.value = bg; cu.title = 'Custom colour'; cu.setAttribute('aria-label', 'Custom paper colour');
  cu.oninput = () => { bg = cu.value; paint(); }; sw.appendChild(cu);
  PATS.forEach(([v, n]) => { const b = el('button', 'seg', n); b.type = 'button'; b.dataset.v = v; b.onclick = () => { pat = v; paint(); }; pt.appendChild(b); });
  paint();
  return () => ({ name: i.value.trim() || 'Untitled note', bg, pattern: pat });
}
function pickFiles() {
  return new Promise(res => {
    const i = el('input'); i.type = 'file'; i.multiple = true; i.accept = '.inknote,.json';
    i.onchange = () => res([...i.files]); i.addEventListener('cancel', () => res([])); i.click();
  });
}

// ---------- actions ----------
async function newDialog() {
  const r = await ask({ title: 'New note', body: newBody, ok: 'Create' }); if (!r) return;
  prefs.set('paper', { bg: r.bg, pattern: r.pattern });
  try {
    const meta = await addDoc({ pages: [{ bg: r.bg, pattern: r.pattern, strokes: [] }] }, r.name);
    persistHint(); location.hash = '#/note/' + meta.id;
  } catch (e) { toast('Could not create the note — browser storage is unavailable'); }
}
async function importFiles(fromEditor) {
  const files = await pickFiles(); if (!files.length) return;
  let n = 0, last = null;
  for (const f of files) {
    try {
      const o = JSON.parse(await f.text());
      if (!o || !Array.isArray(o.pages) || !o.pages.length) throw new Error('bad');
      last = await addDoc(o, o.name || f.name.replace(/\.[^.]+$/, '')); n++;
    } catch (e) {}
  }
  if (!n) { toast('That file is not a valid InkNotes note'); return; }
  persistHint(); toast(n === 1 ? 'Imported 1 note' : 'Imported ' + n + ' notes');
  if (fromEditor && n === 1) location.hash = '#/note/' + last.id;
  else if (document.body.dataset.view === 'home') renderHome();
}
async function rename(m) {
  const n = await ask({ title: 'Rename note', body: nameBody(m.name), ok: 'Save' }); if (!n) return;
  m.name = n; await putMeta(m); renderHome();
}
async function duplicate(m) {
  const text = await getDocText(m.id); if (!text) return;
  const now = Date.now(); await putNote({ ...m, id: uid(), name: m.name + ' copy', created: now, updated: now }, text);
  toast('Duplicated'); renderHome();
}
async function exportFile(m) {
  const text = await getDocText(m.id); if (!text) return;
  const d = JSON.parse(text); d.name = m.name;
  if (await window.api.saveNote(JSON.stringify(d), m.name)) toast('Backup file saved');
}
async function remove(m) {
  const ok = await ask({
    title: 'Delete note?', ok: 'Delete', danger: true,
    body: bd => { bd.appendChild(el('p', 'dtext', '“' + m.name + '” will be deleted from this browser. This can’t be undone — export a backup first if you might need it.')); return () => true; }
  });
  if (!ok) return; await delNote(m.id); toast('Note deleted'); renderHome();
}

// ---------- home page ----------
let all = [];
function newTile() {
  const c = el('div', 'nc newtile'); c.tabIndex = 0; c.setAttribute('role', 'button'); c.setAttribute('aria-label', 'New note');
  const th = el('div', 'th plus'); th.appendChild(el('span', null, '+'));
  const cap = el('div', 'ncap'); cap.append(el('b', 'nm', 'New note'), el('span', 'meta', 'Pick paper & pattern'));
  c.append(th, cap); return c;
}
function card(m) {
  const c = el('div', 'nc'); c.tabIndex = 0; c.setAttribute('role', 'button'); c.dataset.id = m.id; c.setAttribute('aria-label', 'Open ' + m.name);
  const th = el('div', 'th'); th.style.background = m.bg || '#fff';
  if (m.thumb) { const im = new Image(); im.alt = ''; im.decoding = 'async'; im.src = m.thumb; im.draggable = false; th.appendChild(im); }
  const mb = el('button', 'more', '⋯'); mb.type = 'button'; mb.title = 'Note options'; mb.setAttribute('aria-label', 'Options for ' + m.name); mb.setAttribute('aria-haspopup', 'menu');
  th.appendChild(mb);
  const cap = el('div', 'ncap');
  cap.append(el('b', 'nm', m.name), el('span', 'meta', m.pages + (m.pages === 1 ? ' page' : ' pages') + ' · ' + ago(m.updated)));
  c.append(th, cap); return c;
}
function drawGrid() {
  const q = $('#search').value.trim().toLowerCase(), sort = $('#sort').value;
  const cmp = {
    edited: (a, b) => b.updated - a.updated, created: (a, b) => b.created - a.created,
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  }[sort];
  const list = all.filter(m => !q || m.name.toLowerCase().includes(q)).sort(cmp);
  const g = $('#grid'); g.replaceChildren();
  if (!q) g.appendChild(newTile());
  list.forEach(m => g.appendChild(card(m)));
  $('#count').textContent = all.length ? all.length + (all.length === 1 ? ' note' : ' notes') : '';
  const msg = $('#msg');
  msg.hidden = !(q && !list.length) && all.length > 0;
  msg.textContent = q && !list.length ? 'No notes match “' + $('#search').value.trim() + '”.' : all.length ? '' : 'No notes yet — create your first one to start writing.';
}
async function renderHome() {
  try { all = await listMeta(); drawGrid(); }
  catch (e) { $('#grid').replaceChildren(); const m = $('#msg'); m.hidden = false; m.textContent = 'This browser is blocking storage (private window?). Open InkNotes in a normal window to save notes.'; }
}
const menu = $('#menu');
function closeMenu() { menu.hidden = true; }
function showMenu(id, x, y) {
  const m = all.find(n => n.id === id); if (!m) return;
  menu.replaceChildren();
  [['Open', () => { location.hash = '#/note/' + id; }], ['Rename…', () => rename(m)], ['Duplicate', () => duplicate(m)], ['Export file…', () => exportFile(m)], ['Delete…', () => remove(m), true]]
    .forEach(([t, fn, danger]) => { const b = el('button', danger ? 'danger' : '', t); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.onclick = () => { closeMenu(); fn(); }; menu.appendChild(b); });
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  menu.querySelector('button').focus();
}
$('#grid').addEventListener('click', e => {
  const more = e.target.closest('.more'), c = e.target.closest('.nc'); if (!c) return;
  if (more) { const r = more.getBoundingClientRect(); showMenu(c.dataset.id, r.left, r.bottom + 4); e.stopPropagation(); }
  else if (c.classList.contains('newtile')) newDialog();
  else location.hash = '#/note/' + c.dataset.id;
});
$('#grid').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('nc')) { e.preventDefault(); e.target.click(); }
});
$('#grid').addEventListener('contextmenu', e => { const c = e.target.closest('.nc[data-id]'); if (c) { e.preventDefault(); showMenu(c.dataset.id, e.clientX, e.clientY); } });
document.addEventListener('pointerdown', e => { if (!e.target.closest('#menu') && !e.target.closest('.more')) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { closeMenu(); } });
$('#home').addEventListener('scroll', closeMenu); addEventListener('resize', closeMenu);
$('#search').addEventListener('input', drawGrid);
$('#sort').value = prefs.get('sort', 'edited');
$('#sort').addEventListener('change', () => { prefs.set('sort', $('#sort').value); drawGrid(); });
$('#hNew').onclick = newDialog; $('#hImport').onclick = () => importFiles(false);

// ---------- editor session (which note is open, saving) ----------
let current = null, dirtyFlag = false, chain = Promise.resolve(), opening = 0;
function setState(t, s) { const e = $('#saveState'); e.textContent = t; e.dataset.s = s || ''; }
function dirty() { if (!current) return; dirtyFlag = true; setState('Unsaved changes…', ''); }
async function doSave() {
  if (!current || !dirtyFlag) return;
  const cur = current; dirtyFlag = false;
  try {
    const d = InkEditor.serial(), text = JSON.stringify(d);
    await putNote({ id: cur.id, name: d.name || 'Untitled', created: cur.created, updated: Date.now(), pages: d.pages.length, bg: d.pages[0].bg, thumb: InkEditor.thumb() }, text);
    if (current === cur && !dirtyFlag) setState('Saved ✓', 'ok');
  } catch (e) {
    dirtyFlag = true; setState('Not saved', 'bad');
    toast('Could not save — browser storage may be full. Use Backup to keep a file copy.');
  }
}
const save = () => (chain = chain.then(doSave, doSave));
async function openNote(id) {
  if (current && current.id === id) { document.body.dataset.view = 'editor'; return; }
  const token = ++opening;
  await save();                                        // finish saving whatever was open
  const [meta, text] = await Promise.all([getMeta(id), getDocText(id)]);
  if (token !== opening) return;
  let d = null;
  try { d = JSON.parse(text); if (!meta || !Array.isArray(d.pages) || !d.pages.length) d = null; } catch (e) { d = null; }
  if (!d) { toast(meta ? 'Could not open that note' : 'That note no longer exists'); location.hash = '#/'; return; }
  d.name = meta.name; current = { id, created: meta.created }; dirtyFlag = false;
  document.body.dataset.view = 'editor'; closeMenu();
  await nextFrame();                                   // let the editor get its real size
  InkEditor.open(d);
  $('#noteName').value = meta.name; document.title = meta.name + ' – InkNotes'; setState('Saved ✓', 'ok');
}
async function showHome() {
  ++opening; await save(); current = null;
  document.body.dataset.view = 'home'; document.title = 'My notes – InkNotes'; closeMenu();
  await ready;                                         // old single-note autosave is migrated first
  await renderHome();
}
async function showLanding() {
  ++opening; await save(); current = null; closeMenu();
  if (document.body.dataset.view !== 'landing') { document.body.dataset.view = 'landing'; $('#landing').scrollTop = 0; }
  document.title = 'InkNotes – Handwritten notes for pen tablets';
}
function route() {
  const m = /^#\/note\/([\w-]+)/.exec(location.hash);
  if (m) openNote(m[1]); else if (location.hash === '#/') showHome(); else showLanding();
}
$('#bHome').onclick = () => { location.hash = '#/'; };
$('#noteName').addEventListener('input', e => {
  if (!current) return;
  const n = e.target.value.trim() || 'Untitled'; InkEditor.setName(n); document.title = n + ' – InkNotes';
});
$('#noteName').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') e.target.blur(); });
$('#noteName').addEventListener('blur', e => { if (!e.target.value.trim()) e.target.value = 'Untitled'; });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
addEventListener('pagehide', () => save());
addEventListener('hashchange', route);

window.InkApp = { dirty, save, newDialog, importFiles };
// the landing page needs no storage, so the old-data migration waits until the browser is idle
const ready = new Promise(res => (window.requestIdleCallback || setTimeout)(() => migrateLegacy().catch(() => {}).then(res)));
route();
})();
