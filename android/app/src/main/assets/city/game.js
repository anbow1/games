// =====================================================================
//  CITY STORM — modern browser FPS (Three.js)
//  City combat · scoped assault rifle · grenades · ammo/health pickups
// =====================================================================
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

// ---------------------------------------------------------------------
//  Core setup
// ---------------------------------------------------------------------
// The photoreal kit reads THREE from scope, so publish it before pulling the
// module in. Static imports hoist above this line, hence the dynamic one.
globalThis.THREE = THREE;
const PR = await import('./photoreal.js');
const TC = await import('./touch.js');

// Screen-space AO and SMAA are each a full-screen pass at native resolution;
// on a mid-range phone they decide whether the game holds 60 or drops to 30.
// The light probe is a one-off bake at load and stays on everywhere.
const QUALITY_PRESETS = {
  low:  { pixelRatio: 0.70, shadowMap: 1024, shadowExtent: 34, bloom: false, ao: false, smaa: false, lamps: 4 },
  med:  { pixelRatio: 0.95, shadowMap: 1536, shadowExtent: 40, bloom: true,  ao: false, smaa: false, lamps: 2 },
  high: { pixelRatio: 1.30, shadowMap: 2048, shadowExtent: 46, bloom: true,  ao: true,  smaa: true,  lamps: 2 },
};
function store(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
let qualityName = store('cs_quality', 'med');
if (!QUALITY_PRESETS[qualityName]) qualityName = 'med';
const Q = QUALITY_PRESETS[qualityName];
let lookSens = parseFloat(store('cs_sens', '1')) || 1;
let invertLook = store('cs_invert', '0') === '1';
function haptic(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Tone mapping happens once at the end of the post chain, in the grade pass.
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();

// Blue hour: the sun is just under the skyline, so the warm light is a low rim
// and the city's own windows and sodium lamps carry the rest. Everything —
// background, fog colour, image-based lighting — is derived from this one
// shader so they cannot drift apart.
const SUN_DIR = new THREE.Vector3(0.56, 0.46, -0.38).normalize();
const skyUniforms = { uTime: { value: 0 }, uSun: { value: SUN_DIR.clone() } };
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
  vertexShader: `varying vec3 vW;void main(){vW=(modelMatrix*vec4(position,1.)).xyz;
    gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);}`,
  fragmentShader: `
    uniform vec3 uSun; uniform float uTime; varying vec3 vW;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
    void main(){
      vec3 d = normalize(vW - cameraPosition);
      float h = d.y;
      float sd = max(dot(d, uSun), 0.0);

      vec3 zenith = vec3(0.075, 0.140, 0.300);
      vec3 horizon = vec3(0.400, 0.400, 0.470);
      vec3 col = mix(horizon, zenith, clamp(1.0 - exp(-max(h,0.0) * 3.4), 0.0, 1.0));

      // Warm band where the sun sits below the skyline, falling off with height.
      float band = exp(-max(h,0.0) * 7.0) * pow(sd, 2.2);
      col += vec3(1.00, 0.50, 0.20) * band * 2.2;
      col += vec3(1.00, 0.60, 0.28) * pow(sd, 22.0) * exp(-max(h,0.0)*4.0) * 0.9;

      // Sodium-lit smog dome over the city, brightest just above the rooftops.
      col += vec3(0.50, 0.34, 0.18) * exp(-max(h,0.0) * 8.0) * 0.60;

      if (h > 0.0) {
        vec2 uv = d.xz / (h + 0.16) * 0.42;
        float cov = smoothstep(0.34, 0.80, fbm(uv * 0.5 + 3.1));
        float n = fbm(uv * 1.9 + vec2(uTime * 0.004, uTime * 0.002));
        float a = smoothstep(0.44, 0.72, n) * cov * smoothstep(0.0, 0.16, h);
        vec3 lit = mix(vec3(0.10,0.11,0.15), vec3(0.72,0.36,0.20), pow(sd, 1.6));
        col = mix(col, lit, a * 0.85);
      } else {
        col = mix(col, vec3(0.100,0.104,0.120), clamp(-h * 5.0, 0.0, 1.0));
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 40, 24), skyMat);
sky.userData.skipAO = true;   // a dome in the AO depth prepass reads as a wall
scene.add(sky);

scene.fog = new THREE.FogExp2(0x1b2030, 0.0085);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 800);
camera.position.set(0, 1.7, 0);

const menu = document.getElementById('menu');
const playBtn = document.getElementById('playbtn');
const loadingEl = document.getElementById('loading');
const keysBox = document.getElementById('keys');

// ---------------------------------------------------------------------
//  Lighting — sun + hemisphere + ambient for attractive look
// ---------------------------------------------------------------------
// Ambient comes from the prefiltered sky rather than a flat AmbientLight, so
// surfaces facing the glowing horizon are lit differently from those facing the
// dark zenith — which is most of what makes an outdoor scene read as real.
scene.environment = PR.skyEnvironment(renderer, {
  skyMaterial: skyMat,
  groundColor: 0x2b2d33,     // wet asphalt bounces little, but not nothing
  horizonFade: 0.30,
});

const sun = new THREE.DirectionalLight(0xffc48a, 3.4);
sun.position.copy(SUN_DIR).multiplyScalar(120);
// A tight box beats a big map: halving the covered area doubles texel density.
PR.tuneShadows(sun, { size: Q.shadowMap, extent: Q.shadowExtent, near: 1, far: 420, bias: -0.0006, normalBias: 0.035 });
scene.add(sun);
scene.add(sun.target);

// A dim cool fill from the opposite side stands in for skylight bouncing off
// the facades behind the player; without it, backs of objects go to pure black.
const fill = new THREE.DirectionalLight(0x6f8cc4, 0.75);
fill.position.set(-SUN_DIR.x * 60, 40, -SUN_DIR.z * 60);
scene.add(fill);

// Between towers almost no sky is visible, so the probe alone leaves the street
// unreadably dark. A hemisphere light sets a floor without flattening the
// directional cues the probe provides.
scene.add(new THREE.HemisphereLight(0x8ea6c6, 0x4a4034, 1.5));
if ('environmentIntensity' in scene) scene.environmentIntensity = 1.9;

// ---------------------------------------------------------------------
//  Materials
// ---------------------------------------------------------------------
// Every surface gets albedo + normal + roughness. Flat colour is the single
// biggest tell that a scene is synthetic: real materials vary at millimetre
// scale, and that variation is what catches a grazing light.
const TEX = {
  asphalt:  PR.roughSurface({ size: 512, color: '#5b6066', grit: 0.45, crack: 0.4, stain: 0.22, roughBase: 0.94, seed: 11, repeat: 40 }),
  concrete: PR.roughSurface({ size: 512, color: '#4a4e55', grit: 0.45, crack: 0.3, stain: 0.4, roughBase: 0.90, seed: 23, repeat: 30 }),
  roof:     PR.roughSurface({ size: 256, color: '#33363c', grit: 0.6, crack: 0.35, stain: 0.6, roughBase: 0.93, seed: 31, repeat: 1 }),
  steel:    PR.metalPanels({ size: 512, color: '#7a8088', panel: 3, wear: 0.55, streak: 0.5, seed: 41 }),
  drum:     PR.metalPanels({ size: 512, color: '#8d9299', panel: 2, wear: 0.8, streak: 0.9, seed: 53 }),
  timber:   PR.wood({ size: 256, color: '#7d5f34', planks: 4, seed: 61 }),
};

const mat = {
  road:    new THREE.MeshStandardMaterial({ ...TEX.asphalt, roughness: 1, metalness: 0.04, envMapIntensity: 1.15 }),
  sidewalk:new THREE.MeshStandardMaterial({ ...TEX.concrete, roughness: 1, metalness: 0, envMapIntensity: 0.8 }),
  concrete:new THREE.MeshStandardMaterial({ ...TEX.concrete, roughness: 1, metalness: 0, envMapIntensity: 0.8 }),
  roof:    new THREE.MeshStandardMaterial({ ...TEX.roof, roughness: 1, metalness: 0, envMapIntensity: 0.7 }),
  // Metalness rides the generated map, so paint stays dielectric and only the
  // worn-through scratches behave like bare steel.
  steel:   new THREE.MeshStandardMaterial({ ...TEX.steel, metalness: 1, roughness: 1, envMapIntensity: 1.1 }),
  dark:    new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.55, metalness: 0.65, envMapIntensity: 0.9 }),
  ground:  new THREE.MeshStandardMaterial({ ...TEX.asphalt, color: 0x9a9a9a, roughness: 1, metalness: 0.04, envMapIntensity: 1.0 }),
  crate:   new THREE.MeshStandardMaterial({ ...TEX.timber, roughness: 1, metalness: 0, envMapIntensity: 0.6 }),
  barrel:  new THREE.MeshStandardMaterial({ ...TEX.drum, color: 0x3f74b8, metalness: 1, roughness: 1, envMapIntensity: 1.2 }),
  barrelR: new THREE.MeshStandardMaterial({ ...TEX.drum, color: 0xb44242, metalness: 1, roughness: 1, envMapIntensity: 1.2 }),
};

/* ---------------------------------------------------------------------
 *  Building facades
 *
 *  The previous version built one mesh per window — up to ~230 per tower,
 *  well over twenty thousand across the skyline. Baking the whole facade
 *  (wall, recessed glass, frames, lit/dark state) into a tiling texture and
 *  scaling the box UVs per building collapses that to one mesh each, and
 *  looks better besides: real glass reflects the sky, which it can only do
 *  with an envMap and a low roughness.
 * ------------------------------------------------------------------- */
const FACADE_TILE_W = 3.4;   // metres of wall per window column in the tile
const FACADE_TILE_H = 3.3;   // metres per floor
const FACADE_COLS = 4, FACADE_ROWS = 4;

function makeFacade(seed) {
  const S = 512;
  const rnd = (() => { let a = seed >>> 0;
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

  const alb = document.createElement('canvas'); alb.width = alb.height = S;
  const emi = document.createElement('canvas'); emi.width = emi.height = S;
  const rgh = document.createElement('canvas'); rgh.width = rgh.height = S;
  const a = alb.getContext('2d'), e = emi.getContext('2d'), r = rgh.getContext('2d');

  const wallTone = 60 + rnd() * 45;
  a.fillStyle = `rgb(${wallTone | 0},${(wallTone * 1.02) | 0},${(wallTone * 1.08) | 0})`;
  a.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  r.fillStyle = '#e0e0e0'; r.fillRect(0, 0, S, S);        // concrete: rough

  // Concrete blotching and rain streaks down the wall.
  for (let i = 0; i < 260; i++) {
    a.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${0.012 + rnd() * 0.03})`;
    a.fillRect(rnd() * S, rnd() * S, 6 + rnd() * 60, 4 + rnd() * 40);
  }
  const cw = S / FACADE_COLS, ch = S / FACADE_ROWS;
  for (let row = 0; row < FACADE_ROWS; row++) {
    for (let col = 0; col < FACADE_COLS; col++) {
      const x = col * cw, y = row * ch;
      const mx = cw * 0.22, my = ch * 0.22;
      const ww = cw - mx * 2, wh = ch - my * 2;

      // Recess: a dark inset with a bright sill lip below it.
      a.fillStyle = 'rgba(0,0,0,0.55)';
      a.fillRect(x + mx - 2, y + my - 2, ww + 4, wh + 4);

      const lit = rnd() < 0.42;
      if (lit) {
        const warm = 190 + rnd() * 60;
        a.fillStyle = `rgb(${warm | 0},${(warm * 0.82) | 0},${(warm * 0.55) | 0})`;
        a.fillRect(x + mx, y + my, ww, wh);
        // Interiors are not uniform: blinds, furniture, a lamp in one corner.
        e.fillStyle = `rgb(${warm | 0},${(warm * 0.72) | 0},${(warm * 0.40) | 0})`;
        e.fillRect(x + mx, y + my, ww, wh);
        e.fillStyle = 'rgba(0,0,0,0.45)';
        for (let k = 0; k < 3; k++) e.fillRect(x + mx, y + my + rnd() * wh, ww, 1 + rnd() * 3);
        r.fillStyle = '#4d4d4d';
      } else {
        a.fillStyle = `rgb(${18 + rnd() * 14 | 0},${22 + rnd() * 16 | 0},${30 + rnd() * 20 | 0})`;
        a.fillRect(x + mx, y + my, ww, wh);
        r.fillStyle = '#141414';                            // dark glass: glossy
      }
      r.fillRect(x + mx, y + my, ww, wh);

      // Mullion and sill.
      a.fillStyle = 'rgba(0,0,0,0.5)';
      a.fillRect(x + mx + ww / 2 - 1, y + my, 2, wh);
      a.fillStyle = 'rgba(210,210,205,0.30)';
      a.fillRect(x + mx - 3, y + my + wh, ww + 6, 3);
      e.fillStyle = '#000';
      e.fillRect(x + mx + ww / 2 - 1, y + my, 2, wh);
    }
  }
  // Streaks last so they run over the sills.
  for (let i = 0; i < 60; i++) {
    const x = rnd() * S, y = rnd() * S, len = 20 + rnd() * 140;
    const grad = a.createLinearGradient(0, y, 0, y + len);
    grad.addColorStop(0, `rgba(14,12,10,${0.05 + rnd() * 0.13})`);
    grad.addColorStop(1, 'rgba(14,12,10,0)');
    a.fillStyle = grad; a.fillRect(x, y, 1 + rnd() * 3, len);
  }

  const tex = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return new THREE.MeshStandardMaterial({
    map: tex(alb, true),
    emissiveMap: tex(emi, true),
    roughnessMap: tex(rgh, false),
    emissive: 0xffffff,
    emissiveIntensity: 1.15,
    roughness: 1,
    metalness: 0.35,          // glass panes read as reflective via the env probe
    envMapIntensity: 1.4,
  });
}
const FACADES = [makeFacade(3), makeFacade(17), makeFacade(29), makeFacade(47)];

