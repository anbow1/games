/* GENERATED — do not edit. Source: shared/photoreal.js (tools/sync-photoreal.mjs). */
/* =============================================================================
   PHOTOREAL KIT — a small physically-based rendering layer shared by the games
   in this repo.
   =============================================================================

   Three things move a Three.js scene towards photorealism more than anything
   else, and this module provides all three:

     1. IBL. Without an environment map, metal and glass are lit only by the
        analytic lights and read as dead plastic. `skyEnvironment()` prefilters
        the game's own procedural sky into a PMREM probe, so every surface
        reflects the actual sky and picks up bounce from the ground.

     2. An HDR post chain. Scene rendering stays linear and unclamped; tone
        mapping happens once at the end, after bloom, in `GradeShader` — which
        also applies the small photographic imperfections (grain, vignette,
        chromatic aberration, unsharp mask) that sell a rendered frame as a
        photographed one.

     3. Real surface detail. `metalPanels()`, `roughSurface()`, `fabric()` and
        `skin()` synthesise albedo + normal + roughness maps on a canvas at
        load time. No downloads, so the games stay self-contained.

   Each game folder keeps its own copy so it stays self-contained: city-storm
   imports photoreal.js next to its game.js, while the two single-file games
   have the source inlined into their HTML. Edit this file, then run
   tools/sync-photoreal.mjs to propagate it.

   Requires: THREE (r150+) in scope.
============================================================================= */

/* ========================= noise + canvas plumbing ========================= */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on an N×N lattice, so generated maps repeat seamlessly. */
function tileNoise(period, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (x, y) => g[((y % period) + period) % period * period + (((x % period) + period) % period)];
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}

function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

function cv(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

/**
 * Sobel a height field into a tangent-space normal map.
 * Sampling wraps, so the result tiles as cleanly as its input.
 */
function heightToNormal(height, size, strength = 2.0) {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x - 1, y - 1) + 2 * h(x - 1, y) + h(x - 1, y + 1))
               - (h(x + 1, y - 1) + 2 * h(x + 1, y) + h(x + 1, y + 1));
      const dy = (h(x - 1, y - 1) + 2 * h(x, y - 1) + h(x + 1, y - 1))
               - (h(x - 1, y + 1) + 2 * h(x, y + 1) + h(x + 1, y + 1));
      let nx = dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      out[i]     = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const c = cv(size);
  c.getContext('2d').putImageData(new ImageData(out, size, size), 0, 0);
  return c;
}

/** Pack a single channel into a greyscale texture (roughness / metalness / AO). */
function channelCanvas(data, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = clamp01(data[i]) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  const c = cv(size);
  c.getContext('2d').putImageData(new ImageData(out, size, size), 0, 0);
  return c;
}

function texture(canvas, { srgb = false, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) {
    // r152 renamed this; support both so the kit works either side of the change.
    if ('colorSpace' in t) t.colorSpace = THREE.SRGBColorSpace;
    else t.encoding = THREE.sRGBEncoding;
  }
  t.needsUpdate = true;
  return t;
}

/* ============================ material libraries =========================== */

/**
 * Painted sheet metal: panel seams, rivet rows, edge wear, grime streaks.
 * The workhorse for tank hulls, aircraft skins and machinery.
 */
