// =====================================================================
//  CITY STORM — modern browser FPS (Three.js)
//  City combat · scoped assault rifle · grenades · ammo/health pickups
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// ---------------------------------------------------------------------
//  Core setup
// ---------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x73574f);
scene.fog = new THREE.FogExp2(0x73574f, 0.0068);
const timeU = { value: 0 };

// --- procedural dusk sky dome: fbm clouds, cirrus, sunset, horizon haze ---
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { timeU, uSunDir: { value: new THREE.Vector3(-0.79, 0.34, -0.51) } },
  vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float timeU; uniform vec3 uSunDir; varying vec3 vPos;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p = p * 2.03 + vec2(13.7, 7.9); a *= 0.5; } return v; }
    void main(){
      vec3 dir = normalize(vPos);
      float h = clamp(dir.y, -1.0, 1.0);
      float sd = clamp(dot(dir, uSunDir), 0.0, 1.0);
      vec3 zen = vec3(0.05, 0.09, 0.17), hor = vec3(0.52, 0.34, 0.28);
      vec3 col = mix(hor, zen, pow(max(h, 0.0), 0.55));
      col = mix(col, hor * 0.55, smoothstep(0.0, -0.3, h));
      col += vec3(1.0, 0.62, 0.32) * (pow(sd, 900.0) * 6.0 + pow(sd, 64.0) * 0.35 + pow(sd, 8.0) * 0.12);
      col += vec3(1.0, 0.55, 0.3) * pow(sd, 3.0) * smoothstep(0.3, 0.0, h) * 0.35;
      if (h > 0.02) {
        vec2 uv = vec2(atan(dir.z, dir.x), asin(clamp(-dir.y, -1.0, 1.0))) * 2.4;
        float t = timeU * 0.004;
        float n = fbm(uv + vec2(t, t * 0.6));
        float m = smoothstep(0.42, 0.78, n) * smoothstep(0.02, 0.16, h);
        float sh = fbm(uv * 1.9 + vec2(t * 1.7, t));
        float self = smoothstep(0.35, 0.75, sh) * 0.55 + 0.45;
        vec3 cc = mix(vec3(0.30, 0.24, 0.26), vec3(1.05, 0.72, 0.5), clamp(pow(sd, 2.0) * 1.1 + h * 0.4 + n * 0.3, 0.0, 1.0));
        col = mix(col, cc * self * 0.9, m * 0.85);
        float cw = smoothstep(0.55, 0.9, fbm(uv * 3.1 - vec2(t * 2.2, 0.0))) * smoothstep(0.25, 0.55, h) * 0.5;
        vec3 cwc = mix(vec3(0.42, 0.36, 0.42), vec3(1.05, 0.8, 0.7), pow(sd, 4.0) * 0.8 + 0.2);
        col = mix(col, cwc, cw * m * 0.6);
      }
      col = mix(col, vec3(0.45, 0.34, 0.31), pow(1.0 - max(h, 0.0), 8.0) * 0.75);
      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), skyMat);
sky.frustumCulled = false;
scene.add(sky);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 800);
camera.position.set(0, 1.7, 0);

const controls = new PointerLockControls(camera, canvas);
const menu = document.getElementById('menu');
const playBtn = document.getElementById('playbtn');
const loadingEl = document.getElementById('loading');
const keysBox = document.getElementById('keys');

// ---------------------------------------------------------------------
//  Lighting — sun + hemisphere + ambient for attractive look
// ---------------------------------------------------------------------
const hemi = new THREE.HemisphereLight(0x5d6f96, 0x382a1e, 0.8);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffc9a0, 1.9);
sun.position.set(-280, 120, -180);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 100;
sun.shadow.camera.far = 800;
const s = 160;
sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
sun.shadow.camera.top = s;  sun.shadow.camera.bottom = -s;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun); scene.add(sun.target);
scene.add(new THREE.AmbientLight(0x404860, 0.35));

// warm city glow from below
const glow = new THREE.DirectionalLight(0xff7a3b, 0.35);
glow.position.set(-40, 8, -30);
scene.add(glow);

// ---------------------------------------------------------------------
//  Procedural textures (canvas — no external assets)
// ---------------------------------------------------------------------
function rrand(a, b) { return a + Math.random() * (b - a); }

function asphaltTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#26282e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 7000; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(120,124,132,${Math.random() * 0.25})` : `rgba(8,9,12,${Math.random() * 0.3})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, rrand(1, 2.5), rrand(1, 2.5));
  }
  g.globalAlpha = 0.08; g.fillStyle = '#0a0b0e';
  for (let i = 0; i < 14; i++) g.fillRect(0, Math.random() * 256, 256, rrand(3, 10));
  g.globalAlpha = 0.18; g.strokeStyle = '#101216'; g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    let x = Math.random() * 256, y = Math.random() * 256; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += rrand(-30, 30); y += rrand(-30, 30); g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(48, 48); t.anisotropy = 4;
  return t;
}

