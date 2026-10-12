'use strict';
(() => {
// ---------- constants & helpers ----------
const W = 1240, H = 1754, CS = 2;            // page size (A4 @150dpi), cache scale
const GAP = 40, PH = H + GAP;                // pages are stacked vertically
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const lum = h => {
  h = h.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
  const n = parseInt(h, 16); return (.299 * (n >> 16 & 255) + .587 * (n >> 8 & 255) + .114 * (n & 255)) / 255;
};

// ---------- state ----------
const canvas = $('#view'), ctx = canvas.getContext('2d');
const mkPage = (bg = '#ffffff', pattern = 'none') => ({ bg, pattern, strokes: [] });
let doc = { name: 'Untitled', pages: [mkPage()] };
let cur = 0;
const view = { x: 0, y: 0, s: 1 };
const TOOLDEF = { pen: { sens: .8 }, pencil: { sens: .45 }, marker: { sens: 0 }, highlighter: { sens: 0, multiply: true } };
const TS = Object.assign({
  pen: { size: 4, opacity: 1, color: '#16181d' },
  pencil: { size: 3, opacity: .8, color: '#3a3a3a' },
  marker: { size: 12, opacity: 1, color: '#1e66f5' },
  highlighter: { size: 30, opacity: .4, color: '#ffe14d' },
  eraser: { size: 26 }, strokeEraser: { size: 18 }, lasso: {}, pan: {}
}, store.get('inknote.ts', {}));
const S = Object.assign({ pressure: 1, smooth: .25 }, store.get('inknote.settings', {}));
let tool = 'pen', prevTool = 'pen', lastInk = 'pen';
let undoS = [], redoS = [], clip = [];
let live = null, active = null, fl = null, lassoPath = null, hover = null, spaceDown = false;
const caches = new Map(); let raf = 0, bgPending = null;
const pathCache = new WeakMap();
const page = () => doc.pages[cur];

// ---------- stroke rendering ----------
function strokePath(s) {
  const pts = s.pts, p = new Path2D();
  const rad = pts.map(q => Math.max(.05, (1 - s.sens) + s.sens * 2 * q[2]) * s.size / 2);
  for (let i = 0; i < pts.length; i++) {
    const x = pts[i][0], y = pts[i][1], r = rad[i];
    p.moveTo(x + r, y); p.arc(x, y, r, 0, Math.PI * 2);
    if (i) {
      const px = pts[i - 1][0], py = pts[i - 1][1], pr = rad[i - 1];
      const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
      if (d > .01) {
        const nx = -dy / d, ny = dx / d;
        const q = [[px + nx * pr, py + ny * pr], [x + nx * r, y + ny * r], [x - nx * r, y - ny * r], [px - nx * pr, py - ny * pr]];
        let a = 0;
        for (let k = 0; k < 4; k++) { const A = q[k], B = q[(k + 1) % 4]; a += A[0] * B[1] - B[0] * A[1]; }
        if (a < 0) q.reverse();
        p.moveTo(q[0][0], q[0][1]); for (let k = 1; k < 4; k++) p.lineTo(q[k][0], q[k][1]); p.closePath();
      }
    }
  }
  return p;
}
function drawStroke(c, s, lightBg, noCache) {
  let path = noCache ? null : pathCache.get(s);
  if (!path) { path = strokePath(s); if (!noCache) pathCache.set(s, path); }
  c.save();
  c.globalAlpha = s.opacity;
  if (TOOLDEF[s.tool] && TOOLDEF[s.tool].multiply && lightBg) c.globalCompositeOperation = 'multiply';
  c.fillStyle = s.color; c.fill(path);
  c.restore();
}
function drawPattern(c, p) {
  if (p.pattern === 'none') return;
  const dark = lum(p.bg) < .5, g = 48;
  c.save();
  c.strokeStyle = c.fillStyle = dark ? 'rgba(255,255,255,.14)' : 'rgba(40,70,120,.22)';
  c.lineWidth = 1.5;
  if (p.pattern === 'lines') {
    for (let y = g * 2; y < H; y += g) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  } else if (p.pattern === 'grid') {
    for (let y = g; y < H; y += g) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    for (let x = g; x < W; x += g) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
  } else if (p.pattern === 'dots') {
    for (let y = g; y < H; y += g) for (let x = g; x < W; x += g) c.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  c.restore();
}
function renderPage(c, pg, scale, extra) {
  c.save(); c.scale(scale, scale);
  c.fillStyle = pg.bg; c.fillRect(0, 0, W, H);
  drawPattern(c, pg);
  const light = lum(pg.bg) >= .5;
  pg.strokes.forEach(s => drawStroke(c, s, light));
  if (extra) extra.forEach(s => drawStroke(c, s, light, true));
  c.restore();
}
function buildCache(i) {
  const c = document.createElement('canvas'); c.width = W * CS; c.height = H * CS;
  renderPage(c.getContext('2d'), doc.pages[i], CS); caches.set(i, c); return c;
}
const dirtyCache = i => { caches.delete(i === undefined ? cur : i); need(); };
const dirtyAll = () => { caches.clear(); need(); };
function paintToCache(s) {
  const c = caches.get(cur); if (!c) return;
  const g = c.getContext('2d'); g.save(); g.scale(CS, CS); drawStroke(g, s, lum(page().bg) >= .5); g.restore();
}

// ---------- history ----------
const snap = () => ({ cur, pages: doc.pages.map(p => ({ bg: p.bg, pattern: p.pattern, strokes: p.strokes })) });
function pushSnap(s) { undoS.push(s); if (undoS.length > 80) undoS.shift(); redoS = []; }
const pushUndo = () => pushSnap(snap());
function restore(s) {
  doc.pages = s.pages.map(p => ({ ...p })); cur = Math.min(s.cur, doc.pages.length - 1);
  dirtyAll(); pageUI();
}
function undo() { closePops(); commitFloat(); if (!undoS.length) return; redoS.push(snap()); restore(undoS.pop()); changed(); }
function redo() { closePops(); commitFloat(); if (!redoS.length) return; undoS.push(snap()); restore(redoS.pop()); changed(); }
let saveT = 0;
function changed() {
  $('#bUndo').style.opacity = undoS.length ? 1 : .35; $('#bRedo').style.opacity = redoS.length ? 1 : .35;
  clearTimeout(saveT); saveT = setTimeout(() => window.api.autosave(JSON.stringify(serial())), 1500);
  need();
}

// ---------- selection (lasso) ----------
const xf = (s, f) => ({ ...s, size: s.size * f.s, pts: s.pts.map(q => [f.cx + (q[0] - f.cx) * f.s + f.dx, f.cy + (q[1] - f.cy) * f.s + f.dy, q[2]]) });
function makeFloat(strokes, pre, changedFlag) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  strokes.forEach(s => s.pts.forEach(q => {
    const r = s.size / 2 + 2; x0 = Math.min(x0, q[0] - r); y0 = Math.min(y0, q[1] - r); x1 = Math.max(x1, q[0] + r); y1 = Math.max(y1, q[1] + r);
  }));
  return { strokes, pre, dx: 0, dy: 0, s: 1, changed: !!changedFlag, b0: { x0, y0, x1, y1 }, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
function flBox() {
  const f = fl, b = f.b0, t = (x, y) => [f.cx + (x - f.cx) * f.s + f.dx, f.cy + (y - f.cy) * f.s + f.dy];
  const a = t(b.x0, b.y0), c = t(b.x1, b.y1); return { x0: a[0], y0: a[1], x1: c[0], y1: c[1] };
}
function floatMoved() { return fl && (fl.changed || fl.dx || fl.dy || fl.s !== 1); }
function commitFloat() {
  if (!fl) return;
  const moved = floatMoved();
  const out = moved ? fl.strokes.map(s => xf(s, fl)) : fl.strokes;
  if (moved) pushSnap(fl.pre);
  page().strokes = [...page().strokes, ...out];
  fl = null; dirtyCache(); changed();
}
function deleteFloat() { if (!fl) return; pushSnap(fl.pre); fl = null; changed(); }
function copyFloat() { if (fl) clip = fl.strokes.map(s => xf(s, fl)); }
function pasteClip() {
  if (!clip.length) return; commitFloat(); setTool('lasso');
  clip = clip.map(s => ({ ...s, pts: s.pts.map(q => [q[0] + 30, q[1] + 30, q[2]]) }));
  fl = makeFloat(clip.slice(), snap(), true); need();
}
const inPoly = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};
function finishLasso(path) {
  lassoPath = null;
  if (path.length < 3) return;
  const sel = [], rest = [];
  page().strokes.forEach(s => {
    let n = 0; s.pts.forEach(q => { if (inPoly(q[0], q[1], path)) n++; });
    (n / s.pts.length >= .5 ? sel : rest).push(s);
  });
  if (!sel.length) return;
  fl = makeFloat(sel, snap(), false);
  page().strokes = rest; dirtyCache();
}

// ---------- tools & UI ----------
const INK = t => !!TOOLDEF[t];
function setTool(t) {
  if (t === tool) return;
  if (tool === 'lasso') commitFloat();
  prevTool = tool; tool = t; if (INK(t)) lastInk = t;
  document.querySelectorAll('.tb').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  canvas.style.cursor = t === 'pan' ? 'grab' : t === 'lasso' ? 'crosshair' : 'none';
  syncUI(); need();
}
function syncUI() {
  const ts = TS[tool] || {};
  $('#sizeSl').disabled = !ts.size; $('#opSl').disabled = ts.opacity === undefined;
  $('#sizeSl').value = ts.size || 1; $('#opSl').value = Math.round((ts.opacity ?? 1) * 100);
  $('#sizeVal').textContent = ts.size ? Math.round(ts.size) : '–';
  $('#opVal').textContent = ts.opacity === undefined ? '–' : Math.round(ts.opacity * 100);
  const c = (TS[tool] && TS[tool].color) || TS[lastInk].color;
  $('#swDot').style.background = c;
  $('#colorInput').value = c;
}
$('#sizeSl').addEventListener('input', e => { if (TS[tool].size !== undefined) { TS[tool].size = +e.target.value; $('#sizeVal').textContent = e.target.value; store.set('inknote.ts', TS); need(); } });
$('#opSl').addEventListener('input', e => { if (TS[tool].opacity !== undefined) { TS[tool].opacity = +e.target.value / 100; $('#opVal').textContent = e.target.value; store.set('inknote.ts', TS); } });
document.querySelectorAll('.tb').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

const PALETTE = ['#16181d', '#6b7280', '#ffffff', '#e5484d', '#f76b15', '#f5c518', '#30a46c', '#12a594',
  '#0091ff', '#3e63dd', '#8e4ec6', '#d6409f', '#7c4a2d', '#ffe14d', '#a3e635', '#7dd3fc'];
const BGS = ['#ffffff', '#fdf6e3', '#f1f5f9', '#e8f5e9', '#fff8b0', '#1a1b1f', '#0f1b2d', '#1f3d2b'];
let recents = store.get('inknote.recent', []);
function swatches(el, list, fn, curColor) {
  el.innerHTML = '';
  list.forEach(c => {
    const b = document.createElement('button'); b.style.background = c; b.title = c;
    if (curColor && c.toLowerCase() === curColor.toLowerCase()) b.className = 'cur';
    b.onclick = () => fn(c); el.appendChild(b);
  });
}
function setColor(c) {
  if (tool === 'lasso') { if (fl) { fl.strokes = fl.strokes.map(s => ({ ...s, color: c })); fl.changed = true; } }
  else {
    if (!INK(tool)) setTool(lastInk);
    TS[tool].color = c;
  }
  recents = [c, ...recents.filter(x => x !== c)].slice(0, 8); store.set('inknote.recent', recents); store.set('inknote.ts', TS);
  syncUI(); renderColorPop(); need();
}
function renderColorPop() {
  const c = (TS[tool] && TS[tool].color) || TS[lastInk].color;
  swatches($('#palette'), PALETTE, setColor, c); swatches($('#recent'), recents, setColor, c);
}
$('#colorInput').addEventListener('input', e => setColor(e.target.value));
const pops = { color: $('#colorPop'), bg: $('#bgPop'), file: $('#filePop') };
function closePops() {
  Object.values(pops).forEach(p => p.classList.remove('open'));
  if (bgPending) { pushSnap(bgPending); bgPending = null; changed(); }
}
function togglePop(k) {
  const o = pops[k].classList.contains('open'); closePops();
  if (!o) {
    if (k === 'bg') { commitFloat(); cur = visiblePage(); }
    pops[k].classList.add('open'); if (k === 'color') renderColorPop(); else if (k === 'bg') renderBgPop();
  }
}
$('#bColor').onclick = () => togglePop('color');
$('#bPaper').onclick = () => togglePop('bg');
document.addEventListener('pointerdown', e => { if (!e.target.closest('.wrap')) closePops(); });

function setPaper(patch) {
  if (!bgPending) bgPending = snap();
  Object.assign(page(), patch); dirtyCache(); renderBgPop();
}
function renderBgPop() {
  swatches($('#bgPalette'), BGS, c => setPaper({ bg: c }), page().bg);
  $('#bgInput').value = page().bg; $('#patSel').value = page().pattern;
}
$('#bgInput').addEventListener('input', e => setPaper({ bg: e.target.value }));
$('#patSel').addEventListener('change', e => setPaper({ pattern: e.target.value }));
$('#bgAll').onclick = () => {
  const { bg, pattern } = page(); bgPending = null; pushUndo();
  doc.pages = doc.pages.map(p => ({ ...p, bg, pattern })); dirtyAll(); changed(); toast('Applied to all pages');
};

// ---------- view ----------
function resize() {
  const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
  canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d); need();
}
new ResizeObserver(resize).observe(canvas);
function fit(keepPage) {
  const r = canvas.getBoundingClientRect(), vp = keepPage ? visiblePage() : 0;
  view.s = Math.max(.2, (r.width - 150) / W);
  view.x = (r.width - W * view.s) / 2 + 40; view.y = 20 - vp * PH * view.s; pageUI(); need();
}
function zoomAt(f, cx, cy) {
  const ns = clamp(view.s * f, .1, 8);
  view.x = cx - (cx - view.x) * ns / view.s; view.y = cy - (cy - view.y) * ns / view.s; view.s = ns; pageUI(); need();
}
function zoomCenter(f) { const r = canvas.getBoundingClientRect(); zoomAt(f, r.width / 2, r.height / 2); }
const world = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - view.x) / view.s, y: (e.clientY - r.top - view.y) / view.s }; };
const pt = e => { const w = world(e); return { x: w.x, y: w.y - cur * PH }; };   // coordinates local to the current page
const pageAtY = y => clamp(Math.floor((y + GAP / 2) / PH), 0, doc.pages.length - 1);
const visiblePage = () => pageAtY((canvas.getBoundingClientRect().height / 2 - view.y) / view.s);
const prs = e => e.pointerType === 'pen' ? Math.max(e.pressure, .02) : .5;
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey) { const r = canvas.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * .0015), e.clientX - r.left, e.clientY - r.top); }
  else { view.x -= e.shiftKey ? e.deltaY : e.deltaX; view.y -= e.shiftKey ? 0 : e.deltaY; need(); }
}, { passive: false });
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---------- pointer input ----------
canvas.addEventListener('pointerdown', e => {
  if (active) return;
  closePops();
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || spaceDown || tool === 'pan' || e.pointerType === 'touch') {
    active = { id: e.pointerId, kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
    canvas.style.cursor = 'grabbing'; return;
  }
  const idx = pageAtY(world(e).y);
  if (idx !== cur) { commitFloat(); cur = idx; pageUI(); }
  const t = (e.buttons & 32 || e.buttons & 2) ? 'eraser' : tool;   // pen eraser end / barrel button
  const p = pt(e);
  if (INK(t)) {
    commitFloat(); const ts = TS[t];
    live = { tool: t, color: ts.color, size: ts.size, opacity: ts.opacity, sens: TOOLDEF[t].sens * S.pressure, pts: [[p.x, p.y, prs(e)]] };
    active = { id: e.pointerId, kind: 'ink', last: [p.x, p.y], et: t };
  } else if (t === 'eraser' || t === 'strokeEraser') {
    commitFloat(); active = { id: e.pointerId, kind: 'erase', et: t, snap: snap(), changed: false, last: p }; eraseStep(p, p);
  } else if (t === 'lasso') {
    if (fl) {
      const b = flBox(), hr = 18 / view.s;
      const cx = fl.cx + fl.dx, cy = fl.cy + fl.dy;
      if (Math.hypot(p.x - b.x1, p.y - b.y1) < hr) {
        active = { id: e.pointerId, kind: 'fscale', d0: Math.hypot(p.x - cx, p.y - cy) || 1, s0: fl.s }; return;
      }
      if (p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) {
        active = { id: e.pointerId, kind: 'fmove', sx: p.x, sy: p.y, dx0: fl.dx, dy0: fl.dy }; return;
      }
      commitFloat();
    }
    lassoPath = [[p.x, p.y]]; active = { id: e.pointerId, kind: 'lasso' };
  }
  need();
});
canvas.addEventListener('pointermove', e => {
  const r = canvas.getBoundingClientRect(); hover = { x: e.clientX - r.left, y: e.clientY - r.top };
  if (active && e.pointerId === active.id) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (evs.length ? evs : [e]).forEach(step);
  }
  need();
});
canvas.addEventListener('pointerleave', () => { if (!active) { hover = null; need(); } });
function step(ev) {
  const a = active, p = pt(ev);
  if (a.kind === 'pan') { view.x = a.vx + ev.clientX - a.sx; view.y = a.vy + ev.clientY - a.sy; }
  else if (a.kind === 'ink') {
    const sm = S.smooth, fx = a.last[0] + (p.x - a.last[0]) * (1 - sm), fy = a.last[1] + (p.y - a.last[1]) * (1 - sm);
    const d = Math.hypot(fx - a.last[0], fy - a.last[1]); if (d < .8) return;
    const pr = prs(ev), lp = live.pts[live.pts.length - 1], n = Math.ceil(d / 6);
    for (let i = 1; i <= n; i++) { const t = i / n; live.pts.push([a.last[0] + (fx - a.last[0]) * t, a.last[1] + (fy - a.last[1]) * t, lp[2] + (pr - lp[2]) * t]); }
    a.last = [fx, fy];
  }
  else if (a.kind === 'erase') { eraseStep(a.last, p); a.last = p; }
  else if (a.kind === 'lasso') lassoPath.push([p.x, p.y]);
  else if (a.kind === 'fmove') { fl.dx = a.dx0 + p.x - a.sx; fl.dy = a.dy0 + p.y - a.sy; }
  else if (a.kind === 'fscale') fl.s = clamp(a.s0 * Math.hypot(p.x - (fl.cx + fl.dx), p.y - (fl.cy + fl.dy)) / a.d0, .1, 10);
}
function endPointer(e) {
  if (!active || e.pointerId !== active.id) return;
  const a = active; active = null;
  canvas.style.cursor = tool === 'pan' ? 'grab' : tool === 'lasso' ? 'crosshair' : 'none';
  if (a.kind === 'ink') {
    const s = live; live = null;
    const p = pt(e), lp = s.pts[s.pts.length - 1];
    if (Math.hypot(p.x - lp[0], p.y - lp[1]) > .8) s.pts.push([p.x, p.y, lp[2]]);
    pushUndo(); page().strokes = [...page().strokes, s]; paintToCache(s); changed();
  } else if (a.kind === 'erase') { if (a.changed) { pushSnap(a.snap); changed(); } }
  else if (a.kind === 'lasso') finishLasso(lassoPath || []);
  need();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function eraseStep(a, b) {
  const t = active.et, r = TS[t].size / 2;
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / (r / 2))), qs = [];
  for (let i = 0; i <= n; i++) qs.push([a.x + (b.x - a.x) * i / n, a.y + (b.y - a.y) * i / n]);
  const near = (x, y) => qs.some(q => (q[0] - x) ** 2 + (q[1] - y) ** 2 <= r * r);
  const next = []; let ch = false;
  for (const s of page().strokes) {
    const flags = s.pts.map(q => near(q[0], q[1]));
    if (!flags.some(Boolean)) { next.push(s); continue; }
    ch = true; if (t === 'strokeEraser') continue;
    let run = [];
    for (let i = 0; i < s.pts.length; i++) {
      if (flags[i]) { if (run.length) next.push({ ...s, pts: run }); run = []; } else run.push(s.pts[i]);
    }
    if (run.length) next.push({ ...s, pts: run });
  }
  if (ch) { page().strokes = next; active.changed = true; dirtyCache(); }
}