export function metalPanels({
  size = 512, color = '#6b6f5e', panel = 4, rivets = true,
  wear = 0.5, streak = 0.4, seed = 1, repeat = 1, aniso = 8,
} = {}) {
  const c = cv(size), g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const n1 = tileNoise(16, seed), n2 = tileNoise(64, seed + 7);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  const metal = new Float32Array(size * size);

  g.fillStyle = color;
  g.fillRect(0, 0, size, size);

  // Per-panel tonal drift — no two sheets take paint identically.
  const step = size / panel;
  for (let py = 0; py < panel; py++) {
    for (let px = 0; px < panel; px++) {
      g.globalAlpha = 0.05 + rnd() * 0.09;
      g.fillStyle = rnd() < 0.5 ? '#ffffff' : '#000000';
      g.fillRect(px * step, py * step, step, step);
    }
  }
  g.globalAlpha = 1;

  // Mottled weathering.
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = x / size * 8, v = y / size * 8;
      const m = fbm(n1, u, v, 4) - 0.5;
      const grain = (n2(x / size * 64, y / size * 64) - 0.5) * 0.10;
      const k = 1 + m * 0.30 * wear + grain;
      img.data[i]     *= k;
      img.data[i + 1] *= k;
      img.data[i + 2] *= k;
      const idx = y * size + x;
      height[idx] = 0.5 + grain * 0.5;
      rough[idx]  = clamp01(0.55 + m * 0.35 * wear + grain);
      metal[idx]  = clamp01(0.15 + Math.max(0, m) * 0.5 * wear);
    }
  }
  g.putImageData(img, 0, 0);

  // Panel seams: a dark line with a bright lip, which is what reads as a gap.
  g.lineWidth = Math.max(1, size / 512);
  for (let i = 1; i < panel; i++) {
    const p = Math.round(i * step) + 0.5;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.moveTo(p + 1, 0); g.lineTo(p + 1, size); g.moveTo(0, p + 1); g.lineTo(size, p + 1); g.stroke();
    for (let t = 0; t < size; t++) {           // seams are creases in the height field too
      height[t * size + Math.round(i * step)] = 0.08;
      height[Math.round(i * step) * size + t] = 0.08;
    }
  }

  if (rivets) {
    const pitch = Math.max(8, size / 32);
    for (let i = 1; i < panel; i++) {
      for (let t = pitch; t < size; t += pitch) {
        for (const [rx, ry] of [[i * step, t], [t, i * step]]) {
          g.fillStyle = 'rgba(255,255,255,0.16)';
          g.beginPath(); g.arc(rx, ry - 0.6, size / 340, 0, 6.283); g.fill();
          g.fillStyle = 'rgba(0,0,0,0.32)';
          g.beginPath(); g.arc(rx, ry + 0.6, size / 340, 0, 6.283); g.fill();
          const hx = Math.round(rx), hy = Math.round(ry);
          if (hx > 0 && hx < size && hy > 0 && hy < size) height[hy * size + hx] = 0.95;
        }
      }
    }
  }

  // Scratches that cut through to brighter, rougher-edged bare metal.
  const scratches = Math.round(28 * wear);
  for (let i = 0; i < scratches; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * 6.283, len = 8 + rnd() * size * 0.28;
    g.strokeStyle = `rgba(255,255,255,${0.06 + rnd() * 0.16})`;
    g.lineWidth = 0.6 + rnd() * 1.1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }

  // Vertical grime streaks below the seams — gravity is a strong realism cue.
  if (streak > 0) {
    for (let i = 0; i < Math.round(18 * streak); i++) {
      const x = rnd() * size, y = rnd() * size, len = size * (0.08 + rnd() * 0.3);
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, `rgba(28,22,16,${0.20 + rnd() * 0.20})`);
      grad.addColorStop(1, 'rgba(28,22,16,0)');
      g.fillStyle = grad;
      g.fillRect(x, y, 1 + rnd() * 4, len);
    }
  }

  return {
    map: texture(c, { srgb: true, repeat, aniso }),
    normalMap: texture(heightToNormal(height, size, 1.6), { repeat, aniso }),
    roughnessMap: texture(channelCanvas(rough, size), { repeat, aniso }),
    metalnessMap: texture(channelCanvas(metal, size), { repeat, aniso }),
  };
}

/**
 * Mineral surfaces — asphalt, concrete, dirt, rock. `grit` sets the aggregate
 * size, `crack` how broken the surface is.
 */
