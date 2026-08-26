# Games

A collection of browser games. Each game lives in its own folder — open the `index.html` inside (no build step, all need internet for CDNs).

All three also ship as one Android app: [`android/`](android/) is an Android Studio project — **Combat Arcade** — that bundles every game and asset with a full touch control scheme, so it needs no network at all. [Download the APK](https://github.com/anbow1/games/releases/tag/android-latest).

All three browser games render through a shared physically-based layer,
[`shared/photoreal.js`](shared/photoreal.js): image-based lighting prefiltered from each game's
own sky shader, an HDR post chain (depth-based SSAO, bloom, ACES grade with film grain, vignette,
chromatic aberration and unsharp mask, then SMAA), and procedural albedo/normal/roughness maps
generated on a canvas at load so the games stay self-contained.

Each game keeps its own copy so a folder is standalone. Edit `shared/photoreal.js`, then run:

```bash
node tools/sync-shared.mjs          # propagate to every game
node tools/sync-shared.mjs --check  # fail if any copy is stale
```

`shared/bench.html` is a material bench for the kit — serve the repo over HTTP and open it to see
a roughness sweep in metal plus cloth, skin and clearcoat reference balls.

`shared/touch.js` is the matching control layer for the Android builds — a declarative stick,
drag pad and buttons, with every pointer tracked by id so moving, aiming and firing happen at once.

`tools/vendor-three.mjs` copies exactly the Three.js modules a game imports, by walking the real
import graph: the Android app holds no network permission, so a missed import is a white screen on
the device.

| Folder | Game | Genre |
| --- | --- | --- |
| [`tank-battle/`](tank-battle/) | Tank Battle | M1 Abrams vs T-90 armored combat |
| [`falcon-strike/`](falcon-strike/) | Falcon Strike | Modern fighter jet combat |
| [`city-storm/`](city-storm/) | Operation: City Storm | First-person shooter |
| [`android/`](android/) | Combat Arcade | All three games as one Android app — touch controls, fully offline |