// ---------- drawing the view ----------
const need = () => { if (!raf) raf = requestAnimationFrame(draw); };
function clampView() {
  const r = canvas.getBoundingClientRect(), total = (doc.pages.length * PH - GAP) * view.s;
  view.y = clamp(view.y, Math.min(60, r.height - total - 60), 60);
}
function draw() {
  raf = 0; clampView();
  const d = devicePixelRatio || 1, ch = canvas.height / d, px = 1 / view.s;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#2a2c31'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const vis = [];
  doc.pages.forEach((_, i) => { const top = view.y + i * PH * view.s; if (top < ch && top + H * view.s > 0) vis.push(i); });
  for (const k of [...caches.keys()]) if (!vis.includes(k)) caches.delete(k);
  for (const i of vis) {
    const pg = doc.pages[i], light = lum(pg.bg) >= .5;
    ctx.setTransform(d * view.s, 0, 0, d * view.s, d * view.x, d * (view.y + i * PH * view.s));
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 30; ctx.fillStyle = pg.bg; ctx.fillRect(0, 0, W, H); ctx.restore();
    let c = caches.get(i); if (!c && vis.length <= 4) c = buildCache(i);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    if (c) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, 0, 0, W, H); }
    else renderPage(ctx, pg, 1);
    if (i === cur) {
      if (fl) fl.strokes.forEach(s => drawStroke(ctx, xf(s, fl), light, true));
      if (live) drawStroke(ctx, live, light, true);
    }
    ctx.restore();
    if (i === cur) {
      if (fl) {
        const b = flBox(); ctx.save(); ctx.lineWidth = 1.5 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = '#5b8def';
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.setLineDash([]);
        ctx.fillStyle = '#5b8def'; ctx.beginPath(); ctx.arc(b.x1, b.y1, 8 * px, 0, 7); ctx.fill(); ctx.restore();
      }
      if (lassoPath && lassoPath.length > 1) {
        ctx.save(); ctx.lineWidth = 1.6 * px; ctx.setLineDash([6 * px, 4 * px]); ctx.strokeStyle = '#5b8def'; ctx.beginPath();
        lassoPath.forEach((q, j) => j ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.stroke(); ctx.restore();
      }
    }
  }
  // brush cursor
  ctx.setTransform(d, 0, 0, d, 0, 0);
  if (hover && (INK(tool) || tool === 'eraser' || tool === 'strokeEraser') && !(active && active.kind === 'pan')) {
    const r = Math.max(2, (TS[tool].size / 2) * view.s);
    ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hover.x, hover.y, r, 0, 7); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
    ctx.beginPath(); ctx.arc(hover.x, hover.y, r + 1, 0, 7); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke();
  }
  pageUI();
}

