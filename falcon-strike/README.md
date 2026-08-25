# Falcon Strike

Modern fighter jet combat — single-file Three.js game. Open `index.html` in a browser (needs internet for the Three.js CDN).

## Look

Rendered through the shared kit in [`shared/photoreal.js`](../shared/photoreal.js), inlined into
this file between the `photoreal kit` markers — edit the shared source and run
`node tools/sync-photoreal.mjs`, not the copy here.

- The existing sky shader now also seeds a PMREM light probe, so the airframe reflects the
  sky it is flying through instead of being lit only by the sun and a hemisphere.
- The sea is a low-roughness dielectric with two normal-map offsets scrolling against each
  other; sun glint off it exceeds 1.0 on the half-float buffer and blooms.
- The airframe carries generated panel seams, rivet rows and exhaust streaking. The canopy
  is a clearcoated reflective dielectric rather than a Phong shell.
- Terrain keeps its biome vertex colours and gains normal and roughness detail on top.
- Post chain: depth-based SSAO, bloom, ACES grade with grain, vignette, chromatic
  aberration and unsharp mask, then SMAA. The game previously had no post-processing at all.

## Controls

| Key | Action |
| --- | --- |
| `WASD` / arrows | pitch, roll, yaw |
| `Space` | guns |
| `F` | fire air-to-air missile |
| `T` | fire IR-homing missile |
| `M` | fire radar-guided missile |
| `Shift` | afterburner |
| `Ctrl` | idle throttle |
| `R` | reload |
| `C` | chase / cockpit camera |
| `P` / `Esc` | pause |