export function roughSurface({
  size = 512, color = '#3a3d44', grit = 0.5, crack = 0.25, stain = 0.35,
  roughBase = 0.92, seed = 3, repeat = 1, aniso = 8,
} = {}) {
  const c = cv(size), g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const nBig = tileNoise(8, seed), nMid = tileNoise(32, seed + 3), nFine = tileNoise(128, seed + 9);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);

  g.fillStyle = color; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, idx = y * size + x;
      const u = x / size, v = y / size;
      const broad = fbm(nBig, u * 8, v * 8, 3) - 0.5;
      const mid   = fbm(nMid, u * 32, v * 32, 3) - 0.5;
      const fine  = nFine(u * 128, v * 128) - 0.5;
      const detail = broad * 0.5 + mid * 0.6 * grit + fine * 0.8 * grit;
      const k = 1 + detail * 0.55;
      img.data[i]     *= k;
      img.data[i + 1] *= k;
      img.data[i + 2] *= k;
      height[idx] = clamp01(0.5 + detail * 0.9);
      rough[idx]  = clamp01(roughBase + detail * 0.25);
    }
  }
  g.putImageData(img, 0, 0);

  // Cracks: a random walk that forks, which looks far more natural than lines.
  const cracks = Math.round(size / 26 * crack * 4);
  for (let i = 0; i < cracks; i++) {
    let x = rnd() * size, y = rnd() * size, a = rnd() * 6.283;
    g.strokeStyle = `rgba(0,0,0,${0.25 + rnd() * 0.35})`;
    g.lineWidth = 0.5 + rnd() * 1.4;
    g.beginPath(); g.moveTo(x, y);
    const steps = 12 + Math.floor(rnd() * 30);
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.9;
      x += Math.cos(a) * 4; y += Math.sin(a) * 4;
      g.lineTo(x, y);
      const hx = Math.round(x), hy = Math.round(y);
      if (hx >= 0 && hx < size && hy >= 0 && hy < size) height[hy * size + hx] = 0.02;
    }
    g.stroke();
  }

  // Damp patches / oil — darker and markedly smoother than dry surface.
  for (let i = 0; i < Math.round(14 * stain); i++) {
    const x = rnd() * size, y = rnd() * size, r = size * (0.03 + rnd() * 0.13);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(0,0,0,${0.10 + rnd() * 0.22})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    const px = Math.round(x), py = Math.round(y), pr = Math.round(r);
    for (let yy = Math.max(0, py - pr); yy < Math.min(size, py + pr); yy++) {
      for (let xx = Math.max(0, px - pr); xx < Math.min(size, px + pr); xx++) {
        const d = Math.hypot(xx - px, yy - py) / pr;
        if (d < 1) rough[yy * size + xx] *= 1 - (1 - d) * 0.45;
      }
    }
  }

  return {
    map: texture(c, { srgb: true, repeat, aniso }),
    normalMap: texture(heightToNormal(height, size, 2.4), { repeat, aniso }),
    roughnessMap: texture(channelCanvas(rough, size), { repeat, aniso }),
  };
}

/** Woven cloth — uniforms, webbing, tarpaulin. */
export function fabric({
  size = 256, color = '#3d4232', weave = 2, seed = 5, repeat = 1, aniso = 4,
} = {}) {
  const c = cv(size), g = c.getContext('2d');
  const n = tileNoise(32, seed);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);

  g.fillStyle = color; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, idx = y * size + x;
      // Interleaved warp and weft.
      const warp = Math.sin(x / weave * Math.PI) * 0.5 + 0.5;
      const weft = Math.sin(y / weave * Math.PI) * 0.5 + 0.5;
      const thread = ((x / weave | 0) + (y / weave | 0)) % 2 === 0 ? warp : weft;
      const dirt = fbm(n, x / size * 12, y / size * 12, 3) - 0.5;
      const k = 0.90 + thread * 0.14 + dirt * 0.20;
      img.data[i]     *= k;
      img.data[i + 1] *= k;
      img.data[i + 2] *= k;
      height[idx] = thread * 0.5 + dirt * 0.5;
      rough[idx]  = clamp01(0.86 + dirt * 0.18 - thread * 0.08);
    }
  }
  g.putImageData(img, 0, 0);
  return {
    map: texture(c, { srgb: true, repeat, aniso }),
    normalMap: texture(heightToNormal(height, size, 0.35), { repeat, aniso }),
    roughnessMap: texture(channelCanvas(rough, size), { repeat, aniso }),
  };
}

