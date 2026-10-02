/* ==========================================================================
   Jimothy, the Raccoon — Game Engine
   --------------------------------------------------------------------------
   Pure vanilla JavaScript + HTML5 Canvas + Web Audio API.
   No frameworks, no external assets. Everything is drawn and synthesized.

   Sections:
     1. Config & utilities
     2. Audio engine (procedural SFX)
     3. Parallax background (procedurally generated tiles)
     4. Entities: Player, Obstacle, Collectible, Particles, FloatingText
     5. Spawner (difficulty & level generation)
     6. Game (state machine, loop, input, HUD, persistence)
   ========================================================================== */

(() => {
  'use strict';

  /* ========================================================================
     1. CONFIG & UTILITIES
     ====================================================================== */

  const CONFIG = Object.freeze({
    WIDTH: 960,                 // logical canvas width
    HEIGHT: 540,                // logical canvas height
    GROUND_Y: 450,              // y of the sidewalk surface (player's feet)
    PX_PER_METER: 20,           // 1 point per "meter"
    BASE_SPEED: 340,            // px / s at the start
    SPEED_GAIN: 440,            // asymptotic extra speed
    SPEED_RAMP_TIME: 70,        // seconds for ~63% of the ramp
    GRAVITY: 2400,
    JUMP_VELOCITY: -780,
    DOUBLE_JUMP_VELOCITY: -660,
    COYOTE_TIME: 0.09,
    JUMP_BUFFER: 0.12,
    ITEM_POINTS: 10,
    MAX_DT: 1 / 20,
    RESTART_COOLDOWN: 0.75,     // seconds after death before a tap restarts
    STORAGE_HIGH: 'jimothy.highScore',
    STORAGE_MUTE: 'jimothy.muted',
  });

  const STATE = Object.freeze({
    START: 'START',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    GAME_OVER: 'GAME_OVER',
  });

  const PALETTE = Object.freeze({
    // Jimothy's real coat: brownish grey, dark saddle, pale brows and muzzle
    furLight: '#a39d95',
    fur: '#857f78',
    furDark: '#5a554f',
    furDarker: '#38342f',
    mask: '#1d1b1a',
    eye: '#ece8e0',
    pupil: '#2a2622',
    belly: '#b3ada4',
    nose: '#141210',
    cyan: '#00f0ff',
    pink: '#ff2fa8',
    purple: '#9d4dff',
    yellow: '#ffe24d',
    green: '#3dffb0',
    orange: '#ff8c42',
    danger: '#ff4d6d',
  });

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /** Deterministic PRNG (mulberry32) so background tiles look the same each load. */
  function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Axis-aligned bounding box overlap test. */
  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  const storage = {
    get(key, fallback) {
      try {
        const v = window.localStorage.getItem(key);
        return v === null ? fallback : v;
      } catch (_) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, String(value));
      } catch (_) {
        /* private mode / quota — ignore */
      }
    },
  };

  /* ========================================================================
     2. AUDIO ENGINE — all sounds are synthesized with the Web Audio API
     ====================================================================== */

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.muted = storage.get(CONFIG.STORAGE_MUTE, '0') === '1';
    }

    /** Must be called from a user gesture (browser autoplay policy). */
    unlock() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!this.ctx) {
        try {
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.5;
          this.master.connect(this.ctx.destination);
        } catch (_) {
          this.ctx = null;
          return;
        }
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    setMuted(muted) {
      this.muted = muted;
      storage.set(CONFIG.STORAGE_MUTE, muted ? '1' : '0');
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
      }
    }

    get ready() {
      return !!this.ctx && !this.muted;
    }

    /**
     * Play a single oscillator tone with an ADSR-ish envelope.
     * @param {object} o  { freq, type, dur, gain, slide, delay, attack }
     */
    tone({ freq, type = 'square', dur = 0.1, gain = 0.3, slide = null, delay = 0, attack = 0.005 }) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slide !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    /** Short burst of filtered noise (thuds, dust, crashes). */
    noise({ dur = 0.15, gain = 0.25, delay = 0, cutoff = 800 }) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + delay;
      const frames = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(g).connect(this.master);
      src.start(t0);
      src.stop(t0 + dur);
    }

    jump() {
      this.tone({ freq: 320, slide: 720, type: 'square', dur: 0.14, gain: 0.22 });
    }

    doubleJump() {
      this.tone({ freq: 520, slide: 1040, type: 'square', dur: 0.12, gain: 0.2 });
      this.tone({ freq: 780, slide: 1400, type: 'triangle', dur: 0.14, gain: 0.16, delay: 0.06 });
    }

    land() {
      this.noise({ dur: 0.08, gain: 0.12, cutoff: 500 });
    }

    collect() {
      // Classic two-note coin chime
      this.tone({ freq: 987.77, type: 'square', dur: 0.09, gain: 0.18 });
      this.tone({ freq: 1318.51, type: 'square', dur: 0.26, gain: 0.18, delay: 0.08 });
      this.tone({ freq: 2637, type: 'sine', dur: 0.2, gain: 0.06, delay: 0.08 });
    }

    gameOver() {
      this.noise({ dur: 0.3, gain: 0.35, cutoff: 300 });
      const notes = [392, 349.23, 311.13, 261.63];
      notes.forEach((f, i) => {
        this.tone({ freq: f, type: 'square', dur: 0.22, gain: 0.2, delay: 0.15 + i * 0.2 });
        this.tone({ freq: f / 2, type: 'triangle', dur: 0.22, gain: 0.14, delay: 0.15 + i * 0.2 });
      });
      // Final sad slide
      this.tone({ freq: 220, slide: 110, type: 'sawtooth', dur: 0.9, gain: 0.16, delay: 0.95 });
    }

    highScore() {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((f, i) => {
        this.tone({ freq: f, type: 'square', dur: 0.16, gain: 0.14, delay: 1.6 + i * 0.09 });
      });
      this.tone({ freq: 1568, type: 'triangle', dur: 0.5, gain: 0.12, delay: 2.05 });
    }

    start() {
      this.tone({ freq: 440, type: 'square', dur: 0.08, gain: 0.15 });
      this.tone({ freq: 660, type: 'square', dur: 0.08, gain: 0.15, delay: 0.08 });
      this.tone({ freq: 880, type: 'square', dur: 0.18, gain: 0.15, delay: 0.16 });
    }
  }

  /* ========================================================================
     3. PARALLAX BACKGROUND — generated once into offscreen canvases
     ====================================================================== */

  class Background {
    constructor() {
      const { WIDTH: W, HEIGHT: H } = CONFIG;
      this.W = W;
      this.H = H;
      this.tileW = 1920;
      this.buildLayers();
      // The neon signs use the pixel font; rebuild the tiles once it has loaded.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this.buildLayers()).catch(() => {});
      }

      // Seattle drizzle
      this.rain = [];
      for (let i = 0; i < 70; i++) {
        this.rain.push({
          x: Math.random() * W,
          y: Math.random() * H,
          len: 10 + Math.random() * 14,
          speed: 520 + Math.random() * 260,
          depth: 0.4 + Math.random() * 0.6,
        });
      }

      this.stars = [];
      const rng = seededRandom(99);
      for (let i = 0; i < 90; i++) {
        this.stars.push({
          x: rng() * W,
          y: rng() * (H * 0.55),
          r: 0.6 + rng() * 1.4,
          phase: rng() * Math.PI * 2,
          speed: 0.6 + rng() * 2,
        });
      }
    }

    buildLayers() {
      this.layers = [
        { factor: 0.12, canvas: this.buildSkyline(seededRandom(1337)) },
        { factor: 0.35, canvas: this.buildHouses(seededRandom(4242)) },
      ];
    }

    makeTile() {
      const c = document.createElement('canvas');
      c.width = this.tileW;
      c.height = this.H;
      return c;
    }

    /** The Space Needle: Jimothy's skyline is unmistakably Seattle. */
    drawSpaceNeedle(ctx, x, baseY) {
      const h = 290;
      const top = baseY - h;
      ctx.fillStyle = '#1f1b44';
      // Three legs sweeping out to the base
      ctx.beginPath();
      ctx.moveTo(x - 34, baseY);
      ctx.lineTo(x - 7, top + 70);
      ctx.lineTo(x + 7, top + 70);
      ctx.lineTo(x + 34, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#2a2558';
      ctx.fillRect(x - 3, top + 70, 6, h - 70);
      // Halo ring under the saucer
      ctx.strokeStyle = '#2a2558';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, top + 72, 30, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Saucer
      ctx.fillStyle = '#2f2a60';
      ctx.beginPath();
      ctx.moveTo(x - 44, top + 56);
      ctx.lineTo(x + 44, top + 56);
      ctx.lineTo(x + 24, top + 72);
      ctx.lineTo(x - 24, top + 72);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, top + 50, 44, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      // Observation deck lights
      ctx.save();
      ctx.fillStyle = PALETTE.yellow;
      ctx.shadowColor = PALETTE.yellow;
      ctx.shadowBlur = 8;
      for (let i = -3; i <= 3; i++) ctx.fillRect(x + i * 11 - 2, top + 60, 4, 4);
      ctx.fillStyle = PALETTE.cyan;
      ctx.shadowColor = PALETTE.cyan;
      ctx.fillRect(x - 40, top + 50, 80, 1.5);
      ctx.restore();
      // Spire with aircraft light
      ctx.fillStyle = '#2a2558';
      ctx.fillRect(x - 1.5, top, 3, 44);
      ctx.save();
      ctx.fillStyle = PALETTE.danger;
      ctx.shadowColor = PALETTE.danger;
      ctx.shadowBlur = 10;
      ctx.fillRect(x - 2.5, top - 4, 5, 5);
      ctx.restore();
    }

    updateRain(dt, scroll) {
      const { W, H } = this;
      for (const d of this.rain) {
        d.y += d.speed * d.depth * dt;
        d.x -= (90 + scroll * 0.25) * d.depth * dt;
        if (d.y > H + 20) {
          d.y = -20 - Math.random() * 40;
          d.x = Math.random() * (W + 200);
        }
        if (d.x < -20) d.x += W + 200;
      }
    }

    drawRain(ctx) {
      ctx.save();
      ctx.lineCap = 'round';
      for (const d of this.rain) {
        ctx.globalAlpha = 0.1 + d.depth * 0.18;
        ctx.lineWidth = d.depth * 1.4;
        ctx.strokeStyle = '#bfe9ff';
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.18, d.y + d.len);
        ctx.stroke();
      }
      ctx.restore();
    }

    /** Distant skyline: tall dark towers with glowing window grids. */
    buildSkyline(rng) {
      const c = this.makeTile();
      const ctx = c.getContext('2d');
      const { tileW: W, H } = this;
      const horizon = CONFIG.GROUND_Y - 40;
      const windowColors = ['#00f0ff', '#ff2fa8', '#ffe24d', '#9d4dff', '#3dffb0'];

      // Haze behind the buildings
      const haze = ctx.createLinearGradient(0, horizon - 220, 0, horizon);
      haze.addColorStop(0, 'rgba(157, 77, 255, 0)');
      haze.addColorStop(1, 'rgba(157, 77, 255, 0.22)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizon - 220, W, 220);

      let x = 0;
      while (x < W) {
        const bw = 40 + Math.floor(rng() * 70);
        const bh = 90 + Math.floor(rng() * 220);
        const top = horizon - bh;
        ctx.fillStyle = rng() > 0.5 ? '#171433' : '#1c1840';
        ctx.fillRect(x, top, bw, bh);

        // Rooftop detail
        if (rng() > 0.55) {
          ctx.fillStyle = '#120f2a';
          ctx.fillRect(x + bw * 0.3, top - 12, bw * 0.4, 12);
        }
        if (rng() > 0.6) {
          ctx.fillStyle = '#2a2550';
          ctx.fillRect(x + bw / 2 - 1, top - 34, 2, 34);
          ctx.fillStyle = '#ff4d6d';
          ctx.fillRect(x + bw / 2 - 2, top - 36, 4, 4);
        }

        // Windows
        const cols = Math.max(1, Math.floor((bw - 10) / 12));
        const rows = Math.max(1, Math.floor((bh - 12) / 14));
        const tint = windowColors[Math.floor(rng() * windowColors.length)];
        for (let r = 0; r < rows; r++) {
          for (let cc = 0; cc < cols; cc++) {
            if (rng() > 0.62) {
              ctx.fillStyle = rng() > 0.8 ? '#ffe24d' : tint;
              ctx.globalAlpha = 0.35 + rng() * 0.5;
              ctx.fillRect(x + 6 + cc * 12, top + 8 + r * 14, 6, 7);
            }
          }
        }
        ctx.globalAlpha = 1;

        // Occasional neon rooftop strip
        if (rng() > 0.7) {
          ctx.fillStyle = tint;
          ctx.shadowColor = tint;
          ctx.shadowBlur = 12;
          ctx.fillRect(x + 4, top + 2, bw - 8, 2);
          ctx.shadowBlur = 0;
        }

        x += bw + Math.floor(rng() * 14);
      }

      this.drawSpaceNeedle(ctx, 1240, horizon);

      // Ground fog line that hides the base of the skyline
      const fog = ctx.createLinearGradient(0, horizon - 50, 0, horizon + 10);
      fog.addColorStop(0, 'rgba(11, 10, 26, 0)');
      fog.addColorStop(1, 'rgba(11, 10, 26, 1)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, horizon - 50, W, 60);
      return c;
    }

    /** Mid layer: houses, fences, neon signs and streetlamps. */
    buildHouses(rng) {
      const c = this.makeTile();
      const ctx = c.getContext('2d');
      const { tileW: W } = this;
      const base = CONFIG.GROUND_Y + 4;
      this.ballardSignDrawn = false;

      let x = 20;
      while (x < W - 60) {
        const kind = rng();
        if (kind < 0.45) {
          // House
          const hw = 120 + Math.floor(rng() * 70);
          const hh = 80 + Math.floor(rng() * 50);
          const top = base - hh;
          const wall = rng() > 0.5 ? '#2b2650' : '#262146';
          ctx.fillStyle = wall;
          ctx.fillRect(x, top, hw, hh);
          // Roof
          ctx.fillStyle = '#1b1838';
          ctx.beginPath();
          ctx.moveTo(x - 10, top);
          ctx.lineTo(x + hw / 2, top - 40);
          ctx.lineTo(x + hw + 10, top);
          ctx.closePath();
          ctx.fill();
          // Door
          ctx.fillStyle = '#15132c';
          ctx.fillRect(x + hw / 2 - 11, base - 36, 22, 36);
          // Windows
          const wc = rng() > 0.5 ? '#ffe24d' : '#00f0ff';
          ctx.fillStyle = wc;
          ctx.shadowColor = wc;
          ctx.shadowBlur = 10;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(x + 16, top + 22, 20, 18);
          ctx.fillRect(x + hw - 36, top + 22, 20, 18);
          ctx.globalAlpha = 1;
          ctx.shadowBlur = 0;
          ctx.fillStyle = wall;
          ctx.fillRect(x + 25, top + 22, 2, 18);
          ctx.fillRect(x + hw - 27, top + 22, 2, 18);
          ctx.fillRect(x + 16, top + 30, 20, 2);
          ctx.fillRect(x + hw - 36, top + 30, 20, 2);
          // Neon sign on some houses (the first house carries the neighborhood sign instead)
          if (!this.ballardSignDrawn) {
            this.ballardSignDrawn = true;
            ctx.save();
            ctx.font = '9px "Press Start 2P", monospace';
            ctx.textAlign = 'center';
            ctx.fillStyle = PALETTE.cyan;
            ctx.shadowColor = PALETTE.cyan;
            ctx.shadowBlur = 12;
            ctx.fillText('BALLARD', x + hw / 2, top + 16);
            ctx.restore();
          } else if (rng() > 0.55) {
            const sc = rng() > 0.5 ? PALETTE.pink : PALETTE.green;
            ctx.strokeStyle = sc;
            ctx.shadowColor = sc;
            ctx.shadowBlur = 14;
            ctx.lineWidth = 3;
            ctx.strokeRect(x + hw / 2 - 26, top + 6, 52, 14);
            ctx.shadowBlur = 0;
          }
          x += hw + 30 + Math.floor(rng() * 40);
        } else if (kind < 0.75) {
          // Fence section
          const fw = 90 + Math.floor(rng() * 120);
          ctx.fillStyle = '#2a2548';
          for (let px = x; px < x + fw; px += 14) {
            ctx.fillRect(px, base - 42, 9, 42);
          }
          ctx.fillStyle = '#332d58';
          ctx.fillRect(x, base - 36, fw, 5);
          ctx.fillRect(x, base - 18, fw, 5);
          x += fw + 20 + Math.floor(rng() * 30);
        } else {
          // Streetlamp
          ctx.fillStyle = '#3a3560';
          ctx.fillRect(x + 4, base - 150, 6, 150);
          ctx.fillRect(x - 4, base - 150, 22, 6);
          ctx.fillStyle = '#ffe24d';
          ctx.shadowColor = '#ffe24d';
          ctx.shadowBlur = 18;
          ctx.fillRect(x + 14, base - 148, 12, 8);
          ctx.shadowBlur = 0;
          // Light cone
          const cone = ctx.createLinearGradient(0, base - 140, 0, base);
          cone.addColorStop(0, 'rgba(255, 226, 77, 0.18)');
          cone.addColorStop(1, 'rgba(255, 226, 77, 0)');
          ctx.fillStyle = cone;
          ctx.beginPath();
          ctx.moveTo(x + 20, base - 140);
          ctx.lineTo(x - 50, base);
          ctx.lineTo(x + 90, base);
          ctx.closePath();
          ctx.fill();
          x += 70 + Math.floor(rng() * 60);
        }
      }
      return c;
    }

    drawSky(ctx, time) {
      const { W, H } = this;
      const sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, '#05041a');
      sky.addColorStop(0.45, '#15103a');
      sky.addColorStop(0.8, '#2a1650');
      sky.addColorStop(1, '#1c1240');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // Stars (twinkle)
      for (const s of this.stars) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#e8e6ff';
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;

      // Moon
      ctx.save();
      ctx.shadowColor = '#ffe24d';
      ctx.shadowBlur = 40;
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.arc(W - 150, 90, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#ecd98a';
      ctx.beginPath();
      ctx.arc(W - 160, 82, 6, 0, Math.PI * 2);
      ctx.arc(W - 138, 100, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    drawLayers(ctx, distance) {
      for (const layer of this.layers) {
        const off = (distance * layer.factor) % this.tileW;
        ctx.drawImage(layer.canvas, -off, 0);
        ctx.drawImage(layer.canvas, -off + this.tileW, 0);
      }
    }

    drawGround(ctx, distance) {
      const { W, H } = this;
      const gy = CONFIG.GROUND_Y;

      // Sidewalk
      ctx.fillStyle = '#2f2a55';
      ctx.fillRect(0, gy, W, 44);
      ctx.fillStyle = '#3a3466';
      ctx.fillRect(0, gy, W, 5);
      // Slab seams
      const seam = 96;
      let off = distance % seam;
      ctx.fillStyle = '#23203f';
      for (let x = -off; x < W; x += seam) {
        ctx.fillRect(x, gy + 5, 3, 39);
      }
      // Cracks (deterministic by slab index)
      for (let x = -off, i = Math.floor(distance / seam); x < W; x += seam, i++) {
        if ((i * 7919) % 5 === 0) {
          ctx.strokeStyle = '#201c3a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 20, gy + 12);
          ctx.lineTo(x + 38, gy + 24);
          ctx.lineTo(x + 32, gy + 38);
          ctx.stroke();
        }
      }

      // Curb
      ctx.fillStyle = '#4b4480';
      ctx.fillRect(0, gy + 44, W, 6);
      ctx.fillStyle = '#ffe24d';
      ctx.globalAlpha = 0.5;
      const dashOff = distance % 48;
      for (let x = -dashOff; x < W; x += 48) ctx.fillRect(x, gy + 45, 24, 2);
      ctx.globalAlpha = 1;

      // Road
      ctx.fillStyle = '#14122a';
      ctx.fillRect(0, gy + 50, W, H - gy - 50);
      ctx.fillStyle = '#2b2655';
      const laneOff = (distance * 1.3) % 120;
      for (let x = -laneOff; x < W; x += 120) ctx.fillRect(x, gy + 72, 60, 4);

      // Neon reflection on the wet road
      const refl = ctx.createLinearGradient(0, gy + 50, 0, H);
      refl.addColorStop(0, 'rgba(0, 240, 255, 0.08)');
      refl.addColorStop(1, 'rgba(255, 47, 168, 0.06)');
      ctx.fillStyle = refl;
      ctx.fillRect(0, gy + 50, W, H - gy - 50);
    }
  }

  /* ========================================================================
     4. ENTITIES
     ====================================================================== */

  class Player {
    constructor() {
      this.x = 150;
      this.w = 64;
      this.h = 54;
      this.reset();
    }

    reset() {
      this.y = CONFIG.GROUND_Y - this.h;
      this.vy = 0;
      this.onGround = true;
      this.jumpsLeft = 2;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.runPhase = 0;
      this.flipAngle = 0;
      this.flipping = false;
      this.squash = 1;
      this.dead = false;
      this.deadRot = 0;
      this.vx = 0;
    }

    /** Tight, forgiving hitbox: covers the round body, not the fur tufts or legs' reach. */
    get hitbox() {
      return { x: this.x + 12, y: this.y + 8, w: this.w - 26, h: this.h - 10 };
    }

    requestJump() {
      this.jumpBuffer = CONFIG.JUMP_BUFFER;
    }

    tryJump(audio, particles) {
      if (this.dead) return false;
      const canGroundJump = this.onGround || this.coyote > 0;
      if (canGroundJump && this.jumpsLeft >= 2) {
        this.vy = CONFIG.JUMP_VELOCITY;
        this.onGround = false;
        this.coyote = 0;
        this.jumpsLeft = 1;
        this.squash = 1.25;
        audio.jump();
        particles.dust(this.x + this.w / 2, CONFIG.GROUND_Y, 6);
        return true;
      }
      if (!this.onGround && this.jumpsLeft === 1) {
        this.vy = CONFIG.DOUBLE_JUMP_VELOCITY;
        this.jumpsLeft = 0;
        this.flipping = true;
        this.flipAngle = 0;
        audio.doubleJump();
        particles.burst(this.x + this.w / 2, this.y + this.h / 2, 8, [PALETTE.cyan, '#ffffff'], 140, 0.4);
        return true;
      }
      return false;
    }

    update(dt, speed, audio, particles) {
      if (this.dead) {
        this.vy += CONFIG.GRAVITY * dt;
        this.y += this.vy * dt;
        this.x += this.vx * dt;
        this.deadRot += dt * 9;
        return;
      }

      // Jimothy scurries: a quick, bouncy cycle rather than a long stride.
      this.runPhase += dt * (15 + speed / 45);
      if (this.coyote > 0) this.coyote -= dt;
      if (this.jumpBuffer > 0) {
        this.jumpBuffer -= dt;
        if (this.tryJump(audio, particles)) this.jumpBuffer = 0;
      }

      if (!this.onGround) {
        this.vy += CONFIG.GRAVITY * dt;
        this.y += this.vy * dt;
        if (this.flipping) {
          this.flipAngle += dt * 14;
          if (this.flipAngle >= Math.PI * 2) {
            this.flipAngle = 0;
            this.flipping = false;
          }
        }
        const floor = CONFIG.GROUND_Y - this.h;
        if (this.y >= floor) {
          this.y = floor;
          this.vy = 0;
          this.onGround = true;
          this.jumpsLeft = 2;
          this.flipping = false;
          this.flipAngle = 0;
          this.squash = 0.72;
          audio.land();
          particles.dust(this.x + this.w / 2, CONFIG.GROUND_Y, 8);
        }
      }

      // Squash & stretch eases back to neutral
      this.squash = lerp(this.squash, 1, Math.min(1, dt * 14));
    }

    die(speed) {
      this.dead = true;
      this.vy = -520;
      this.vx = -speed * 0.35;
      this.onGround = false;
    }

    /**
     * Jimothy, as he really is: a round, neckless "loaf" with a hunched back,
     * disproportionately long legs and a short ringed tail. He scurries and
     * hops rather than running, so the ground cycle is a quick bounce.
     */
    draw(ctx, time) {
      const cx = this.x + this.w / 2;
      const feet = this.y + this.h;
      const airborne = !this.onGround;
      const hop = airborne || this.dead ? 0 : Math.abs(Math.sin(this.runPhase)) * 6;
      const lean = airborne ? clamp(this.vy / 2600, -0.3, 0.35) : -0.06 + Math.sin(this.runPhase * 2) * 0.03;

      ctx.save();
      ctx.translate(cx, feet - hop);
      if (this.dead) {
        ctx.rotate(this.deadRot);
      } else if (this.flipping) {
        ctx.rotate(this.flipAngle);
      } else {
        ctx.rotate(lean);
      }
      ctx.scale(2 - this.squash, this.squash);

      // --- Short ringed tail (short spine = short tail) ---
      const tailWag = this.dead ? 0.4 : airborne ? -0.7 : -0.15 + Math.sin(this.runPhase) * 0.2;
      ctx.save();
      ctx.translate(-24, -26);
      ctx.rotate(tailWag);
      const rings = [PALETTE.furDark, PALETTE.furDarker, PALETTE.furDark, PALETTE.furDarker];
      for (let i = 0; i < rings.length; i++) {
        ctx.fillStyle = rings[i];
        ctx.beginPath();
        ctx.ellipse(-i * 6, -i * 2.5, 8.5 - i * 1.2, 6.5 - i * 0.8, -0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // --- Long, thin legs with little hands ---
      const legs = [
        { x: -15, back: true },
        { x: -7, back: true },
        { x: 11, back: false },
        { x: 19, back: false },
      ];
      for (let i = 0; i < legs.length; i++) {
        const leg = legs[i];
        let swing;
        if (this.dead) swing = 0.35 * ((i % 2) * 2 - 1);
        else if (airborne) swing = leg.back ? 0.7 : -0.6;
        else swing = Math.sin(this.runPhase + (i % 2) * Math.PI) * 0.95;
        ctx.save();
        ctx.translate(leg.x, -20);
        ctx.rotate(swing);
        ctx.fillStyle = PALETTE.furDark;
        roundRect(ctx, -2.5, 0, 5, 21, 2.5);
        ctx.fill();
        // Hand / foot with tiny toes
        ctx.fillStyle = PALETTE.furDarker;
        roundRect(ctx, -4, 17, 10, 4, 2);
        ctx.fill();
        ctx.fillRect(-3, 20, 1.5, 2);
        ctx.fillRect(0, 20, 1.5, 2);
        ctx.fillRect(3, 20, 1.5, 2);
        ctx.restore();
      }

      // --- Round body with a hunch toward the back ---
      ctx.fillStyle = PALETTE.fur;
      ctx.beginPath();
      ctx.ellipse(0, -34, 27, 22, -0.18, 0, Math.PI * 2);
      ctx.fill();
      // Shaggy back tufts along the top arc
      ctx.fillStyle = PALETTE.furDark;
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + 0.35 + (i / 8) * (Math.PI - 0.9);
        const bx = Math.cos(a) * 27;
        const by = -34 + Math.sin(a) * 22;
        const flick = Math.sin(this.runPhase * 2 + i) * 1.2;
        ctx.beginPath();
        ctx.moveTo(bx - 4, by + 3);
        ctx.lineTo(bx + flick, by - 5);
        ctx.lineTo(bx + 4, by + 3);
        ctx.closePath();
        ctx.fill();
      }
      // Dark saddle on the hunched back
      ctx.beginPath();
      ctx.ellipse(-6, -47, 17, 7, -0.25, 0, Math.PI * 2);
      ctx.fill();
      // Light belly
      ctx.fillStyle = PALETTE.belly;
      ctx.beginPath();
      ctx.ellipse(4, -24, 16, 10, 0.1, 0, Math.PI * 2);
      ctx.fill();

      // --- Head sits directly on the body: no neck ---
      const hx = 21;
      const hy = -40;
      // Ears: small, round, white-rimmed
      const earBack = airborne ? 3 : 0;
      for (const ex of [hx - 9, hx + 7]) {
        ctx.fillStyle = PALETTE.furDark;
        ctx.beginPath();
        ctx.arc(ex - earBack * 0.5, hy - 12 + earBack, 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = PALETTE.eye;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(ex - earBack * 0.5, hy - 12 + earBack, 5.5, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
      }
      // Face
      ctx.fillStyle = PALETTE.fur;
      ctx.beginPath();
      ctx.ellipse(hx, hy, 15, 13.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // White brows and cheeks framing the mask
      ctx.fillStyle = PALETTE.eye;
      ctx.beginPath();
      ctx.ellipse(hx - 5, hy - 7, 6.5, 3.2, -0.1, 0, Math.PI * 2);
      ctx.ellipse(hx + 7, hy - 7, 6.5, 3.2, 0.1, 0, Math.PI * 2);
      ctx.ellipse(hx + 4, hy + 7, 11, 5.5, 0.1, 0, Math.PI * 2);
      ctx.fill();
      // Bandit mask: wide, sweeping down to the cheeks
      ctx.fillStyle = PALETTE.mask;
      ctx.beginPath();
      ctx.ellipse(hx - 6, hy - 1, 9.5, 6, -0.35, 0, Math.PI * 2);
      ctx.ellipse(hx + 8, hy - 1, 9, 6, 0.35, 0, Math.PI * 2);
      ctx.fill();
      // Grey stripe down the muzzle between the mask halves
      ctx.fillStyle = PALETTE.furLight;
      ctx.beginPath();
      ctx.ellipse(hx + 2, hy + 1, 2.2, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      const eyeR = airborne ? 3.6 : 3;
      const blink = !this.dead && Math.sin(time * 1.7) > 0.985;
      ctx.fillStyle = '#2a2622';
      ctx.beginPath();
      ctx.ellipse(hx - 5, hy - 1, eyeR, blink ? 0.6 : eyeR, 0, 0, Math.PI * 2);
      ctx.ellipse(hx + 8, hy - 1, eyeR, blink ? 0.6 : eyeR, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!blink) {
        if (this.dead) {
          ctx.strokeStyle = PALETTE.danger;
          ctx.lineWidth = 1.6;
          for (const ex of [hx - 5, hx + 8]) {
            ctx.beginPath();
            ctx.moveTo(ex - 2.5, hy - 3.5);
            ctx.lineTo(ex + 2.5, hy + 1.5);
            ctx.moveTo(ex + 2.5, hy - 3.5);
            ctx.lineTo(ex - 2.5, hy + 1.5);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(hx - 3.6, hy - 2.2, 1.1, 0, Math.PI * 2);
          ctx.arc(hx + 9.4, hy - 2.2, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Snout, nose and mouth
      ctx.fillStyle = PALETTE.nose;
      ctx.beginPath();
      ctx.ellipse(hx + 15, hy + 3, 3.4, 2.6, 0.2, 0, Math.PI * 2);
      ctx.fill();
      if (!this.dead) {
        ctx.strokeStyle = PALETTE.furDarker;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(hx + 12, hy + 8);
        ctx.quadraticCurveTo(hx + 15, hy + 11, hx + 18, hy + 8);
        ctx.stroke();
      }

      ctx.restore();
    }
  }

  /* --------------------------------------------------------------------- */

  const OBSTACLE_TYPES = Object.freeze({
    CAN: { w: 40, h: 50, speed: 0, inset: 5, minMeters: 0 },
    CANS: { w: 86, h: 50, speed: 0, inset: 5, minMeters: 60 },
    DUMPSTER: { w: 112, h: 58, speed: 0, inset: 6, minMeters: 150 },
    CAT: { w: 56, h: 36, speed: 110, inset: 7, minMeters: 100 },
    TRUCK: { w: 150, h: 74, speed: 150, inset: 8, minMeters: 260 },
  });

  class Obstacle {
    /**
     * @param {string} type   key in OBSTACLE_TYPES
     * @param {number} worldX world-space x (screen x = worldX - distance)
     */
    constructor(type, worldX) {
      const def = OBSTACLE_TYPES[type];
      this.type = type;
      this.def = def;
      this.worldX = worldX;
      this.w = def.w;
      this.h = def.h;
      this.y = CONFIG.GROUND_Y - def.h;
      this.ownSpeed = def.speed;
      this.phase = Math.random() * Math.PI * 2;
      this.variant = Math.random();
      this.dead = false;
    }

    screenX(distance) {
      return this.worldX - distance;
    }

    hitbox(distance) {
      const i = this.def.inset;
      return { x: this.screenX(distance) + i, y: this.y + i, w: this.w - i * 2, h: this.h - i };
    }

    update(dt, distance, frozen) {
      if (!frozen && this.ownSpeed) this.worldX -= this.ownSpeed * dt;
      this.phase += dt * 10;
      if (this.screenX(distance) + this.w < -60) this.dead = true;
    }

    draw(ctx, distance, time) {
      const x = this.screenX(distance);
      ctx.save();
      ctx.translate(x, this.y);
      switch (this.type) {
        case 'CAN':
          this.drawCan(ctx, 0, this.variant > 0.5);
          break;
        case 'CANS':
          this.drawCan(ctx, 0, false);
          this.drawCan(ctx, 46, true);
          break;
        case 'DUMPSTER':
          this.drawDumpster(ctx);
          break;
        case 'CAT':
          this.drawCat(ctx, time);
          break;
        case 'TRUCK':
          this.drawTruck(ctx, time);
          break;
        default:
          break;
      }
      ctx.restore();
    }

    drawCan(ctx, ox, lidAskew) {
      const w = 40;
      const h = 50;
      // Body
      const grad = ctx.createLinearGradient(ox, 0, ox + w, 0);
      grad.addColorStop(0, '#5b5f78');
      grad.addColorStop(0.5, '#8a8fa8');
      grad.addColorStop(1, '#4a4e66');
      ctx.fillStyle = grad;
      roundRect(ctx, ox + 2, 8, w - 4, h - 8, 4);
      ctx.fill();
      // Ridges
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < 3; i++) ctx.fillRect(ox + 4, 18 + i * 11, w - 8, 2);
      // Lid
      ctx.save();
      if (lidAskew) {
        ctx.translate(ox + w / 2, 8);
        ctx.rotate(-0.18);
        ctx.translate(-(ox + w / 2), -8);
      }
      ctx.fillStyle = '#9aa0bb';
      roundRect(ctx, ox - 1, 2, w + 2, 9, 3);
      ctx.fill();
      ctx.fillStyle = '#6e738e';
      roundRect(ctx, ox + w / 2 - 6, -3, 12, 6, 2);
      ctx.fill();
      ctx.restore();
      // Neon rim light
      ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
      ctx.fillRect(ox + 3, 10, 2, h - 12);
    }

    drawDumpster(ctx) {
      const w = this.w;
      const h = this.h;
      ctx.fillStyle = '#1e7a4c';
      roundRect(ctx, 0, 10, w, h - 10, 5);
      ctx.fill();
      ctx.fillStyle = '#16603a';
      ctx.fillRect(0, 10, w, 6);
      ctx.fillRect(10, 24, w - 20, 3);
      // Lid
      ctx.fillStyle = '#25945c';
      ctx.beginPath();
      ctx.moveTo(-3, 12);
      ctx.lineTo(8, 0);
      ctx.lineTo(w - 8, 0);
      ctx.lineTo(w + 3, 12);
      ctx.closePath();
      ctx.fill();
      // Wheels
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(14, h - 2, 5, 0, Math.PI * 2);
      ctx.arc(w - 14, h - 2, 5, 0, Math.PI * 2);
      ctx.fill();
      // Graffiti tag
      ctx.fillStyle = PALETTE.pink;
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('JIM', w / 2, 44);
      ctx.textAlign = 'left';
    }

    drawCat(ctx, time) {
      const run = this.phase * 1.4;
      const bob = Math.abs(Math.sin(run)) * 2;
      ctx.translate(0, -bob);
      ctx.fillStyle = '#15121f';
      // Tail (raised, aggressive)
      ctx.save();
      ctx.translate(50, 16);
      ctx.rotate(-0.9 + Math.sin(time * 6 + this.phase) * 0.15);
      roundRect(ctx, -3, -22, 6, 26, 3);
      ctx.fill();
      ctx.restore();
      // Legs
      for (let i = 0; i < 4; i++) {
        const lx = 12 + i * 9;
        const swing = Math.sin(run + (i % 2) * Math.PI) * 0.7;
        ctx.save();
        ctx.translate(lx, 24);
        ctx.rotate(swing);
        roundRect(ctx, -2.5, 0, 5, 12, 2);
        ctx.fill();
        ctx.restore();
      }
      // Arched body
      ctx.beginPath();
      ctx.ellipse(28, 20, 22, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(28, 14, 16, 7, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      // Head (facing left, toward Jimothy)
      ctx.beginPath();
      ctx.arc(10, 14, 10, 0, Math.PI * 2);
      ctx.fill();
      // Ears
      ctx.beginPath();
      ctx.moveTo(2, 8);
      ctx.lineTo(3, -2);
      ctx.lineTo(10, 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(11, 5);
      ctx.lineTo(17, -2);
      ctx.lineTo(18, 8);
      ctx.closePath();
      ctx.fill();
      // Glowing eyes
      ctx.save();
      ctx.shadowColor = PALETTE.yellow;
      ctx.shadowBlur = 8;
      ctx.fillStyle = PALETTE.yellow;
      ctx.beginPath();
      ctx.ellipse(6, 13, 2.4, 1.6, 0.3, 0, Math.PI * 2);
      ctx.ellipse(13, 13, 2.4, 1.6, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#000';
      ctx.fillRect(5.5, 12, 1, 2.5);
      ctx.fillRect(12.5, 12, 1, 2.5);
      // Whiskers / hiss
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(2, 18);
      ctx.lineTo(-6, 16);
      ctx.moveTo(2, 20);
      ctx.lineTo(-6, 22);
      ctx.stroke();
    }

    drawTruck(ctx, time) {
      const w = this.w;
      const h = this.h;
      const wheelSpin = -this.phase * 0.6;
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.ellipse(w / 2, h + 1, w / 2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Cargo box
      ctx.fillStyle = '#e9e9f2';
      roundRect(ctx, 46, 4, w - 46, h - 16, 4);
      ctx.fill();
      // Cab (front, facing left toward Jimothy)
      ctx.fillStyle = '#d4d4e2';
      roundRect(ctx, 0, 22, 52, h - 34, 6);
      ctx.fill();
      ctx.fillStyle = '#1b2a44';
      roundRect(ctx, 6, 26, 30, 18, 3);
      ctx.fill();
      // Stripe + text
      ctx.fillStyle = PALETTE.orange;
      ctx.fillRect(46, 40, w - 46, 6);
      ctx.fillStyle = '#1b2a44';
      ctx.font = '7px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('ANIMAL', 46 + (w - 46) / 2, 20);
      ctx.fillText('CONTROL', 46 + (w - 46) / 2, 32);
      ctx.textAlign = 'left';
      // Paw logo
      ctx.fillStyle = '#1b2a44';
      ctx.beginPath();
      ctx.arc(w - 18, 52, 3, 0, Math.PI * 2);
      ctx.fill();
      // Light bar (flashing)
      const flash = Math.floor(time * 6) % 2 === 0;
      ctx.save();
      ctx.shadowBlur = 14;
      ctx.fillStyle = flash ? PALETTE.danger : '#3a3a55';
      ctx.shadowColor = PALETTE.danger;
      roundRect(ctx, 10, 14, 14, 7, 2);
      ctx.fill();
      ctx.fillStyle = flash ? '#3a3a55' : '#4da3ff';
      ctx.shadowColor = '#4da3ff';
      roundRect(ctx, 26, 14, 14, 7, 2);
      ctx.fill();
      ctx.restore();
      // Headlight beam
      ctx.save();
      const beam = ctx.createLinearGradient(0, 0, -90, 0);
      beam.addColorStop(0, 'rgba(255, 240, 180, 0.35)');
      beam.addColorStop(1, 'rgba(255, 240, 180, 0)');
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(2, 44);
      ctx.lineTo(-90, 30);
      ctx.lineTo(-90, 70);
      ctx.lineTo(2, 54);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#fff3b0';
      ctx.fillRect(0, 44, 5, 10);
      // Wheels
      for (const wx of [26, w - 30]) {
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(wx, h - 4, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#777';
        ctx.beginPath();
        ctx.arc(wx, h - 4, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(wx + Math.cos(wheelSpin) * 5, h - 4 + Math.sin(wheelSpin) * 5);
        ctx.lineTo(wx - Math.cos(wheelSpin) * 5, h - 4 - Math.sin(wheelSpin) * 5);
        ctx.stroke();
      }
    }
  }

  /* --------------------------------------------------------------------- */

  const COLLECTIBLE_TYPES = ['PIZZA', 'DONUT', 'SHINY'];

  class Collectible {
    constructor(type, worldX, y) {
      this.type = type;
      this.worldX = worldX;
      this.baseY = y;
      this.w = 30;
      this.h = 30;
      this.phase = Math.random() * Math.PI * 2;
      this.dead = false;
    }

    screenX(distance) {
      return this.worldX - distance;
    }

    y(time) {
      return this.baseY + Math.sin(time * 4 + this.phase) * 4;
    }

    hitbox(distance, time) {
      return { x: this.screenX(distance) + 2, y: this.y(time) + 2, w: this.w - 4, h: this.h - 4 };
    }

    update(distance) {
      if (this.screenX(distance) + this.w < -40) this.dead = true;
    }

    draw(ctx, distance, time) {
      const x = this.screenX(distance) + this.w / 2;
      const y = this.y(time) + this.h / 2;
      ctx.save();
      ctx.translate(x, y);
      switch (this.type) {
        case 'PIZZA':
          this.drawPizza(ctx);
          break;
        case 'DONUT':
          this.drawDonut(ctx);
          break;
        default:
          this.drawShiny(ctx, time);
      }
      ctx.restore();
    }

    drawPizza(ctx) {
      ctx.save();
      ctx.rotate(-0.6);
      ctx.shadowColor = PALETTE.yellow;
      ctx.shadowBlur = 10;
      // Crust
      ctx.fillStyle = '#d9913d';
      ctx.beginPath();
      ctx.moveTo(0, 14);
      ctx.lineTo(-13, -10);
      ctx.quadraticCurveTo(0, -17, 13, -10);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      // Cheese
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.lineTo(-10, -8);
      ctx.quadraticCurveTo(0, -12, 10, -8);
      ctx.closePath();
      ctx.fill();
      // Pepperoni
      ctx.fillStyle = '#c0392b';
      ctx.beginPath();
      ctx.arc(-3, -5, 2.6, 0, Math.PI * 2);
      ctx.arc(4, -3, 2.6, 0, Math.PI * 2);
      ctx.arc(0, 3, 2.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    drawDonut(ctx) {
      ctx.save();
      ctx.shadowColor = PALETTE.pink;
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#e6a05a';
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Frosting (half eaten: a bite on the right)
      ctx.fillStyle = PALETTE.pink;
      ctx.beginPath();
      ctx.arc(0, -1, 12, 0, Math.PI * 2);
      ctx.fill();
      // Hole
      ctx.fillStyle = '#1c1240';
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();
      // Bite
      ctx.beginPath();
      ctx.arc(11, -6, 6, 0, Math.PI * 2);
      ctx.fill();
      // Sprinkles
      const sprinkles = ['#00f0ff', '#ffe24d', '#3dffb0', '#ffffff'];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.4;
        if (a > 5.2 && a < 6.2) continue; // skip bite area
        ctx.save();
        ctx.translate(Math.cos(a) * 8, Math.sin(a) * 8 - 1);
        ctx.rotate(a);
        ctx.fillStyle = sprinkles[i % sprinkles.length];
        ctx.fillRect(-2, -0.8, 4, 1.6);
        ctx.restore();
      }
      ctx.restore();
    }

    drawShiny(ctx, time) {
      ctx.save();
      ctx.rotate(Math.sin(time * 3 + this.phase) * 0.2);
      ctx.shadowColor = PALETTE.cyan;
      ctx.shadowBlur = 14;
      // Crumpled foil / shiny can
      ctx.fillStyle = '#c9d6ff';
      ctx.beginPath();
      ctx.moveTo(-9, -11);
      ctx.lineTo(10, -8);
      ctx.lineTo(12, 6);
      ctx.lineTo(2, 12);
      ctx.lineTo(-11, 7);
      ctx.lineTo(-7, -2);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8fb3ff';
      ctx.beginPath();
      ctx.moveTo(-7, -2);
      ctx.lineTo(10, -8);
      ctx.lineTo(2, 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(-3, -7);
      ctx.lineTo(1, -5);
      ctx.lineTo(-1, 0);
      ctx.closePath();
      ctx.fill();
      // Sparkle
      const s = 0.6 + 0.4 * Math.sin(time * 9 + this.phase);
      ctx.strokeStyle = `rgba(255,255,255,${s})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(12, -12);
      ctx.lineTo(12, -4);
      ctx.moveTo(8, -8);
      ctx.lineTo(16, -8);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* --------------------------------------------------------------------- */

  class ParticleSystem {
    constructor() {
      this.items = [];
      this.max = 400;
    }

    spawn(p) {
      if (this.items.length >= this.max) this.items.shift();
      this.items.push(p);
    }

    burst(x, y, count, colors, speed = 180, life = 0.6, gravity = 500) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.4 + Math.random() * 0.8);
        this.spawn({
          x, y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - 60,
          life, maxLife: life,
          size: 2 + Math.random() * 4,
          color: pick(colors),
          gravity,
          square: Math.random() > 0.5,
        });
      }
    }

    dust(x, y, count) {
      for (let i = 0; i < count; i++) {
        this.spawn({
          x: x + rand(-14, 14), y: y - 2,
          vx: rand(-90, -20), vy: rand(-70, -20),
          life: 0.4, maxLife: 0.4,
          size: 3 + Math.random() * 4,
          color: 'rgba(200, 190, 240, 0.5)',
          gravity: -40,
          square: false,
        });
      }
    }

    update(dt, scroll) {
      const arr = this.items;
      for (let i = arr.length - 1; i >= 0; i--) {
        const p = arr[i];
        p.life -= dt;
        if (p.life <= 0) {
          arr[i] = arr[arr.length - 1];
          arr.pop();
          continue;
        }
        p.vy += p.gravity * dt;
        p.x += (p.vx - scroll) * dt;
        p.y += p.vy * dt;
      }
    }

    draw(ctx) {
      for (const p of this.items) {
        const t = p.life / p.maxLife;
        ctx.globalAlpha = Math.min(1, t * 1.5);
        ctx.fillStyle = p.color;
        const s = p.size * (0.5 + t * 0.5);
        if (p.square) {
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, s / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    clear() {
      this.items.length = 0;
    }
  }

  class FloatingTexts {
    constructor() {
      this.items = [];
    }

    add(x, y, text, color) {
      this.items.push({ x, y, text, color, life: 0.8, maxLife: 0.8 });
    }

    update(dt, scroll) {
      for (let i = this.items.length - 1; i >= 0; i--) {
        const f = this.items[i];
        f.life -= dt;
        f.y -= 50 * dt;
        f.x -= scroll * 0.3 * dt;
        if (f.life <= 0) this.items.splice(i, 1);
      }
    }

    draw(ctx) {
      ctx.font = '12px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      for (const f of this.items) {
        ctx.globalAlpha = Math.min(1, f.life / f.maxLife * 2);
        ctx.fillStyle = f.color;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 8;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    clear() {
      this.items.length = 0;
    }
  }

  /* ========================================================================
     5. SPAWNER — difficulty curve & procedural level generation
     ====================================================================== */

  class Spawner {
    constructor(game) {
      this.game = game;
      this.reset();
    }

    reset() {
      // First obstacle shows up a comfortable distance ahead
      this.nextObstacleX = CONFIG.WIDTH + 500;
      this.lastWasMoving = false;
    }

    pickType(meters) {
      const pool = [];
      for (const [name, def] of Object.entries(OBSTACLE_TYPES)) {
        if (meters >= def.minMeters) {
          // Weight: cans common, trucks rarer
          const weight = name === 'TRUCK' ? 1.3 : name === 'CAT' ? 1.6 : name === 'DUMPSTER' ? 1.2 : 2;
          for (let i = 0; i < Math.round(weight * 10); i++) pool.push(name);
        }
      }
      return pick(pool);
    }

    update() {
      const g = this.game;
      const spawnEdge = g.distance + CONFIG.WIDTH + 200;
      while (this.nextObstacleX < spawnEdge) {
        const meters = g.distance / CONFIG.PX_PER_METER;
        const type = this.pickType(meters);
        const def = OBSTACLE_TYPES[type];
        const speed = g.speed;
        const obstacle = new Obstacle(type, this.nextObstacleX);
        g.obstacles.push(obstacle);

        // Gap in seconds of travel, shrinking a little as the player gets further
        const difficulty = clamp(meters / 1500, 0, 1);
        const minT = lerp(1.05, 0.85, difficulty);
        const maxT = lerp(2.0, 1.35, difficulty);
        let gap = speed * rand(minT, maxT) + def.w;

        // Moving obstacles close distance on their own: give them extra lead.
        if (def.speed > 0) {
          const approachTime = (CONFIG.WIDTH + 200) / (speed + def.speed);
          gap += def.speed * approachTime + 120;
        }

        this.spawnCollectibles(obstacle, gap, def);
        this.nextObstacleX += gap;
        this.lastWasMoving = def.speed > 0;
      }
    }

    spawnCollectibles(obstacle, gap, def) {
      const g = this.game;
      const roll = Math.random();
      const groundY = CONFIG.GROUND_Y;
      const type = pick(COLLECTIBLE_TYPES);

      // Arc over a static obstacle: rewards a clean jump
      if (def.speed === 0 && roll < 0.45) {
        const n = 5;
        const span = def.w + 150;
        const startX = obstacle.worldX + def.w / 2 - span / 2;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const x = startX + t * span;
          const y = groundY - def.h - 50 - Math.sin(t * Math.PI) * 70;
          g.collectibles.push(new Collectible(type, x - 15, y - 15));
        }
      }

      // Row or high line in the gap after the obstacle
      const freeStart = obstacle.worldX + def.w + 140;
      const freeEnd = obstacle.worldX + gap - 160;
      const free = freeEnd - freeStart;
      if (free > 160 && roll > 0.3) {
        const n = clamp(Math.floor(free / 46), 3, 6);
        const rowW = n * 46;
        const startX = freeStart + (free - rowW) / 2;
        const high = Math.random() < 0.3;
        const y = high ? groundY - 190 : groundY - 70 - Math.random() * 30;
        const rowType = pick(COLLECTIBLE_TYPES);
        for (let i = 0; i < n; i++) {
          g.collectibles.push(new Collectible(rowType, startX + i * 46, y));
        }
      }
    }
  }

  /* ========================================================================
     6. GAME — state machine, loop, input, HUD, persistence
     ====================================================================== */

  class Game {
    constructor() {
      this.canvas = document.getElementById('game');
      this.ctx = this.canvas.getContext('2d');
      this.stage = document.getElementById('stage');

      this.dom = {
        overlay: document.getElementById('overlay'),
        kicker: document.getElementById('overlay-kicker'),
        title: document.getElementById('overlay-title'),
        sub: document.getElementById('overlay-sub'),
        stats: document.getElementById('overlay-stats'),
        record: document.getElementById('overlay-record'),
        finalScore: document.getElementById('final-score'),
        finalItems: document.getElementById('final-items'),
        finalHigh: document.getElementById('final-high'),
        btnStart: document.getElementById('btn-start'),
        btnMute: document.getElementById('btn-mute'),
        hudScore: document.getElementById('hud-score'),
        hudHigh: document.getElementById('hud-high'),
        hudItems: document.getElementById('hud-items'),
      };

      this.audio = new AudioEngine();
      this.background = new Background();
      this.player = new Player();
      this.particles = new ParticleSystem();
      this.texts = new FloatingTexts();
      this.spawner = new Spawner(this);
      this.obstacles = [];
      this.collectibles = [];

      this.state = STATE.START;
      this.time = 0;          // total wall time (for animations)
      this.elapsed = 0;       // time in the current run
      this.distance = 0;      // px scrolled in the current run
      this.speed = CONFIG.BASE_SPEED;
      this.score = 0;
      this.items = 0;
      this.deathTimer = 0;
      this.isNewRecord = false;
      this.highScore = parseInt(storage.get(CONFIG.STORAGE_HIGH, '0'), 10) || 0;
      this.hudCache = { score: -1, high: -1, items: -1 };

      this.lastFrame = performance.now();
      this.running = true;

      this.bindInput();
      this.setupResize();
      this.updateMuteButton();
      this.showStartOverlay();
      this.updateHud(true);

      requestAnimationFrame((t) => this.frame(t));
    }

    /* ----- Resize / DPR ----- */

    setupResize() {
      const resize = () => this.resize();
      if ('ResizeObserver' in window) {
        new ResizeObserver(resize).observe(this.stage);
      }
      window.addEventListener('resize', resize);
      window.addEventListener('orientationchange', resize);
      this.resize();
    }

    resize() {
      const rect = this.stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);
      const bw = Math.round(rect.width * dpr);
      const bh = Math.round(rect.height * dpr);
      if (this.canvas.width !== bw || this.canvas.height !== bh) {
        this.canvas.width = bw;
        this.canvas.height = bh;
      }
      this.scaleX = bw / CONFIG.WIDTH;
      this.scaleY = bh / CONFIG.HEIGHT;
    }

    /* ----- Input ----- */

    bindInput() {
      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        switch (e.code) {
          case 'Space':
          case 'ArrowUp':
          case 'KeyW':
            e.preventDefault();
            this.primaryAction();
            break;
          case 'Enter':
            if (this.state !== STATE.PLAYING) {
              e.preventDefault();
              this.primaryAction();
            }
            break;
          case 'KeyP':
          case 'Escape':
            this.togglePause();
            break;
          case 'KeyM':
            this.toggleMute();
            break;
          default:
            break;
        }
      });

      // Pointer events cover mouse, touch and pen with one handler.
      this.stage.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        this.primaryAction();
      });

      // Older mobile browsers: make sure touches never scroll/zoom the stage.
      this.stage.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
      this.stage.addEventListener('contextmenu', (e) => e.preventDefault());

      this.dom.btnStart.addEventListener('click', (e) => {
        e.stopPropagation();
        this.audio.unlock();
        if (this.state === STATE.START || this.state === STATE.GAME_OVER) this.startGame();
      });

      this.dom.btnMute.addEventListener('pointerdown', (e) => e.stopPropagation());
      this.dom.btnMute.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMute();
      });

      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state === STATE.PLAYING) this.pause();
      });
      window.addEventListener('blur', () => {
        if (this.state === STATE.PLAYING) this.pause();
      });
    }

    /** Space / tap: context-sensitive. */
    primaryAction() {
      this.audio.unlock();
      switch (this.state) {
        case STATE.START:
          this.startGame();
          break;
        case STATE.PLAYING:
          this.player.requestJump();
          break;
        case STATE.PAUSED:
          this.resume();
          break;
        case STATE.GAME_OVER:
          if (this.deathTimer >= CONFIG.RESTART_COOLDOWN) this.startGame();
          break;
        default:
          break;
      }
    }

    toggleMute() {
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      this.updateMuteButton();
    }

    updateMuteButton() {
      const muted = this.audio.muted;
      this.dom.btnMute.classList.toggle('muted', muted);
      this.dom.btnMute.textContent = muted ? '✕' : '♪';
      this.dom.btnMute.setAttribute('aria-pressed', String(muted));
    }

    /* ----- State transitions ----- */

    startGame() {
      this.state = STATE.PLAYING;
      this.elapsed = 0;
      this.distance = 0;
      this.speed = CONFIG.BASE_SPEED;
      this.score = 0;
      this.items = 0;
      this.deathTimer = 0;
      this.isNewRecord = false;
      this.obstacles.length = 0;
      this.collectibles.length = 0;
      this.particles.clear();
      this.texts.clear();
      this.player.reset();
      this.spawner.reset();
      this.dom.overlay.classList.add('hidden');
      this.dom.btnStart.blur();
      this.stage.classList.remove('shake');
      this.audio.start();
      this.updateHud(true);
    }

    pause() {
      if (this.state !== STATE.PLAYING) return;
      this.state = STATE.PAUSED;
      this.showOverlay({
        kicker: 'TAKING A BREATHER',
        title: 'PAUSED',
        sub: 'Jimothy is catching his breath behind a Ballard dumpster.',
        button: 'RESUME',
        stats: false,
      });
    }

    resume() {
      if (this.state !== STATE.PAUSED) return;
      this.state = STATE.PLAYING;
      this.dom.overlay.classList.add('hidden');
      this.dom.btnStart.blur();
      this.lastFrame = performance.now();
    }

    togglePause() {
      if (this.state === STATE.PLAYING) this.pause();
      else if (this.state === STATE.PAUSED) this.resume();
    }

    gameOver() {
      this.state = STATE.GAME_OVER;
      this.deathTimer = 0;
      this.player.die(this.speed);
      this.audio.gameOver();
      this.particles.burst(
        this.player.x + this.player.w / 2,
        this.player.y + this.player.h / 2,
        36,
        [PALETTE.fur, PALETTE.furDark, PALETTE.danger, '#ffffff'],
        260,
        0.9
      );
      this.stage.classList.remove('shake');
      // Force reflow so the animation restarts
      void this.stage.offsetWidth;
      this.stage.classList.add('shake');

      // highScore is raised live during the run so the HUD tracks it;
      // isNewRecord tells us whether this run actually beat the saved score.
      if (this.score > this.highScore) this.highScore = this.score;
      if (this.isNewRecord) {
        storage.set(CONFIG.STORAGE_HIGH, this.highScore);
        this.audio.highScore();
      }
      this.updateHud(true);
    }

    showStartOverlay() {
      this.showOverlay({
        kicker: '♥ TEAM JIMOTHY ♥',
        title: 'PRESS START',
        sub: "Ballard's roundest raccoon is hungry. The streets are not safe. Let's eat anyway.",
        button: 'START',
        stats: false,
      });
    }

    showGameOverOverlay() {
      const quips = [
        'Ballard wins this round. Ballard will not gloat.',
        'Jimothy will be back. Jimothy is always back.',
        'That pizza was worth it. Probably.',
        'Animal Control: 1. Jimothy: still the most Seattle animal possible.',
        'Not very Hot Jimothy Summer of you.',
        'Somebody is already posting this to r/JimothyTheRaccoon.',
        'Bonked. Nobody saw. Nobody but you.',
      ];
      this.showOverlay({
        kicker: 'GAME OVER',
        title: this.isNewRecord ? 'NEW RECORD!' : 'BONKED!',
        sub: pick(quips),
        button: 'RUN AGAIN',
        stats: true,
        danger: !this.isNewRecord,
      });
    }

    showOverlay({ kicker, title, sub, button, stats, danger = false }) {
      const d = this.dom;
      d.kicker.textContent = kicker;
      d.title.textContent = title;
      d.title.classList.toggle('danger', danger);
      d.sub.textContent = sub;
      d.btnStart.textContent = button;
      d.stats.hidden = !stats;
      d.record.hidden = !(stats && this.isNewRecord);
      if (stats) {
        d.finalScore.textContent = String(this.score);
        d.finalItems.textContent = String(this.items);
        d.finalHigh.textContent = String(this.highScore);
      }
      d.overlay.classList.remove('hidden');
    }

    /* ----- HUD ----- */

    updateHud(force = false) {
      const c = this.hudCache;
      const d = this.dom;
      if (force || c.score !== this.score) {
        c.score = this.score;
        d.hudScore.textContent = String(this.score);
      }
      if (force || c.high !== this.highScore) {
        c.high = this.highScore;
        d.hudHigh.textContent = String(this.highScore);
      }
      if (force || c.items !== this.items) {
        c.items = this.items;
        d.hudItems.textContent = String(this.items);
        if (!force) {
          d.hudItems.classList.remove('bump');
          void d.hudItems.offsetWidth;
          d.hudItems.classList.add('bump');
        }
      }
    }

    /* ----- Loop ----- */

    frame(now) {
      const dt = Math.min((now - this.lastFrame) / 1000, CONFIG.MAX_DT);
      this.lastFrame = now;
      this.time += dt;

      this.update(dt);
      const scroll = this.state === STATE.PLAYING ? this.speed : this.state === STATE.START ? CONFIG.BASE_SPEED * 0.5 : 0;
      this.background.updateRain(dt, scroll);
      this.render();

      requestAnimationFrame((t) => this.frame(t));
    }

    update(dt) {
      switch (this.state) {
        case STATE.START: {
          // Attract mode: Ballard drifts by while Jimothy scurries in place.
          const idleSpeed = CONFIG.BASE_SPEED * 0.5;
          this.distance += idleSpeed * dt;
          this.player.runPhase += dt * 15;
          this.particles.update(dt, idleSpeed);
          break;
        }
        case STATE.PLAYING:
          this.updatePlaying(dt);
          break;
        case STATE.PAUSED:
          break;
        case STATE.GAME_OVER: {
          this.deathTimer += dt;
          this.player.update(dt, 0, this.audio, this.particles);
          this.particles.update(dt, 0);
          this.texts.update(dt, 0);
          for (const o of this.obstacles) o.update(dt, this.distance, true);
          if (this.deathTimer >= 1.0 && this.dom.overlay.classList.contains('hidden')) {
            this.showGameOverOverlay();
          }
          break;
        }
        default:
          break;
      }
    }

    updatePlaying(dt) {
      this.elapsed += dt;
      // Asymptotic speed ramp: quick early, levels off late.
      const ramp = 1 - Math.exp(-this.elapsed / CONFIG.SPEED_RAMP_TIME);
      this.speed = CONFIG.BASE_SPEED + CONFIG.SPEED_GAIN * ramp;
      this.distance += this.speed * dt;

      this.player.update(dt, this.speed, this.audio, this.particles);
      this.spawner.update();

      const playerBox = this.player.hitbox;

      // Obstacles
      for (let i = this.obstacles.length - 1; i >= 0; i--) {
        const o = this.obstacles[i];
        o.update(dt, this.distance, false);
        if (o.dead) {
          this.obstacles.splice(i, 1);
          continue;
        }
        if (aabb(playerBox, o.hitbox(this.distance))) {
          this.gameOver();
          return;
        }
      }

      // Collectibles
      for (let i = this.collectibles.length - 1; i >= 0; i--) {
        const c = this.collectibles[i];
        c.update(this.distance);
        if (c.dead) {
          this.collectibles.splice(i, 1);
          continue;
        }
        if (aabb(playerBox, c.hitbox(this.distance, this.time))) {
          this.collectibles.splice(i, 1);
          this.collect(c);
        }
      }

      this.particles.update(dt, this.speed);
      this.texts.update(dt, this.speed);

      const meters = Math.floor(this.distance / CONFIG.PX_PER_METER);
      this.score = meters + this.items * CONFIG.ITEM_POINTS;
      if (this.score > this.highScore) {
        this.highScore = this.score;
        this.isNewRecord = true;
      }
      this.updateHud();
    }

    collect(c) {
      this.items += 1;
      this.audio.collect();
      const cx = c.screenX(this.distance) + c.w / 2;
      const cy = c.y(this.time) + c.h / 2;
      const colors =
        c.type === 'PIZZA' ? [PALETTE.yellow, PALETTE.orange, '#c0392b']
        : c.type === 'DONUT' ? [PALETTE.pink, PALETTE.cyan, '#ffffff']
        : [PALETTE.cyan, '#ffffff', '#8fb3ff'];
      this.particles.burst(cx, cy, 14, colors, 200, 0.55, 300);
      this.texts.add(cx, cy - 10, `+${CONFIG.ITEM_POINTS}`, colors[0]);
    }

    /* ----- Render ----- */

    render() {
      const ctx = this.ctx;
      ctx.setTransform(this.scaleX || 1, 0, 0, this.scaleY || 1, 0, 0);

      this.background.drawSky(ctx, this.time);
      this.background.drawLayers(ctx, this.distance);
      this.background.drawGround(ctx, this.distance);

      // Player shadow
      const p = this.player;
      const shadowScale = clamp(1 - (CONFIG.GROUND_Y - (p.y + p.h)) / 260, 0.35, 1);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.35 * shadowScale})`;
      ctx.beginPath();
      ctx.ellipse(p.x + p.w / 2, CONFIG.GROUND_Y + 2, 26 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      for (const c of this.collectibles) c.draw(ctx, this.distance, this.time);
      for (const o of this.obstacles) o.draw(ctx, this.distance, this.time);
      p.draw(ctx, this.time);
      this.particles.draw(ctx);
      this.texts.draw(ctx);
      this.background.drawRain(ctx);

      // Vignette
      const vig = ctx.createRadialGradient(
        CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2, CONFIG.HEIGHT * 0.45,
        CONFIG.WIDTH / 2, CONFIG.HEIGHT / 2, CONFIG.HEIGHT * 0.95
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, CONFIG.WIDTH, CONFIG.HEIGHT);

      if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) this.drawRunInfo(ctx);
    }

    drawRunInfo(ctx) {
      const meters = Math.floor(this.distance / CONFIG.PX_PER_METER);
      const mult = (this.speed / CONFIG.BASE_SPEED).toFixed(1);
      ctx.font = '10px "Press Start 2P", monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(232, 230, 255, 0.75)';
      ctx.fillText(`${meters} m`, 16, 26);
      ctx.fillStyle = 'rgba(0, 240, 255, 0.75)';
      ctx.fillText(`SPEED x${mult}`, 16, 44);
      if (this.player.jumpsLeft === 1 && !this.player.onGround) {
        ctx.fillStyle = 'rgba(255, 226, 77, 0.7)';
        ctx.fillText('DOUBLE JUMP READY', 16, 62);
      }
    }
  }

  /* ----- Boot ----- */

  const boot = () => {
    window.JimothyGame = new Game();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
