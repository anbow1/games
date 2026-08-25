// ESM resolve hook: map bare three.js specifiers to the local mocks so the
// game module can be imported headless (see _runtest.js).
const dir = new URL('.', import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier === 'three') {
    return { url: new URL('mockthree.js', dir).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/controls/')) {
    // PointerLockControls lives in mockthree.js
    return { url: new URL('mockthree.js', dir).href, shortCircuit: true };
  }
  if (specifier.startsWith('three/addons/')) {
    return { url: new URL('mockaddons.js', dir).href, shortCircuit: true };
  }
  return next(specifier, context);
}
