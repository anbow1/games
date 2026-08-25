# Operation: City Storm

First-person shooter — Three.js (module) + pointer-lock mouse aim. Open `index.html` in a browser (needs internet for the Three.js CDN).

## Controls

- Click the canvas to lock the pointer
- `WASD` — move, mouse — aim, `LMB` — fire
- Standard FPS HUD: health bar, ammo counter, grenade + kill feed

## Dev notes

- `_env.js`, `mockthree.js`, `mockaddons.js` — Node test scaffolding (Three.js mocks)
- `_runtest.mjs` — headless smoke-test runner (`node _runtest.mjs`)