/** Sawn timber — crates, pallets, boarding. */
export function wood({
  size = 256, color = '#8a6a3a', planks = 4, seed = 7, repeat = 1, aniso = 8,
} = {}) {
  const c = cv(size), g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const n = tileNoise(32, seed);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);

  g.fillStyle = color; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, idx = y * size + x;
      // Grain runs along the plank and wobbles, so warp the sample coordinate
      // rather than drawing straight lines.
      const warp = fbm(n, x / size * 3, y / size * 3, 3) - 0.5;
      const rings = Math.sin((y / size * 26 + warp * 5) * Math.PI) * 0.5 + 0.5;
      const fibre = (n(x / size * 8, y / size * 90) - 0.5);
      const k = 0.86 + rings * 0.20 + fibre * 0.14 + warp * 0.12;
      img.data[i]     *= k;
      img.data[i + 1] *= k * 0.98;
      img.data[i + 2] *= k * 0.94;
      height[idx] = rings * 0.55 + fibre * 0.45;
      rough[idx]  = clamp01(0.80 + fibre * 0.16 - rings * 0.06);
    }
  }
  g.putImageData(img, 0, 0);

  // Plank joints, plus a shadow lip so the boards read as separate pieces.
  const step = size / planks;
  g.lineWidth = Math.max(1.5, size / 200);
  for (let i = 1; i < planks; i++) {
    const p = Math.round(i * step) + 0.5;
    g.strokeStyle = 'rgba(20,12,6,0.62)';
    g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
    for (let t = 0; t < size; t++) height[Math.round(i * step) * size + t] = 0.03;
  }
  // Nail heads at the plank ends.
  for (let i = 0; i < planks; i++) {
    for (const nx of [size * 0.08, size * 0.92]) {
      const ny = i * step + step * 0.5;
      g.fillStyle = 'rgba(30,26,22,0.55)';
      g.beginPath(); g.arc(nx, ny, size / 110, 0, 6.283); g.fill();
    }
  }
  // Scuffs.
  for (let i = 0; i < 22; i++) {
    g.strokeStyle = `rgba(40,28,16,${0.05 + rnd() * 0.12})`;
    g.lineWidth = 0.5 + rnd() * 1.5;
    const x = rnd() * size, y = rnd() * size, a = (rnd() - 0.5) * 0.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * rnd() * size * 0.4, y + Math.sin(a) * 8); g.stroke();
  }

  return {
    map: texture(c, { srgb: true, repeat, aniso }),
    normalMap: texture(heightToNormal(height, size, 0.9), { repeat, aniso }),
    roughnessMap: texture(channelCanvas(rough, size), { repeat, aniso }),
  };
}

/**
 * Skin. Faces read as plastic without pore-level roughness break-up and a
 * little colour variation, which is all this provides — the specular response
 * matters more than the albedo here.
 */
