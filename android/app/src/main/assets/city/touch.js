/* GENERATED — do not edit. Source: shared/touch.js (tools/sync-shared.mjs). */
/* =============================================================================
   TOUCH CONTROLS — on-screen controls shared by the Android builds
   =============================================================================

   All three games were written for keyboard and mouse. Rather than hand-rolling
   a control layer per game, each one declares what it needs — an analog stick,
   a drag pad, some buttons — and this module builds it.

   Two things it gets right that a naive implementation does not:

     - Every pointer is tracked by id, so driving, aiming and firing happen at
       once. A single-touch implementation feels broken within seconds.
     - The stick floats: it snaps to wherever the thumb lands inside its zone
       rather than making the player find a fixed pad they cannot see.

   Layout is in vh units throughout, so the controls stay thumb-sized on a
   4-inch phone and on a tablet without a media query in sight. Safe-area insets
   are respected, which matters on any device with a cutout or gesture bar.

   Requires nothing but the DOM.
============================================================================= */

const CSS = `
.tc-layer{position:absolute;inset:0;z-index:6;display:none;touch-action:none;
  --tc-sl:env(safe-area-inset-left,0px);--tc-sr:env(safe-area-inset-right,0px);
  --tc-sb:env(safe-area-inset-bottom,0px);--tc-st:env(safe-area-inset-top,0px)}
.tc-layer.tc-on{display:block}
.tc-hint{position:absolute;left:0;right:0;pointer-events:none;display:flex;
  align-items:center;justify-content:center;transition:opacity 1.2s}
.tc-hint b{font-weight:400;font-size:2.2vh;letter-spacing:.45vh;
  color:rgba(210,235,215,.55);text-shadow:0 0 1vh rgba(0,0,0,.95)}
.tc-stick{position:absolute;border-radius:50%;pointer-events:none;opacity:.5;
  border:1px solid rgba(190,225,200,.30);
  background:radial-gradient(circle,rgba(12,26,16,.30),rgba(4,10,6,.55));
  transition:opacity .18s}
.tc-stick.tc-live{opacity:1}
.tc-stick::before{content:"";position:absolute;inset:38%;border-radius:50%;
  border:1px solid rgba(190,225,200,.18)}
.tc-knob{position:absolute;left:50%;top:50%;border-radius:50%;
  border:1px solid rgba(200,240,210,.55);background:rgba(48,104,64,.45);
  box-shadow:0 0 2vh rgba(140,220,160,.30)}
.tc-btn{position:absolute;display:flex;align-items:center;justify-content:center;
  text-align:center;line-height:1.3;letter-spacing:.15vh;overflow:hidden;
  font-family:inherit;color:#d6e6da;user-select:none;-webkit-user-select:none;
  border:1px solid rgba(160,215,175,.42);background:rgba(10,26,14,.52);
  box-shadow:0 0 2vh rgba(0,0,0,.5) inset}
.tc-btn.tc-round{border-radius:50%}
.tc-btn.tc-pill{border-radius:1vh}
.tc-btn.tc-press{background:rgba(60,150,80,.68);box-shadow:0 0 2.4vh rgba(140,220,160,.5)}
.tc-btn.tc-hot{border-color:#ffd24a;color:#ffd24a}
.tc-btn.tc-off{opacity:.42}
.tc-btn.tc-warm{border-color:rgba(255,150,95,.62);background:rgba(52,18,8,.55);color:#ffbe8a}
.tc-btn.tc-warm.tc-press{background:rgba(190,78,28,.8);color:#fff}
.tc-btn>span{position:relative;z-index:1}
.tc-ring{position:absolute;inset:0;border-radius:50%;z-index:0}
.tc-sub{display:block;font-size:1.45vh;opacity:.85}
.tc-col{position:absolute;display:flex;flex-direction:column-reverse;gap:1.1vh}
/* Buttons are absolutely positioned by default, but ones inside a column have
   to stay in flow or they all stack on the column's origin. */
.tc-col>.tc-btn{position:relative;left:auto;right:auto;top:auto;bottom:auto}
`;

