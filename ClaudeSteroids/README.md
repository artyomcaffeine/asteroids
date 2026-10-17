# ClaudeSteroids

A browser remake of the pygame Asteroids game in the parent folder, with neon vector graphics and extra gameplay.
It's plain HTML5 Canvas and JavaScript, so there's nothing to install or build.

## Run it

Open `index.html` in a modern browser. If your browser blocks local files, serve the folder instead:

```bash
cd ClaudeSteroids
python3 -m http.server 8000
# then open http://localhost:8000
```

## Controls

| Key | Action |
| --- | --- |
| `W` / `↑` | Thrust |
| `A` `D` / `←` `→` | Rotate |
| `S` / `↓` | Reverse thrust |
| `Space` | Fire |
| `Shift` | Hyperspace (4 s cooldown) |
| `P` / `Esc` | Pause |
| `M` | Mute |
| `G` | Toggle glow effects (for slower machines) |

On phones and tablets, on-screen touch buttons appear automatically.

## What's new compared to the pygame version

**Graphics**
- Neon glow look: a pre-rendered nebula backdrop, a three-layer parallax starfield, a vignette and CRT scanlines.
- Jagged, rotating asteroids with shading, craters and rim lighting, in three color themes.
- A shaded player ship with a cockpit, a flickering engine flame and exhaust particles.
- Particle explosions with sparks, smoke, flashes, shockwave rings, flying debris and screen shake. When you die, the ship breaks apart in slow motion.
- Floating score popups, wave banners and a HUD (score, high score, lives, power-up timers, hyperspace meter).
- Scales to any window size and supports high-DPI screens.

**Gameplay**
- Newtonian flight with inertia and drag instead of fixed-speed movement, and screen wrap-around.
- Waves get bigger and faster as you go.
- Armored iron asteroids from wave 3 that take several hits and score double.
- Flying saucers. The large one fires at random; the small one aims at you.
- Power-ups: triple shot, rapid fire, a stackable shield and an extra ship.
- A chain multiplier (up to ×5) for quick kills, an extra ship every 10,000 points, and three lives with temporary invulnerability on respawn.
- Hyperspace jumps to the safest spot it can find.
- The high score is saved in the browser.
- Synthesized sound effects using the Web Audio API, with no audio files.

Gameplay values that match the original `constants.py`, such as the player radius, turn speed, asteroid sizes and split behavior, are kept at the top of `game.js`.