export function skin({ size = 256, color = '#b07a5c', seed = 11, aniso = 4 } = {}) {
  const c = cv(size), g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const n = tileNoise(64, seed);
  const height = new Float32Array(size * size);
  const rough = new Float32Array(size * size);

  g.fillStyle = color; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4, idx = y * size + x;
      const blotch = fbm(n, x / size * 10, y / size * 10, 3) - 0.5;
      const pore = (n(x / size * 96, y / size * 96) - 0.5);
      img.data[i]     *= 1 + blotch * 0.16 + pore * 0.05;
      img.data[i + 1] *= 1 + blotch * 0.10 + pore * 0.05;
      img.data[i + 2] *= 1 + blotch * 0.06 + pore * 0.05;
      height[idx] = 0.5 + pore * 0.35;
      rough[idx]  = clamp01(0.52 + pore * 0.30 + blotch * 0.12);
    }
  }
  g.putImageData(img, 0, 0);
  // Stubble / grime around the jaw, kept subtle.
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(40,28,22,${0.03 + rnd() * 0.05})`;
    g.beginPath(); g.arc(rnd() * size, rnd() * size, rnd() * 2.2, 0, 6.283); g.fill();
  }
  return {
    map: texture(c, { srgb: true, aniso }),
    // Pores are a roughness cue far more than a silhouette cue; push the normal
    // map any harder and skin reads as orange peel.
    normalMap: texture(heightToNormal(height, size, 0.12), { aniso }),
    roughnessMap: texture(channelCanvas(rough, size), { aniso }),
  };
}

/* ============================ image-based lighting ========================= */

/**
 * Prefilter a sky into an irradiance/reflection probe.
 *
 * `skyMaterial` is the game's own sky shader, so the lighting always agrees
 * with what the player sees on the horizon. A ground hemisphere is included
 * deliberately: without it the lower half of every object is lit sky-blue from
 * below, which is the single most common giveaway of a naive Three.js scene.
 */
export function skyEnvironment(renderer, {
  skyMaterial = null, skyColor = 0x9db8cc, groundColor = 0x3b3529, intensity = 1, horizonFade = 0.35,
} = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();

  const envScene = new THREE.Scene();

  if (skyMaterial) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 20), skyMaterial);
    envScene.add(dome);
  } else {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(500, 24, 16),
      new THREE.MeshBasicMaterial({ color: skyColor, side: THREE.BackSide }),
    );
    envScene.add(dome);
  }

  // Ground bounce, faded in below the horizon rather than butted against it.
  // A hard terminator between sky and ground shows up as a visible seam in
  // every low-roughness reflection, which is exactly where the eye looks.
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(480, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, depthTest: false, fog: false,
      uniforms: { uColor: { value: new THREE.Color(groundColor) }, uFade: { value: horizonFade } },
      vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 uColor;uniform float uFade;varying vec3 vP;' +
        'void main(){float d=normalize(vP).y;gl_FragColor=vec4(uColor,smoothstep(0.02,-uFade,d));}',
    }),
  );
  ground.renderOrder = 1;
  envScene.add(ground);

  const rt = pmrem.fromScene(envScene, 0, 1, 1200);
  pmrem.dispose();
  envScene.traverse((o) => { if (o.isMesh && o.material !== skyMaterial) o.material.dispose(); });

  const tex = rt.texture;
  tex.userData.intensity = intensity;
  return tex;
}

/** Point every standard material in a subtree at the probe. */
export function applyEnvironment(root, envMap, intensity = 1) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m || !m.isMeshStandardMaterial) continue;
      m.envMap = envMap;
      m.envMapIntensity = intensity;
      m.needsUpdate = true;
    }
  });
}

/* ============================== colour grading ============================= */

/**
 * The final pass: HDR in, display-referred sRGB out.
 *
 * Tone mapping lives here rather than on the materials so that bloom upstream
 * operates on genuine HDR values. Everything after the tone map — aberration,
 * vignette, grain, unsharp mask — is there to imitate a lens and a sensor.
 */
export const GradeShader = {
  uniforms: {
    tDiffuse:    { value: null },
    exposure:    { value: 1.0 },
    contrast:    { value: 1.06 },
    saturation:  { value: 1.05 },
    vignette:    { value: 0.32 },
    grain:       { value: 0.035 },
    aberration:  { value: 0.0016 },
    sharpen:     { value: 0.35 },
    lift:        { value: new THREE.Vector3(0.0, 0.0, 0.0) },
    time:        { value: 0 },
    texel:       { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float exposure, contrast, saturation, vignette, grain, aberration, sharpen, time;
    uniform vec3 lift;
    uniform vec2 texel;
    varying vec2 vUv;

    // Stephen Hill's fit of the ACES RRT+ODT.
    const mat3 ACESIn = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777);
    const mat3 ACESOut = mat3(
       1.60475, -0.10208, -0.00327,
      -0.53108,  1.10813, -0.07276,
      -0.07367, -0.00605,  1.07602);
    vec3 rrtOdtFit(vec3 v){
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 c){ return clamp(ACESOut * rrtOdtFit(ACESIn * c), 0.0, 1.0); }

    vec3 toSRGB(vec3 c){
      return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
    }

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    void main(){
      vec2 uv = vUv;
      vec2 fromCentre = uv - 0.5;
      float r2 = dot(fromCentre, fromCentre);

      // Lateral chromatic aberration grows towards the frame edge, as in a real lens.
      vec3 hdr;
      if (aberration > 0.0) {
        vec2 off = fromCentre * aberration * r2 * 4.0;
        hdr.r = texture2D(tDiffuse, uv + off).r;
        hdr.g = texture2D(tDiffuse, uv).g;
        hdr.b = texture2D(tDiffuse, uv - off).b;
      } else {
        hdr = texture2D(tDiffuse, uv).rgb;
      }

      // Unsharp mask on the HDR signal — recovers the micro-contrast that
      // bloom and tone mapping flatten out.
      if (sharpen > 0.0) {
        vec3 blur = (
          texture2D(tDiffuse, uv + vec2( texel.x, 0.0)).rgb +
          texture2D(tDiffuse, uv + vec2(-texel.x, 0.0)).rgb +
          texture2D(tDiffuse, uv + vec2(0.0,  texel.y)).rgb +
          texture2D(tDiffuse, uv + vec2(0.0, -texel.y)).rgb) * 0.25;
        hdr += (hdr - blur) * sharpen;
      }

      vec3 col = aces(max(hdr, 0.0) * exposure);

      col = (col - 0.5) * contrast + 0.5;
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, saturation);
      col += lift * (1.0 - luma);

      col *= 1.0 - vignette * smoothstep(0.10, 0.75, r2);

      // Grain is strongest in the mid-tones, as film and sensors both are.
      float g = (hash(uv * 1024.0 + fract(time)) - 0.5) * grain;
      col += g * (1.0 - abs(luma * 2.0 - 1.0));

      gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
    }
  `,
};