// ---------- pages ----------
let lastPUI = '';
function pageUI() {
  const t = `Page ${visiblePage() + 1} / ${doc.pages.length}`;
  if (t !== lastPUI) { lastPUI = t; $('#pageInfo').textContent = t; }
  $('#zoomInfo').textContent = Math.round(view.s / Math.max(.2, (canvas.getBoundingClientRect().width - 150) / W) * 100) + '%';
}
function goPage(i) { commitFloat(); cur = clamp(i, 0, doc.pages.length - 1); view.y = 20 - cur * PH * view.s; pageUI(); need(); }
function addPage() {
  commitFloat(); cur = visiblePage(); pushUndo();
  const p = page(); doc.pages.splice(cur + 1, 0, mkPage(p.bg, p.pattern)); dirtyAll(); goPage(cur + 1); changed();
}
function delPage() {
  commitFloat(); cur = visiblePage(); pushUndo();
  if (doc.pages.length === 1) doc.pages[0] = mkPage(page().bg, page().pattern); else { doc.pages.splice(cur, 1); cur = Math.min(cur, doc.pages.length - 1); }
  dirtyAll(); goPage(cur); changed();
}
$('#pPrev').onclick = () => goPage(visiblePage() - 1); $('#pNext').onclick = () => goPage(visiblePage() + 1);
$('#pAdd').onclick = addPage; $('#pDel').onclick = delPage; $('#zFit').onclick = () => fit(true);
$('#bUndo').onclick = undo; $('#bRedo').onclick = redo;

