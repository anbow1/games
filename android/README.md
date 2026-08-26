# Combat Arcade — Android

All three games from this repo in one app, rebuilt for touch: **Steel Thunder** (tanks),
**Falcon Strike** (jets) and **City Storm** (first-person). A launcher page picks between them.

Everything ships inside the APK. There is **no `INTERNET` permission** — the games, Three.js and
every asset are bundled, so it runs on a plane, in a tunnel, or on a factory-reset tablet with no
SIM. The only permission is `VIBRATE`.

## Getting it onto a phone

Every push builds an APK on CI and publishes it here:

> **https://github.com/anbow1/games/releases/tag/android-latest**

On the phone:

1. Open that link in Chrome and tap `combat-arcade.apk`.
2. Chrome warns the file may be harmful — the standard warning for any APK outside the Play
   Store. Tap **Download anyway**.
3. Open the downloaded file (Chrome's download bar, or *Files → Downloads*).
4. Android asks to allow installing unknown apps from Chrome. Tap **Settings**, turn on
   *Allow from this source*, press back, tap **Install**.
5. Launch **Combat Arcade**. Hold the phone in landscape.

The APK is signed with the standard Android debug key, so it installs alongside anything from the
Play Store and will not auto-update — download it again to get a newer build.

> The package changed from `com.anbow.steelthunder` to `com.anbow.combatarcade` when the app grew
> from one game to three, so this installs next to the old Steel Thunder rather than over it. The
> old one can be uninstalled.

## Controls

Common to all three: pointers are tracked by id, so moving, aiming and firing happen at once; the
analog stick floats to wherever the thumb lands rather than making you find a fixed pad; the
hardware/gesture **back** button pauses, back again returns to the launcher.

### Steel Thunder

| Zone | Action |
| --- | --- |
| Top of screen | Drag to slew the turret and elevate the gun |
| Bottom-left stick | Push to drive, pull to reverse, tilt to steer |
| **120mm** | Main gun. The button rims with a reload ring and shows the loaded round |
| **COAX MG** | Hold for the machine gun |
| BRAKE · AP▸HE · CAM · UAV | Hard stop, round select, interior sight, drone |

### Falcon Strike

| Zone | Action |
| --- | --- |
| Bottom-left stick | Pitch and roll. Pitch can be inverted on the start screen |
| **A/B** / **IDLE** | Throttle — afterburner and idle, held |
| ◀ ▶ | Rudder |
| **GUNS** | 20 mm cannon, held |
| **IR** / **RADAR** / **FFAR** | Missiles and rockets, tapped. Stores are on the button faces |

Cannon, missile counts and the lock bars moved to the top-left of the HUD, since the flight stick
now occupies the bottom-left corner.

### City Storm

| Zone | Action |
| --- | --- |
| Bottom-left stick | Move. Push past 85% to sprint — no separate sprint button |
| Right side of screen | Drag to look. Sensitivity and Y-inversion are on the start screen |
| **FIRE** ×2 | One under each thumb. A single trigger on the right fights the look pad for the same thumb, so you could not turn while shooting |
| **ADS** | Hold to aim down sights (rifle only); look slows while scoped |
| JUMP · RELOAD · GRENADE · RIFLE/SHOTGUN | |

There is no pointer to lock on a touch screen, so the DEPLOY button starts play directly and the
look pad takes the place of mouse movement.

## Graphics presets

Each game has its own LOW / MEDIUM / HIGH on its start screen, persisted between sessions.
Changing one reloads the page, because shadow map size, terrain segment counts and light counts
are baked at construction.

Screen-space AO and SMAA are each a full-screen pass at native resolution — on a mid-range phone
they are the difference between 60 and 30 fps — so only **HIGH** pays for them. The image-based
lighting probe is a one-off bake at load and stays on at every preset: it is what stops armour,
airframes and glass reading as flat paint.

If a game stutters, drop it to LOW first; that also halves the pixel ratio.

## Building it yourself

Requires Android Studio (or a JDK 17+ and the Android SDK with the API 35 platform and build tools).

```bash
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug           # build and push to a connected device
./gradlew assembleRelease        # unsigned release APK — sign it before distributing
```

Or open the `android/` folder in Android Studio and hit Run.

- `minSdk 24` (Android 7.0), `targetSdk 35`, locked to landscape, immersive full-screen.
- Needs an up-to-date Android System WebView (Chrome 89+, for import-map support) — which is every
  Play-enabled device, since WebView auto-updates.

## How it works

`MainActivity` is a thin shell around a `WebView`. It loads `assets/launcher.html`; the cards are
ordinary links to each game.

Assets are served over `https://appassets.androidplatform.net/` through `WebViewAssetLoader`
rather than `file://`. That is not cosmetic: the games load Three.js as ES modules through an
import map, and module scripts are rejected by CORS on an opaque `file://` origin. The asset
loader answers those requests straight out of the APK, so a page with a real origin gets
`localStorage`, WebAudio and modules with no network involved. `shouldOverrideUrlLoading` refuses
to navigate anywhere off that host.

Back is three levels deep, in order: a running game's `window.__androidBack` pauses it and claims
the press; otherwise `WebView.goBack()` returns to the launcher; from the launcher — which defines
no such hook, and that absence is how it is identified as the top of the stack — back exits after
a confirm.

```
app/src/main/
├── java/com/anbow/combatarcade/MainActivity.kt
└── assets/
    ├── launcher.html
    ├── tank/    index.html + vendor/three/
    ├── falcon/  index.html + vendor/three/
    └── city/    index.html + game.js + photoreal.js + touch.js + vendor/three/
```

The three games pin different Three.js releases (0.152.2, 0.160.0, 0.169.0), so each vendors its
own. `tools/vendor-three.mjs` walks the actual import graph from the entry specifiers rather than
copying whole example directories or guessing the dependency list — with no network permission, a
missed import is a white screen on the device. Roughly 11 modules and 750 KB per game.

The rendering layer (`shared/photoreal.js`) and the control layer (`shared/touch.js`) are shared
with the browser builds and copied in by `tools/sync-shared.mjs`; CI fails the build if any copy
is stale.

## Credits

Three.js (MIT) is vendored under each game's `vendor/three/`, licence included.