let cssInjected = false;
function injectCSS() {
  if (cssInjected) return;
  cssInjected = true;
  const s = document.createElement('style');
  s.textContent = CSS;
  document.head.appendChild(s);
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Place an element from one of the four corners, in vh units. */
function anchorTo(el, anchor, x, y, w, h) {
  el.style.width = w != null ? `${w}vh` : '';
  el.style.height = h != null ? `${h}vh` : '';
  const L = 'calc(' + x + 'vh + var(--tc-sl))', R = 'calc(' + x + 'vh + var(--tc-sr))';
  const B = 'calc(' + y + 'vh + var(--tc-sb))', T = 'calc(' + y + 'vh + var(--tc-st))';
  el.style.left = el.style.right = el.style.top = el.style.bottom = '';
  if (anchor[1] === 'l') el.style.left = L; else el.style.right = R;
  if (anchor[0] === 't') el.style.top = T; else el.style.bottom = B;
}

/**
 * Build a control layer.
 *
 * @param {object} cfg
 * @param {object} [cfg.stick]   floating analog stick: {zone, radius, deadzone, x, y, anchor}
 * @param {object} [cfg.pad]     drag-to-aim region: {zone, hint, hintTop, hintHeight}
 * @param {Array}  [cfg.buttons] [{id,label,sub,kind,shape,size,w,h,anchor,x,y,accent,column}]
 * @param {Function} [cfg.onPress]   (id) => void, fired on press for both kinds
 * @param {Function} [cfg.onRelease] (id) => void, fired on release for kind 'hold'
 * @param {Function} [cfg.haptic]    (ms) => void
 */
export function createTouchControls(cfg = {}) {
  injectCSS();

  const layer = document.createElement('div');
  layer.className = 'tc-layer';

  const state = {
    stick: { x: 0, y: 0 },
    padDX: 0, padDY: 0,
    held: new Set(),
    enabled: false,
  };

  const haptic = cfg.haptic || ((ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} });

  /* ------------------------------- drag pad ------------------------------ */
  let hintEl = null, hintFaded = false;
  if (cfg.pad) {
    hintEl = document.createElement('div');
    hintEl.className = 'tc-hint';
    hintEl.style.top = (cfg.pad.hintTop != null ? cfg.pad.hintTop : 0) + '%';
    hintEl.style.height = (cfg.pad.hintHeight != null ? cfg.pad.hintHeight : 42) + '%';
    hintEl.innerHTML = `<b>${cfg.pad.hint || 'DRAG TO AIM'}</b>`;
    layer.appendChild(hintEl);
  }
  const fadeHint = () => {
    if (hintFaded || !hintEl) return;
    hintFaded = true;
    hintEl.style.opacity = '0';
  };

  /* -------------------------------- stick -------------------------------- */
  let stickEl = null, knobEl = null, stickR = 80;
  if (cfg.stick) {
    stickEl = document.createElement('div');
    stickEl.className = 'tc-stick';
    knobEl = document.createElement('div');
    knobEl.className = 'tc-knob';
    stickEl.appendChild(knobEl);
    layer.appendChild(stickEl);
  }

  function layoutStick() {
    if (!stickEl) return;
    const vh = innerHeight / 100;
    const d = (cfg.stick.radius != null ? cfg.stick.radius : 11) * 2;
    stickR = (d / 2) * vh;
    anchorTo(stickEl, cfg.stick.anchor || 'bl',
      cfg.stick.x != null ? cfg.stick.x : 3,
      cfg.stick.y != null ? cfg.stick.y : 3, d, d);
    const kd = d * 0.39;
    knobEl.style.width = knobEl.style.height = `${kd}vh`;
    knobEl.style.margin = `${-kd / 2}vh 0 0 ${-kd / 2}vh`;
  }

  function placeStick(x, y) {
    const cx = clamp(x, stickR + 2, innerWidth - stickR - 2);
    const cy = clamp(y, stickR + 2, innerHeight - stickR - 2);
    stickEl.style.left = `${cx - stickR}px`;
    stickEl.style.top = `${cy - stickR}px`;
    stickEl.style.right = stickEl.style.bottom = 'auto';
    stickEl.classList.add('tc-live');
    return { x: cx, y: cy };
  }

  function resetStick() {
    if (!stickEl) return;
    knobEl.style.transform = '';
    stickEl.classList.remove('tc-live');
    stickEl.style.left = stickEl.style.top = stickEl.style.right = stickEl.style.bottom = '';
    layoutStick();
    state.stick.x = state.stick.y = 0;
  }

  function moveStick(cx, cy, x, y) {
    let dx = x - cx, dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > stickR) { dx = dx / d * stickR; dy = dy / d * stickR; }
    knobEl.style.transform = `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)`;
    const nx = dx / stickR, ny = dy / stickR;
    const mag = Math.hypot(nx, ny);
    const dz = cfg.stick.deadzone != null ? cfg.stick.deadzone : 0.14;
    const k = mag > dz ? (mag - dz) / (1 - dz) / mag : 0;   // radial dead zone
    state.stick.x = nx * k;
    state.stick.y = ny * k;
  }

  /* ------------------------------- buttons ------------------------------- */
  const buttons = new Map();
  const columns = new Map();

  for (const b of (cfg.buttons || [])) {
    const el = document.createElement('div');
    el.className = 'tc-btn ' + (b.shape === 'round' ? 'tc-round' : 'tc-pill');
    if (b.accent === 'warm') el.classList.add('tc-warm');
    const ring = document.createElement('div');
    ring.className = 'tc-ring';
    el.appendChild(ring);
    const span = document.createElement('span');
    span.innerHTML = b.sub ? `${b.label}<b class="tc-sub">${b.sub}</b>` : b.label;
    el.appendChild(span);
    el.dataset.id = b.id;

    if (b.column) {
      let col = columns.get(b.column);
      if (!col) {
        col = document.createElement('div');
        col.className = 'tc-col';
        columns.set(b.column, col);
        layer.appendChild(col);
      }
      col.appendChild(el);
    } else {
      layer.appendChild(el);
    }
    buttons.set(b.id, { cfg: b, el, ring, span });
  }

  function layoutButtons() {
    for (const [, col] of columns) col.style.cssText = col.style.cssText;  // keep inline anchors
    for (const [, b] of buttons) {
      const c = b.cfg;
      if (c.shape === 'round') {
        b.el.style.width = b.el.style.height = `${c.size}vh`;
        b.el.style.fontSize = `${c.size * 0.135}vh`;
      } else {
        b.el.style.width = `${c.w != null ? c.w : 16}vh`;
        b.el.style.height = `${c.h != null ? c.h : 5.2}vh`;
        b.el.style.fontSize = `${c.font != null ? c.font : 1.7}vh`;
      }
      if (!c.column) {
        b.el.style.position = 'absolute';
        anchorTo(b.el, c.anchor || 'br', c.x || 3, c.y || 3, null, null);
        if (c.shape === 'round') { b.el.style.width = b.el.style.height = `${c.size}vh`; }
        else { b.el.style.width = `${c.w != null ? c.w : 16}vh`; b.el.style.height = `${c.h != null ? c.h : 5.2}vh`; }
      }
    }
    for (const [name, col] of columns) {
      const first = [...buttons.values()].find((b) => b.cfg.column === name);
      if (!first) continue;
      anchorTo(col, first.cfg.anchor || 'br', first.cfg.x || 3, first.cfg.y || 3, null, null);
    }
  }

  /* ---------------------------- pointer routing -------------------------- */
  const pointers = new Map();

  const inZone = (fn, x, y) => (typeof fn === 'function' ? fn(x, y, innerWidth, innerHeight) : false);
  const defaultStickZone = (x, y, w, h) => x < w * 0.45 && y > h * 0.44;
  const defaultPadZone = (x, y, w, h) => y < h * 0.44;

  layer.addEventListener('pointerdown', (e) => {
    if (e.target !== layer && e.target !== hintEl && !(hintEl && hintEl.contains(e.target))) return;
    e.preventDefault();
    if (!state.enabled) return;
    try { layer.setPointerCapture(e.pointerId); } catch (err) {}
    const x = e.clientX, y = e.clientY;

    const stickZone = cfg.stick ? (cfg.stick.zone || defaultStickZone) : null;
    if (stickZone && inZone(stickZone, x, y)) {
      for (const p of pointers.values()) if (p.kind === 'stick') return;   // one stick at a time
      const c = placeStick(x, y);
      pointers.set(e.pointerId, { kind: 'stick', cx: c.x, cy: c.y });
      moveStick(c.x, c.y, x, y);
      return;
    }
    const padZone = cfg.pad ? (cfg.pad.zone || defaultPadZone) : null;
    if (padZone && inZone(padZone, x, y)) {
      pointers.set(e.pointerId, { kind: 'pad', lx: x, ly: y });
      fadeHint();
    }
  });

  layer.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    e.preventDefault();
    if (p.kind === 'stick') moveStick(p.cx, p.cy, e.clientX, e.clientY);
    else {
      if (state.enabled) { state.padDX += e.clientX - p.lx; state.padDY += e.clientY - p.ly; }
      p.lx = e.clientX; p.ly = e.clientY;
    }
  });

  const endPointer = (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (p.kind === 'stick') resetStick();
  };
  layer.addEventListener('pointerup', endPointer);
  layer.addEventListener('pointercancel', endPointer);

  for (const [id, b] of buttons) {
    const c = b.cfg;
    b.el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      if (!state.enabled) return;
      try { b.el.setPointerCapture(e.pointerId); } catch (err) {}
      b.el.classList.add('tc-press');
      if (c.kind !== 'tap') state.held.add(id);
      haptic(c.kind === 'tap' ? 12 : 18);
      cfg.onPress && cfg.onPress(id);
    });
    const up = (e) => {
      e.stopPropagation();
      if (!b.el.classList.contains('tc-press')) return;
      b.el.classList.remove('tc-press');
      state.held.delete(id);
      if (c.kind !== 'tap') cfg.onRelease && cfg.onRelease(id);
    };
    b.el.addEventListener('pointerup', up);
    b.el.addEventListener('pointercancel', up);
  }

  function layout() {
    layoutStick();
    layoutButtons();
  }

  const api = {
    el: layer,
    state,
    attach(parent) { (parent || document.body).appendChild(layer); layout(); return api; },
    show() { state.enabled = true; layer.classList.add('tc-on'); layout(); return api; },
    hide() { api.releaseAll(); state.enabled = false; layer.classList.remove('tc-on'); return api; },
    /** Read and clear the accumulated pad drag; call once per frame. */
    consumePad() {
      const d = { dx: state.padDX, dy: state.padDY };
      state.padDX = state.padDY = 0;
      return d;
    },
    isHeld(id) { return state.held.has(id); },
    setLabel(id, html) { const b = buttons.get(id); if (b) b.span.innerHTML = html; },
    setHot(id, on) { const b = buttons.get(id); if (b) b.el.classList.toggle('tc-hot', !!on); },
    setDisabled(id, on) { const b = buttons.get(id); if (b) b.el.classList.toggle('tc-off', !!on); },
    /** Sweep a progress arc round a round button — reload timers and the like. */
    setRing(id, frac, colour) {
      const b = buttons.get(id);
      if (!b) return;
      b.ring.style.background = frac > 0 && frac < 1
        ? `conic-gradient(${colour || 'rgba(255,160,90,.30)'} ${(frac * 360).toFixed(0)}deg, rgba(0,0,0,0) 0deg)`
        : 'none';
    },
    /** Drop every latched input — call on pause, death, or an overlay opening. */
    releaseAll() {
      state.held.clear();
      state.padDX = state.padDY = 0;
      pointers.clear();
      resetStick();
      for (const [, b] of buttons) b.el.classList.remove('tc-press');
    },
    fadeHint,
    layout,
  };

  addEventListener('resize', layout);
  addEventListener('orientationchange', () => setTimeout(layout, 120));
  return api;
}