/**
 * Scale a box's UVs so a tiling facade lands at the right physical size on
 * every face. BoxGeometry lays out four vertices per face in +X,-X,+Y,-Y,+Z,-Z
 * order, which lets each pair be scaled independently.
 */
function tileBoxUVs(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const scaleFace = (face, su, sv) => {
    for (let i = 0; i < 4; i++) {
      const k = face * 4 + i;
      uv.setXY(k, uv.getX(k) * su, uv.getY(k) * sv);
    }
  };
  const rows = Math.max(1, Math.round(h / FACADE_TILE_H)) / FACADE_ROWS;
  scaleFace(0, Math.max(1, Math.round(d / FACADE_TILE_W)) / FACADE_COLS, rows);
  scaleFace(1, Math.max(1, Math.round(d / FACADE_TILE_W)) / FACADE_COLS, rows);
  scaleFace(2, w / 8, d / 8);                 // roof
  scaleFace(3, w / 8, d / 8);
  scaleFace(4, Math.max(1, Math.round(w / FACADE_TILE_W)) / FACADE_COLS, rows);
  scaleFace(5, Math.max(1, Math.round(w / FACADE_TILE_W)) / FACADE_COLS, rows);
  uv.needsUpdate = true;
}

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
  // Snap the footprint and height to the window grid so the baked facade lines
  // up with the corners instead of slicing a window in half.
  const w = Math.round((12 + Math.random() * 14) / FACADE_TILE_W) * FACADE_TILE_W;
  const d = Math.round((12 + Math.random() * 14) / FACADE_TILE_W) * FACADE_TILE_W;
  const h = Math.round((18 + Math.random() * 62) / FACADE_TILE_H) * FACADE_TILE_H;
  const group = new THREE.Group();

  const geo = new THREE.BoxGeometry(w, h, d);
  tileBoxUVs(geo, w, h, d);
  const facade = FACADES[(Math.random() * FACADES.length) | 0];
  const body = new THREE.Mesh(geo, [facade, facade, mat.roof, mat.roof, facade, facade]);
  body.position.y = h / 2;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Roof clutter — plant housing, vents, a parapet. Rooflines read as flat and
  // fake without something breaking the silhouette.
  const ac = new THREE.Mesh(new THREE.BoxGeometry(w * 0.42, 2.4, d * 0.42), mat.steel);
  ac.position.y = h + 1.2; ac.castShadow = true; ac.receiveShadow = true; group.add(ac);
  for (let i = 0; i < 3; i++) {
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 1.4 + Math.random(), 10), mat.steel);
    vent.position.set((Math.random() - 0.5) * w * 0.7, h + 0.8, (Math.random() - 0.5) * d * 0.7);
    vent.castShadow = true; group.add(vent);
  }
  const parapetH = 1.0;
  const parapet = new THREE.Mesh(new THREE.BoxGeometry(w + 0.5, parapetH, d + 0.5), mat.concrete);
  parapet.position.y = h + parapetH / 2; parapet.castShadow = true; parapet.receiveShadow = true;
  group.add(parapet);

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
const barrelGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.5, 20);
const barrelRibGeo = new THREE.TorusGeometry(0.63, 0.055, 6, 20);
function addBarrel(x, z, m = mat.barrel) {
  const b = new THREE.Mesh(barrelGeo, m);
  // Rolling hoops: the highlight they catch is what makes a drum read as steel.
  for (const y of [-0.42, 0, 0.42]) {
    const rib = new THREE.Mesh(barrelRibGeo, mat.steel);
    rib.rotation.x = Math.PI / 2; rib.position.y = y; rib.castShadow = true; b.add(rib);
  }
  b.position.set(x, 0.75, z); b.rotation.y = Math.random() * Math.PI;
  b.castShadow = true; b.receiveShadow = true; scene.add(b);
  colliders.push({ min: new THREE.Vector3(x - 0.7, -1, z - 0.7), max: new THREE.Vector3(x + 0.7, 1.6, z + 0.7) });
}
function addCrate(x, z, s = 1.4) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat.crate);
  c.position.set(x, s / 2, z); c.rotation.y = Math.random() * Math.PI;
  c.castShadow = true; c.receiveShadow = true; scene.add(c);
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
// Emissive well above 1.0 so the bulb clears the bloom threshold on the
// half-float buffer and blooms the way a sodium lamp does through haze.
const lampBulb = new THREE.MeshStandardMaterial({
  color: 0x000000, emissive: 0xffcc7a, emissiveIntensity: 3.2, roughness: 1,
});
const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 6.2, 10);
const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8);
const hoodGeo = new THREE.CylinderGeometry(0.34, 0.16, 0.34, 12, 1, true);
const bulbGeo = new THREE.SphereGeometry(0.17, 10, 8);
for (let i = -CITY; i <= CITY; i += Q.lamps) {
  for (let j = -CITY; j <= CITY; j += Q.lamps) {
    const x = i * BLOCK + ROAD_HALF + 1, z = j * BLOCK;
    const pole = new THREE.Mesh(poleGeo, mat.dark);
    pole.position.set(x, 3.1, z); pole.castShadow = true; scene.add(pole);
    const arm = new THREE.Mesh(armGeo, mat.dark);
    arm.rotation.z = Math.PI / 2; arm.position.set(x - 0.7, 6.1, z);
    arm.castShadow = true; scene.add(arm);
    const hood = new THREE.Mesh(hoodGeo, mat.dark);
    hood.position.set(x - 1.4, 6.0, z); hood.castShadow = true;
    hood.material.side = THREE.DoubleSide; scene.add(hood);
    const bulb = new THREE.Mesh(bulbGeo, lampBulb);
    bulb.position.set(x - 1.4, 5.92, z); scene.add(bulb);
    const pl = new THREE.PointLight(0xffb765, 6, 22, 2);
    pl.position.set(x - 1.4, 5.8, z); scene.add(pl);
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
let composer = null, pipe = null;
try {
  pipe = PR.buildPipeline(renderer, scene, camera,
    { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, SMAAPass },
    {
      exposure: 1.9,
      // Interiors and street lamps are authored well above 1.0, so a threshold
      // just over white picks out the actual light sources and nothing else.
      bloomThreshold: 1.02, bloomStrength: 0.55, bloomRadius: 0.85,
      ao: Q.ao, aoRadius: 0.75, aoIntensity: 0.9, aoSamples: 12, aoPower: 1.15, aoScale: 0.5,
      smaa: Q.smaa, bloom: Q.bloom,
      grade: {
        contrast: 1.07, saturation: 0.96, vignette: 0.32,
        grain: 0.042, aberration: 0.0022, sharpen: 0.40,
        lift: new THREE.Vector3(0.030, 0.026, 0.024),   // open the shadows, slightly warm
      },
    });
  composer = pipe.composer;
} catch (err) {
  console.warn('post-processing unavailable, falling back to direct render', err);
  composer = null; pipe = null;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // the grade pass did this
  renderer.toneMappingExposure = 1.05;
}

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
/* The view model fills a third of the screen at all times, so it carries more
 * of the game's perceived fidelity than anything else. Built once per weapon
 * and cached: parkerised receiver, polymer furniture, and gloved hands on the
 * grip and handguard — a floating weapon with no hands is the strongest tell
 * that a first-person view is a mock-up. */
const VIEW_MATS = {
  steelDark: new THREE.MeshStandardMaterial({ color: 0x25282d, roughness: 0.38, metalness: 0.92, envMapIntensity: 1.3 }),
  polymer:   new THREE.MeshStandardMaterial({ color: 0x1b1e21, roughness: 0.72, metalness: 0.05, envMapIntensity: 0.8 }),
  wood:      new THREE.MeshStandardMaterial({ ...PR.wood({ size: 256, color: '#4a3018', planks: 1, seed: 97, repeat: 1 }), roughness: 1, metalness: 0, envMapIntensity: 0.7 }),
  glove:     new THREE.MeshStandardMaterial({ ...PR.fabric({ size: 128, color: '#23262b', weave: 2, seed: 103, repeat: 1 }), roughness: 1, metalness: 0, envMapIntensity: 0.6 }),
  glass:     new THREE.MeshStandardMaterial({ color: 0x101c16, roughness: 0.08, metalness: 1, envMapIntensity: 2.0 }),
};

/** Gloved hand: palm block, a thumb, and four finger segments wrapped forward. */
function buildHand(flip = 1) {
  const h = new THREE.Group();
  const M = VIEW_MATS.glove;
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.088, 0.062), M); h.add(palm);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.032, 3, 6), M);
  thumb.rotation.set(0.5, 0, flip * 0.7); thumb.position.set(flip * 0.028, 0.016, 0.026); h.add(thumb);
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.030, 3, 6), M);
    f.rotation.x = Math.PI / 2 - 0.35;
    f.position.set(flip * -0.014, 0.030 - i * 0.022, -0.030);
    h.add(f);
  }
  return h;
}

