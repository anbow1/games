# Steel Thunder — Android

An Android app build of [`tank-battle/`](../tank-battle/), rebuilt for touch. M1 Abrams vs T-90,
full ballistics, procedural terrain, UAV recon — driven entirely with your thumbs.

Everything ships inside the APK. There is **no `INTERNET` permission**: the game, Three.js and every
asset are bundled, so it runs on a plane, in a tunnel, or on a factory-reset tablet with no SIM.

## Controls

The screen is split into three zones, plus two big buttons on the right for shooting.

```
┌──────────────────────────────────────────────────────────┐
│ [HULL · AMMO]        ‹ compass ›            [ TAC MAP ]   │
│                                                          │
│         ▲  drag anywhere up here to slew the             │
│            turret and elevate the gun                    │  ← top ~44%
│ ─────────────────────────────────────────────────────    │
│                                              ❚❚ PAUSE    │
│                                                 UAV      │
│                                              CAM EXT     │
│                                              AP ▸ HE     │
│   ⊙ stick     [BRAKE]      0 km/h      (COAX)  ( 120mm ) │
└──────────────────────────────────────────────────────────┘
   ↑ bottom-left 45%                          ↑ two fire buttons
```

| Zone | Action |
| --- | --- |
| **Top of screen** | Drag to aim — left/right slews the turret, up/down elevates the gun |
| **Bottom-left** | Floating drive stick: push up to drive, pull down to reverse, tilt to steer (analog) |
| **120mm** | Fire the main gun. The button rims with a reload ring and shows the loaded round |
| **COAX MG** | Hold for the coaxial machine gun |
| **BRAKE** | Hard stop |
| **AP ▸ HE** | Switch round: APFSDS-DT / HE-thermobaric |
| **CAM** | Exterior chase view ⇄ interior commander's sight (mil-dot reticle, AZ/EL/RNG readout) |
| **UAV** | Deploy the drone for a live tactical feed (10 min endurance, 25 s cooldown) |
| **❚❚ / back** | Pause. The hardware/gesture back button pauses too; press back again to exit |

The stick is *floating* — it snaps to wherever your thumb lands in the bottom-left quadrant rather
than forcing you to find a fixed pad. Driving, aiming and firing are tracked per pointer, so all
three work at once.

Aim sensitivity (three steps) and the graphics preset are on the start screen and persist between
sessions. The main gun and hull hits give haptic feedback.

## Graphics presets

The whole scene budget hangs off one switch, applied at load — changing it reloads the page.

| | pixel ratio | shadows | terrain | trees | grass | post |
| --- | --- | --- | --- | --- | --- | --- |
| **Low** | 0.75× | 1024, hard | 110² | 170 | 900 | none |
| **Medium** (default) | 1.0× | 1536, soft | 140² | 245 | 2000 | bloom |
| **High** | 1.4× | 2048, soft | 170² | 320 | 3800 | bloom + FXAA |

The compass and the tactical map (which does LOS raycasts for spotting) redraw at 7–12 Hz instead of
every frame — on a phone that was costing more than the terrain.

## Building

Requires Android Studio (or a JDK 17+ and the Android SDK with API 35 platform + build tools).

```bash
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug           # build and push to a connected device
./gradlew assembleRelease        # unsigned release APK — sign it before distributing
```

Or open the `tank-battle-android/` folder in Android Studio and hit Run.

- `minSdk 24` (Android 7.0), `targetSdk 35`, locked to landscape, immersive full-screen.
- Needs a device with an up-to-date Android System WebView (Chrome 89+ for import-map support) —
  which is every Play-enabled device, since WebView auto-updates.
- The only permission is `VIBRATE`.

## How it works

`MainActivity` is a thin shell around a `WebView` that hosts the game.

The page is served over `https://appassets.androidplatform.net/` via `WebViewAssetLoader` rather
than `file://`. That is not cosmetic: the game loads Three.js as an ES module through an import map,
and module scripts are rejected by CORS on an opaque `file://` origin. The asset loader answers those
requests straight out of the APK, so a page with a real origin gets `localStorage`, WebAudio and
modules — with no network involved. `shouldOverrideUrlLoading` refuses to navigate anywhere else.

```
app/src/main/
├── java/com/anbow/steelthunder/MainActivity.kt   WebView host, immersive mode, back → pause
└── assets/game/
    ├── index.html                                the game (touch build)
    └── vendor/three/                             Three.js 0.152.2, trimmed to what's used
```

`assets/game/index.html` is a port of `tank-battle/index.html`: same simulation, plus the touch
control layer, the pause screen, the graphics presets, haptics, and safe-area-aware HUD scaling.
Keyboard and mouse handlers are still in there, so the file also runs unchanged in a desktop browser
if you serve the folder over HTTP.

## Credits

Three.js (MIT) is vendored under `assets/game/vendor/three/`, licence included.