function facadeTex(base) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 60; i++) {
    g.globalAlpha = rrand(0.03, 0.09);
    g.fillStyle = Math.random() < 0.7 ? '#20242c' : '#cfc4ae';
    g.fillRect(rrand(0, 256), 0, rrand(1, 3), rrand(20, 128));
  }
  g.globalAlpha = 0.25; g.fillStyle = '#1a1d24'; g.fillRect(0, 112, 256, 16);
  g.globalAlpha = 1;
  for (let b = 0; b < 4; b++) {
    const x = 16 + b * 60, w = 44;
    if (Math.random() < 0.38) g.fillStyle = `rgba(255,${(200 + Math.random() * 40) | 0},${(120 + Math.random() * 60) | 0},1)`;
    else {
      const gr = g.createLinearGradient(0, 16, 0, 96);
      gr.addColorStop(0, '#2c3e50'); gr.addColorStop(0.5, '#1a2734'); gr.addColorStop(1, '#141d28');
      g.fillStyle = gr;
    }
    g.fillRect(x, 16, w, 80);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 3; g.strokeRect(x, 16, w, 80);
    g.beginPath(); g.moveTo(x + w / 2, 16); g.lineTo(x + w / 2, 96); g.moveTo(x, 56); g.lineTo(x + w, 56); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function softTex() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const SOFT_TEX = softTex();
const FACADE_BASES = ['#4a5568', '#5a4a42', '#57503f', '#414a52', '#5e4a3c', '#4d5560'].map(facadeTex);

// ---------------------------------------------------------------------
//  Materials
// ---------------------------------------------------------------------
const mat = {
  road:    new THREE.MeshStandardMaterial({ color: 0xa8adb5, map: asphaltTex(), roughness: 0.95, metalness: 0.05 }),
  sidewalk:new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.9 }),
  concrete:new THREE.MeshStandardMaterial({ color: 0x3a3d44, roughness: 0.85 }),
  glass:   new THREE.MeshStandardMaterial({ color: 0x8fb6d9, roughness: 0.1, metalness: 0.9, emissive: 0x1a3a5a, emissiveIntensity: 0.4 }),
  glassLit:new THREE.MeshStandardMaterial({ color: 0xffe9a8, roughness: 0.3, metalness: 0.2, emissive: 0xffcf6b, emissiveIntensity: 1.1 }),
  steel:   new THREE.MeshStandardMaterial({ color: 0x6b7078, roughness: 0.4, metalness: 0.85 }),
  dark:    new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.7, metalness: 0.4 }),
  ground:  new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 1.0 }),
  crate:   new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.85 }),
  barrel:  new THREE.MeshStandardMaterial({ color: 0x3366aa, roughness: 0.6, metalness: 0.3 }),
  barrelR: new THREE.MeshStandardMaterial({ color: 0xaa3333, roughness: 0.6, metalness: 0.3 }),
};

// ---------------------------------------------------------------------
//  Ground & road grid
// ---------------------------------------------------------------------
const CITY = 5;            // buildings blocks per side
const BLOCK = 24;          // meters between buildings
const ROAD_HALF = 6;

const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat.ground);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// road plane (slightly above ground)
const roads = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), mat.road);
roads.rotation.x = -Math.PI / 2;
roads.position.y = 0.02;
roads.receiveShadow = true;
scene.add(roads);

// road lane markings
const laneMat = new THREE.MeshStandardMaterial({ color: 0xd8d2a0, emissive: 0x555030, roughness: 0.8 });
for (let i = -CITY; i <= CITY; i++) {
  for (let k = -ROAD_HALF * 2; k < ROAD_HALF * 2; k += 6) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(3, 0.05, 0.35), laneMat);
    h.position.set(i * BLOCK, 0.05, k);
    scene.add(h);
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 3), laneMat);
    v.position.set(k, 0.05, i * BLOCK);
    scene.add(v);
  }
}

// ---------------------------------------------------------------------
//  Building generator (with lit / dark windows)
// ---------------------------------------------------------------------
const colliders = [];   // {min,max} AABB for player collision

function makeBuilding(x, z) {
  const w = 12 + Math.random() * 14;
  const d = 12 + Math.random() * 14;
  const h = 18 + Math.random() * 62;
  const group = new THREE.Group();

  // facade: canvas texture (one floor x 4 window bays) tiled per building;
  // emissiveMap makes the lit windows glow at dusk
  const ft = FACADE_BASES[(Math.random() * FACADE_BASES.length) | 0].clone();
  ft.repeat.set(Math.max(1, Math.round(w / 8)), Math.max(2, Math.round(h / 3.2)));
  const facMat = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.85, metalness: 0.1, emissive: 0xffc98a, emissiveMap: ft, emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [facMat, facMat, mat.concrete, mat.concrete, facMat, facMat]);
  body.position.y = h / 2;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // roof detail
  const ac = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 2, d * 0.5), mat.dark);
  ac.position.y = h + 1; ac.castShadow = true; group.add(ac);

  const px = x, pz = z;
  group.position.set(px, 0, pz);
  scene.add(group);

  colliders.push({
    min: new THREE.Vector3(px - w / 2 - 0.5, -1, pz - d / 2 - 0.5),
    max: new THREE.Vector3(px + w / 2 + 0.5, h + 2, pz + d / 2 + 0.5)
  });
  return group;
}

// place buildings in blocks, leaving roads
for (let bx = -CITY; bx <= CITY; bx++) {
  for (let bz = -CITY; bz <= CITY; bz++) {
    if (Math.random() < 0.12) continue; // empty lot / plaza
    const cx = bx * BLOCK + (Math.random() * 8 - 4);
    const cz = bz * BLOCK + (Math.random() * 8 - 4);
    // keep spawn clear
    if (Math.abs(cx) < 18 && Math.abs(cz) < 18) continue;
    makeBuilding(cx, cz);
  }
}

// street props: barrels, crates, lamp posts
function addBarrel(x, z, m = mat.barrel) {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.5, 16), m);
  b.position.set(x, 0.75, z); b.castShadow = true; scene.add(b);
  colliders.push({ min: new THREE.Vector3(x - 0.7, -1, z - 0.7), max: new THREE.Vector3(x + 0.7, 1.6, z + 0.7) });
}
function addCrate(x, z, s = 1.4) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat.crate);
  c.position.set(x, s / 2, z); c.rotation.y = Math.random() * Math.PI; c.castShadow = true; scene.add(c);
  colliders.push({ min: new THREE.Vector3(x - s / 2, -1, z - s / 2), max: new THREE.Vector3(x + s / 2, s, z + s / 2) });
}
for (let i = 0; i < 40; i++) {
  const x = (Math.random() * 2 - 1) * CITY * BLOCK * 0.45;
  const z = (Math.random() * 2 - 1) * CITY * BLOCK * 0.45;
  if (Math.abs(x) < 14 && Math.abs(z) < 14) continue;
  if (Math.random() < 0.5) addBarrel(x, z, Math.random() < 0.5 ? mat.barrel : mat.barrelR);
  else if (Math.random() < 0.5) addCrate(x, z, 1.2 + Math.random() * 0.8);
}

