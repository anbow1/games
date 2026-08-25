// Faithful-enough THREE mock for headless crash-testing.
// Implements every method/property the game uses. Math is simplified but
// never throws — so any throw during the run points to the game code.

class Vector {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  setScalar(s) { this.x = s; this.y = s; this.z = s; return this; }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  distanceSqTo(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return dx * dx + dy * dy + dz * dz; }
  normalize() { const l = this.length() || 1; this.x /= l; this.y /= l; this.z /= l; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z, bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by; this.y = az * bx - ax * bz; this.z = ax * by - ay * bx; return this;
  }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
}

class Color {
  constructor(c) { this.r = 1; this.g = 1; this.b = 1; if (c != null) this.setHex(c); }
  setHex(c) { this.r = ((c >> 16) & 255) / 255; this.g = ((c >> 8) & 255) / 255; this.b = (c & 255) / 255; return this; }
  setHSL(h, s, l) { this.r = this.g = this.b = l; return this; }
  copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; }
  set(c) { return this.setHex(c); }
}

class Euler {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

class Object3D {
  constructor() {
    this.position = new Vector();
    this.rotation = new Euler();
    this.scale = new Vector(1, 1, 1);
    this.userData = {};
    this.parent = null;
    this.visible = true;
    this.children = [];
    this.isObject3D = true;
  }
  add(o) { o.parent = this; this.children.push(o); return this; }
  remove(o) { const i = this.children.indexOf(o); if (i >= 0) { o.parent = null; this.children.splice(i, 1); } return this; }
  traverse(fn) { fn(this); for (const c of this.children) if (c.traverse) c.traverse(fn); }
  getWorldPosition(out) {
    let o = this, wx = 0, wy = 0, wz = 0;
    while (o) { wx += o.position.x; wy += o.position.y; wz += o.position.z; o = o.parent; }
    return out.set(wx, wy, wz);
  }
  getWorldDirection(out) {
    const px = this.rotation.x, py = this.rotation.y;
    return out.set(Math.sin(py) * Math.cos(px), Math.sin(px), -Math.cos(py) * Math.cos(px)).normalize();
  }
  clone() { const c = new Object3D(); c.position = this.position.clone(); c.rotation = this.rotation.clone(); c.scale = this.scale.clone(); return c; }
}

class Mesh extends Object3D {
  constructor(geometry = null, material = null) { super(); this.geometry = geometry; this.material = material; this.isMesh = true; }
}
class Group extends Object3D {}
class Line extends Object3D { constructor(g = null, m = null) { super(); this.geometry = g; this.material = m; } }
class Sprite extends Object3D { constructor(m = null) { super(); this.material = m; } }

class Camera extends Object3D {
  constructor() { super(); this.fov = 50; this.aspect = 1; this.near = 0.1; this.far = 2000; this.projectionMatrix = {}; }
  updateProjectionMatrix() {}
}
class PerspectiveCamera extends Camera {
  constructor(fov, aspect, near, far) { super(); this.fov = fov; this.aspect = aspect; this.near = near; this.far = far; }
}

class Light extends Object3D {
  constructor(intensity = 1) {
    super();
    this.intensity = intensity;
    this.color = new Color(0xffffff);
    this.target = new Object3D();
    this.isLight = true;
    this.shadow = {
      mapSize: new Vector(),
      camera: { left: -1, right: 1, top: 1, bottom: -1, near: 1, far: 2000 },
      bias: 0, normalBias: 0, visible: true, type: 0,
    };
  }
}
class DirectionalLight extends Light {}
class HemisphereLight extends Light {}
class AmbientLight extends Light {}
class PointLight extends Light { constructor(intensity = 1, distance = 0, decay = 1) { super(intensity); this.distance = distance; this.decay = decay; } }

class Scene extends Object3D {
  constructor() { super(); this.children = []; this.background = null; this.fog = null; }
}

class Fog {
  constructor(color = 0x000000, near = 1, far = 1000) { this.color = new Color(color); this.near = near; this.far = far; }
}
class FogExp2 extends Fog {
  constructor(color = 0x000000, density = 0.00025) { super(color); this.density = density; }
}

class Raycaster {
  constructor() { this.origin = new Vector(); this.direction = new Vector(0, 0, -1); }
  set(origin, direction) { this.origin = origin.clone(); this.direction = direction.clone().normalize(); return this; }
  intersectObjects(objects) {
    const hits = [];
    for (const obj of objects) {
      if (!obj.userData || !obj.userData.isEnemy) continue;
      const wp = obj.getWorldPosition(new Vector());
      const d = wp.distanceTo(this.origin);
      if (d < 1.5 || d > 140) continue; // nearby enemies are always hittable (exercise combat paths)
      const childMeshes = [];
      obj.traverse(c => { if (c.isMesh) childMeshes.push(c); });
      const target = childMeshes.length ? (Math.random() < 0.25 ? childMeshes[0] : childMeshes[Math.floor(Math.random() * childMeshes.length)]) : obj;
      hits.push({ distance: d, point: wp.clone(), object: target });
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }
}

class Clock { constructor() { this._last = 0; } getDelta() { const d = 1 / 60; this._last += d; return d; } }

class WebGLRenderer {
  constructor(opts) { this.options = opts; this.shadowMap = { enabled: false, type: 0 }; this.toneMapping = 0; this.toneMappingExposure = 1; this.outputColorSpace = 'sRGB'; }
  setSize(w, h) { this._w = w; this._h = h; }
  setPixelRatio(r) { this.pixelRatio = r; }
  getPixelRatio() { return this.pixelRatio || 1; }
  render() {}
}

class BoxGeometry {}
class CylinderGeometry {}
class SphereGeometry {}
class PlaneGeometry {}
class RingGeometry {}
class TorusGeometry {}
class BufferGeometry { setFromPoints(pts) { this.points = pts; return this; } }
class MeshStandardMaterial {}
class MeshBasicMaterial {}
class LineBasicMaterial {}
class SpriteMaterial {}
class ShaderMaterial {}

class Texture {
  constructor(image) {
    this.image = image;
    this.wrapS = 0; this.wrapT = 0;
    this.repeat = { x: 1, y: 1, set(x, y) { this.x = x; this.y = y; } };
    this.offset = { x: 0, y: 0 };
    this.anisotropy = 1; this.colorSpace = ''; this.needsUpdate = false;
  }
  clone() { return new Texture(this.image); }
}
class CanvasTexture extends Texture {}

class InstancedMesh extends Mesh {
  constructor(geometry, material, count = 0) {
    super(geometry, material);
    this.count = count;
    this.instanceMatrix = { needsUpdate: false };
    this.instanceColor = null;
  }
  setMatrixAt() {}
  setColorAt() { if (!this.instanceColor) this.instanceColor = { needsUpdate: false }; }
  getComputedMatrix() { return {}; }
}

class PointerLockControls {
  constructor(camera, domElement) { this.camera = camera; this.domElement = domElement; this._locked = false; this._handlers = {}; }
  get isLocked() { return this._locked; }
  lock() { this._locked = true; this._fire('lock'); }
  unlock() { this._locked = false; this._fire('unlock'); }
  addEventListener(type, cb) { (this._handlers[type] = this._handlers[type] || []).push(cb); return this; }
  removeEventListener() {}
  _fire(type) { (this._handlers[type] || []).forEach(cb => cb({ type })); }
}

const Vector3 = Vector;
const Vector2 = Vector;

// Enum constants (numeric identity doesn't matter for the mock)
const PCFSoftShadowMap = 0, ACESFilmicToneMapping = 1, SRGBColorSpace = 'sRGB';
const AdditiveBlending = 1, DoubleSide = 2, FrontSide = 0, BackSide = 3;
const RepeatWrapping = 3, NearestFilter = 4, LinearFilter = 5;

// Namespace object (default export) — convenience only.
const THREE = {
  Vector3, Color, Vector2, Object3D, Group, Mesh, Line, Sprite, Camera,
  PerspectiveCamera, Light, DirectionalLight, HemisphereLight, AmbientLight, PointLight,
  Scene, Raycaster, Clock, WebGLRenderer, Fog, FogExp2,
  BoxGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, RingGeometry, TorusGeometry, BufferGeometry,
  MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial, SpriteMaterial, ShaderMaterial,
  Texture, CanvasTexture, InstancedMesh,
  PointerLockControls,
  PCFSoftShadowMap: 0, ACESFilmicToneMapping: 1, SRGBColorSpace: 'sRGB', BackSide: 3,
  AdditiveBlending: 1, DoubleSide: 2, FrontSide: 0,
  RepeatWrapping: 3, NearestFilter: 4, LinearFilter: 5,
};

export {
  Vector3, Color, Vector2, Object3D, Group, Mesh, Line, Sprite, Camera,
  PerspectiveCamera, Light, DirectionalLight, HemisphereLight, AmbientLight, PointLight,
  Scene, Raycaster, Clock, WebGLRenderer, Fog, FogExp2,
  BoxGeometry, CylinderGeometry, SphereGeometry, PlaneGeometry, RingGeometry, TorusGeometry, BufferGeometry,
  MeshStandardMaterial, MeshBasicMaterial, LineBasicMaterial, SpriteMaterial, ShaderMaterial,
  Texture, CanvasTexture, InstancedMesh,
  PointerLockControls,
};
export default THREE;