function buildWeapon(kind) {
  const g = new THREE.Group();
  const { steelDark, polymer, wood, glove, glass } = VIEW_MATS;

  if (kind === 'rifle') {
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.072, 0.34), steelDark);
    upper.position.set(0, 0.012, -0.14); g.add(upper);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.062, 0.20), polymer);
    lower.position.set(0, -0.048, -0.02); g.add(lower);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.052, 0.26), polymer);
    guard.position.set(0, 0.006, -0.40); g.add(guard);
    // Picatinny slots read as a row of fine shadow lines at any distance.
    for (let i = 0; i < 9; i++) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.050, 0.006, 0.010), steelDark);
      slot.position.set(0, 0.036, -0.30 - i * 0.026); g.add(slot);
    }
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0115, 0.26, 12), steelDark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.010, -0.62); g.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.017, 0.055, 12), steelDark);
    brake.rotation.x = Math.PI / 2; brake.position.set(0, 0.010, -0.755); g.add(brake);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.155, 0.072), polymer);
    mag.position.set(0, -0.135, -0.045); mag.rotation.x = -0.16; g.add(mag);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.115, 0.052), polymer);
    grip.position.set(0, -0.115, 0.055); grip.rotation.x = 0.30; g.add(grip);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.070, 0.19), polymer);
    stock.position.set(0, -0.012, 0.20); g.add(stock);
    const optic = new THREE.Mesh(new THREE.CylinderGeometry(0.0225, 0.0225, 0.115, 14), steelDark);
    optic.rotation.x = Math.PI / 2; optic.position.set(0, 0.072, -0.15); g.add(optic);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0195, 16), glass);
    lens.position.set(0, 0.072, -0.209); lens.rotation.y = Math.PI; g.add(lens);
    const charge = new THREE.Mesh(new THREE.BoxGeometry(0.030, 0.014, 0.030), steelDark);
    charge.position.set(0, 0.048, 0.028); g.add(charge);

    const rh = buildHand(1); rh.position.set(0.005, -0.108, 0.052); rh.rotation.set(0.30, 0, 0); g.add(rh);
    const lh = buildHand(-1); lh.position.set(-0.005, -0.038, -0.40); lh.rotation.set(-0.18, 0, 0); g.add(lh);

    g.userData.muzzle = new THREE.Object3D();
    g.userData.muzzle.position.set(0, 0.010, -0.80); g.add(g.userData.muzzle);
  } else {
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.078, 0.30), steelDark);
    receiver.position.set(0, 0, -0.12); g.add(receiver);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.52, 14), steelDark);
    barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.018, -0.52); g.add(barrel);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.46, 12), steelDark);
    tube.rotation.x = Math.PI / 2; tube.position.set(0, -0.022, -0.48); g.add(tube);
    const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 12), wood);
    pump.rotation.x = Math.PI / 2; pump.position.set(0, -0.022, -0.36); g.add(pump);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.11, 0.050), wood);
    grip.position.set(0, -0.098, 0.048); grip.rotation.x = 0.32; g.add(grip);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.082, 0.22), wood);
    stock.position.set(0, -0.014, 0.20); g.add(stock);
    const bead = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), steelDark);
    bead.position.set(0, 0.040, -0.76); g.add(bead);

    const rh = buildHand(1); rh.position.set(0.005, -0.092, 0.046); rh.rotation.set(0.32, 0, 0); g.add(rh);
    const lh = buildHand(-1); lh.position.set(-0.005, -0.062, -0.36); lh.rotation.set(-0.10, 0, 0); g.add(lh);

    g.userData.muzzle = new THREE.Object3D();
    g.userData.muzzle.position.set(0, 0.018, -0.82); g.add(g.userData.muzzle);
  }
  // The view model is drawn inside the near plane; casting shadows from it just
  // produces a slab of shadow across the world.
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
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
  curView.scale.setScalar(0.62);
  curView.position.set(0.20, -0.17, -0.34);
  curView.rotation.set(0.02, 0.07, 0);
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
}