/* ================================ ambient occlusion ======================= */

/** Minimal full-screen triangle renderer, so the kit needs no Pass import. */
function fullscreenQuad() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(geo, null);
  const scn = new THREE.Scene();
  scn.add(mesh);
  return function draw(renderer, material, target) {
    mesh.material = material;
    renderer.setRenderTarget(target || null);
    renderer.render(scn, cam);
  };
}

const AO_COMMON = /* glsl */`
  uniform highp sampler2D tDepth;
  uniform mat4 projInv;
  uniform vec2 texel;
  float depthAt(vec2 uv){ return texture2D(tDepth, uv).x; }
  vec3 viewFromDepth(vec2 uv, float d){
    vec4 clip = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vec4 v = projInv * clip;
    return v.xyz / v.w;
  }
`;

/**
 * Screen-space AO computed from the depth the scene render already produced.
 *
 * Three's own SAOPass and SSAOPass were both tried here and rejected: each
 * re-renders the entire scene one or more extra times per frame (SAOPass does
 * it twice — a beauty pass it does not even use at this output mode, plus a
 * depth override), roughly tripling draw calls in a game that has to hold
 * framerate on a phone. SAOPass also leaves background pixels reading as
 * near-plane geometry, which multiplies the sky to black.
 *
 * This runs as its own pass rather than a plain ShaderPass because occlusion is
 * computed into a private half-resolution target. Sampling the shared depth
 * texture while writing into one of the composer's ping-pong buffers — which is
 * what that texture is attached to — is a framebuffer feedback loop, and the
 * driver rejects the draw outright. Working off to the side also buys a
 * depth-aware blur and a 4× cheaper occlusion loop.
 */