// ---------- files ----------
function serial() {
  const pages = doc.pages.map((p, i) => ({ bg: p.bg, pattern: p.pattern, strokes: (fl && i === cur) ? [...p.strokes, ...fl.strokes.map(s => xf(s, fl))] : p.strokes }));
  return { app: 'InkNotes', version: 1, name: doc.name, pages };
}
function loadDoc(d, name) {
  if (!d || !Array.isArray(d.pages) || !d.pages.length) throw new Error('bad file');
  doc = { name: name || d.name || 'Untitled', pages: d.pages.map(p => ({ bg: p.bg || '#ffffff', pattern: p.pattern || 'none', strokes: p.strokes || [] })) };
  cur = 0; undoS = []; redoS = []; fl = null; live = null; dirtyAll(); fit(false); changed();
}
async function newNote() {
  commitFloat();
  if (doc.pages.some(p => p.strokes.length) && !confirm('Start a new note? Unsaved changes will be lost.')) return;
  loadDoc({ pages: [mkPage(page().bg, page().pattern)] }, 'Untitled');
}
async function saveNote() { commitFloat(); const n = await window.api.saveNote(JSON.stringify(serial()), doc.name); if (n) { doc.name = n; toast('Saved'); } }
async function openNote() {
  const r = await window.api.openNote(); if (!r) return;
  try { loadDoc(JSON.parse(r.text), r.name); toast('Opened ' + r.name); } catch (e) { toast('That file is not a valid InkNotes note'); }
}
function pageCanvas(pg, scale) { const c = document.createElement('canvas'); c.width = W * scale; c.height = H * scale; renderPage(c.getContext('2d'), pg, scale); return c; }
async function exportPdf() {
  commitFloat(); toast('Exporting PDF…');
  const imgs = doc.pages.map(p => pageCanvas(p, 2).toDataURL('image/png'));
  const r = await window.api.exportPdf(imgs, doc.name); toast(r ? 'PDF saved' : 'Export cancelled');
}
async function exportPng() {
  commitFloat(); cur = visiblePage(); const r = await window.api.exportPng(pageCanvas(page(), 2).toDataURL('image/png'), `${doc.name}-page${cur + 1}`);
  toast(r ? 'PNG saved' : 'Export cancelled');
}
$('#bNew').onclick = newNote; $('#bOpen').onclick = openNote; $('#bSave').onclick = saveNote;
$('#bPdf').onclick = exportPdf; $('#bPng').onclick = exportPng;
let toastT = 0;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