// lamp posts with glowing bulbs
const lampBulb = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffe0a0, emissiveIntensity: 3.2 });
for (let i = -CITY; i <= CITY; i += 2) {
  for (let j = -CITY; j <= CITY; j += 2) {
    const x = i * BLOCK + ROAD_HALF + 1, z = j * BLOCK;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 6, 8), mat.dark);
    pole.position.set(x, 3, z); pole.castShadow = true; scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), lampBulb);
    bulb.position.set(x, 6.1, z); scene.add(bulb);
    // real dynamic lights only near the spawn area; far lamps are emissive-only (bloom catches them)
    if (Math.hypot(x, z) < 75) {
      const pl = new THREE.PointLight(0xffd9a0, 1.1, 30, 2);
      pl.position.set(x, 6, z); scene.add(pl);
    }
  }
}

// ---------------------------------------------------------------------
//  Audio (synthesized — no external files)
// ---------------------------------------------------------------------
const ACtx = new (window.AudioContext || window.webkitAudioContext)();
function noiseBuffer(dur = 0.3) {
  const n = ACtx.sampleRate * dur, buf = ACtx.createBuffer(1, n, ACtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.5);
  return buf;
}
function sfx(type) {
  if (ACtx.state === 'suspended') ACtx.resume();
  const t = ACtx.currentTime;
  const g = ACtx.createGain(); g.connect(ACtx.destination);
  if (type === 'shot') {
    const o = ACtx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const n = ACtx.createBufferSource(); n.buffer = noiseBuffer(0.18); const ng = ACtx.createGain(); ng.gain.setValueAtTime(0.5, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16); n.connect(ng); ng.connect(ACtx.destination);
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(g); o.start(t); o.stop(t + 0.15); n.start(t);
  } else if (type === 'boom') {
    const n = ACtx.createBufferSource(); n.buffer = noiseBuffer(0.7); const ng = ACtx.createGain(); ng.gain.setValueAtTime(0.9, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.6); n.connect(ng); ng.connect(ACtx.destination);
    const o = ACtx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.5); o.connect(g); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.6); o.start(t); o.stop(t + 0.6);
  } else if (type === 'empty') {
    const o = ACtx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(500, t + 0.06); o.connect(g); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); o.start(t); o.stop(t + 0.09);
  } else if (type === 'reload') {
    const o = ACtx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(300, t); o.frequency.linearRampToValueAtTime(600, t + 0.2); o.connect(g); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.start(t); o.stop(t + 0.26);
  } else if (type === 'hurt') {
    const o = ACtx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.2); o.connect(g); g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.start(t); o.stop(t + 0.26);
  } else if (type === 'pickup') {
    const o = ACtx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.linearRampToValueAtTime(1100, t + 0.12); o.connect(g); g.gain.setValueAtTime(0.22, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16); o.start(t); o.stop(t + 0.17);
  }
}

// ---------------------------------------------------------------------
//  Post-processing (subtle bloom for glow)
// ---------------------------------------------------------------------
let composer = null, fxaaPass = null;
function sizeFXAA() {
  if (!fxaaPass) return;
  const pr = renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.set(1 / (window.innerWidth * pr), 1 / (window.innerHeight * pr));
}
try {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.6, 0.8);
  composer.addPass(bloom);
  composer.addPass(new ShaderPass(GammaCorrectionShader));
  fxaaPass = new ShaderPass(FXAAShader);
  composer.addPass(fxaaPass);
} catch (e) { composer = null; }
sizeFXAA();

// =====================================================================
//  WEAPONS
// =====================================================================
const WEAPONS = {
  rifle: {
    name: 'ASSAULT RIFLE', mag: 30, res: 120, rpm: 600, dmg: 27, headshot: 2.4,
    fov: 75, zoomFov: 22, auto: true, spread: 0.012, recoil: 0.03, switches: true
  },
  shotgun: {
    name: 'SHOTGUN', mag: 6, res: 30, rpm: 130, dmg: 14, pellets: 8, headshot: 1.6,
    fov: 75, zoomFov: 75, auto: false, spread: 0.06, recoil: 0.09, switches: true
  }
};

const state = {
  weapon: 'rifle',
  hp: 100, maxHp: 100,
  ammo: {}, res: {},
  grenades: 4,
  kills: 0, wave: 1,
  firing: false, canFire: true,
  zoom: 0,           // 0..1 interpolation
  reloading: false,
  reloadEnd: 0,
  fireCd: 0,
  time: 0
};
state.ammo.rifle = WEAPONS.rifle.mag; state.res.rifle = WEAPONS.rifle.res;
state.ammo.shotgun = WEAPONS.shotgun.mag; state.res.shotgun = WEAPONS.shotgun.res;

// ---- view model (built per weapon) ----
function buildWeapon(kind) {
  const g = new THREE.Group();
  const bodyMat = kind === 'rifle' ? new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.5, metalness: 0.6 })
                                    : new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.7, metalness: 0.3 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.35, metalness: 0.9 });
  if (kind === 'rifle') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.62), bodyMat); body.position.set(0, 0, -0.2); g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.5, 12), metalMat); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.55); g.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), bodyMat); mag.position.set(0, -0.12, -0.05); g.add(mag);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.2), bodyMat); stock.position.set(0, -0.01, 0.22); g.add(stock);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 12), metalMat); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.085, -0.18); g.add(scope);
    g.userData.muzzle = new THREE.Object3D(); g.userData.muzzle.position.set(0, 0.02, -0.8); g.add(g.userData.muzzle);
  } else {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.7), bodyMat); body.position.set(0, 0, -0.2); g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 12), metalMat); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.01, -0.55); g.add(barrel);
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.14), bodyMat); pump.position.set(0, -0.06, -0.32); g.add(pump);
    g.userData.muzzle = new THREE.Object3D(); g.userData.muzzle.position.set(0, 0.01, -0.85); g.add(g.userData.muzzle);
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}

const viewGroup = new THREE.Group();
camera.add(viewGroup);
scene.add(camera);
let curView = null;
function equipWeapon(kind, animate = true) {
  if (curView) viewGroup.remove(curView);
  curView = buildWeapon(kind);
  viewGroup.add(curView);
  curView.position.set(0.16, -0.16, -0.35);
  curView.rotation.set(0, 0.05, 0);
  curView.userData.basePos = curView.position.clone();
  curView.userData.recoil = 0;
  curView.userData.aim = 0; // 0..1 aim interpolation
  // hide scope overlay group unless rifle
  curView.userData.kind = kind;
}
equipWeapon('rifle');

