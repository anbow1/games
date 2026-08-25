// Headless test runner: boots the game against the THREE mock and drives it
// through hundreds of frames of simulated combat, reporting any thrown error.
import './_env.js';
await import('./_runtest.js'); // game runs as module side-effects and sets window.__CITYSTORM
const W = global.window;
const doc = global.document;
const g = W.__CITYSTORM;

const canvas = doc.getElementById('game');
const kd = (W._h.keydown || []);
const ku = (W._h.keyup || []);
const md = (canvas._h.mousedown || []);
const mu = (canvas._h.mouseup || []);

function press(code) { kd.forEach((h) => h({ code })); }
function release(code) { ku.forEach((h) => h({ code })); }
function mouseDown(btn) { md.forEach((h) => h({ button: btn, preventDefault() {} })); }
function mouseUp(btn) { mu.forEach((h) => h({ button: btn, preventDefault() {} })); }

// diagnostics: confirm handlers are registered
console.log('handlers -> keydown:' + (W._h.keydown||[]).length + ' keyup:' + (W._h.keyup||[]).length + ' mousedown:' + md.length + ' mouseup:' + mu.length);

// Focused test of the click-to-lock branch that was broken:
// 1) with the pointer NOT locked, a canvas mousedown should LOCK (and NOT fire)
g.controls.unlock();
const ammoBefore = g.state.ammo.rifle;
mouseDown(0);
console.log('[click-to-lock] first click locked pointer:', g.controls.isLocked === true);
console.log('[click-to-lock] first click did NOT fire:', g.state.firing === false && g.state.ammo.rifle === ammoBefore);
// 2) with the pointer locked, the next canvas mousedown should start firing
mouseDown(0);
console.log('[click-to-lock] second click is firing:', g.state.firing === true);

// Simulate the real user flow: click the DEPLOY button, then verify the game
// starts and the pointer locks (this is the path that was dead before the fix).
const playBtn = doc.getElementById('playbtn');
const menuEl = doc.getElementById('menu');
const keysBoxEl = doc.getElementById('keys');
console.log('playbtn visible before click:', playBtn.style.display !== 'none');
(playBtn._h.click || []).forEach((h) => h({}));
console.log('keys visible after click:', keysBoxEl.style.display === 'grid');
console.log('menu hidden after click:', menuEl.style.display !== 'flex');
// simulate the setTimeout(()=>controls.lock(),60) firing
g.controls.lock();
console.log('pointer locked:', g.controls._locked === true);

function step() {
  const q = global.__rafQueue;
  const fn = q.pop();
  if (fn) fn();
}

let crashes = [];
let frames = 0;
const MAX_FRAMES = 900; // ~15s @60fps
let firing = false;

// start the session
g.controls.lock();
press('KeyW');            // hold forward
firing = true;

for (let i = 0; i < MAX_FRAMES; i++) {
  frames++;
  // periodic actions to exercise every system
  if (i % 15 === 7) { press('KeyR'); }                       // reload
  if (i % 40 === 20) { press('KeyQ'); }                       // throw grenade
  if (i % 55 === 30) { press('Digit1'); press('Digit2'); }   // switch weapons
  if (i % 70 === 40) { mouseDown(2); }                        // enter scope
  if (i % 70 === 45) { mouseUp(2); }                          // exit scope
  if (i % 200 === 100) { release('KeyW'); press('KeyA'); }   // strafe
  if (i % 200 === 150) { press('KeyW'); release('KeyA'); }
  if (i % 300 === 150 && g.state.hp <= 0) { g.controls.lock(); } // redeploy after death

  if (firing) { mouseDown(0); } // hold fire (cooldown-gated in fire())

  if (i % 100 === 0) {
    const alive = g.enemies.filter(e => e && e.alive).length;
    console.log('[run] frame=' + i + ' time=' + g.state.time.toFixed(1) + ' totalEnemies=' + g.enemies.length + ' alive=' + alive + ' wave=' + g.state.wave);
  }

  // step one animation frame
  try { step(); }
  catch (e) { crashes.push({ frame: i, err: String(e), stack: e.stack }); break; }
}

mouseUp(0); release('KeyW'); release('KeyA');

// sanity assertions
const s = g.state;
const problems = [];
if (s.hp < 0 || s.hp > 100) problems.push(`hp out of range: ${s.hp}`);
if (s.ammo.rifle < 0 || s.ammo.shotgun < 0) problems.push(`negative ammo: ${s.ammo.rifle}/${s.ammo.shotgun}`);
if (s.res.rifle < 0 || s.res.shotgun < 0) problems.push(`negative res: ${s.res.rifle}/${s.res.shotgun}`);
if (s.grenades < 0) problems.push(`negative grenades: ${s.grenades}`);
if (s.kills <= 0) problems.push('no kills recorded (combat path may not have run)');
if (s.wave < 2) problems.push(`waves never advanced (wave=${s.wave})`);

console.log('FRAMES RUN:', frames);
console.log('KILLS:', s.kills, 'WAVE:', s.wave, 'HP:', s.hp, 'WEAPON:', s.weapon);
console.log('AMMO rifle:', s.ammo.rifle, 'res:', s.res.rifle, '| shotgun:', s.ammo.shotgun, 'res:', s.res.shotgun);
console.log('GRENADES:', s.grenades);
console.log('ENEMIES ALIVE:', g.enemies.length);
console.log('-----------------------------');
if (crashes.length) {
  console.log('CRASHES:', crashes.length);
  crashes.forEach((c) => console.log(`[frame ${c.frame}] ${c.err}\n${(c.stack || '').split('\n').slice(0, 4).join('\n')}`));
  process.exit(1);
} else if (problems.length) {
  console.log('SANITY WARNINGS:', problems.length);
  problems.forEach((p) => console.log(' - ' + p));
  process.exit(2);
} else {
  console.log('OK: no crashes, no sanity violations.');
  process.exit(0);
}