// ---------- shortcuts ----------
const bump = d => { const ts = TS[tool]; if (!ts || !ts.size) return; const v = ts.size, st = v < 10 ? 1 : v < 30 ? 2 : 5; ts.size = clamp(v + d * st, 1, 100); store.set('inknote.ts', TS); syncUI(); need(); };
const ACTIONS = [
  ['undo', 'Undo', 'ctrl+z', undo], ['redo', 'Redo', 'ctrl+y', redo],
  ['pen', 'Pen', 'p', () => setTool('pen')], ['pencil', 'Pencil', 'n', () => setTool('pencil')],
  ['marker', 'Marker', 'm', () => setTool('marker')], ['highlighter', 'Highlighter', 'h', () => setTool('highlighter')],
  ['eraser', 'Eraser', 'e', () => setTool('eraser')], ['strokeEraser', 'Stroke eraser', 'x', () => setTool('strokeEraser')],
  ['lasso', 'Lasso select', 'l', () => setTool('lasso')], ['pan', 'Hand tool', 'g', () => setTool('pan')],
  ['prevTool', 'Previous tool', 'q', () => setTool(prevTool)],
  ['sizeUp', 'Bigger brush', ']', () => bump(1)], ['sizeDown', 'Smaller brush', '[', () => bump(-1)],
  ['nextPage', 'Next page', 'pagedown', () => goPage(visiblePage() + 1)], ['prevPage', 'Previous page', 'pageup', () => goPage(visiblePage() - 1)],
  ['newPage', 'Add page', 'ctrl+enter', addPage], ['delPage', 'Delete page', 'alt+delete', delPage],
  ['copy', 'Copy selection', 'ctrl+c', () => { copyFloat(); toast('Copied'); }], ['paste', 'Paste', 'ctrl+v', pasteClip],
  ['dup', 'Duplicate selection', 'ctrl+d', () => { copyFloat(); pasteClip(); }], ['del', 'Delete selection', 'delete', deleteFloat],
  ['new', 'New note', 'ctrl+alt+n', newNote], ['open', 'Open note', 'ctrl+o', openNote], ['save', 'Save note', 'ctrl+s', saveNote],
  ['pdf', 'Export PDF', 'ctrl+e', exportPdf], ['png', 'Export PNG', 'ctrl+shift+e', exportPng],
  ['fit', 'Fit page', 'ctrl+0', () => fit(true)], ['zoomIn', 'Zoom in', 'ctrl+=', () => zoomCenter(1.25)], ['zoomOut', 'Zoom out', 'ctrl+-', () => zoomCenter(.8)],
  ['settings', 'Settings', 'ctrl+,', () => openModal()]
];
const defaults = Object.fromEntries(ACTIONS.map(a => [a[0], a[2]]));
let keys = Object.assign({}, defaults, store.get('inknote.keys', {}));
function combo(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  const m = []; if (e.ctrlKey || e.metaKey) m.push('ctrl'); if (e.altKey) m.push('alt'); if (e.shiftKey) m.push('shift');
  m.push(e.key === ' ' ? 'space' : e.key.toLowerCase()); return m.join('+');
}
const pretty = c => c ? c.split('+').map(x => x.length > 1 ? x[0].toUpperCase() + x.slice(1) : x.toUpperCase()).join(' + ') : 'Not set';
let capturing = null;
document.addEventListener('keydown', e => {
  if (capturing) {
    e.preventDefault(); if (e.key === 'Escape') { capturing = null; buildKeyList(); return; }
    const c = combo(e); if (!c) return;
    for (const k in keys) if (keys[k] === c) keys[k] = '';
    keys[capturing] = c; store.set('inknote.keys', keys); capturing = null; buildKeyList(); return;
  }
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
  if (e.key === ' ' && !e.ctrlKey) { spaceDown = true; e.preventDefault(); return; }
  if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else { commitFloat(); closePops(); } return; }
  const c = combo(e); if (!c) return;
  if (c === 'ctrl+shift+z') { e.preventDefault(); redo(); return; }
  if (c === 'backspace') { if (fl) { e.preventDefault(); deleteFloat(); } return; }
  if (c === 'ctrl+shift+=') { e.preventDefault(); zoomCenter(1.25); return; }
  const a = ACTIONS.find(x => keys[x[0]] === c);
  if (a) { e.preventDefault(); if (a[0] !== 'undo' && a[0] !== 'redo') closePops(); a[3](); }
});
document.addEventListener('keyup', e => { if (e.key === ' ') spaceDown = false; });
window.addEventListener('blur', () => { spaceDown = false; });