// muzzle flash light + sprite
const muzzleLight = new THREE.PointLight(0xffcc66, 0, 12);
camera.add(muzzleLight);
const flashMat = new THREE.SpriteMaterial({ color: 0xffd266, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.9, depthWrite: false });
const flash = new THREE.Sprite(flashMat); flash.scale.set(1.4, 1.4, 1);
camera.add(flash); flash.visible = false;

// =====================================================================
//  TRACERS & IMPACTS
// =====================================================================
const tracers = [];
function spawnTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.85 }));
  scene.add(line);
  tracers.push({ line, life: 0.08 });
}
const impacts = [];
function spawnImpact(pos) {
  const geo = new THREE.SphereGeometry(0.08, 6, 6);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.9 }));
  m.position.copy(pos); scene.add(m);
  impacts.push({ mesh: m, life: 0.12 });
  // spark burst
  for (let i = 0; i < 7; i++) puff(pos, new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 1.5, (Math.random() - 0.5) * 5), Math.random() < 0.5 ? 0xffd27a : 0xffffff, 0.14, 1.4, 0.16 + Math.random() * 0.1, -3, 0.8);
}

// --- soft sprite particle pool (smoke / sparks / fireball) + pooled flash lights ---
const particles = [];
const flashPool = [];
function flashLight(pos, intensity, color) {
  let l = flashPool.find(f => !f.active);
  if (!l && flashPool.length < 6) { l = new THREE.PointLight(0xffffff, 0, 120, 1.8); l.active = false; scene.add(l); flashPool.push(l); }
  if (!l) return;
  l.active = true; l.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
  l.intensity = intensity * 60; l.color.set(color);
}
function puff(pos, vel, color, size, grow, life, grav, baseO = 0.5) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: SOFT_TEX, color, transparent: true, opacity: baseO, depthWrite: false }));
  m.position.copy(pos); m.scale.set(size, size, 1); scene.add(m);
  particles.push({ mesh: m, pos: pos.clone(), vel, life, maxLife: life, grow, baseS: size, baseO, grav });
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); continue; }
    p.vel.y += p.grav * dt;
    p.pos.addScaledVector(p.vel, dt);
    if (p.pos.y < 0.2) p.pos.y = 0.2;
    p.mesh.position.copy(p.pos);
    const t = 1 - p.life / p.maxLife;
    const sz = p.baseS * (1 + p.grow * t);
    p.mesh.scale.set(sz, sz, 1);
    p.mesh.material.opacity = p.baseO * (p.life / p.maxLife);
  }
  for (const f of flashPool) if (f.active) { f.intensity *= Math.max(0, 1 - dt * 90); if (f.intensity < 0.5) { f.intensity = 0; f.active = false; } }
}

// =====================================================================
//  ENEMIES
// =====================================================================
const enemies = [];
function makeEnemy(x, z) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.02, 0.6, 0.35), roughness: 0.8 });
  const vest = new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.7, metalness: 0.2, emissive: 0xff5a2a, emissiveIntensity: 0 });
  // body
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.35), vest); torso.position.y = 1.3; torso.castShadow = true; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 12), skin); head.position.y = 1.85; head.castShadow = true; g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat.dark); helmet.position.y = 1.88; g.add(helmet);
  const armGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18);
  const lArm = new THREE.Mesh(armGeo, skin); lArm.position.set(-0.42, 1.35, 0.1); lArm.rotation.x = -0.6; g.add(lArm);
  const rArm = new THREE.Mesh(armGeo, skin); rArm.position.set(0.42, 1.35, 0.15); rArm.rotation.x = -0.8; g.add(rArm);
  const legGeo = new THREE.BoxGeometry(0.2, 0.8, 0.22);
  const lLeg = new THREE.Mesh(legGeo, mat.dark); lLeg.position.set(-0.17, 0.5, 0); lLeg.castShadow = true; g.add(lLeg);
  const rLeg = new THREE.Mesh(legGeo, mat.dark); rLeg.position.set(0.17, 0.5, 0); rLeg.castShadow = true; g.add(rLeg);
  // enemy weapon
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.6), mat.dark); gun.position.set(0.42, 1.3, 0.45); g.add(gun);

  g.position.set(x, 0, z);
  g.userData.isEnemy = true;
  scene.add(g);
  const e = { mesh: g, hp: 100, maxHp: 100, head, headY: 1.85, lArm, rArm, lLeg, rLeg, vestMat: vest,
    fireCd: 0, alive: true, hitFlash: 0, walk: Math.random() * 6, speed: 2.6 + Math.random() * 1.4 };
  enemies.push(e);
  return e;
}

function spawnWave(n) {
  for (let i = 0; i < n; i++) {
    let x, z, tries = 0;
    do { x = (Math.random() * 2 - 1) * CITY * BLOCK * 0.7; z = (Math.random() * 2 - 1) * CITY * BLOCK * 0.7; tries++; }
    while (Math.hypot(x - camera.position.x, z - camera.position.z) < 40 && tries < 40);
    makeEnemy(x, z);
  }
}

function damageEnemy(e, dmg, headshot) {
  if (!e.alive) return;
  e.hp -= dmg; e.hitFlash = 0.12;
  { const hp2 = e.mesh.position.clone(); hp2.y += 1.4;
    for (let i = 0; i < 5; i++) puff(hp2, new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3), headshot ? 0xff8a5a : 0xd8d0c0, 0.16, 1.3, 0.15, -1.5, 0.7); }
  // knockback nudge
  const dir = new THREE.Vector3(); dir.subVectors(e.mesh.position, camera.position).y = 0; dir.normalize();
  e.mesh.position.addScaledVector(dir, headshot ? 0.18 : 0.08);
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  if (!e.alive) return;
  e.alive = false;
  // death animation: fall over
  e.deathT = 0;
  state.kills++;
  updateHUD();
  sfx('pickup'); // reuse feedback sound
  // drop a pickup sometimes
  if (Math.random() < 0.5) spawnPickup(e.mesh.position.x, e.mesh.position.z);
}