// =====================================================================
//  ENEMIES
// =====================================================================
const enemies = [];
/* ---------------------------------------------------------------------
 *  Infantry
 *
 *  Geometry and materials are built once and shared by every soldier —
 *  a wave is a dozen bodies, and cloning materials per body would multiply
 *  the shader compiles for no visual gain. The one exception is the plate
 *  carrier, cloned per enemy so a hit can actually flash on that soldier
 *  alone (the old code tracked hitFlash but never rendered it).
 *
 *  Limbs are pivot groups hung at the hip and shoulder rather than boxes
 *  centred on the limb, so rotation.x swings them from the joint the way a
 *  leg actually moves. The animation code drives the same four handles.
 * ------------------------------------------------------------------- */
const SOLDIER = (() => {
  const uniform = new THREE.MeshStandardMaterial({
    ...PR.fabric({ size: 256, color: '#3f4636', weave: 2, seed: 71, repeat: 2 }),
    roughness: 1, metalness: 0, envMapIntensity: 0.8,
  });
  const webbing = new THREE.MeshStandardMaterial({
    ...PR.fabric({ size: 256, color: '#23262a', weave: 3, seed: 83, repeat: 2 }),
    roughness: 1, metalness: 0, envMapIntensity: 0.7,
  });
  const flesh = new THREE.MeshStandardMaterial({
    ...PR.skin({ size: 256, color: '#a47a5e' }),
    roughness: 0.62, metalness: 0, envMapIntensity: 0.8,
  });
  const gear = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.55, metalness: 0.7, envMapIntensity: 1.0 });
  const boot = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.7, metalness: 0.1, envMapIntensity: 0.6 });
  const helmetM = new THREE.MeshStandardMaterial({ color: 0x39402f, roughness: 0.72, metalness: 0.25, envMapIntensity: 0.9 });
  const lens = new THREE.MeshStandardMaterial({ color: 0x0a1410, roughness: 0.12, metalness: 0.9, envMapIntensity: 1.6 });

  const G = {
    thigh: new THREE.CapsuleGeometry(0.105, 0.30, 4, 10),
    shin: new THREE.CapsuleGeometry(0.085, 0.30, 4, 10),
    boot: new THREE.BoxGeometry(0.16, 0.13, 0.30),
    knee: new THREE.SphereGeometry(0.10, 10, 8),
    pelvis: new THREE.BoxGeometry(0.36, 0.20, 0.24),
    torso: new THREE.CapsuleGeometry(0.20, 0.26, 5, 12),
    carrier: new THREE.BoxGeometry(0.42, 0.44, 0.30),
    pouch: new THREE.BoxGeometry(0.11, 0.13, 0.08),
    upperArm: new THREE.CapsuleGeometry(0.072, 0.20, 4, 9),
    foreArm: new THREE.CapsuleGeometry(0.062, 0.20, 4, 9),
    glove: new THREE.BoxGeometry(0.10, 0.13, 0.09),
    shoulder: new THREE.SphereGeometry(0.095, 10, 8),
    neck: new THREE.CylinderGeometry(0.062, 0.070, 0.10, 8),
    head: new THREE.SphereGeometry(0.108, 14, 12),
    jaw: new THREE.BoxGeometry(0.13, 0.09, 0.13),
    helmet: new THREE.SphereGeometry(0.132, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
    nvgMount: new THREE.BoxGeometry(0.07, 0.05, 0.04),
    nvgTube: new THREE.CylinderGeometry(0.026, 0.026, 0.11, 10),
    rail: new THREE.BoxGeometry(0.012, 0.012, 0.20),
    gunBody: new THREE.BoxGeometry(0.055, 0.085, 0.38),
    gunHand: new THREE.BoxGeometry(0.05, 0.055, 0.26),
    gunBarrel: new THREE.CylinderGeometry(0.013, 0.015, 0.30, 9),
    gunMag: new THREE.BoxGeometry(0.04, 0.17, 0.075),
    gunStock: new THREE.BoxGeometry(0.045, 0.075, 0.20),
    gunGrip: new THREE.BoxGeometry(0.045, 0.13, 0.055),
    gunOptic: new THREE.CylinderGeometry(0.024, 0.024, 0.13, 10),
  };

  /** Right-side limb; mirror by negating x on the returned group. */
  function buildArm() {
    const pivot = new THREE.Group();
    const sh = new THREE.Mesh(G.shoulder, uniform); sh.castShadow = true; pivot.add(sh);
    const ua = new THREE.Mesh(G.upperArm, uniform); ua.position.y = -0.18; ua.castShadow = true; pivot.add(ua);
    const elbow = new THREE.Group(); elbow.position.y = -0.34; pivot.add(elbow);
    elbow.rotation.x = 1.15;                          // forearm brought up to the weapon
    const fa = new THREE.Mesh(G.foreArm, uniform); fa.position.y = -0.16; fa.castShadow = true; elbow.add(fa);
    const gl = new THREE.Mesh(G.glove, gear); gl.position.y = -0.31; gl.castShadow = true; elbow.add(gl);
    return pivot;
  }

  function buildLeg() {
    const pivot = new THREE.Group();
    const th = new THREE.Mesh(G.thigh, uniform); th.position.y = -0.23; th.castShadow = true; pivot.add(th);
    const kn = new THREE.Mesh(G.knee, webbing); kn.position.y = -0.46; pivot.add(kn);
    const sh = new THREE.Mesh(G.shin, uniform); sh.position.y = -0.70; sh.castShadow = true; pivot.add(sh);
    const bt = new THREE.Mesh(G.boot, boot); bt.position.set(0, -0.94, 0.05); bt.castShadow = true; pivot.add(bt);
    return pivot;
  }

  function buildRifle() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(G.gunBody, gear); body.position.z = -0.05; g.add(body);
    const hand = new THREE.Mesh(G.gunHand, gear); hand.position.set(0, -0.005, -0.30); g.add(hand);
    const bar = new THREE.Mesh(G.gunBarrel, gear); bar.rotation.x = Math.PI / 2; bar.position.set(0, 0.01, -0.55); g.add(bar);
    const mag = new THREE.Mesh(G.gunMag, gear); mag.position.set(0, -0.12, -0.02); mag.rotation.x = -0.18; g.add(mag);
    const stock = new THREE.Mesh(G.gunStock, gear); stock.position.set(0, -0.01, 0.22); g.add(stock);
    const grip = new THREE.Mesh(G.gunGrip, gear); grip.position.set(0, -0.10, 0.10); grip.rotation.x = 0.28; g.add(grip);
    const optic = new THREE.Mesh(G.gunOptic, gear); optic.rotation.x = Math.PI / 2; optic.position.set(0, 0.075, -0.04); g.add(optic);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.021, 12), lens);
    glass.position.set(0, 0.075, -0.105); glass.rotation.y = Math.PI; g.add(glass);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  return { uniform, webbing, flesh, gear, boot, helmetM, lens, G, buildArm, buildLeg, buildRifle };
})();