// ---------- settings dialog ----------
function buildKeyList() {
  const el = $('#keyList'); el.innerHTML = '';
  ACTIONS.forEach(a => {
    const r = document.createElement('div'); r.className = 'krow';
    const l = document.createElement('span'); l.textContent = a[1];
    const b = document.createElement('button'); b.textContent = capturing === a[0] ? 'Press keys…' : pretty(keys[a[0]]);
    if (capturing === a[0]) b.className = 'cap';
    b.onclick = () => { capturing = a[0]; buildKeyList(); };
    r.append(l, b); el.appendChild(r);
  });
}
function openModal() {
  $('#sPress').value = Math.round(S.pressure * 100); $('#sSmooth').value = Math.round(S.smooth * 100);
  $('#sPressV').textContent = $('#sPress').value + '%'; $('#sSmoothV').textContent = $('#sSmooth').value + '%';
  buildKeyList(); $('#modal').hidden = false;
}
function closeModal() { capturing = null; $('#modal').hidden = true; }
$('#bSet').onclick = openModal; $('#mClose').onclick = closeModal;
$('#modal').addEventListener('pointerdown', e => { if (e.target.id === 'modal') closeModal(); });
$('#sPress').oninput = e => { S.pressure = e.target.value / 100; $('#sPressV').textContent = e.target.value + '%'; store.set('inknote.settings', S); };
$('#sSmooth').oninput = e => { S.smooth = e.target.value / 100; $('#sSmoothV').textContent = e.target.value + '%'; store.set('inknote.settings', S); };
$('#keyReset').onclick = () => { keys = Object.assign({}, defaults); store.set('inknote.keys', keys); buildKeyList(); };

// ---------- file menu (narrow windows) ----------
$('#bFile').onclick = () => togglePop('file');
document.querySelectorAll('.mi').forEach(b => b.onclick = () => {
  closePops(); ({ new: newNote, open: openNote, save: saveNote, pdf: exportPdf, png: exportPng })[b.dataset.act]();
});

// ---------- boot ----------
(async () => {
  document.querySelector('[data-tool="pen"]').classList.add('on');
  canvas.style.cursor = 'none'; syncUI(); resize(); fit(); changed();
  try { const t = await window.api.loadAutosave(); if (t) loadDoc(JSON.parse(t)); } catch (e) {}
})();
})();