export function createAOPass(renderer, camera, depthTexture, opts = {}) {
  const {
    width = 1, height = 1, samples = 16, radius = 0.9,
    intensity = 1.0, power = 1.6, bias = 0.028, maxRange = 2.2, scale = 0.5,
  } = opts;

  const draw = fullscreenQuad();
  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, depthBuffer: false };
  let aw = Math.max(1, Math.floor(width * scale)), ah = Math.max(1, Math.floor(height * scale));
  const targetA = new THREE.WebGLRenderTarget(aw, ah, rtOpts);
  const targetB = new THREE.WebGLRenderTarget(aw, ah, rtOpts);

  const occlude = new THREE.ShaderMaterial({
    defines: { SAMPLES: samples },
    uniforms: {
      tDepth: { value: depthTexture },
      projInv: { value: new THREE.Matrix4() },
      proj: { value: new THREE.Matrix4() },
      texel: { value: new THREE.Vector2(1 / aw, 1 / ah) },
      radius: { value: radius }, intensity: { value: intensity },
      bias: { value: bias }, power: { value: power }, maxRange: { value: maxRange },
    },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
    fragmentShader: AO_COMMON + /* glsl */`
      uniform mat4 proj;
      uniform float radius, intensity, bias, power, maxRange;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }

      void main(){
        float d = depthAt(vUv);
        // Far plane: sky, and anything else with no geometry behind it.
        if (d >= 0.999999) { gl_FragColor = vec4(1.0); return; }

        vec3 P = viewFromDepth(vUv, d);

        // Normal from depth. Take the closer neighbour on each axis so a
        // silhouette does not smear a false normal across the edge.
        vec3 pR = viewFromDepth(vUv + vec2(texel.x,0.0), depthAt(vUv + vec2(texel.x,0.0)));
        vec3 pL = viewFromDepth(vUv - vec2(texel.x,0.0), depthAt(vUv - vec2(texel.x,0.0)));
        vec3 pU = viewFromDepth(vUv + vec2(0.0,texel.y), depthAt(vUv + vec2(0.0,texel.y)));
        vec3 pD = viewFromDepth(vUv - vec2(0.0,texel.y), depthAt(vUv - vec2(0.0,texel.y)));
        vec3 dx = abs(pR.z - P.z) < abs(pL.z - P.z) ? (pR - P) : (P - pL);
        vec3 dy = abs(pU.z - P.z) < abs(pD.z - P.z) ? (pU - P) : (P - pD);
        vec3 N = normalize(cross(dx, dy));

        float ang = hash(vUv * 1024.0) * 6.2831853;
        float occ = 0.0;

        for (int i = 0; i < SAMPLES; i++) {
          float fi = float(i);
          float a = fi * 2.3999632 + ang;                       // golden angle
          float r = radius * sqrt((fi + 0.5) / float(SAMPLES));
          vec3 dir = normalize(vec3(cos(a), sin(a), 0.35 + 0.65 * hash(vec2(fi, ang))));
          if (dot(dir, N) < 0.0) dir = -dir;                    // fold into the hemisphere

          vec3 sp = P + dir * r;
          vec4 clip = proj * vec4(sp, 1.0);
          vec2 sUv = (clip.xy / clip.w) * 0.5 + 0.5;
          if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) continue;

          float sd = depthAt(sUv);
          if (sd >= 0.999999) continue;
          // View space looks down -Z, so a greater z is nearer the camera.
          float diff = viewFromDepth(sUv, sd).z - sp.z;
          if (diff > bias) occ += smoothstep(1.0, 0.0, (diff - bias) / maxRange);
        }

        float ao = pow(clamp(1.0 - (occ / float(SAMPLES)) * intensity, 0.0, 1.0), power);
        gl_FragColor = vec4(ao, ao, ao, 1.0);
      }
    `,
  });

  // Separable blur that refuses to cross a depth discontinuity, so occlusion
  // does not bleed from a near object onto the distant surface behind it.
  const blur = new THREE.ShaderMaterial({
    uniforms: {
      tAO: { value: null }, tDepth: { value: depthTexture },
      projInv: { value: occlude.uniforms.projInv.value },
      texel: { value: new THREE.Vector2(1 / aw, 1 / ah) },
      dir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
    fragmentShader: AO_COMMON + /* glsl */`
      uniform sampler2D tAO;
      uniform vec2 dir;
      varying vec2 vUv;
      void main(){
        float centre = viewFromDepth(vUv, depthAt(vUv)).z;
        float sum = 0.0, wsum = 0.0;
        for (int i = -3; i <= 3; i++) {
          vec2 uv = vUv + dir * texel * float(i);
          float z = viewFromDepth(uv, depthAt(uv)).z;
          float w = exp(-float(i * i) * 0.18) * step(abs(z - centre), 0.6);
          sum += texture2D(tAO, uv).r * w;
          wsum += w;
        }
        float v = wsum > 0.0 ? sum / wsum : texture2D(tAO, vUv).r;
        gl_FragColor = vec4(v, v, v, 1.0);
      }
    `,
  });

  const apply = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, tAO: { value: targetA.texture } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
    fragmentShader: /* glsl */`
      uniform sampler2D tDiffuse, tAO;
      varying vec2 vUv;
      void main(){
        vec4 src = texture2D(tDiffuse, vUv);
        gl_FragColor = vec4(src.rgb * texture2D(tAO, vUv).r, src.a);
      }
    `,
  });

  // Duck-typed Pass: EffectComposer only needs these members.
  return {
    enabled: true, needsSwap: true, clear: false, renderToScreen: false,
    uniforms: occlude.uniforms,
    render(r, writeBuffer, readBuffer) {
      occlude.uniforms.proj.value.copy(camera.projectionMatrix);
      occlude.uniforms.projInv.value.copy(camera.projectionMatrixInverse);

      draw(r, occlude, targetA);
      blur.uniforms.tAO.value = targetA.texture;
      blur.uniforms.dir.value.set(1, 0);
      draw(r, blur, targetB);
      blur.uniforms.tAO.value = targetB.texture;
      blur.uniforms.dir.value.set(0, 1);
      draw(r, blur, targetA);

      apply.uniforms.tDiffuse.value = readBuffer.texture;
      draw(r, apply, this.renderToScreen ? null : writeBuffer);
    },
    setSize(w, h) {
      aw = Math.max(1, Math.floor(w * scale));
      ah = Math.max(1, Math.floor(h * scale));
      targetA.setSize(aw, ah);
      targetB.setSize(aw, ah);
      occlude.uniforms.texel.value.set(1 / aw, 1 / ah);
      blur.uniforms.texel.value.set(1 / aw, 1 / ah);
    },
    dispose() { targetA.dispose(); targetB.dispose(); occlude.dispose(); blur.dispose(); apply.dispose(); },
  };
}

/* ============================== render pipeline =========================== */

/**
 * Assemble the post chain. Pass the addon classes in, so this module needs no
 * imports of its own and can be inlined into any of the games.
 *
 *   deps: { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, SMAAPass }
 *
 * Order matters: AO and bloom act on linear HDR, the grade tone-maps to sRGB,
 * and SMAA runs last because edge detection wants perceptual values.
 */