function makeEnemy(x, z) {
  const S = SOLDIER;
  const g = new THREE.Group();

  const legL = S.buildLeg(); legL.position.set(-0.115, 0.96, 0); g.add(legL);
  const legR = S.buildLeg(); legR.position.set(0.115, 0.96, 0); g.add(legR);

  const pelvis = new THREE.Mesh(S.G.pelvis, S.uniform); pelvis.position.y = 1.02; pelvis.castShadow = true; g.add(pelvis);

  const torso = new THREE.Mesh(S.G.torso, S.uniform); torso.position.y = 1.33; torso.castShadow = true; g.add(torso);

  // Own carrier material so a hit flashes on this soldier and not the squad.
  const carrierMat = S.webbing.clone();
  const carrier = new THREE.Mesh(S.G.carrier, carrierMat);
  carrier.position.set(0, 1.33, 0.01); carrier.castShadow = true; g.add(carrier);
  for (let i = 0; i < 3; i++) {                        // magazine pouches
    const p = new THREE.Mesh(S.G.pouch, S.webbing);
    p.position.set(-0.13 + i * 0.13, 1.19, 0.19); p.castShadow = true; g.add(p);
  }

  const armL = S.buildArm(); armL.position.set(-0.245, 1.47, 0.02); g.add(armL);
  const armR = S.buildArm(); armR.position.set(0.245, 1.47, 0.02); g.add(armR);

  const neck = new THREE.Mesh(S.G.neck, S.flesh); neck.position.y = 1.58; g.add(neck);
  const head = new THREE.Mesh(S.G.head, S.flesh); head.position.y = 1.70; head.castShadow = true; g.add(head);
  const jaw = new THREE.Mesh(S.G.jaw, S.flesh); jaw.position.set(0, 1.655, 0.035); g.add(jaw);

  const helmet = new THREE.Mesh(S.G.helmet, S.helmetM); helmet.position.y = 1.715; helmet.castShadow = true; g.add(helmet);
  const mount = new THREE.Mesh(S.G.nvgMount, S.gear); mount.position.set(0, 1.775, 0.10); g.add(mount);
  for (const sx of [-0.03, 0.03]) {                    // stowed night-vision tubes
    const tube = new THREE.Mesh(S.G.nvgTube, S.gear);
    tube.rotation.x = Math.PI / 2.3; tube.position.set(sx, 1.80, 0.14); g.add(tube);
  }

  const rifle = S.buildRifle();
  rifle.position.set(0.16, 1.30, 0.18);
  rifle.rotation.set(0, -0.22, 0);
  g.add(rifle);

  g.position.set(x, 0, z);
  g.userData.isEnemy = true;
  scene.add(g);

  const e = { mesh: g, hp: 100, maxHp: 100, head, headY: 1.70,
    lArm: armL, rArm: armR, lLeg: legL, rLeg: legR, carrierMat,
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
// There is no pointer to lock on a touch screen, so the DEPLOY button starts
// the game directly and the look pad takes the place of mouse movement.
function beginPlay() {
  if (ACtx.state === 'suspended') ACtx.resume();
  loadingEl.style.display = 'none';
  playBtn.textContent = 'DEPLOY';
  menu.style.display = 'none';
  if (gameOver) resetGame();
  started = true;
  touch.show();
  haptic(20);
  setTimeout(() => touch.fadeHint(), 9000);
}
playBtn.addEventListener('click', beginPlay);

/* =====================================================================
 *  Touch controls
 *
 *  Left thumb moves, right thumb looks. Firing gets two buttons — one
 *  under each thumb — because a single fire button on the right competes
 *  with the look pad for the same thumb, and holding one means you cannot
 *  turn. Every mobile shooter that works solves it this way.
 *
 *  Sprint has no button: pushing the stick past 85% is the sprint, which
 *  is one less thing to hunt for mid-fight.
 * ===================================================================== */
const touch = TC.createTouchControls({
  stick: {
    zone: (x, y, w, h) => x < w * 0.42 && y > h * 0.32,
    radius: 11.5, x: 3, y: 3, anchor: 'bl', deadzone: 0.12,
  },
  pad: {
    // Everything right of the stick column, top to bottom — the buttons sit
    // on top of it and take their own touches.
    zone: (x, y, w, h) => x > w * 0.42 || y < h * 0.32,
    hint: 'DRAG TO LOOK',
    hintTop: 6, hintHeight: 26,
  },
  buttons: [
    { id: 'fire',  label: 'FIRE', kind: 'hold', shape: 'round', size: 15,  anchor: 'br', x: 3,  y: 3,  accent: 'warm' },
    { id: 'ads',   label: 'ADS',  kind: 'hold', shape: 'round', size: 10,  anchor: 'br', x: 19.5, y: 4.5 },
    { id: 'fireL', label: 'FIRE', kind: 'hold', shape: 'round', size: 10.5, anchor: 'bl', x: 3.5, y: 27, accent: 'warm' },
    { id: 'jump',  label: 'JUMP', kind: 'tap',  shape: 'pill', w: 11, h: 6.2, anchor: 'bl', x: 27, y: 4.5, font: 1.8 },

    { id: 'pause',  label: '&#10073;&#10073; PAUSE', kind: 'tap', shape: 'pill', w: 15.5, h: 5, anchor: 'br', x: 3, y: 20, column: 'r' },
    { id: 'weapon', label: 'RIFLE',                  kind: 'tap', shape: 'pill', w: 15.5, h: 5, column: 'r' },
    { id: 'gren',   label: 'GRENADE',                kind: 'tap', shape: 'pill', w: 15.5, h: 5, column: 'r' },
    { id: 'reload', label: 'RELOAD',                 kind: 'tap', shape: 'pill', w: 15.5, h: 5, column: 'r' },
  ],
  onPress(id) {
    if (paused && id !== 'pause') return;
    switch (id) {
      case 'fire': case 'fireL':
        if (started) { state.firing = true; fire(); }
        break;
      case 'ads':    enterScope(true); break;
      case 'jump':   if (onGround) { velocity.y = 7.2; onGround = false; } break;
      case 'reload': reload(); break;
      case 'gren':   throwGrenade(); break;
      case 'weapon': swapWeapon(state.weapon === 'rifle' ? 'shotgun' : 'rifle'); break;
      case 'pause':  setPaused(!paused); break;
    }
  },
  onRelease(id) {
    switch (id) {
      case 'fire': case 'fireL':
        // Only stop firing once neither trigger is down.
        if (!touch.isHeld('fire') && !touch.isHeld('fireL')) state.firing = false;
        break;
      case 'ads': enterScope(false); break;
    }
  },
  haptic,
}).attach(document.body);

let paused = false;
const pauseScreen = document.createElement('div');
pauseScreen.id = 'pausescreen';
pauseScreen.style.cssText = 'position:fixed;inset:0;z-index:21;display:none;align-items:center;' +
  'justify-content:center;flex-direction:column;gap:2vh;background:rgba(3,8,10,.88);color:#eaeef3;text-align:center';
pauseScreen.innerHTML = '<div style="font-size:5vh;letter-spacing:1vh;color:#7fffd4">PAUSED</div>' +
  '<div style="font-size:1.8vh;opacity:.75;letter-spacing:.4vh">OPERATION ON HOLD</div>' +
  '<button class="sbtn" id="csResume" style="font-size:2.4vh;padding:1.4vh 5vh">RESUME</button>' +
  '<button class="sbtn" id="csAbort" style="font-size:2vh;padding:1.1vh 4vh">ABORT &amp; RESTART</button>';
document.body.appendChild(pauseScreen);
pauseScreen.querySelector('#csResume').addEventListener('click', () => setPaused(false));
pauseScreen.querySelector('#csAbort').addEventListener('click', () => location.reload());

function setPaused(v) {
  if (!started || gameOver) return;
  paused = v;
  pauseScreen.style.display = v ? 'flex' : 'none';
  // An overlay swallows the pointerup, so a held trigger would latch on.
  if (v) { state.firing = false; enterScope(false); touch.releaseAll(); }
}

// Android hardware/gesture back: hold the operation rather than leaving it.
window.__androidBack = function () {
  if (!started || gameOver) return false;
  setPaused(!paused);
  return true;
};
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
addEventListener('contextmenu', (e) => e.preventDefault());

(function initSettings() {
  const card = document.querySelector('#menu .card');
  if (!card) return;
  const wrap = document.createElement('div');
  wrap.innerHTML =
    '<div class="setRow"><span class="setLbl">GRAPHICS</span>' +
    '<button class="sbtn" data-q="low">LOW</button><button class="sbtn" data-q="med">MEDIUM</button><button class="sbtn" data-q="high">HIGH</button></div>' +
    '<div class="setRow"><span class="setLbl">LOOK SENSITIVITY</span>' +
    '<button class="sbtn" data-s="0.65">LOW</button><button class="sbtn" data-s="1">NORMAL</button><button class="sbtn" data-s="1.5">HIGH</button></div>' +
    '<div class="setRow"><span class="setLbl">LOOK Y</span>' +
    '<button class="sbtn" data-i="0">NORMAL</button><button class="sbtn" data-i="1">INVERTED</button></div>';
  card.insertBefore(wrap, card.querySelector('#playbtn'));

  // The preset is baked into the shadow map and the light count, so changing
  // it reloads.
  wrap.querySelectorAll('.sbtn[data-q]').forEach((b) => {
    b.classList.toggle('sel', b.dataset.q === qualityName);
    b.addEventListener('click', () => {
      if (b.dataset.q === qualityName) return;
      storeSet('cs_quality', b.dataset.q);
      location.reload();
    });
  });
  wrap.querySelectorAll('.sbtn[data-s]').forEach((b) => {
    b.classList.toggle('sel', Math.abs(parseFloat(b.dataset.s) - lookSens) < 0.01);
    b.addEventListener('click', () => {
      lookSens = parseFloat(b.dataset.s); storeSet('cs_sens', b.dataset.s);
      wrap.querySelectorAll('.sbtn[data-s]').forEach((o) => o.classList.toggle('sel', o === b));
    });
  });
  wrap.querySelectorAll('.sbtn[data-i]').forEach((b) => {
    b.classList.toggle('sel', (b.dataset.i === '1') === invertLook);
    b.addEventListener('click', () => {
      invertLook = b.dataset.i === '1'; storeSet('cs_invert', b.dataset.i);
      wrap.querySelectorAll('.sbtn[data-i]').forEach((o) => o.classList.toggle('sel', o === b));
    });
  });
})();


// On load: make sure the menu is set up correctly (the DEPLOY button must be
// visible before it can ever be clicked).
(function initMenu() {
  el.scope.classList.remove('on');
  loadingEl.style.display = 'none';
  keysBox.style.display = 'grid';
  playBtn.style.display = 'block';
})();

canvas.addEventListener('mousedown', e => {
  if (e.button === 2) e.preventDefault();
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
  if (typeof touch !== 'undefined' && touch) touch.setLabel('weapon', kind === 'rifle' ? 'RIFLE' : 'SHOTGUN');
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
  touch.hide();
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

  // --- look (replaces pointer-lock mouse movement) ---
  // camera.rotation.order is 'YXZ', so yaw and pitch can be set directly; the
  // pitch clamp is what stops the view rolling over at the poles.
  {
    const d = touch.consumePad();
    if (d.dx || d.dy) {
      const k = 0.0032 * lookSens * (state.wantZoom ? 0.45 : 1);   // slower when scoped
      camera.rotation.y -= d.dx * k;
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
        camera.rotation.x + (invertLook ? d.dy : -d.dy) * k));
    }
  }

  // --- movement ---
  const st = touch.state.stick;
  const sprinting = Math.hypot(st.x, st.y) > 0.85;   // push the stick to sprint
  const speed = (keys['ShiftLeft'] || keys['ShiftRight'] || sprinting) ? 9.5 : 6.2;
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
  const move = new THREE.Vector3();
  if (keys['KeyW']) move.add(forward);
  if (keys['KeyS']) move.sub(forward);
  if (keys['KeyD']) move.add(right);
  if (keys['KeyA']) move.sub(right);
  if (st.x || st.y) {
    move.addScaledVector(forward, -st.y);   // stick up is forward
    move.addScaledVector(right, st.x);
  }
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
      // Hit flash — the carrier material is this soldier's own clone.
      if (e.hitFlash > 0) {
        e.hitFlash -= dt;
        const k = Math.max(0, e.hitFlash) / 0.12;
        e.carrierMat.emissive.setRGB(k * 0.9, k * 0.25, k * 0.12);
      } else if (e.carrierMat.emissive.r !== 0) {
        e.carrierMat.emissive.setRGB(0, 0, 0);
      }
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
  if (pipe) pipe.setSize(window.innerWidth, window.innerHeight);
  else if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

// intro
showMsg('CITY STORM ONLINE', 2200);
updateHUD();

const SUN_OFFSET = SUN_DIR.clone().multiplyScalar(140);
let elapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (started && !gameOver && !paused) update(dt);

  // Keep the dome centred on the viewer so it never clips, and drag the shadow
  // frustum along with the player — a tight box only helps if it is where the
  // player is.
  sky.position.copy(camera.position);
  skyUniforms.uTime.value = elapsed;
  sun.position.copy(camera.position).add(SUN_OFFSET);
  sun.target.position.copy(camera.position);
  sun.target.updateMatrixWorld();

  if (pipe) pipe.update(elapsed);
  if (composer && started) composer.render();
  else renderer.render(scene, camera);
}
animate();

// expose for debugging
window.__CITYSTORM = { state, enemies, WEAPONS, camera, scene, renderer, get touch(){return touch;} };