// =====================================================================
//  PICKUPS  (ammo + health)
// =====================================================================
const pickups = [];
function spawnPickup(x, z) {
  const isHealth = Math.random() < 0.45;
  const g = new THREE.Group();
  const col = isHealth ? 0x33ff7a : 0xffcf40;
  const boxMat = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, roughness: 0.4, metalness: 0.3 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), boxMat); box.castShadow = true; g.add(box);
  // label ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.55; g.add(ring);
  const icon = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.06), new THREE.MeshStandardMaterial({ color: 0x101214 }));
  icon.position.set(0, 0.31, 0.42); g.add(icon); // simple cross/box marker
  if (isHealth) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 0.06), new THREE.MeshStandardMaterial({ color: 0xdf2030 })); v.position.set(0, 0.5, 0.42); g.add(v); const h = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.06), new THREE.MeshStandardMaterial({ color: 0xdf2030 })); h.position.set(0, 0.5, 0.42); g.add(h); }
  else { const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x8a6a2a })); b.position.y = 0.35; g.add(b); }
  g.position.set(x, 0.5, z); scene.add(g);
  pickups.push({ mesh: g, kind: isHealth ? 'health' : 'ammo', spin: 0 });
}
// initial scattered pickups
for (let i = 0; i < 10; i++) {
  spawnPickup((Math.random() * 2 - 1) * CITY * BLOCK * 0.5, (Math.random() * 2 - 1) * CITY * BLOCK * 0.5);
}

// =====================================================================
//  GRENADES
// =====================================================================
const grenades = [];
const explosionFxs = [];
function throwGrenade() {
  if (state.grenades <= 0 || state.reloading) return;
  state.grenades--;
  updateHUD();
  const origin = camera.position.clone();
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  const g = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.28, 10), new THREE.MeshStandardMaterial({ color: 0x3a4a2a, roughness: 0.6, metalness: 0.4 }));
  g.position.copy(origin).add(new THREE.Vector3(0, 0.3, 0));
  g.castShadow = true; scene.add(g);
  const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.05), mat.steel); pin.position.set(0, 0.18, 0); g.add(pin);
  const vel = new THREE.Vector3().addScaledVector(dir, 22); vel.y += 6;
  grenades.push({ mesh: g, vel, spin: (Math.random() - 0.5) * 12, life: 3.0, fuse: 2.4, bob: 0 });
  sfx('reload');
}

function explode(pos, radius = 8, dmg = 120) {
  sfx('boom');
  // flash
  const light = new THREE.PointLight(0xffaa33, 6, 60); light.position.copy(pos); scene.add(light);
  explosionFxs.push({ mesh: light, life: 0.25, max: 0.25 });
  // shockwave ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.6, 24), new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.copy(pos); ring.position.y += 0.1; scene.add(ring);
  explosionFxs.push({ mesh: ring, life: 0.4, max: 0.4, ring: true });
  // damage enemies
  for (const e of enemies) {
    if (!e.alive) continue;
    const d = e.mesh.position.distanceTo(pos);
    if (d < radius) damageEnemy(e, dmg * (1 - d / radius) * 1.6, false);
  }
  // damage player
  const dp = camera.position.distanceTo(pos);
  if (dp < radius) takeDamage(60 * (1 - dp / radius));
  // debris particles
  for (let i = 0; i < 14; i++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ color: 0x333, emissive: 0x442200, emissiveIntensity: 0.5 }));
    p.position.copy(pos); p.position.add(new THREE.Vector3((Math.random()-0.5)*2,(Math.random()),(Math.random()-0.5)*2));
    scene.add(p);
    explosionFxs.push({ mesh: p, life: 0.7, max: 0.7, debris: true,
      vel: new THREE.Vector3((Math.random()-0.5)*10, 4 + Math.random()*6, (Math.random()-0.5)*10) });
  }
  // fireball + smoke column
  puff(pos.clone(), new THREE.Vector3(0, 1.5, 0), 0xff9a4a, 2.6, 1.8, 0.35, -1.2, 0.8);
  flashLight(pos, 3, 0xffd9a8);
  for (let i = 0; i < 6; i++) puff(pos.clone(), new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3), 0x555a60, 1.8 + Math.random(), 2.4, 1.4 + Math.random(), -0.35, 0.5);
}

// =====================================================================
//  PLAYER PHYSICS & COLLISION
// =====================================================================
const velocity = new THREE.Vector3();
let onGround = true;
const PLAYER_R = 0.5;
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

function collide(pos) {
  for (const c of colliders) {
    const cx = Math.max(c.min.x, Math.min(pos.x, c.max.x));
    const cz = Math.max(c.min.z, Math.min(pos.z, c.max.z));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < PLAYER_R * PLAYER_R) {
      const dist = Math.sqrt(d2) || 0.0001;
      const push = (PLAYER_R - dist) / dist;
      pos.x += dx * push; pos.z += dz * push;
    }
  }
}