export function buildPipeline(renderer, scene, camera, deps, opts = {}) {
  const { EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, SMAAPass } = deps;
  const {
    ao = true, aoRadius = 0.9, aoIntensity = 1.0, aoSamples = 16, aoPower = 1.6, aoScale = 0.5,
    bloom = true, bloomStrength = 0.42, bloomRadius = 0.75, bloomThreshold = 1.05,
    smaa = true, exposure = 1.0, grade = {},
  } = opts;

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = Math.max(1, size.x), h = Math.max(1, size.y);

  // Tone mapping is the grade pass's job; keep the scene linear until then.
  renderer.toneMapping = THREE.NoToneMapping;

  // EffectComposer's default render target is UnsignedByteType, which clamps
  // every value at 1.0 — bloom would find no highlights above threshold and the
  // tone mapper would receive an already-crushed image. Give it half-float so
  // the chain is genuinely high dynamic range.
  const hdrTarget = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
  });

  const composer = new EffectComposer(renderer, hdrTarget);
  composer.addPass(new RenderPass(scene, camera));

  let depthTexture = null, aoPass = null;
  if (ao) {
    // One depth texture shared by both ping-pong targets: whichever one the
    // RenderPass happened to draw into, the depth lands here. Safe only because
    // the AO pass runs immediately afterwards, before any full-screen pass has
    // had a chance to clear it.
    depthTexture = new THREE.DepthTexture(w, h);
    depthTexture.type = THREE.UnsignedIntType;
    composer.renderTarget1.depthTexture = depthTexture;
    composer.renderTarget2.depthTexture = depthTexture;

    aoPass = createAOPass(renderer, camera, depthTexture, {
      width: w, height: h, samples: aoSamples,
      radius: aoRadius, intensity: aoIntensity, power: aoPower, scale: aoScale,
    });
    composer.addPass(aoPass);
  }

  let bloomPass = null;
  if (bloom && UnrealBloomPass) {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), bloomStrength, bloomRadius, bloomThreshold);
    composer.addPass(bloomPass);
  }

  const gradePass = new ShaderPass(GradeShader);
  gradePass.uniforms.exposure.value = exposure;
  for (const [k, v] of Object.entries(grade)) {
    if (gradePass.uniforms[k]) gradePass.uniforms[k].value = v;
  }
  gradePass.uniforms.texel.value.set(1 / w, 1 / h);
  composer.addPass(gradePass);

  let smaaPass = null;
  if (smaa && SMAAPass) {
    smaaPass = new SMAAPass(w, h);
    composer.addPass(smaaPass);
  }

  return {
    composer, gradePass, bloomPass, aoPass, smaaPass, depthTexture,
    /** Call once per frame: animates grain and refreshes the AO projection. */
    update(t) {
      gradePass.uniforms.time.value = t;
      // the AO pass refreshes its own projection matrices at render time
    },
    setExposure(v) { gradePass.uniforms.exposure.value = v; },
    setSize(width, height) {
      composer.setSize(width, height);
      const pr = renderer.getPixelRatio();
      const dw = Math.max(1, Math.floor(width * pr)), dh = Math.max(1, Math.floor(height * pr));
      gradePass.uniforms.texel.value.set(1 / dw, 1 / dh);
      if (depthTexture) {
        depthTexture.image.width = dw;
        depthTexture.image.height = dh;
        depthTexture.needsUpdate = true;
        aoPass.setSize(dw, dh);
      }
      if (bloomPass) bloomPass.setSize(width, height);
      if (smaaPass) smaaPass.setSize(width, height);
    },
  };
}

/**
 * Shadow settings that hold up close-in. A tight frustum is worth far more
 * than a big map: halving the covered area doubles effective resolution.
 */
export function tuneShadows(light, { size = 2048, extent = 90, near = 1, far = 400, bias = -0.0004, normalBias = 0.02 } = {}) {
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  light.shadow.camera.left = -extent;
  light.shadow.camera.right = extent;
  light.shadow.camera.top = extent;
  light.shadow.camera.bottom = -extent;
  light.shadow.camera.near = near;
  light.shadow.camera.far = far;
  light.shadow.bias = bias;
  light.shadow.normalBias = normalBias;
  light.shadow.camera.updateProjectionMatrix();
  return light;
}
