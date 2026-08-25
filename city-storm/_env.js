// Installs a minimal DOM + browser global environment for headless testing.
class El {
  constructor() {
    this.style = {};
    this._cls = new Set();
    this.classList = {
      add: (...a) => a.forEach((x) => this._cls.add(x)),
      remove: (...a) => a.forEach((x) => this._cls.delete(x)),
      toggle: (x, f) => { if (f !== undefined) this._cls.has(x) ? (f ? this._cls.add(x) : this._cls.delete(x)) : this._cls.toggle(x); else this._cls.has(x) ? this._cls.delete(x) : this._cls.add(x); },
      contains: (x) => this._cls.has(x),
    };
    this._h = {};
    this.textContent = '';
    this.children = [];
    this.className = '';
  }
  addEventListener(t, cb) { (this._h[t] = this._h[t] || []).push(cb); }
  removeEventListener(t) {}
  dispatch(t, ev) { (this._h[t] || []).forEach((cb) => cb(ev || {})); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  setAttribute() {}
  removeAttribute() {}
  getContext() { return null; }
  focus() {}
}

const els = new Map();
function getEl(id) { if (!els.has(id)) els.set(id, new El()); return els.get(id); }

// Minimal canvas + 2d context mock for procedural texture generation.
function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() {}, fill() {}, clearRect() {},
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
  };
}
function makeCanvas() { return { width: 0, height: 0, getContext: () => makeCtx() }; }

global.document = {
  getElementById: getEl,
  createElement: (t) => (t === 'canvas' ? makeCanvas() : new El()),
  querySelector: () => new El(),
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: new El(),
  documentElement: new El(),
  pointerLockElement: null,
  exitPointerLock() {},
};

class Win extends El {
  constructor() { super(); this.innerWidth = 1280; this.innerHeight = 720; this.devicePixelRatio = 2; }
}
const win = new Win();
global.window = win;
global.self = win;

// AudioContext mock
function makeGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
function makeOsc() { return { type: 'sine', frequency: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
function makeSrc() { return { buffer: null, connect() {}, start() {}, stop() {} }; }
class ACtx {
  constructor() { this.sampleRate = 44100; this.currentTime = 0; this.state = 'running'; this.destination = {}; }
  resume() { this.state = 'running'; }
  createGain() { return makeGain(); }
  createOscillator() { return makeOsc(); }
  createBufferSource() { return makeSrc(); }
  createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; }
}
win.AudioContext = ACtx;
win.webkitAudioContext = ACtx;

// requestAnimationFrame queue for manual stepping
global.__rafQueue = [];
global.__rafId = 0;
global.requestAnimationFrame = (fn) => { global.__rafQueue.push(fn); return ++global.__rafId; };
global.cancelAnimationFrame = () => {};

win.requestAnimationFrame = global.requestAnimationFrame;
win.cancelAnimationFrame = global.cancelAnimationFrame;

export { win };
