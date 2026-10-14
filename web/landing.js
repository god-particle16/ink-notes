// Landing page: a small "try the pen" demo. Lines drawn in the hero fade away after a few seconds.
(() => {
  'use strict';
  const hero = document.getElementById('lpHero'), cv = document.getElementById('lpInk'), more = document.getElementById('lpMore');
  if (more) more.onclick = () => document.getElementById('lpFeatures').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (!hero || !cv || !matchMedia('(hover:hover) and (pointer:fine)').matches) return;   // mouse / pen only
  const g = cv.getContext('2d'), LIFE = 3200;
  let dpr = 1, w = 0, h = 0, strokes = [], cur = null, id = -1, raf = 0;
  new ResizeObserver(() => {
    const r = hero.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); w = r.width; h = r.height;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  }).observe(hero);
  function add(e) {
    const r = hero.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, t = performance.now(), a = cur.pts[cur.pts.length - 1];
    let wd;
    if (e.pointerType === 'pen') wd = 1.4 + 9 * e.pressure;                      // pen: pressure
    else { const v = a ? Math.hypot(x - a.x, y - a.y) / Math.max(1, t - a.t) : 0; wd = Math.max(1.8, 7 - v * 3); if (a) wd = a.w * .6 + wd * .4; }   // mouse: faster = thinner
    cur.pts.push({ x, y, w: wd, t }); if (!raf) raf = requestAnimationFrame(frame);
  }
  hero.addEventListener('pointerdown', e => {
    if (cur || e.button || e.target.closest('a,button')) return;
    id = e.pointerId; hero.setPointerCapture(id); cur = { pts: [] }; strokes.push(cur); add(e);
  });
  hero.addEventListener('pointermove', e => {
    if (!cur || e.pointerId !== id) return;
    for (const c of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) add(c);
  });
  const end = e => { if (cur && e.pointerId === id) cur = null; };
  hero.addEventListener('pointerup', end); hero.addEventListener('pointercancel', end);
  function frame() {
    raf = 0; const now = performance.now();
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    g.lineCap = g.lineJoin = 'round'; g.strokeStyle = '#0f1b33';
    strokes = strokes.filter(s => s === cur || (s.pts.length && now - s.pts[s.pts.length - 1].t < LIFE));
    for (const s of strokes) for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1], b = s.pts[i], k = 1 - (now - b.t) / LIFE;
      if (k <= 0) continue;
      g.globalAlpha = .9 * k * k; g.lineWidth = b.w; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    if (strokes.length) raf = requestAnimationFrame(frame);
  }
})();
