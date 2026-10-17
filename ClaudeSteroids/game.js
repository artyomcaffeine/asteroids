// ClaudeSteroids - a neon, browser-based take on the pygame Asteroids in the parent folder.
// No build step or dependencies: open index.html in any modern browser.
'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Constants (values from ../constants.py are kept where they still make sense)
  // ---------------------------------------------------------------------------
  const W = 1280;
  const H = 720;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  const PLAYER_RADIUS = 20;
  const PLAYER_TURN_SPEED = 300 * DEG;
  const PLAYER_THRUST = 520;
  const PLAYER_REVERSE_THRUST = 260;
  const PLAYER_MAX_SPEED = 560;
  const PLAYER_DRAG = 0.55; // fraction of velocity kept after one second
  const PLAYER_SHOOT_COOLDOWN = 0.22;
  const PLAYER_RAPID_COOLDOWN = 0.08;
  const HYPERSPACE_COOLDOWN = 4;
  const RESPAWN_INVULN = 3;
  const START_LIVES = 3;
  const EXTRA_LIFE_EVERY = 10000;

  const SHOT_RADIUS = 4;
  const SHOT_SPEED = 720;
  const SHOT_LIFE = 1.0;

  const ASTEROID_MIN_RADIUS = 20;
  const ASTEROID_KINDS = 3;
  const ASTEROID_SCORE = { 3: 20, 2: 50, 1: 100 };

  const POWERUP_DURATION = 10;
  const POWERUP_LIFETIME = 10;
  const CHAIN_WINDOW = 1.2;

  const MAX_PARTICLES = 1600;
  const HIGHSCORE_KEY = 'claudesteroids.highscore';

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function wrap(o, pad) {
    if (o.x < -pad) o.x += W + pad * 2;
    else if (o.x > W + pad) o.x -= W + pad * 2;
    if (o.y < -pad) o.y += H + pad * 2;
    else if (o.y > H + pad) o.y -= H + pad * 2;
  }

  function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  function overlaps(a, ra, b, rb) {
    const r = ra + rb;
    return dist2(a, b) < r * r;
  }

  function removeFrom(arr, item) {
    const i = arr.indexOf(item);
    if (i >= 0) arr.splice(i, 1);
  }

  function loadHighScore() {
    try { return parseInt(localStorage.getItem(HIGHSCORE_KEY), 10) || 0; } catch (e) { return 0; }
  }

  function saveHighScore(v) {
    try { localStorage.setItem(HIGHSCORE_KEY, String(v)); } catch (e) { /* storage unavailable */ }
  }

  // ---------------------------------------------------------------------------
  // Canvas & scaling (fixed 1280x720 world, letterboxed to the window)
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let viewScale = 1;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewScale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * viewScale) + 'px';
    canvas.style.height = Math.floor(H * viewScale) + 'px';
    canvas.width = Math.round(W * viewScale * dpr);
    canvas.height = Math.round(H * viewScale * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // Glow via shadowBlur is the prettiest option but can be slow on weak GPUs;
  // it switches off automatically if the frame rate drops (or with the G key).
  const fx = { glow: true, slowTime: 0 };

  function glow(color, blur) {
    if (fx.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
    }
  }

  function noGlow() {
    ctx.shadowBlur = 0;
  }

  // ---------------------------------------------------------------------------
  // Sound: everything is synthesised with WebAudio, so there are no asset files
  // ---------------------------------------------------------------------------
  const Sfx = (() => {
    let ac = null;
    let master = null;
    let noiseBuf = null;
    let thrustGain = null;
    let ufoOsc = null;
    let ufoGain = null;
    let muted = false;

    function init() {
      if (ac) {
        if (ac.state === 'suspended') ac.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ac.destination);

      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      // continuous engine rumble, faded in/out while thrusting
      const thrustSrc = ac.createBufferSource();
      thrustSrc.buffer = noiseBuf;
      thrustSrc.loop = true;
      const thrustFilter = ac.createBiquadFilter();
      thrustFilter.type = 'lowpass';
      thrustFilter.frequency.value = 380;
      thrustGain = ac.createGain();
      thrustGain.gain.value = 0;
      thrustSrc.connect(thrustFilter).connect(thrustGain).connect(master);
      thrustSrc.start();

      // the saucer warble
      ufoOsc = ac.createOscillator();
      ufoOsc.type = 'square';
      ufoOsc.frequency.value = 440;
      const lfo = ac.createOscillator();
      lfo.frequency.value = 7;
      const lfoGain = ac.createGain();
      lfoGain.gain.value = 90;
      lfo.connect(lfoGain).connect(ufoOsc.frequency);
      ufoGain = ac.createGain();
      ufoGain.gain.value = 0;
      ufoOsc.connect(ufoGain).connect(master);
      ufoOsc.start();
      lfo.start();
    }

    function tone({ type = 'square', f0, f1 = f0, dur, vol = 0.2, delay = 0 }) {
      if (!ac) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.05);
    }

    function noise({ dur, vol, f0, f1 = 60 }) {
      if (!ac) return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(f0, t);
      filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter).connect(g).connect(master);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.05);
    }

    return {
      init,
      shoot() { tone({ f0: 1100, f1: 240, dur: 0.11, vol: 0.06 }); },
      enemyShoot() { tone({ type: 'sawtooth', f0: 500, f1: 160, dur: 0.16, vol: 0.05 }); },
      hit() { tone({ type: 'triangle', f0: 340, f1: 140, dur: 0.07, vol: 0.12 }); },
      explode(size) {
        noise({ dur: 0.25 + size * 0.22, vol: 0.22 + size * 0.08, f0: 3200 / size, f1: 70 });
        tone({ type: 'sine', f0: 90 + 60 / size, f1: 28, dur: 0.3 + size * 0.15, vol: 0.22 });
      },
      playerDie() {
        noise({ dur: 1.4, vol: 0.5, f0: 4000, f1: 50 });
        tone({ type: 'sine', f0: 220, f1: 20, dur: 1.2, vol: 0.35 });
      },
      power() {
        [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.14, vol: 0.12, delay: i * 0.06 }));
      },
      extraLife() {
        [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => tone({ type: 'square', f0: f, dur: 0.1, vol: 0.06, delay: i * 0.07 }));
      },
      shieldHit() { tone({ type: 'sine', f0: 900, f1: 200, dur: 0.3, vol: 0.18 }); },
      hyper() { tone({ type: 'sine', f0: 180, f1: 2200, dur: 0.35, vol: 0.14 }); },
      wave() {
        [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.25, vol: 0.1, delay: i * 0.1 }));
      },
      thrust(on) {
        if (thrustGain) thrustGain.gain.setTargetAtTime(on ? 0.2 : 0, ac.currentTime, 0.05);
      },
      ufo(on, small) {
        if (!ufoGain) return;
        ufoGain.gain.setTargetAtTime(on ? 0.035 : 0, ac.currentTime, 0.08);
        ufoOsc.frequency.setTargetAtTime(small ? 900 : 460, ac.currentTime, 0.01);
      },
      toggleMute() {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : 0.5;
        return muted;
      },
      get muted() { return muted; },
    };
  })();

  // ---------------------------------------------------------------------------
  // Input: keyboard + on-screen touch buttons
  // ---------------------------------------------------------------------------
  const keys = new Set();
  const pressed = new Set(); // keys that went down this frame
  const touch = { left: false, right: false, thrust: false, fire: false };
  const BLOCKED = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];

  window.addEventListener('keydown', (e) => {
    if (BLOCKED.includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
    Sfx.init();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => {
    keys.clear();
    if (state === 'playing') state = 'paused';
  });

  const down = (...codes) => codes.some((c) => keys.has(c));
  const hit = (...codes) => codes.some((c) => pressed.has(c));

  const input = {
    left: () => down('KeyA', 'ArrowLeft') || touch.left,
    right: () => down('KeyD', 'ArrowRight') || touch.right,
    thrust: () => down('KeyW', 'ArrowUp') || touch.thrust,
    reverse: () => down('KeyS', 'ArrowDown'),
    fire: () => down('Space', 'KeyJ') || touch.fire,
    hyper: () => hit('ShiftLeft', 'ShiftRight', 'KeyH', 'TouchHyper'),
    start: () => hit('Enter', 'Space', 'TouchStart'),
    pause: () => hit('KeyP', 'Escape', 'TouchPause'),
  };

  function setupTouch() {
    const enable = () => document.body.classList.add('touch');
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) enable();
    window.addEventListener('touchstart', enable, { once: true, passive: true });

    document.querySelectorAll('#touch button').forEach((btn) => {
      const k = btn.dataset.k;
      const on = (e) => {
        e.preventDefault();
        Sfx.init();
        btn.classList.add('on');
        if (k === 'hyper') pressed.add('TouchHyper');
        else if (k === 'pause') pressed.add('TouchPause');
        else touch[k] = true;
        if (state !== 'playing' && k !== 'pause') pressed.add('TouchStart');
      };
      const off = (e) => {
        e.preventDefault();
        btn.classList.remove('on');
        if (k in touch) touch[k] = false;
      };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
      btn.addEventListener('pointerleave', off);
    });

    canvas.addEventListener('pointerdown', () => {
      Sfx.init();
      if (state !== 'playing') pressed.add('TouchStart');
    });
  }
  setupTouch();

  // ---------------------------------------------------------------------------
  // Pre-rendered backdrop: nebula, starfield, vignette
  // ---------------------------------------------------------------------------
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  const nebula = (() => {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#05031a');
    bg.addColorStop(0.5, '#02010a');
    bg.addColorStop(1, '#070214');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const hues = [265, 290, 200, 320, 180];
    for (let i = 0; i < 14; i++) {
      const x = rand(0, W);
      const y = rand(0, H);
      const r = rand(150, 420);
      const hue = pick(hues);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `hsla(${hue}, 80%, 45%, ${rand(0.05, 0.11)})`);
      grad.addColorStop(0.5, `hsla(${hue + 20}, 70%, 30%, ${rand(0.02, 0.05)})`);
      grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // faint dust
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(255,255,255,${rand(0.02, 0.12)})`;
      g.fillRect(rand(0, W), rand(0, H), 1, 1);
    }
    return c;
  })();

  const vignette = (() => {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.7)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    return c;
  })();

  const STAR_LAYERS = [
    { count: 140, speed: 0.04, size: [0.6, 1.2], alpha: [0.25, 0.55] },
    { count: 70, speed: 0.1, size: [1.0, 1.8], alpha: [0.4, 0.8] },
    { count: 28, speed: 0.22, size: [1.6, 2.6], alpha: [0.6, 1.0] },
  ];
  const stars = STAR_LAYERS.map((layer) =>
    Array.from({ length: layer.count }, () => ({
      x: rand(0, W),
      y: rand(0, H),
      s: rand(layer.size[0], layer.size[1]),
      a: rand(layer.alpha[0], layer.alpha[1]),
      tw: rand(0, TAU),
      hue: pick([200, 220, 260, 40, 0]),
    }))
  );

  function updateStars(dt, vx, vy) {
    STAR_LAYERS.forEach((layer, i) => {
      for (const s of stars[i]) {
        s.x -= (vx * layer.speed + 6 * layer.speed) * dt;
        s.y -= (vy * layer.speed + 2 * layer.speed) * dt;
        s.tw += dt * 2.5;
        if (s.x < 0) s.x += W; else if (s.x > W) s.x -= W;
        if (s.y < 0) s.y += H; else if (s.y > H) s.y -= H;
      }
    });
  }

  function drawStars() {
    for (const layer of stars) {
      for (const s of layer) {
        ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(s.tw));
        ctx.fillStyle = s.hue === 0 ? '#ffffff' : `hsl(${s.hue}, 80%, 85%)`;
        ctx.fillRect(s.x, s.y, s.s, s.s);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let state = 'title'; // title | playing | paused | gameover
  let ship = null;
  let asteroids = [];
  let bullets = [];
  let enemyBullets = [];
  let particles = [];
  let debris = [];
  let rings = [];
  let texts = [];
  let powerups = [];
  let ufo = null;

  let score = 0;
  let highScore = loadHighScore();
  let newHigh = false;
  let lives = START_LIVES;
  let nextLifeAt = EXTRA_LIFE_EVERY;
  let wave = 0;
  let waveTimer = 0;
  let ufoTimer = 0;
  let respawnTimer = 0;
  let chain = 0;
  let chainTimer = 0;
  let shake = 0;
  let banner = null;
  let time = 0;

  // ---------------------------------------------------------------------------
  // Asteroids
  // ---------------------------------------------------------------------------
  const ROCK_STYLES = [
    { stroke: '#ffae6b', glow: '#ff6a1a', inner: '#4a2c1c', outer: '#140906', spark: ['#ffd29a', '#ff8a3d', '#ff5a1a'] },
    { stroke: '#d29bff', glow: '#9d4edd', inner: '#33204e', outer: '#0d0617', spark: ['#f0d6ff', '#c77dff', '#8a3ffc'] },
    { stroke: '#7fe3ff', glow: '#1aa7ff', inner: '#183447', outer: '#050d15', spark: ['#e0f8ff', '#7fe3ff', '#2a8cff'] },
  ];
  const IRON_STYLE = { stroke: '#e6eef7', glow: '#9fb6cf', inner: '#4a525e', outer: '#111419', spark: ['#ffffff', '#cfd8e3', '#ffd27f'] };

  // Each rock is drawn once into its own off-screen canvas (fill, craters and glow),
  // so per-frame drawing is just a rotated drawImage.
  function makeRockSprite(r, style, iron) {
    const n = randInt(10, 15);
    const verts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rand(-0.15, 0.15);
      const rr = r * rand(0.78, 1.12);
      verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    const pad = 20;
    const size = Math.ceil((r * 1.15 + pad) * 2);
    const S = 2; // render at 2x for crispness
    const c = makeCanvas(size * S, size * S);
    const g = c.getContext('2d');
    g.scale(S, S);
    g.translate(size / 2, size / 2);

    const path = () => {
      g.beginPath();
      verts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
    };

    path();
    const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.15);
    grad.addColorStop(0, style.inner);
    grad.addColorStop(1, style.outer);
    g.fillStyle = grad;
    g.fill();

    g.save();
    path();
    g.clip();
    const craters = Math.max(2, Math.round(r / 12));
    for (let i = 0; i < craters; i++) {
      const cr = r * rand(0.1, 0.24);
      const ca = rand(0, TAU);
      const cd = rand(0, r * 0.62);
      const cx = Math.cos(ca) * cd;
      const cy = Math.sin(ca) * cd;
      g.beginPath();
      g.arc(cx, cy, cr, 0, TAU);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fill();
      g.beginPath();
      g.arc(cx + cr * 0.15, cy + cr * 0.15, cr, Math.PI * 0.1, Math.PI * 0.9);
      g.strokeStyle = 'rgba(255,255,255,0.10)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    if (iron) {
      // riveted armour bands
      g.strokeStyle = 'rgba(220,235,255,0.25)';
      g.lineWidth = 2;
      for (let i = -1; i <= 1; i++) {
        g.beginPath();
        g.moveTo(-r * 1.2, i * r * 0.45 - r * 0.2);
        g.lineTo(r * 1.2, i * r * 0.45 + r * 0.2);
        g.stroke();
      }
    }
    // rim light
    const rim = g.createLinearGradient(-r, -r, r, r);
    rim.addColorStop(0, 'rgba(255,255,255,0.18)');
    rim.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = rim;
    g.fillRect(-r * 1.3, -r * 1.3, r * 2.6, r * 2.6);
    g.restore();

    path();
    g.lineJoin = 'round';
    g.shadowColor = style.glow;
    g.shadowBlur = 16;
    g.lineWidth = iron ? 3 : 2;
    g.strokeStyle = style.stroke;
    g.stroke();
    g.shadowBlur = 0;
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.stroke();

    return { canvas: c, size };
  }

  function spawnAsteroid(size, x, y, vx, vy, opts = {}) {
    const r = ASTEROID_MIN_RADIUS * size;
    const iron = !!opts.iron;
    const style = iron ? IRON_STYLE : opts.style || pick(ROCK_STYLES);
    const a = {
      x, y, vx, vy, r, size, iron, style,
      hp: iron ? size + 1 : 1,
      rot: rand(0, TAU),
      spin: rand(-1.2, 1.2) / size,
      flash: 0,
      sprite: makeRockSprite(r, style, iron),
    };
    asteroids.push(a);
    return a;
  }

  // Spawn on the screen edge, mirroring AsteroidField's edge spawning in the original.
  function spawnEdgeAsteroid(size, speedMul, iron) {
    const r = ASTEROID_MIN_RADIUS * size;
    let x, y;
    if (Math.random() < 0.5) {
      x = Math.random() < 0.5 ? -r + 1 : W + r - 1;
      y = rand(0, H);
    } else {
      x = rand(0, W);
      y = Math.random() < 0.5 ? -r + 1 : H + r - 1;
    }
    const towardCenter = Math.atan2(H / 2 - y, W / 2 - x) + rand(-30, 30) * DEG;
    const speed = rand(40, 100) * speedMul;
    return spawnAsteroid(size, x, y, Math.cos(towardCenter) * speed, Math.sin(towardCenter) * speed, { iron });
  }

  function damageAsteroid(a, hx, hy, ivx, ivy, byPlayer) {
    a.hp--;
    if (a.hp > 0) {
      a.flash = 0.12;
      a.vx += ivx * 0.03;
      a.vy += ivy * 0.03;
      sparks(hx, hy, 10, a.style.spark, 260);
      Sfx.hit();
      return;
    }
    destroyAsteroid(a, ivx, ivy, byPlayer);
  }

  function destroyAsteroid(a, ivx, ivy, byPlayer) {
    removeFrom(asteroids, a);
    explosion(a.x, a.y, a.size, a.style.spark);
    Sfx.explode(a.size);
    addShake(a.size * 3.5);

    if (byPlayer) {
      const base = ASTEROID_SCORE[a.size] * (a.iron ? 2 : 1);
      addScore(base, a.x, a.y);
      const dropChance = a.iron ? 0.35 : 0.06 + 0.02 * a.size;
      if (Math.random() < dropChance) spawnPowerup(a.x, a.y);
    }

    // split, as in Asteroid.split(): two children angled 20-50 degrees apart at 1.2x speed
    if (a.size > 1) {
      const angle = rand(20, 50) * DEG;
      const kick = 0.04;
      for (const sign of [1, -1]) {
        const c = Math.cos(angle * sign);
        const s = Math.sin(angle * sign);
        let vx = (a.vx * c - a.vy * s) * 1.2 + ivx * kick;
        let vy = (a.vx * s + a.vy * c) * 1.2 + ivy * kick;
        const speed = Math.hypot(vx, vy);
        if (speed < 50) {
          const k = 50 / (speed || 1);
          vx = speed ? vx * k : rand(-50, 50);
          vy = speed ? vy * k : rand(-50, 50);
        }
        spawnAsteroid(a.size - 1, a.x, a.y, vx, vy, { iron: a.iron, style: a.iron ? null : a.style });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
  function addParticle(p) {
    if (particles.length >= MAX_PARTICLES) particles.shift();
    particles.push(p);
  }

  function sparks(x, y, n, colors, speed) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const v = rand(speed * 0.3, speed);
      const life = rand(0.25, 0.6);
      addParticle({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: rand(1, 2.2), color: pick(colors), drag: 0.08, kind: 'spark' });
    }
  }

  function explosion(x, y, size, colors) {
    sparks(x, y, 14 + size * 14, colors, 140 + size * 70);
    for (let i = 0; i < 6 + size * 5; i++) {
      const a = rand(0, TAU);
      const v = rand(10, 60 + size * 15);
      const life = rand(0.6, 1.3);
      addParticle({ x: x + rand(-8, 8) * size, y: y + rand(-8, 8) * size, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, size: rand(6, 12) * size * 0.6, color: colors[2], drag: 0.3, kind: 'smoke' });
    }
    for (let i = 0; i < 3 + size * 2; i++) {
      const a = rand(0, TAU);
      const v = rand(30, 120);
      debris.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: rand(0, TAU), spin: rand(-6, 6), len: rand(4, 9) * size, life: rand(0.6, 1.2), max: 1.2, color: colors[1] });
    }
    rings.push({ x, y, r: 4, maxR: 30 + size * 28, life: 0.45, max: 0.45, color: colors[1], width: 2 + size });
    // flash
    addParticle({ x, y, vx: 0, vy: 0, life: 0.12, max: 0.12, size: 20 + size * 18, color: '#ffffff', drag: 1, kind: 'flash' });
  }

  function addShake(v) {
    shake = Math.min(28, shake + v);
  }

  function floatText(x, y, str, color, size = 18) {
    texts.push({ x, y, str, color, size, life: 1.0, max: 1.0 });
  }

  function showBanner(title, sub) {
    banner = { title, sub, life: 2.6, max: 2.6 };
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------
  function multiplier() {
    return Math.min(5, 1 + Math.floor(chain / 4));
  }

  function addScore(base, x, y) {
    chain++;
    chainTimer = CHAIN_WINDOW;
    const mult = multiplier();
    const pts = base * mult;
    score += pts;
    floatText(x, y, mult > 1 ? `${pts}  x${mult}` : String(pts), mult > 1 ? '#ffd23f' : '#ffffff', mult > 1 ? 20 : 16);
    if (score >= nextLifeAt) {
      nextLifeAt += EXTRA_LIFE_EVERY;
      gainLife();
    }
    if (score > highScore) {
      highScore = score;
      newHigh = true;
    }
  }

  function gainLife() {
    lives++;
    Sfx.extraLife();
    if (ship) floatText(ship.x, ship.y - 40, '1UP', '#ff5c9a', 24);
  }

  // ---------------------------------------------------------------------------
  // Power-ups
  // ---------------------------------------------------------------------------
  const POWERUPS = {
    triple: { color: '#00e5ff', label: 'T', name: 'TRIPLE SHOT' },
    rapid: { color: '#ffd23f', label: 'R', name: 'RAPID FIRE' },
    shield: { color: '#4dff88', label: 'S', name: 'SHIELD' },
    life: { color: '#ff5c9a', label: '+', name: 'EXTRA SHIP' },
  };

  function spawnPowerup(x, y) {
    const type = Math.random() < 0.08 ? 'life' : pick(['triple', 'rapid', 'shield']);
    const a = rand(0, TAU);
    powerups.push({ x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, type, r: 14, life: POWERUP_LIFETIME, t: 0 });
  }

  function collectPowerup(p) {
    const def = POWERUPS[p.type];
    removeFrom(powerups, p);
    Sfx.power();
    rings.push({ x: p.x, y: p.y, r: 10, maxR: 70, life: 0.4, max: 0.4, color: def.color, width: 3 });
    floatText(p.x, p.y - 24, def.name, def.color, 18);
    if (p.type === 'triple') ship.triple = POWERUP_DURATION;
    else if (p.type === 'rapid') ship.rapid = POWERUP_DURATION;
    else if (p.type === 'shield') ship.shield = Math.min(3, ship.shield + 1);
    else if (p.type === 'life') gainLife();
  }

  // ---------------------------------------------------------------------------
  // Player ship
  // ---------------------------------------------------------------------------
  function newShip() {
    return {
      x: W / 2, y: H / 2, vx: 0, vy: 0, a: 0, r: PLAYER_RADIUS,
      cooldown: 0, invuln: RESPAWN_INVULN, hyperCooldown: 0,
      thrusting: false, triple: 0, rapid: 0, shield: 0,
    };
  }

  function forward(a) {
    return [Math.sin(a), -Math.cos(a)];
  }

  function updateShip(dt) {
    const s = ship;
    if (input.left()) s.a -= PLAYER_TURN_SPEED * dt;
    if (input.right()) s.a += PLAYER_TURN_SPEED * dt;

    const [fx_, fy_] = forward(s.a);
    s.thrusting = input.thrust();
    if (s.thrusting) {
      s.vx += fx_ * PLAYER_THRUST * dt;
      s.vy += fy_ * PLAYER_THRUST * dt;
      exhaust(s, fx_, fy_, 3);
    } else if (input.reverse()) {
      s.vx -= fx_ * PLAYER_REVERSE_THRUST * dt;
      s.vy -= fy_ * PLAYER_REVERSE_THRUST * dt;
      // small retro jets at the nose
      if (Math.random() < 0.6) {
        const life = rand(0.1, 0.25);
        addParticle({ x: s.x + fx_ * s.r, y: s.y + fy_ * s.r, vx: fx_ * 160 + rand(-40, 40), vy: fy_ * 160 + rand(-40, 40), life, max: life, size: 1.5, color: '#9ff6ff', drag: 0.1, kind: 'spark' });
      }
    }
    Sfx.thrust(s.thrusting);

    const keep = Math.pow(PLAYER_DRAG, dt);
    s.vx *= keep;
    s.vy *= keep;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp > PLAYER_MAX_SPEED) {
      s.vx *= PLAYER_MAX_SPEED / sp;
      s.vy *= PLAYER_MAX_SPEED / sp;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    wrap(s, s.r);

    s.cooldown -= dt;
    s.invuln = Math.max(0, s.invuln - dt);
    s.hyperCooldown = Math.max(0, s.hyperCooldown - dt);
    s.triple = Math.max(0, s.triple - dt);
    s.rapid = Math.max(0, s.rapid - dt);

    if (input.fire() && s.cooldown <= 0) shoot(s);
    if (input.hyper() && s.hyperCooldown <= 0) hyperspace(s);
  }

  function exhaust(s, fx_, fy_, n) {
    const bx = s.x - fx_ * s.r * 0.75;
    const by = s.y - fy_ * s.r * 0.75;
    for (let i = 0; i < n; i++) {
      const spread = rand(-0.35, 0.35);
      const c = Math.cos(spread);
      const sn = Math.sin(spread);
      const dx = -fx_ * c + fy_ * sn;
      const dy = -fy_ * c - fx_ * sn;
      const v = rand(160, 320);
      const life = rand(0.18, 0.4);
      addParticle({ x: bx, y: by, vx: s.vx * 0.5 + dx * v, vy: s.vy * 0.5 + dy * v, life, max: life, size: rand(1.5, 3.5), color: pick(['#fff3b0', '#ffb347', '#ff6a1a', '#ff3d6e']), drag: 0.05, kind: 'dot' });
    }
  }

  function shoot(s) {
    const [fx_, fy_] = forward(s.a);
    const spreads = s.triple > 0 ? [-0.16, 0, 0.16] : [0];
    for (const off of spreads) {
      const [dx, dy] = forward(s.a + off);
      bullets.push({
        x: s.x + fx_ * s.r, y: s.y + fy_ * s.r,
        vx: dx * SHOT_SPEED + s.vx * 0.5, vy: dy * SHOT_SPEED + s.vy * 0.5,
        r: SHOT_RADIUS, life: SHOT_LIFE,
        color: s.rapid > 0 ? '#ffd23f' : '#5ef2ff',
      });
    }
    s.cooldown = s.rapid > 0 ? PLAYER_RAPID_COOLDOWN : PLAYER_SHOOT_COOLDOWN;
    // tiny recoil and muzzle flash
    s.vx -= fx_ * 6;
    s.vy -= fy_ * 6;
    for (let i = 0; i < 4; i++) {
      const life = rand(0.05, 0.12);
      addParticle({ x: s.x + fx_ * s.r, y: s.y + fy_ * s.r, vx: fx_ * rand(80, 200) + rand(-50, 50), vy: fy_ * rand(80, 200) + rand(-50, 50), life, max: life, size: 1.5, color: '#e0fbff', drag: 0.1, kind: 'spark' });
    }
    Sfx.shoot();
  }

  function hyperspace(s) {
    sparks(s.x, s.y, 30, ['#5ef2ff', '#ffffff', '#c77dff'], 220);
    rings.push({ x: s.x, y: s.y, r: 40, maxR: 2, life: 0.3, max: 0.3, color: '#5ef2ff', width: 3 });
    let best = null;
    let bestD = -1;
    for (let i = 0; i < 25; i++) {
      const p = { x: rand(80, W - 80), y: rand(80, H - 80) };
      let d = Infinity;
      for (const a of asteroids) d = Math.min(d, Math.sqrt(dist2(p, a)) - a.r);
      if (d > bestD) { bestD = d; best = p; }
      if (d > 180) break;
    }
    s.x = best.x;
    s.y = best.y;
    s.vx *= 0.2;
    s.vy *= 0.2;
    s.invuln = Math.max(s.invuln, 0.6);
    s.hyperCooldown = HYPERSPACE_COOLDOWN;
    rings.push({ x: s.x, y: s.y, r: 2, maxR: 60, life: 0.35, max: 0.35, color: '#c77dff', width: 3 });
    sparks(s.x, s.y, 24, ['#5ef2ff', '#ffffff', '#c77dff'], 200);
    Sfx.hyper();
  }

  function shipHit() {
    const s = ship;
    if (s.invuln > 0) return false;
    if (s.shield > 0) {
      s.shield--;
      s.invuln = 1.0;
      rings.push({ x: s.x, y: s.y, r: s.r * 1.6, maxR: 110, life: 0.4, max: 0.4, color: '#4dff88', width: 4 });
      sparks(s.x, s.y, 24, ['#4dff88', '#c8ffd9', '#ffffff'], 260);
      Sfx.shieldHit();
      addShake(8);
      return true;
    }
    killShip();
    return true;
  }

  function killShip() {
    const s = ship;
    explosion(s.x, s.y, 3, ['#ffffff', '#5ef2ff', '#1aa7ff']);
    sparks(s.x, s.y, 60, ['#ffffff', '#5ef2ff', '#ffd23f', '#ff6a1a'], 420);
    // hull fragments
    const pts = shipOutline(s.r);
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      const c = Math.cos(s.a);
      const sn = Math.sin(s.a);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const wx = s.x + mx * c - my * sn;
      const wy = s.y + mx * sn + my * c;
      const a = Math.atan2(wy - s.y, wx - s.x) + rand(-0.4, 0.4);
      const v = rand(40, 140);
      debris.push({ x: wx, y: wy, vx: s.vx * 0.3 + Math.cos(a) * v, vy: s.vy * 0.3 + Math.sin(a) * v, rot: Math.atan2(y2 - y1, x2 - x1) + s.a, spin: rand(-5, 5), len: Math.hypot(x2 - x1, y2 - y1), life: 2.2, max: 2.2, color: '#5ef2ff' });
    }
    rings.push({ x: s.x, y: s.y, r: 10, maxR: 220, life: 0.8, max: 0.8, color: '#5ef2ff', width: 5 });
    addShake(24);
    fx.slowTime = 0.7;
    Sfx.thrust(false);
    Sfx.playerDie();
    ship = null;
    lives--;
    chain = 0;
    respawnTimer = 2.6;
  }

  // ---------------------------------------------------------------------------
  // UFO
  // ---------------------------------------------------------------------------
  function spawnUfo() {
    const small = (wave >= 4 && Math.random() < 0.5) || (wave >= 7 && Math.random() < 0.7);
    const fromLeft = Math.random() < 0.5;
    ufo = {
      x: fromLeft ? -40 : W + 40, y: rand(90, H - 90),
      vx: (fromLeft ? 1 : -1) * (small ? 160 : 110), vy: 0,
      r: small ? 15 : 24, small, hp: small ? 1 : 2,
      fireTimer: rand(0.6, 1.2), turnTimer: rand(1, 2), t: 0, flash: 0,
    };
    Sfx.ufo(true, small);
  }

  function updateUfo(dt) {
    const u = ufo;
    u.t += dt;
    u.flash = Math.max(0, u.flash - dt);
    u.turnTimer -= dt;
    if (u.turnTimer <= 0) {
      u.turnTimer = rand(0.8, 2);
      u.vy = pick([-1, 0, 1]) * rand(60, 120);
    }
    u.x += u.vx * dt;
    u.y += u.vy * dt;
    if (u.y < -u.r) u.y += H + u.r * 2;
    else if (u.y > H + u.r) u.y -= H + u.r * 2;

    if ((u.vx > 0 && u.x > W + 60) || (u.vx < 0 && u.x < -60)) {
      ufo = null;
      Sfx.ufo(false);
      return;
    }

    u.fireTimer -= dt;
    if (u.fireTimer <= 0 && ship) {
      u.fireTimer = u.small ? rand(0.7, 1.1) : rand(1.1, 1.8);
      let a;
      if (u.small) {
        const err = Math.max(0.03, 0.22 - wave * 0.02);
        a = Math.atan2(ship.y - u.y, ship.x - u.x) + rand(-err, err);
      } else {
        a = rand(0, TAU);
      }
      enemyBullets.push({ x: u.x, y: u.y, vx: Math.cos(a) * 360, vy: Math.sin(a) * 360, r: 4, life: 1.6 });
      Sfx.enemyShoot();
    }
  }

  function destroyUfo(byPlayer) {
    const u = ufo;
    explosion(u.x, u.y, 2.5, ['#ffffff', '#ff5caa', '#b4ff4d']);
    Sfx.explode(3);
    Sfx.ufo(false);
    addShake(12);
    if (byPlayer) {
      addScore(u.small ? 1000 : 200, u.x, u.y);
      if (Math.random() < 0.6) spawnPowerup(u.x, u.y);
    }
    ufo = null;
  }

  // ---------------------------------------------------------------------------
  // Waves & game flow
  // ---------------------------------------------------------------------------
  function startWave(n) {
    wave = n;
    const count = Math.min(3 + n, 12);
    const speedMul = 1 + 0.07 * (n - 1);
    const ironChance = n >= 3 ? Math.min(0.08 + 0.03 * n, 0.35) : 0;
    for (let i = 0; i < count; i++) {
      spawnEdgeAsteroid(ASTEROID_KINDS, speedMul, Math.random() < ironChance);
    }
    ufoTimer = n >= 2 ? rand(10, 22) : rand(25, 35);
    showBanner(`WAVE ${n}`, n === 1 ? 'GOOD LUCK, PILOT' : `${count} INCOMING`);
    Sfx.wave();
  }

  function resetWorld() {
    asteroids = [];
    bullets = [];
    enemyBullets = [];
    particles = [];
    debris = [];
    rings = [];
    texts = [];
    powerups = [];
    ufo = null;
    Sfx.ufo(false);
    Sfx.thrust(false);
  }

  function startGame() {
    resetWorld();
    score = 0;
    newHigh = false;
    lives = START_LIVES;
    nextLifeAt = EXTRA_LIFE_EVERY;
    chain = 0;
    chainTimer = 0;
    ship = newShip();
    waveTimer = 0;
    state = 'playing';
    startWave(1);
  }

  function setupTitle() {
    resetWorld();
    for (let i = 0; i < 7; i++) {
      const a = spawnAsteroid(randInt(1, 3), rand(0, W), rand(0, H), 0, 0);
      const ang = rand(0, TAU);
      const sp = rand(20, 60);
      a.vx = Math.cos(ang) * sp;
      a.vy = Math.sin(ang) * sp;
    }
  }

  function gameOver() {
    state = 'gameover';
    Sfx.ufo(false);
    if (score >= highScore) {
      highScore = score;
      saveHighScore(highScore);
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function updateWorld(dt) {
    for (const a of asteroids) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.spin * dt;
      a.flash = Math.max(0, a.flash - dt);
      wrap(a, a.r);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) { debris.splice(i, 1); continue; }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += d.spin * dt;
      d.vx *= Math.pow(0.6, dt);
      d.vy *= Math.pow(0.6, dt);
    }

    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt;
      if (r.life <= 0) rings.splice(i, 1);
    }

    for (let i = texts.length - 1; i >= 0; i--) {
      const t = texts[i];
      t.life -= dt;
      t.y -= 40 * dt;
      if (t.life <= 0) texts.splice(i, 1);
    }

    if (banner) {
      banner.life -= dt;
      if (banner.life <= 0) banner = null;
    }
  }

  function updateProjectiles(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.life -= dt;
      if (b.life <= 0) { list.splice(i, 1); continue; }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wrap(b, 0);
    }
  }

  function collisions() {
    // player bullets vs asteroids / UFO
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      let consumed = false;
      for (let j = asteroids.length - 1; j >= 0; j--) {
        const a = asteroids[j];
        if (overlaps(b, b.r, a, a.r * 0.92)) {
          damageAsteroid(a, b.x, b.y, b.vx, b.vy, true);
          consumed = true;
          break;
        }
      }
      if (!consumed && ufo && overlaps(b, b.r, ufo, ufo.r)) {
        consumed = true;
        ufo.hp--;
        ufo.flash = 0.1;
        sparks(b.x, b.y, 10, ['#ffffff', '#ff5caa'], 240);
        if (ufo.hp <= 0) destroyUfo(true);
        else Sfx.hit();
      }
      if (consumed) bullets.splice(i, 1);
    }

    // UFO vs asteroids
    if (ufo) {
      for (const a of asteroids) {
        if (overlaps(ufo, ufo.r, a, a.r * 0.85)) {
          destroyAsteroid(a, ufo.vx, ufo.vy, false);
          destroyUfo(false);
          break;
        }
      }
    }

    if (!ship) return;

    for (const a of asteroids) {
      if (overlaps(ship, ship.r * 0.7, a, a.r * 0.85)) {
        if (shipHit() && ship) destroyAsteroid(a, ship.vx, ship.vy, true);
        break;
      }
    }

    if (ship && ufo && overlaps(ship, ship.r * 0.7, ufo, ufo.r)) {
      if (shipHit()) destroyUfo(true);
    }

    if (ship) {
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (overlaps(ship, ship.r * 0.7, b, b.r)) {
          if (shipHit()) enemyBullets.splice(i, 1);
          if (!ship) break;
        }
      }
    }

    if (ship) {
      for (const p of powerups) {
        if (overlaps(ship, ship.r, p, p.r)) {
          collectPowerup(p);
          break;
        }
      }
    }
  }

  function updatePlaying(dt) {
    if (ship) updateShip(dt);
    updateWorld(dt);
    updateProjectiles(bullets, dt);
    updateProjectiles(enemyBullets, dt);

    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.life -= dt;
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      wrap(p, p.r);
      if (p.life <= 0) powerups.splice(i, 1);
    }

    if (ufo) updateUfo(dt);
    else if (wave >= 1) {
      ufoTimer -= dt;
      if (ufoTimer <= 0 && asteroids.length > 0) {
        spawnUfo();
        ufoTimer = rand(18, 30) - Math.min(wave, 10);
      }
    }

    collisions();

    chainTimer -= dt;
    if (chainTimer <= 0) chain = 0;

    if (!ship) {
      respawnTimer -= dt;
      if (respawnTimer <= 0) {
        if (lives > 0) ship = newShip();
        else gameOver();
      }
    }

    if (asteroids.length === 0 && !ufo) {
      waveTimer += dt;
      if (waveTimer > 1.8) {
        waveTimer = 0;
        startWave(wave + 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const FONT = 'Orbitron, "Segoe UI", system-ui, sans-serif';

  function text(str, x, y, size, color, align = 'center', glowColor = color, blur = 14, weight = 700) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    glow(glowColor, blur);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    noGlow();
  }

  function shipOutline(r) {
    return [
      [0, -r],
      [r * 0.72, r * 0.85],
      [r * 0.28, r * 0.55],
      [-r * 0.28, r * 0.55],
      [-r * 0.72, r * 0.85],
    ];
  }

  function drawShipShape(r, thrusting, alpha) {
    ctx.globalAlpha = alpha;
    if (thrusting) {
      const fl = r * rand(0.8, 1.5);
      ctx.globalCompositeOperation = 'lighter';
      const fg = ctx.createLinearGradient(0, r * 0.55, 0, r * 0.55 + fl);
      fg.addColorStop(0, 'rgba(255,250,200,0.95)');
      fg.addColorStop(0.35, 'rgba(255,160,60,0.8)');
      fg.addColorStop(1, 'rgba(255,40,90,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(-r * 0.26, r * 0.58);
      ctx.quadraticCurveTo(0, r * 0.55 + fl * 1.2, r * 0.26, r * 0.58);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    const pts = shipOutline(r);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    const body = ctx.createLinearGradient(0, -r, 0, r);
    body.addColorStop(0, '#16405a');
    body.addColorStop(1, '#050b16');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineJoin = 'round';
    glow('#00d9ff', 18);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#5ef2ff';
    ctx.stroke();
    noGlow();

    // wing accents
    ctx.strokeStyle = 'rgba(94,242,255,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(r * 0.45, r * 0.62);
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(-r * 0.45, r * 0.62);
    ctx.stroke();

    // cockpit
    const cg = ctx.createRadialGradient(0, -r * 0.3, 1, 0, -r * 0.2, r * 0.3);
    cg.addColorStop(0, '#e9feff');
    cg.addColorStop(1, 'rgba(94,242,255,0.15)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.18, r * 0.16, r * 0.28, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawShip(s) {
    const blink = s.invuln > 0 && s.shield === 0 ? (Math.sin(time * 30) > 0 ? 1 : 0.35) : 1;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    drawShipShape(s.r, s.thrusting, blink);
    ctx.restore();

    if (s.shield > 0 || s.invuln > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      const color = s.shield > 0 ? '77,255,136' : '94,242,255';
      const rr = s.r * 1.75;
      const g = ctx.createRadialGradient(s.x, s.y, rr * 0.5, s.x, s.y, rr);
      g.addColorStop(0, `rgba(${color},0)`);
      g.addColorStop(0.85, `rgba(${color},${0.08 + pulse * 0.08})`);
      g.addColorStop(1, `rgba(${color},${0.25 + pulse * 0.15})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s.x, s.y, rr, 0, TAU);
      ctx.fill();
      if (s.shield > 0) {
        glow(`rgb(${color})`, 14);
        ctx.strokeStyle = `rgba(${color},${0.6 + pulse * 0.3})`;
        ctx.lineWidth = 1.5;
        for (let i = 0; i < s.shield; i++) {
          ctx.beginPath();
          ctx.arc(s.x, s.y, rr + i * 5, time * (1.5 + i) , time * (1.5 + i) + Math.PI * 1.4);
          ctx.stroke();
        }
        noGlow();
      }
    }
  }

  function drawAsteroids() {
    for (const a of asteroids) {
      const sp = a.sprite;
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);
      ctx.drawImage(sp.canvas, -sp.size / 2, -sp.size / 2, sp.size, sp.size);
      if (a.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a.flash / 0.12;
        ctx.drawImage(sp.canvas, -sp.size / 2, -sp.size / 2, sp.size, sp.size);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
    }
  }

  function drawBullets() {
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const b of bullets) {
      const tx = b.x - b.vx * 0.03;
      const ty = b.y - b.vy * 0.03;
      ctx.globalAlpha = Math.min(1, b.life * 4);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 6;
      ctx.globalAlpha *= 0.35;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.globalAlpha = Math.min(1, b.life * 4);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const b of enemyBullets) {
      ctx.globalAlpha = Math.min(1, b.life * 4);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 10);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.3, '#ff5caa');
      g.addColorStop(1, 'rgba(255,40,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 10, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawUfo(u) {
    const r = u.r;
    ctx.save();
    ctx.translate(u.x, u.y + Math.sin(u.t * 3) * 2);
    // dome
    const dg = ctx.createRadialGradient(0, -r * 0.5, 1, 0, -r * 0.3, r * 0.6);
    dg.addColorStop(0, '#f2fff0');
    dg.addColorStop(1, 'rgba(180,255,77,0.2)');
    ctx.fillStyle = dg;
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.25, r * 0.45, r * 0.42, 0, Math.PI, 0);
    ctx.fill();
    // hull
    const hg = ctx.createLinearGradient(0, -r * 0.3, 0, r * 0.4);
    hg.addColorStop(0, '#3a1440');
    hg.addColorStop(1, '#0d0412');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.34, 0, 0, TAU);
    ctx.fill();
    glow('#ff2d95', 18);
    ctx.strokeStyle = u.flash > 0 ? '#ffffff' : '#ff5caa';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.25, r * 0.45, r * 0.42, 0, Math.PI, 0);
    ctx.strokeStyle = '#b4ff4d';
    ctx.stroke();
    noGlow();
    // running lights
    for (let i = 0; i < 6; i++) {
      const ang = u.t * 4 + (i / 6) * TAU;
      const lx = Math.cos(ang) * r * 0.75;
      if (Math.sin(ang) < 0) continue;
      ctx.fillStyle = i % 2 ? '#b4ff4d' : '#ffe066';
      ctx.beginPath();
      ctx.arc(lx, r * 0.08, 2.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPowerups() {
    for (const p of powerups) {
      if (p.life < 3 && Math.sin(p.life * 20) < 0) continue;
      const def = POWERUPS[p.type];
      const pulse = 1 + Math.sin(p.t * 5) * 0.08;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(pulse, pulse);
      ctx.rotate(p.t * 1.2);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const x = Math.cos(a) * p.r;
        const y = Math.sin(a) * p.r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(5,10,20,0.75)';
      ctx.fill();
      glow(def.color, 18);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      noGlow();
      ctx.rotate(-p.t * 1.2);
      text(def.label, 0, 1, 14, '#ffffff', 'center', def.color, 10, 900);
      ctx.restore();
    }
  }

  function drawEffects() {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      const t = p.life / p.max;
      if (p.kind === 'spark') {
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035);
        ctx.stroke();
      } else if (p.kind === 'dot') {
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, TAU);
        ctx.fill();
      } else if (p.kind === 'smoke') {
        ctx.globalAlpha = t * 0.18;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - t * 0.6), 0, TAU);
        ctx.fill();
      } else if (p.kind === 'flash') {
        ctx.globalAlpha = t * 0.8;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    }

    ctx.lineCap = 'round';
    for (const d of debris) {
      ctx.globalAlpha = Math.min(1, d.life / d.max * 1.5);
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 2;
      const dx = Math.cos(d.rot) * d.len / 2;
      const dy = Math.sin(d.rot) * d.len / 2;
      ctx.beginPath();
      ctx.moveTo(d.x - dx, d.y - dy);
      ctx.lineTo(d.x + dx, d.y + dy);
      ctx.stroke();
    }

    for (const r of rings) {
      const t = 1 - r.life / r.max;
      const ease = 1 - Math.pow(1 - t, 3);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r + (r.maxR - r.r) * ease, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const t of texts) {
      ctx.globalAlpha = Math.min(1, t.life / t.max * 2);
      text(t.str, t.x, t.y, t.size, t.color, 'center', t.color, 10);
    }
    ctx.globalAlpha = 1;
  }

  function drawLifeIcon(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.55, 0.55);
    drawShipShape(PLAYER_RADIUS, false, 1);
    ctx.restore();
  }

  function drawBar(x, y, w, frac, color, label) {
    ctx.font = `700 11px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(x, y + 10, w, 4);
    glow(color, 10);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + 10, w * clamp(frac, 0, 1), 4);
    noGlow();
  }

  function drawHud() {
    text('SCORE', 32, 28, 12, 'rgba(94,242,255,0.7)', 'left', '#000', 0, 500);
    text(String(score).padStart(6, '0'), 32, 56, 30, '#ffffff', 'left', '#5ef2ff', 16, 900);
    const mult = multiplier();
    if (mult > 1 && chainTimer > 0) {
      const pulse = 1 + Math.sin(time * 12) * 0.05;
      ctx.save();
      ctx.translate(36, 92);
      ctx.scale(pulse, pulse);
      text(`x${mult} CHAIN`, 0, 0, 16, '#ffd23f', 'left', '#ff9f1a', 14, 900);
      ctx.restore();
      ctx.fillStyle = 'rgba(255,210,63,0.6)';
      ctx.fillRect(36, 106, 110 * (chainTimer / CHAIN_WINDOW), 2);
    }

    text(`HI ${String(highScore).padStart(6, '0')}`, W / 2, 28, 14, newHigh ? '#ffd23f' : 'rgba(255,255,255,0.75)', 'center', newHigh ? '#ff9f1a' : '#000', newHigh ? 12 : 0, 700);
    text(`WAVE ${wave}`, W / 2, 50, 12, 'rgba(199,125,255,0.9)', 'center', '#9d4edd', 8, 700);

    for (let i = 0; i < Math.min(lives, 8); i++) drawLifeIcon(W - 36 - i * 28, 40);
    if (lives > 8) text(`+${lives - 8}`, W - 36 - 8 * 28, 40, 12, '#5ef2ff', 'center');

    if (ship) {
      let y = H - 80;
      if (ship.triple > 0) { drawBar(32, y, 140, ship.triple / POWERUP_DURATION, POWERUPS.triple.color, 'TRIPLE SHOT'); y -= 30; }
      if (ship.rapid > 0) { drawBar(32, y, 140, ship.rapid / POWERUP_DURATION, POWERUPS.rapid.color, 'RAPID FIRE'); y -= 30; }
      if (ship.shield > 0) { drawBar(32, y, 140, ship.shield / 3, POWERUPS.shield.color, `SHIELD x${ship.shield}`); }

      const ready = ship.hyperCooldown <= 0;
      drawBar(W - 172, H - 50, 140, 1 - ship.hyperCooldown / HYPERSPACE_COOLDOWN, ready ? '#c77dff' : 'rgba(199,125,255,0.5)', ready ? 'HYPERSPACE READY' : 'HYPERSPACE');
    }
  }

  function drawBanner() {
    if (!banner) return;
    const t = 1 - banner.life / banner.max;
    const alpha = t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1;
    const spread = 1 + (1 - Math.min(1, t * 5)) * 0.4;
    ctx.globalAlpha = alpha;
    ctx.save();
    ctx.translate(W / 2, H / 2 - 150);
    ctx.scale(spread, 1);
    text(banner.title, 0, 0, 56, '#ffffff', 'center', '#c77dff', 28, 900);
    ctx.restore();
    if (banner.sub) text(banner.sub, W / 2, H / 2 - 98, 16, 'rgba(94,242,255,0.9)', 'center', '#5ef2ff', 10, 500);
    ctx.globalAlpha = 1;
  }

  function drawTitle() {
    const bob = Math.sin(time * 1.5) * 6;
    const grad = ctx.createLinearGradient(W / 2 - 400, 0, W / 2 + 400, 0);
    grad.addColorStop(0, '#5ef2ff');
    grad.addColorStop(0.5, '#c77dff');
    grad.addColorStop(1, '#ff5caa');
    ctx.font = `900 84px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    glow('#9d4edd', 40);
    ctx.fillStyle = grad;
    ctx.fillText('CLAUDESTEROIDS', W / 2, 200 + bob);
    noGlow();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeText('CLAUDESTEROIDS', W / 2, 200 + bob);

    text('A NEON ASTEROIDS REMIX', W / 2, 262, 16, 'rgba(255,255,255,0.7)', 'center', '#5ef2ff', 8, 500);

    const lines = [
      ['W / ↑', 'THRUST'],
      ['A D / ← →', 'ROTATE'],
      ['S / ↓', 'REVERSE'],
      ['SPACE', 'FIRE'],
      ['SHIFT', 'HYPERSPACE'],
      ['P  /  M', 'PAUSE / MUTE'],
    ];
    lines.forEach(([k, v], i) => {
      const y = 340 + i * 30;
      text(k, W / 2 - 20, y, 15, '#5ef2ff', 'right', '#00d9ff', 8, 700);
      text(v, W / 2 + 20, y, 15, 'rgba(255,255,255,0.8)', 'left', '#000', 0, 500);
    });

    const blink = 0.55 + 0.45 * Math.sin(time * 4);
    ctx.globalAlpha = blink;
    text(document.body.classList.contains('touch') ? 'TAP TO START' : 'PRESS ENTER TO START', W / 2, 560, 22, '#ffd23f', 'center', '#ff9f1a', 18, 900);
    ctx.globalAlpha = 1;

    if (highScore > 0) text(`HIGH SCORE  ${highScore}`, W / 2, 610, 14, 'rgba(255,255,255,0.7)', 'center', '#000', 0, 500);

    // power-up legend
    const items = Object.values(POWERUPS);
    items.forEach((def, i) => {
      const x = W / 2 - 270 + i * 180;
      text(def.label, x, 670, 14, '#ffffff', 'center', def.color, 12, 900);
      ctx.strokeStyle = def.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, 670, 12, 0, TAU);
      ctx.stroke();
      text(def.name, x + 20, 670, 11, def.color, 'left', '#000', 0, 500);
    });
  }

  function drawOverlay(title, sub, sub2) {
    ctx.fillStyle = 'rgba(2,1,10,0.55)';
    ctx.fillRect(0, 0, W, H);
    text(title, W / 2, H / 2 - 40, 64, '#ffffff', 'center', '#ff5caa', 30, 900);
    if (sub) text(sub, W / 2, H / 2 + 20, 20, '#5ef2ff', 'center', '#00d9ff', 10, 700);
    if (sub2) {
      ctx.globalAlpha = 0.55 + 0.45 * Math.sin(time * 4);
      text(sub2, W / 2, H / 2 + 70, 18, '#ffd23f', 'center', '#ff9f1a', 14, 700);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    const k = viewScale * dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.drawImage(nebula, 0, 0);
    drawStars();

    ctx.save();
    if (shake > 0.2) ctx.translate(rand(-shake, shake), rand(-shake, shake));
    drawPowerups();
    drawAsteroids();
    drawBullets();
    if (ufo) drawUfo(ufo);
    if (ship && state !== 'title') drawShip(ship);
    drawEffects();
    ctx.restore();

    ctx.drawImage(vignette, 0, 0);

    if (state === 'title') {
      drawTitle();
    } else {
      drawHud();
      drawBanner();
      if (state === 'paused') drawOverlay('PAUSED', 'P / ESC TO RESUME', Sfx.muted ? 'SOUND OFF (M)' : 'SOUND ON (M)');
      if (state === 'gameover') {
        drawOverlay('GAME OVER', `SCORE ${score}  •  WAVE ${wave}`, newHigh ? 'NEW HIGH SCORE!  PRESS ENTER' : 'PRESS ENTER TO PLAY AGAIN');
      }
    }

    if (Sfx.muted && state === 'playing') text('MUTED', W / 2, H - 24, 11, 'rgba(255,255,255,0.4)', 'center', '#000', 0, 500);
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  let last = performance.now();
  let frameAvg = 1 / 60;
  let slowFrames = 0;

  function frame(now) {
    const raw = Math.min((now - last) / 1000, 0.05);
    last = now;
    time += raw;

    // adaptive quality: disable live glow if we can't hold ~40fps
    frameAvg = frameAvg * 0.95 + raw * 0.05;
    if (fx.glow && frameAvg > 1 / 40) {
      if (++slowFrames > 120) fx.glow = false;
    } else {
      slowFrames = 0;
    }

    if (hit('KeyM')) Sfx.toggleMute();
    if (hit('KeyG')) fx.glow = !fx.glow;

    let dt = raw;
    if (fx.slowTime > 0) {
      fx.slowTime -= raw;
      dt *= 0.35;
    }

    if (state === 'title') {
      updateWorld(dt);
      updateStars(dt, 30, 10);
      if (input.start()) startGame();
    } else if (state === 'playing') {
      if (input.pause()) {
        state = 'paused';
        Sfx.thrust(false);
        Sfx.ufo(false);
      } else {
        updatePlaying(dt);
        updateStars(dt, ship ? ship.vx : 0, ship ? ship.vy : 0);
      }
    } else if (state === 'paused') {
      if (input.pause() || input.start()) {
        state = 'playing';
        if (ufo) Sfx.ufo(true, ufo.small);
      }
    } else if (state === 'gameover') {
      updateWorld(dt);
      updateStars(dt, 20, 5);
      if (input.start()) startGame();
    }

    shake *= Math.pow(0.004, raw);

    render();
    pressed.clear();
    requestAnimationFrame(frame);
  }

  setupTitle();
  requestAnimationFrame(frame);
})();
