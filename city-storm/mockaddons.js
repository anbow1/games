// Mock post-processing addons used by the game.
class RenderPass { constructor(scene, camera) { this.scene = scene; this.camera = camera; } update() {} }
class UnrealBloomPass { constructor(res, strength, radius, threshold) { this.resolution = res; this.strength = strength; this.radius = radius; this.threshold = threshold; } setSize() {} }
class EffectComposer {
  constructor(renderer) { this.renderer = renderer; this.passes = []; }
  addPass(pass) { this.passes.push(pass); }
  removePass(pass) { const i = this.passes.indexOf(pass); if (i >= 0) this.passes.splice(i, 1); }
  setSize(w, h) { this._w = w; this._h = h; }
  render() {}
}
class ShaderPass {
  constructor(shader) { this.uniforms = (shader && shader.uniforms) || {}; this.material = { uniforms: this.uniforms }; }
}
const GammaCorrectionShader = { name: 'GammaCorrectionShader', uniforms: {} };
const FXAAShader = { name: 'FXAAShader', uniforms: { resolution: { value: { set() {} } } } };
export { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, GammaCorrectionShader, FXAAShader };
