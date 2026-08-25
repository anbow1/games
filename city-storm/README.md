# Operation: City Storm

First-person shooter — Three.js (module) + pointer-lock mouse aim.

Because it loads `game.js` as an ES module, it has to be **served over HTTP** rather than
opened from disk (`python3 -m http.server` from the repo root works). Needs internet for
the Three.js CDN.

## Look

Dusk city canyon, rendered through the shared kit in [`shared/photoreal.js`](../shared/photoreal.js)
(copied here as `photoreal.js` — run `node tools/sync-photoreal.mjs` after editing the shared file).

- The sky shader feeds both the background and a prefiltered PMREM probe, so glass and
  steel reflect the same sky the player sees.
- Post chain on a half-float target: SSAO from the scene depth, bloom, ACES grade with
  grain, vignette, lateral chromatic aberration and an unsharp mask, then SMAA.
- Asphalt, concrete, timber and painted steel carry generated albedo + normal + roughness maps.
- Facades are baked to a tiling texture with lit and dark interiors. The previous version
  built one mesh per window — over twenty thousand across the skyline; the whole city is
  now about a thousand.
- Soldiers are jointed at hip and shoulder, with plate carrier, pouches, helmet and stowed
  night-vision mount. The first-person weapon has gloved hands on the grip and handguard.

## Controls

- Click the canvas to lock the pointer
- `WASD` — move, mouse — aim, `LMB` — fire
- Standard FPS HUD: health bar, ammo counter, grenade + kill feed

## Dev notes

- `_env.js`, `mockthree.js`, `mockaddons.js` — Node test scaffolding (Three.js mocks)
- `_runtest.mjs` — headless smoke-test runner (`node _runtest.mjs`)
