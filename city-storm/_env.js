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

global.ImageData = class ImageData {
  constructor(data, w, h) {
    if (typeof data === 'number') { h = w; w = data; data = new Uint8ClampedArray(w * h * 4); }
    this.data = data; this.width = w; this.height = h === undefined ? data.length / 4 / w : h;
  }
};

const els = new Map();
function getEl(id) { if (!els.has(id)) els.set(id, new El()); return els.get(id); }

// Minimal canvas + 2d context mock for procedural texture generation.
// The photoreal kit synthesises normal/roughness maps by reading pixels back
// out of the canvas, so getImageData has to return a real, correctly-sized
// buffer rather than a stub — the Sobel pass indexes straight into it.
function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  return {
    canvas,
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() {}, closePath() {}, stroke() {}, fill() {}, clearRect() {},
    save() {}, restore() {}, translate() {}, rotate() {}, scale() {},
    createLinearGradient() { return grad; }, createRadialGradient() { return grad; },
    getImageData(x, y, w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData() {},
    drawImage() {},
  };
}
function makeCanvas() {
  const c = { width: 0, height: 0 };
  c.getContext = () => makeCtx(c);
  return c;
}

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
