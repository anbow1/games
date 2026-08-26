# Tank Battle

A single-file, realistic-ish modern tank battle game. M1 Abrams vs T-90 — full ballistics, procedural terrain, dynamic sky, UAV tactical recon.

**No build step.** Open `index.html` in any modern browser (needs internet for the Three.js CDN).

Rendering goes through the shared kit in [`shared/photoreal.js`](../shared/photoreal.js), inlined
into this file between the `photoreal kit` markers — edit the shared source and run
`node tools/sync-shared.mjs`, not the copy here.

## Gameplay

You command a company of tanks against an enemy AI force. Engage with the 120mm main gun (APFSDS / HE) and the coaxial machine gun, deploy your UAV for a live tactical feed, and survive.

- **M1 Abrams** — boxy CROWS-topped turret, MRS muzzle reference system
- **T-90** — KORA APSS pods on the turret, bore evacuator + muzzle brake

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | throttle forward / reverse |
| `A` / `D` | steer left / right |
| `Space` | brake |
| Mouse | aim turret (yaw) + main gun (elevation) |
| `Q` / `E` or `←`/`→` | turret yaw (fallback) |
| `↑` / `↓` | elevate main gun (fallback) |
| `LMB` | fire 120mm main gun |
| `RMB` | machine gun |
| `H` | toggle round: APFSDS / HE |
| `C` | camera: exterior / interior commander sight |
| `D` | deploy / stow UAV (10 min feed, 25 s cooldown) |
| `P` | pause |

## Features

- Full projectile ballistics (gravity, lead, reload timers) with tracers and impact markers
- Procedural terrain with vertex-color biomes, baked AO, dirt/grass micro-texture, wind-swayed instanced grass
- Two-species forests (conifer / broadleaf), scattered rocks, villages with windowed facades
- Dynamic sky shader: fbm clouds with self-shadowing, cirrus layer, sun forward-scatter, horizon haze
- Detailed tank models: treaded tracks, road wheels, stowage bins, visors, exhausts, APSS pods, thermal sleeves
- Hit feedback: sparks, hit markers, smoke trails, wreck fires, muzzle flashes + point lights
- Image-based lighting: the sky shader also feeds a PMREM probe, so armour reflects the sky above it
- Post chain on a half-float buffer: depth-based SSAO, bloom, ACES grade with grain, vignette,
  chromatic aberration and unsharp mask, then SMAA
- Armour carries panel seams, rivets and rain streaking, with metalness driven by the map so paint
  stays dielectric and only worn-through scratches behave like bare steel
- Interior commander view: green-phosphor mil-dot sight with AZ / EL / RNG / SPD readouts
- Tactical map with elevation shading, LOS-based spotting, ghosting of last-known positions, and a live turret aim ray on your own tank
- UAV deployable recon with 10-minute endurance feed