// =====================================================================
//  COMBAT
// =====================================================================
const raycaster = new THREE.Raycaster();
function fire() {
  const w = WEAPONS[state.weapon];
  if (state.reloading || state.time < state.reloadEnd) return;
  if (state.fireCd > 0) return;                    // fire-rate cooldown
  if (state.ammo[state.weapon] <= 0) { sfx('empty'); state.fireCd = 0.25; return; }
  state.ammo[state.weapon]--;
  updateHUD();
  sfx('shot');

  // recoil kick
  camera.rotation.x += w.recoil * (0.8 + Math.random() * 0.4);
  curView.userData.recoil = 1;

  // muzzle flash
  muzzleLight.position.copy(curView.userData.muzzle.getWorldPosition(new THREE.Vector3()));
  muzzleLight.intensity = 4; flash.visible = true; flash.position.copy(muzzleLight.position); flash.scale.setScalar(1.2 + Math.random() * 0.6);
  setTimeout(() => { muzzleLight.intensity = 0; flash.visible = false; }, 45);
  const mzp = muzzleLight.position.clone();
  flashLight(mzp, state.weapon === 'shotgun' ? 1.6 : 0.8, 0xffcf8a);
  for (let q = 0; q < 3; q++) puff(mzp, new THREE.Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), 0x9aa0a8, 0.25, 1.6, 0.3, -0.4, 0.4);

  const pellets = w.pellets || 1;
  for (let p = 0; p < pellets; p++) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.x += (Math.random() - 0.5) * w.spread;
    dir.y += (Math.random() - 0.5) * w.spread;
    dir.z += (Math.random() - 0.5) * w.spread;
    dir.normalize();
    raycaster.set(camera.position, dir);
    // hit enemies
    let hitEnemy = null, hitDist = Infinity, headshot = false;
    const eMeshes = enemies.filter(e => e.alive).map(e => e.mesh);
    const enemyHits = raycaster.intersectObjects(eMeshes, true);
    if (enemyHits.length) {
      hitDist = enemyHits[0].distance;
      let obj = enemyHits[0].object;
      while (obj.parent && !obj.userData.isEnemy) obj = obj.parent;
      const e = enemies.find(en => en.mesh === obj);
      if (e) {
        hitEnemy = e;
        // detect headshot by walking up to the head mesh
        let o2 = enemyHits[0].object;
        while (o2) { if (o2 === e.head) { headshot = true; break; } o2 = o2.parent; }
      }
    }
    // hit buildings for tracer end
    let buildingHits = raycaster.intersectObjects(scene.children.filter(o => o.userData !== undefined && o.userData.isColliderObj), false);
    const buildingDist = buildingHits.length ? buildingHits[0].distance : Infinity;

    const from = camera.position.clone().addScaledVector(dir, 0.5);
    const endDist = Math.min(hitDist, buildingDist, 300);
    const end = camera.position.clone().addScaledVector(dir, endDist);
    spawnTracer(from, end);
    if (endDist === buildingDist && !hitEnemy) spawnImpact(end.clone());

    if (hitEnemy && hitDist < buildingDist) {
      const dmg = w.dmg * (headshot ? w.headshot : 1);
      damageEnemy(hitEnemy, dmg, headshot);
      showHitmarker(headshot);
    }
  }

  state.fireCd = 60 / w.rpm;   // throttle automatic fire
}

function showHitmarker(head) {
  const hm = document.getElementById('hitmarker');
  hm.style.opacity = '1'; hm.style.transition = 'none';
  hm.querySelectorAll('i').forEach(i => i.style.background = head ? '#ff3b5c' : '#fff');
  setTimeout(() => { hm.style.transition = 'opacity .18s'; hm.style.opacity = '0'; }, 60);
}

function reload() {
  const w = WEAPONS[state.weapon];
  if (state.reloading || state.ammo[state.weapon] === w.mag || state.res[state.weapon] <= 0) return;
  state.reloading = true; state.reloadEnd = state.time + 1.3;
  sfx('reload');
}

// =====================================================================
//  DAMAGE / PLAYER HEALTH
// =====================================================================
let invuln = 0;
function takeDamage(amount) {
  if (invuln > 0) return;
  state.hp = Math.max(0, state.hp - amount);
  invuln = 0.4;
  sfx('hurt');
  const d = document.getElementById('damage');
  d.style.opacity = '1'; d.style.transition = 'none';
  setTimeout(() => { d.style.transition = 'opacity .4s'; d.style.opacity = '0'; }, 90);
  updateHUD();
  if (state.hp <= 0) handleGameOver();
}

// =====================================================================
//  HUD
// =====================================================================
const el = {
  hp: document.getElementById('hpfill'), ammo: document.getElementById('ammoN'),
  res: document.getElementById('ammoRes'), gren: document.getElementById('grenN'),
  kills: document.getElementById('kills'), wave: document.getElementById('waveN'),
  alive: document.getElementById('alive'), msg: document.getElementById('msg'),
  prompt: document.getElementById('prompt'), scope: document.getElementById('scope')
};
function updateHUD() {
  el.hp.style.width = (state.hp / state.maxHp * 100) + '%';
  el.ammo.textContent = state.ammo[state.weapon];
  el.res.textContent = state.res[state.weapon];
  el.gren.textContent = state.grenades;
  el.kills.textContent = state.kills;
  el.wave.textContent = state.wave;
  const aliveCount = enemies.filter(e => e.alive).length;
  el.alive.textContent = 'Hostiles: ' + aliveCount;
}
function showMsg(t, ms = 1600) { el.msg.textContent = t; el.msg.style.opacity = '1'; clearTimeout(showMsg._t); showMsg._t = setTimeout(() => el.msg.style.opacity = '0', ms); }
function showPrompt(t, on) { el.prompt.style.opacity = on ? '1' : '0'; el.prompt.textContent = t; }

// =====================================================================
//  MENU / POINTER LOCK
// =====================================================================
let started = false, gameOver = false;
playBtn.addEventListener('click', () => {
  if (ACtx.state === 'suspended') ACtx.resume();
  loadingEl.style.display = 'none'; keysBox.style.display = 'grid';
  playBtn.textContent = 'DEPLOY';
  playBtn.style.display = 'block';
  controls.lock();   // synchronous user gesture (button click) — required to lock the pointer
});

// On load: make sure the menu is set up correctly (the DEPLOY button must be
// visible before it can ever be clicked).
(function initMenu() {
  el.scope.classList.remove('on');
  loadingEl.style.display = 'none';
  keysBox.style.display = 'grid';
  playBtn.style.display = 'block';
})();

controls.addEventListener('lock', () => { started = true; menu.style.display = 'none'; if (gameOver) resetGame(); });
controls.addEventListener('unlock', () => {
  if (!gameOver) { menu.style.display = 'flex'; document.getElementById('keys').style.display = 'grid'; playBtn.style.display = 'block'; loadingEl.style.display = 'none'; playBtn.textContent = 'RESUME'; }
});

