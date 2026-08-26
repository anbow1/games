// Mock post-processing addons used by the game.
class RenderPass { constructor(scene, camera) { this.scene = scene; this.camera = camera; } update() {} }
class UnrealBloomPass { constructor(res, strength, radius, threshold) { this.resolution = res; this.strength = strength; this.radius = radius; this.threshold = threshold; } setSize() {} }
class EffectComposer {
  // The game hands in its own half-float target; keep it so the mock matches
  // the real two-argument signature.
  // Real EffectComposer keeps two ping-pong targets; the game attaches its
  // shared depth texture to both, so the mock has to expose both.
  constructor(renderer, target) {
    this.renderer = renderer;
    this.renderTarget1 = target || { texture: {}, setSize() {}, dispose() {} };
    this.renderTarget2 = { texture: {}, setSize() {}, dispose() {} };
    this.passes = [];
  }
  addPass(pass) { this.passes.push(pass); }
  removePass(pass) { const i = this.passes.indexOf(pass); if (i >= 0) this.passes.splice(i, 1); }
  setSize(w, h) { this._w = w; this._h = h; }
  render() {}
}
class ShaderPass {
  constructor(shader) { this.uniforms = (shader && shader.uniforms) || {}; this.material = { uniforms: this.uniforms }; }
}
class SMAAPass { constructor(w, h) { this.width = w; this.height = h; } setSize() {} }
const GammaCorrectionShader = { name: 'GammaCorrectionShader', uniforms: {} };
const FXAAShader = { name: 'FXAAShader', uniforms: { resolution: { value: { set() {} } } } };
export { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, SMAAPass, GammaCorrectionShader, FXAAShader };
