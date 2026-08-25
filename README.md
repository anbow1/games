# Games

A collection of browser games. Each game lives in its own folder — open the `index.html` inside (no build step, all need internet for CDNs).

One of them also ships as a native app: `tank-battle-android/` is an Android Studio project that wraps Tank Battle with a full touch control scheme and bundles every asset, so it needs no network at all.

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

> **Note:** `tank-battle-android/` still ships the pre-upgrade renderer. Its bundled Three.js is
> trimmed and has no `SMAAPass`, and the post chain needs gating behind the touch build's quality
> presets before it is safe on a phone.

| Folder | Game | Genre |
| --- | --- | --- |
| [`tank-battle/`](tank-battle/) | Tank Battle | M1 Abrams vs T-90 armored combat |
| [`falcon-strike/`](falcon-strike/) | Falcon Strike | Modern fighter jet combat |
| [`city-storm/`](city-storm/) | Operation: City Storm | First-person shooter |
| [`tank-battle-android/`](tank-battle-android/) | Steel Thunder | Android app build of Tank Battle — touch controls, fully offline |