canvas.addEventListener('mousedown', e => {
  if (e.button === 2) e.preventDefault();
  if (!controls.isLocked) {
    controls.lock();   // user gesture: click the canvas to lock the mouse (then it fires)
    return;
  }
  if (!started) return;
  if (e.button === 0) { state.firing = true; fire(); }
  if (e.button === 2) enterScope(true);
});
canvas.addEventListener('mouseup', e => {
  if (e.button === 0) state.firing = false;
  if (e.button === 2) enterScope(false);
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// auto-fire for automatic weapons
setInterval(() => { if (started && state.firing && WEAPONS[state.weapon].auto) fire(); }, 30);

window.addEventListener('keydown', e => {
  if (!started) return;
  switch (e.code) {
    case 'KeyR': reload(); break;
    case 'KeyQ': throwGrenade(); break;
    case 'Space': if (onGround) { velocity.y = 7.2; onGround = false; } break;
    case 'Digit1': swapWeapon('rifle'); break;
    case 'Digit2': swapWeapon('shotgun'); break;
    case 'KeyE': tryUse(); break;
  }
});

function enterScope(on) {
  if (state.weapon !== 'rifle') { el.scope.classList.remove('on'); state.zoom = 0; return; }
  el.scope.classList.toggle('on', on);
  state.wantZoom = on;
}

function swapWeapon(kind) {
  if (kind === state.weapon || !WEAPONS[kind].switches) return;
  state.weapon = kind; state.zoom = 0; state.wantZoom = false; el.scope.classList.remove('on');
  equipWeapon(kind); updateHUD(); showMsg(WEAPONS[kind].name, 900);
}

function tryUse() {
  // pick up nearest pickup
  let best = null, bd = 3.2;
  for (const p of pickups) {
    const d = p.mesh.position.distanceTo(camera.position);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) collectPickup(best);
  else showPrompt('', false);
}
function collectPickup(p) {
  sfx('pickup'); showMsg(p.kind === 'health' ? '+HEALTH' : '+AMMO', 900);
  if (p.kind === 'health') { state.hp = Math.min(state.maxHp, state.hp + 45); }
  else { state.res.rifle += 60; state.res.shotgun += 8; }
  scene.remove(p.mesh);
  pickups.splice(pickups.indexOf(p), 1);
  updateHUD();
}

// =====================================================================
//  GAME OVER / RESET
// =====================================================================
function handleGameOver() {
  gameOver = true; started = false;
  controls.unlock();
  sfx('boom');
  const m = document.getElementById('menu');
  m.style.display = 'flex';
  document.getElementById('keys').style.display = 'none';
  const b = document.getElementById('playbtn'); b.style.display = 'block';
  b.textContent = 'REDEPLOY';
  document.getElementById('loading').style.display = 'block';
  document.getElementById('loading').textContent = `YOU DIED · KILLS: ${state.kills} · WAVE: ${state.wave}`;
}
function resetGame() {
  // clear enemies & pickups
  for (const e of enemies) scene.remove(e.mesh); enemies.length = 0;
  for (const p of pickups) scene.remove(p.mesh); pickups.length = 0;
  for (const g of grenades) scene.remove(g.mesh); grenades.length = 0;
  state.hp = 100; state.kills = 0; state.wave = 1; state.grenades = 4;
  state.ammo.rifle = WEAPONS.rifle.mag; state.res.rifle = WEAPONS.rifle.res;
  state.ammo.shotgun = WEAPONS.shotgun.mag; state.res.shotgun = WEAPONS.shotgun.res;
  state.weapon = 'rifle'; equipWeapon('rifle');
  camera.position.set(0, 1.7, 8); camera.rotation.set(0, 0, 0); camera.rotation.order = 'YXZ';
  state.fireCd = 0;
  for (let i = 0; i < 8; i++) spawnPickup((Math.random()*2-1)*CITY*BLOCK*0.4, (Math.random()*2-1)*CITY*BLOCK*0.4);
  spawnWave(5); updateHUD(); showMsg('WAVE 1', 1500);
  gameOver = false;
}

// =====================================================================
//  MAIN LOOP
// =====================================================================
const clock = new THREE.Clock();
let walkBob = 0;

function update(dt) {
  state.time += dt;
  if (state.fireCd > 0) state.fireCd = Math.max(0, state.fireCd - dt);
  updateParticles(dt);

  // --- movement ---
  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? 9.5 : 6.2;
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(forward);
  if (keys['KeyS']) move.sub(forward);
  if (keys['KeyD']) move.add(right);
  if (keys['KeyA']) move.sub(right);
  const moving = move.lengthSq() > 0;
  if (moving) move.normalize().multiplyScalar(speed * dt);
  camera.position.x += move.x; camera.position.z += move.z;
  // gravity
  velocity.y -= 20 * dt;
  camera.position.y += velocity.y * dt;
  const floor = 1.7;
  if (camera.position.y <= floor) { camera.position.y = floor; velocity.y = 0; onGround = true; }
  collide(camera.position);

  // --- zoom interpolation (scope) ---
  const w = WEAPONS[state.weapon];
  const targetZoom = state.wantZoom ? 1 : 0;
  state.zoom += (targetZoom - state.zoom) * Math.min(1, dt * 12);
  const targetFov = w.fov + (w.zoomFov - w.fov) * state.zoom;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 14);
  camera.updateProjectionMatrix();

  // --- view model aim & bob ---
  if (curView) {
    const aim = state.zoom;
    curView.userData.aim += (aim - curView.userData.aim) * Math.min(1, dt * 14);
    const bp = curView.userData.basePos;
    // when scoped, move weapon down-right and scale
    curView.position.set(
      bp.x + aim * 0.14,
      bp.y - aim * 0.12,
      bp.z + aim * 0.05
    );
    // recoil
    curView.userData.recoil += (0 - curView.userData.recoil) * Math.min(1, dt * 10);
    const rec = curView.userData.recoil;
    // walk bob
    if (moving && onGround) walkBob += dt * speed * 1.6;
    else walkBob *= 0.9;
    const bob = moving ? Math.sin(walkBob) * 0.012 : 0;
    curView.position.y += bob;
    curView.position.x += Math.cos(walkBob * 0.5) * 0.008;
    curView.rotation.z = rec * -0.4;
    curView.position.z = bp.z - rec * 0.12 + (moving ? 0 : -0.02);
  }

  // --- reload completion ---
  if (state.reloading && state.time >= state.reloadEnd) {
    const w = WEAPONS[state.weapon];
    const need = w.mag - state.ammo[state.weapon];
    const give = Math.min(need, state.res[state.weapon]);
    state.ammo[state.weapon] += give;
    state.res[state.weapon] -= give;
    state.reloading = false;
    updateHUD();
  }

  // --- grenades ---
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.vel.y -= 18 * dt;
    g.mesh.position.addScaledVector(g.vel, dt);
    g.mesh.rotation.x += g.spin * dt; g.mesh.rotation.y += g.spin * 1.3 * dt;
    g.life -= dt; g.fuse -= dt;
    // bounce
    if (g.mesh.position.y <= 0.16) {
      g.mesh.position.y = 0.16;
      g.vel.y = -g.vel.y * 0.4; g.vel.x *= 0.7; g.vel.z *= 0.7;
      g.spin *= 0.6;
      if (Math.abs(g.vel.y) < 1.5) g.vel.y = 0;
    }
    if (g.fuse <= 0) {
      explode(g.mesh.position.clone());
      scene.remove(g.mesh); grenades.splice(i, 1);
    }
  }

  // --- pickups ---
  for (const p of pickups) {
    p.spin += dt * 1.8;
    p.mesh.rotation.y = p.spin;
    p.mesh.position.y = 0.5 + Math.sin(state.time * 2 + p.spin) * 0.12;
    // auto-pickup when very close
    if (p.mesh.position.distanceTo(camera.position) < 1.6) collectPickup(p);
  }

  // --- enemies ---
  for (const e of enemies) {
    if (e.alive) {
      const toPlayer = new THREE.Vector3();
      toPlayer.set(camera.position.x - e.mesh.position.x, 0, camera.position.z - e.mesh.position.z);
      const dist = toPlayer.length();
      if (dist > 0.001) toPlayer.normalize();
      // face + move toward player
      e.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      if (dist > 3.2) {
        e.mesh.position.addScaledVector(toPlayer, e.speed * dt);
        e.walk += dt * 12;
        const sw = Math.sin(e.walk) * 0.5;
        e.lLeg.rotation.x = sw; e.rLeg.rotation.x = -sw;
        e.lArm.rotation.x = -0.6 - sw * 0.4; e.rArm.rotation.x = -0.8 + sw * 0.4;
      }
      // hit flash (emissive pulse on the vest)
      if (e.hitFlash > 0) e.hitFlash -= dt;
      e.vestMat.emissiveIntensity = e.hitFlash > 0 ? (e.hitFlash / 0.12) * 1.6 : 0;
      // attack
      e.fireCd -= dt;
      if (dist < 34 && e.fireCd <= 0) {
        e.fireCd = 0.9 + Math.random() * 0.8;
        enemyShoot(e);
      }
    } else {
      // death animation
      if (e.deathT === undefined) e.deathT = 0;
      e.deathT += dt;
      e.mesh.rotation.z = Math.min(Math.PI / 2, e.deathT * 4) * (Math.random() < 0.5 ? 1 : -1);
      e.mesh.position.y = -Math.min(0.9, e.deathT * 1.5);
      if (e.deathT > 2.2) {
        scene.remove(e.mesh);
        enemies.splice(enemies.indexOf(e), 1);
      }
    }
  }

  // --- explosions fx ---
  for (let i = explosionFxs.length - 1; i >= 0; i--) {
    const f = explosionFxs[i];
    f.life -= dt;
    const t = f.life / f.max;
    if (f.ring) { f.mesh.scale.setScalar(1 + (1 - t) * 12); f.mesh.material.opacity = t * 0.9; }
    else if (f.debris) { f.mesh.position.addScaledVector(f.vel, dt); f.vel.y -= 16 * dt; }
    else if (f.mesh.isLight) { f.mesh.intensity = (f.max / f.life) * 4; }
    else { f.mesh.scale.setScalar(1 + (1 - t) * 3); f.mesh.material.opacity = t; }
    if (f.life <= 0) { scene.remove(f.mesh); explosionFxs.splice(i, 1); }
  }

  // --- tracers ---
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i]; t.life -= dt; t.line.material.opacity = (t.life / 0.08) * 0.85;
    if (t.life <= 0) { scene.remove(t.line); tracers.splice(i, 1); }
  }
  for (let i = impacts.length - 1; i >= 0; i--) {
    const t = impacts[i]; t.life -= dt; t.mesh.material.opacity = (t.life / 0.12); t.mesh.scale.setScalar(1 + (0.12 - t.life) * 6);
    if (t.life <= 0) { scene.remove(t.mesh); impacts.splice(i, 1); }
  }

  // --- regen / regen small hp over time when low (combat pace) ---
  if (state.hp > 0 && state.hp < 30 && state.time > 3) state.hp = Math.min(30, state.hp + dt * 2);

  // --- damage invuln fade ---
  if (invuln > 0) invuln -= dt;

  // --- wave management ---
  if (enemies.filter(e => e.alive).length === 0 && started && !gameOver) {
    state.wave++;
    updateHUD();
    showMsg('WAVE ' + state.wave, 2000);
    spawnWave(4 + state.wave * 2);
    // reward
    state.grenades += 1; state.res.rifle += 30; state.res.shotgun += 4; updateHUD();
  }

  updateHUD();
}

function enemyShoot(e) {
  // tracer from enemy to player, small hit chance based on distance & player movement
  const from = e.mesh.position.clone().add(new THREE.Vector3(0, 1.3, 0));
  const to = camera.position.clone();
  const dir = new THREE.Vector3().subVectors(to, from).normalize();
  spawnTracer(from, from.clone().addScaledVector(dir, 60));
  const accuracy = 0.72 - Math.min(0.3, e.mesh.position.distanceTo(camera.position) / 100);
  if (Math.random() < accuracy * 0.28) {
    takeDamage(4 + Math.random() * 6);
  }
}

// =====================================================================
//  RESIZE & RUN
// =====================================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) composer.setSize(window.innerWidth, window.innerHeight);
  sizeFXAA();
});

// intro
showMsg('CITY STORM ONLINE', 2200);
updateHUD();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  timeU.value += dt;
  if (started && !gameOver) update(dt);
  if (composer) composer.render();
  else renderer.render(scene, camera);
}
animate();

// expose for debugging
window.__CITYSTORM = { state, enemies, WEAPONS, controls, camera, scene, renderer };
