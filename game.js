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
    MIN_VIEW_W: 540,            // narrowest logical view (portrait phones)
    MAX_VIEW_W: 1400,           // widest logical view (ultrawide screens)
    PLAYER_X: 150,              // player's left edge on wide screens
    PLAYER_X_NARROW: 100,       // ...and on narrow screens, to keep reaction time
    SPRITE_SCALE: 0.8,          // illustration units -> logical px
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

  /** Scenery palette: a warm, cosy Ballard dusk. */
  const ART = Object.freeze({
    skyTop: '#141a3f',
    skyHigh: '#3c3570',
    skyMid: '#7a5a8f',
    skyLow: '#c97b85',
    skyHorizon: '#f0a46e',
    moon: '#fff1c9',
    moonShade: '#f1dca0',
    skyline: '#4a3d72',
    skylineDark: '#3b2f5e',
    windowWarm: '#ffd27a',
    windowPeach: '#ffb37a',
    houseA: '#8f6f9c',
    houseB: '#6f86a8',
    houseC: '#a97b6a',
    houseD: '#7f9a7a',
    roof: '#3e3356',
    porch: '#d9c4a5',
    door: '#5b3b3a',
    trunk: '#5a4036',
    leafDark: '#2d5440',
    leaf: '#35634a',
    leafLight: '#4b7d5a',
    fence: '#e9dccb',
    fenceRail: '#cdbfa9',
    lamp: '#3e3356',
    bulbPink: '#ffb3c1',
    bulbMint: '#b8e0a8',
    sidewalk: '#6a5b80',
    sidewalkTop: '#7b6b92',
    seam: '#574a6e',
    curb: '#8a7aa3',
    road: '#2f2846',
    lane: '#5a4f73',
    heart: '#e4566a',
  });

  /** Display font used for every piece of text drawn on the canvas. */
  const FONT = '"Fredoka", "Nunito", "Segoe UI", sans-serif';

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

    /**
     * A stereo panner feeding the master, when the browser has one.
     * `from`/`to` are -1 (left) .. 1 (right); the pan glides between them.
     */
    panner(from, to, dur) {
      const ctx = this.ctx;
      if (!ctx.createStereoPanner) return this.master;
      const p = ctx.createStereoPanner();
      const t0 = ctx.currentTime;
      p.pan.setValueAtTime(clamp(from, -1, 1), t0);
      p.pan.linearRampToValueAtTime(clamp(to, -1, 1), t0 + dur);
      p.connect(this.master);
      return p;
    }

    /** An alley cat announcing itself: a sliding, slightly nasal "meow". */
    meow(pan = 0.7) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const pitch = 0.88 + Math.random() * 0.3;
      const dur = 0.62;
      const out = this.panner(pan, pan - 0.5, dur);

      // Vocal cord: a sawtooth sliding "me-e-ow", softened by a formant-like filter
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(560 * pitch, t0);
      osc.frequency.linearRampToValueAtTime(840 * pitch, t0 + 0.14);
      osc.frequency.setValueAtTime(840 * pitch, t0 + 0.24);
      osc.frequency.exponentialRampToValueAtTime(400 * pitch, t0 + dur);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(1500 * pitch, t0);
      filter.frequency.linearRampToValueAtTime(2600 * pitch, t0 + 0.18);
      filter.frequency.exponentialRampToValueAtTime(800 * pitch, t0 + dur);

      // Linear tail so the "ow" stays audible as the pitch falls
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.16, t0 + 0.05);
      g.gain.setValueAtTime(0.16, t0 + 0.24);
      g.gain.linearRampToValueAtTime(0.1, t0 + 0.45);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);

      // A quiet breathy layer an octave up gives the "e" vowel its brightness
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1120 * pitch, t0);
      osc2.frequency.linearRampToValueAtTime(1760 * pitch, t0 + 0.14);
      osc2.frequency.exponentialRampToValueAtTime(760 * pitch, t0 + dur);
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.linearRampToValueAtTime(0.04, t0 + 0.06);
      g2.gain.linearRampToValueAtTime(0.0001, t0 + dur * 0.85);

      osc.connect(filter).connect(g).connect(out);
      osc2.connect(g2).connect(out);
      osc.start(t0);
      osc2.start(t0);
      osc.stop(t0 + dur + 0.05);
      osc2.stop(t0 + dur + 0.05);
    }

    /**
     * The Animal Control truck's siren: a soft two-tone "wee-woo" that
     * sweeps across the stereo field as the truck drives past.
     */
    siren(dur = 2, panFrom = 0.9, panTo = -0.6) {
      if (!this.ready) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime;
      const half = 0.26;
      const cycles = clamp(Math.round(dur / (half * 2)), 2, 5);
      const total = cycles * half * 2;
      const out = this.panner(panFrom, panTo, total);

      const osc = ctx.createOscillator();
      osc.type = 'square';
      for (let i = 0; i < cycles; i++) {
        osc.frequency.setValueAtTime(698, t0 + i * half * 2);
        osc.frequency.setValueAtTime(523, t0 + i * half * 2 + half);
      }
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.07, t0 + 0.08);
      g.gain.setValueAtTime(0.07, t0 + total - 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + total);

      // A faint sub-harmonic makes it feel like it comes from a vehicle
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      for (let i = 0; i < cycles; i++) {
        osc2.frequency.setValueAtTime(349, t0 + i * half * 2);
        osc2.frequency.setValueAtTime(261.5, t0 + i * half * 2 + half);
      }
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.linearRampToValueAtTime(0.035, t0 + 0.08);
      g2.gain.setValueAtTime(0.035, t0 + total - 0.3);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + total);

      osc.connect(filter).connect(g).connect(out);
      osc2.connect(g2).connect(out);
      osc.start(t0);
      osc2.start(t0);
      osc.stop(t0 + total + 0.05);
      osc2.stop(t0 + total + 0.05);
    }
  }

  /* ========================================================================
     3. PARALLAX BACKGROUND — generated once into offscreen canvases
     ====================================================================== */

  class Background {
    constructor() {
      this.H = CONFIG.HEIGHT;
      this.tileW = 1920;
      this.fieldW = 1800; // width of the star / cloud fields before they repeat
      this.buildLayers();
      // The signs use the display font; rebuild the tiles once it has loaded.
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => this.buildLayers()).catch(() => {});
      }

      // Seattle drizzle (soft, lavender, never heavy)
      this.rain = [];
      for (let i = 0; i < 80; i++) {
        this.rain.push({
          x: Math.random() * 1600,
          y: -800 + Math.random() * 1400,
          len: 9 + Math.random() * 12,
          speed: 460 + Math.random() * 240,
          depth: 0.4 + Math.random() * 0.6,
        });
      }

      // Stars cover a tall field so portrait screens (which see far above the skyline) get sky too.
      this.stars = [];
      const rng = seededRandom(99);
      for (let i = 0; i < 220; i++) {
        this.stars.push({
          x: rng() * this.fieldW,
          y: -900 + rng() * 1150,
          r: 0.7 + rng() * 1.5,
          phase: rng() * Math.PI * 2,
          speed: 0.5 + rng() * 1.8,
        });
      }

      // The moon and its glow, rendered once
      this.moonR = 38;
      this.moonCanvas = document.createElement('canvas');
      this.moonCanvas.width = this.moonCanvas.height = 200;
      {
        const mc = this.moonCanvas.getContext('2d');
        mc.save();
        mc.shadowColor = ART.moon;
        mc.shadowBlur = 48;
        mc.fillStyle = ART.moon;
        mc.beginPath();
        mc.arc(100, 100, this.moonR, 0, Math.PI * 2);
        mc.fill();
        mc.fill();
        mc.restore();
        mc.fillStyle = ART.moonShade;
        mc.beginPath();
        mc.arc(89, 92, 6, 0, Math.PI * 2);
        mc.arc(110, 110, 4, 0, Math.PI * 2);
        mc.arc(104, 84, 3, 0, Math.PI * 2);
        mc.fill();
      }
      this.skyGradient = null;
      this.roadGradient = null;

      // Soft clouds catching the last light
      this.clouds = [];
      const crng = seededRandom(7);
      for (let i = 0; i < 9; i++) {
        this.clouds.push({
          x: crng() * this.fieldW,
          y: -420 + crng() * 640,
          w: 120 + crng() * 160,
          h: 18 + crng() * 16,
          a: 0.12 + crng() * 0.16,
        });
      }
    }

    buildLayers() {
      this.layers = [
        { factor: 0.12, canvas: this.buildSkyline(seededRandom(1337)) },
        { factor: 0.35, canvas: this.buildStreet(seededRandom(4242)) },
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
      const body = ART.skylineDark;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(x - 34, baseY);
      ctx.lineTo(x - 7, top + 70);
      ctx.lineTo(x + 7, top + 70);
      ctx.lineTo(x + 34, baseY);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - 3, top + 70, 6, h - 70);
      ctx.strokeStyle = body;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(x, top + 72, 30, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = ART.skyline;
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
      ctx.save();
      ctx.fillStyle = ART.windowWarm;
      ctx.shadowColor = ART.windowWarm;
      ctx.shadowBlur = 8;
      for (let i = -3; i <= 3; i++) ctx.fillRect(x + i * 11 - 2, top + 60, 4, 4);
      ctx.fillRect(x - 40, top + 50, 80, 1.5);
      ctx.restore();
      ctx.fillStyle = body;
      ctx.fillRect(x - 1.5, top, 3, 44);
      ctx.save();
      ctx.fillStyle = ART.heart;
      ctx.shadowColor = ART.heart;
      ctx.shadowBlur = 10;
      ctx.fillRect(x - 2.5, top - 4, 5, 5);
      ctx.restore();
    }

    /** Distant skyline: soft plum towers with warm golden windows. */
    buildSkyline(rng) {
      const c = this.makeTile();
      const ctx = c.getContext('2d');
      const { tileW: W } = this;
      const horizon = CONFIG.GROUND_Y - 40;

      // Warm haze where the city meets the sunset
      const haze = ctx.createLinearGradient(0, horizon - 240, 0, horizon);
      haze.addColorStop(0, 'rgba(242, 164, 110, 0)');
      haze.addColorStop(1, 'rgba(242, 164, 110, 0.35)');
      ctx.fillStyle = haze;
      ctx.fillRect(0, horizon - 240, W, 240);

      let x = 0;
      while (x < W) {
        const bw = 40 + Math.floor(rng() * 70);
        const bh = 80 + Math.floor(rng() * 210);
        const top = horizon - bh;
        ctx.fillStyle = rng() > 0.5 ? ART.skyline : ART.skylineDark;
        ctx.fillRect(x, top, bw, bh);

        if (rng() > 0.55) {
          ctx.fillStyle = ART.skylineDark;
          ctx.fillRect(x + bw * 0.3, top - 12, bw * 0.4, 12);
        }
        if (rng() > 0.7) {
          // Rooftop water tower
          ctx.fillStyle = ART.skylineDark;
          ctx.fillRect(x + bw / 2 - 8, top - 18, 16, 18);
          ctx.beginPath();
          ctx.moveTo(x + bw / 2 - 10, top - 18);
          ctx.lineTo(x + bw / 2, top - 26);
          ctx.lineTo(x + bw / 2 + 10, top - 18);
          ctx.closePath();
          ctx.fill();
        } else if (rng() > 0.6) {
          ctx.fillStyle = ART.skylineDark;
          ctx.fillRect(x + bw / 2 - 1, top - 30, 2, 30);
          ctx.fillStyle = ART.heart;
          ctx.fillRect(x + bw / 2 - 2, top - 32, 4, 4);
        }

        const cols = Math.max(1, Math.floor((bw - 10) / 12));
        const rows = Math.max(1, Math.floor((bh - 12) / 14));
        for (let r = 0; r < rows; r++) {
          for (let cc = 0; cc < cols; cc++) {
            if (rng() > 0.6) {
              ctx.fillStyle = rng() > 0.75 ? ART.windowPeach : ART.windowWarm;
              ctx.globalAlpha = 0.3 + rng() * 0.5;
              ctx.fillRect(x + 6 + cc * 12, top + 8 + r * 14, 6, 7);
            }
          }
        }
        ctx.globalAlpha = 1;
        x += bw + Math.floor(rng() * 14);
      }

      this.drawSpaceNeedle(ctx, 1240, horizon);

      // Soft fog that hides the base of the skyline
      const fog = ctx.createLinearGradient(0, horizon - 60, 0, horizon + 10);
      fog.addColorStop(0, 'rgba(78, 62, 112, 0)');
      fog.addColorStop(1, 'rgba(78, 62, 112, 1)');
      ctx.fillStyle = fog;
      ctx.fillRect(0, horizon - 60, W, 70);
      return c;
    }

    drawTree(ctx, x, base, rng) {
      const trunkH = 26 + rng() * 20;
      const r = 24 + rng() * 18;
      ctx.fillStyle = ART.trunk;
      ctx.fillRect(x - 4, base - trunkH, 8, trunkH);
      const greens = [ART.leafDark, ART.leaf, ART.leafLight];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = greens[i];
        ctx.beginPath();
        ctx.arc(x + (i - 1) * r * 0.45, base - trunkH - r * 0.7 + i * 4, r - i * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawStringLights(ctx, x1, x2, y, rng) {
      const sag = 14 + rng() * 10;
      ctx.strokeStyle = 'rgba(60, 45, 80, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.quadraticCurveTo((x1 + x2) / 2, y + sag * 2, x2, y);
      ctx.stroke();
      const bulbs = [ART.windowWarm, ART.bulbPink, ART.bulbMint, ART.windowPeach];
      const n = Math.max(3, Math.floor((x2 - x1) / 22));
      ctx.save();
      ctx.shadowBlur = 8;
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const bx = x1 + (x2 - x1) * t;
        const by = y + 2 * sag * t * (1 - t) * 2;
        const col = bulbs[i % bulbs.length];
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.beginPath();
        ctx.arc(bx, by + 4, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    /** Mid layer: a cosy Ballard street of craftsman houses, trees, fences and string lights. */
    buildStreet(rng) {
      const c = this.makeTile();
      const ctx = c.getContext('2d');
      const { tileW: W } = this;
      const base = CONFIG.GROUND_Y + 4;
      let signDrawn = false;
      const walls = [ART.houseA, ART.houseB, ART.houseC, ART.houseD];

      let x = 20;
      while (x < W - 60) {
        const kind = rng();
        if (kind < 0.42) {
          // Craftsman house with a porch
          const hw = 130 + Math.floor(rng() * 70);
          const hh = 84 + Math.floor(rng() * 46);
          const top = base - hh;
          const wall = walls[Math.floor(rng() * walls.length)];
          ctx.fillStyle = wall;
          ctx.fillRect(x, top, hw, hh);
          // Roof with overhang
          ctx.fillStyle = ART.roof;
          ctx.beginPath();
          ctx.moveTo(x - 14, top + 4);
          ctx.lineTo(x + hw / 2, top - 44);
          ctx.lineTo(x + hw + 14, top + 4);
          ctx.lineTo(x + hw + 14, top + 10);
          ctx.lineTo(x - 14, top + 10);
          ctx.closePath();
          ctx.fill();
          // Attic window
          ctx.fillStyle = ART.windowWarm;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(x + hw / 2, top - 12, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          // Porch
          ctx.fillStyle = ART.roof;
          ctx.fillRect(x + hw / 2 - 34, base - 54, 68, 6);
          ctx.fillStyle = ART.porch;
          ctx.fillRect(x + hw / 2 - 32, base - 48, 5, 48);
          ctx.fillRect(x + hw / 2 + 27, base - 48, 5, 48);
          ctx.fillRect(x + hw / 2 - 34, base - 8, 68, 8);
          // Door
          ctx.fillStyle = ART.door;
          roundRect(ctx, x + hw / 2 - 11, base - 40, 22, 40, 3);
          ctx.fill();
          ctx.fillStyle = ART.windowWarm;
          ctx.fillRect(x + hw / 2 - 6, base - 34, 12, 8);
          // Windows, warm and lit
          ctx.save();
          ctx.fillStyle = ART.windowWarm;
          ctx.shadowColor = ART.windowWarm;
          ctx.shadowBlur = 12;
          ctx.globalAlpha = 0.95;
          roundRect(ctx, x + 16, top + 24, 22, 20, 2);
          ctx.fill();
          roundRect(ctx, x + hw - 38, top + 24, 22, 20, 2);
          ctx.fill();
          ctx.restore();
          ctx.fillStyle = wall;
          ctx.fillRect(x + 26, top + 24, 2, 20);
          ctx.fillRect(x + hw - 28, top + 24, 2, 20);
          ctx.fillRect(x + 16, top + 33, 22, 2);
          ctx.fillRect(x + hw - 38, top + 33, 22, 2);
          // Flower box under one window
          ctx.fillStyle = ART.trunk;
          ctx.fillRect(x + 14, top + 45, 26, 5);
          for (let f = 0; f < 4; f++) {
            ctx.fillStyle = f % 2 ? ART.bulbPink : ART.heart;
            ctx.beginPath();
            ctx.arc(x + 18 + f * 6, top + 44, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          // The neighbourhood sign, once per tile
          if (!signDrawn) {
            signDrawn = true;
            ctx.save();
            ctx.fillStyle = ART.roof;
            roundRect(ctx, x + hw / 2 - 40, top + 50, 80, 20, 4);
            ctx.fill();
            ctx.font = `bold 13px ${FONT}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = ART.windowWarm;
            ctx.shadowColor = ART.windowWarm;
            ctx.shadowBlur = 10;
            ctx.fillText('BALLARD', x + hw / 2, top + 60);
            ctx.restore();
          }
          x += hw + 34 + Math.floor(rng() * 40);
        } else if (kind < 0.62) {
          // Picket fence with a tree behind it
          const fw = 100 + Math.floor(rng() * 120);
          this.drawTree(ctx, x + fw * (0.3 + rng() * 0.4), base, rng);
          ctx.fillStyle = ART.fence;
          for (let px = x; px < x + fw; px += 14) {
            ctx.fillRect(px, base - 40, 8, 40);
            ctx.beginPath();
            ctx.moveTo(px, base - 40);
            ctx.lineTo(px + 4, base - 46);
            ctx.lineTo(px + 8, base - 40);
            ctx.closePath();
            ctx.fill();
          }
          ctx.fillStyle = ART.fenceRail;
          ctx.fillRect(x, base - 34, fw, 4);
          ctx.fillRect(x, base - 16, fw, 4);
          x += fw + 20 + Math.floor(rng() * 30);
        } else if (kind < 0.8) {
          // Two trees with string lights between them
          const gap = 110 + Math.floor(rng() * 60);
          this.drawTree(ctx, x, base, rng);
          this.drawTree(ctx, x + gap, base, rng);
          this.drawStringLights(ctx, x, x + gap, base - 70, rng);
          x += gap + 50 + Math.floor(rng() * 40);
        } else {
          // Old-fashioned street lamp with a warm pool of light
          ctx.fillStyle = ART.lamp;
          ctx.fillRect(x + 4, base - 150, 6, 150);
          ctx.fillRect(x - 6, base - 150, 26, 5);
          ctx.beginPath();
          ctx.moveTo(x + 10, base - 150);
          ctx.lineTo(x + 20, base - 140);
          ctx.lineTo(x + 32, base - 140);
          ctx.lineTo(x + 20, base - 158);
          ctx.closePath();
          ctx.fill();
          ctx.save();
          ctx.fillStyle = ART.windowWarm;
          ctx.shadowColor = ART.windowWarm;
          ctx.shadowBlur = 18;
          roundRect(ctx, x + 14, base - 148, 12, 10, 3);
          ctx.fill();
          ctx.restore();
          const cone = ctx.createLinearGradient(0, base - 140, 0, base);
          cone.addColorStop(0, 'rgba(255, 210, 122, 0.22)');
          cone.addColorStop(1, 'rgba(255, 210, 122, 0)');
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

    /** Sky: a warm Pacific-Northwest dusk, from deep blue overhead to peach at the horizon. */
    drawSky(ctx, time, distance, view) {
      const H = this.H;
      if (!this.skyGradient) {
        const sky = ctx.createLinearGradient(0, -700, 0, 430);
        sky.addColorStop(0, ART.skyTop);
        sky.addColorStop(0.45, ART.skyHigh);
        sky.addColorStop(0.72, ART.skyMid);
        sky.addColorStop(0.9, ART.skyLow);
        sky.addColorStop(1, ART.skyHorizon);
        this.skyGradient = sky;
      }
      ctx.fillStyle = this.skyGradient;
      ctx.fillRect(0, view.top, view.w, H - view.top);

      // Stars, fading toward the bright horizon
      ctx.fillStyle = '#fff6e8';
      for (const s of this.stars) {
        if (s.x > view.w + 4 || s.y < view.top - 4 || s.y > 260) continue;
        const twinkle = 0.5 + 0.5 * Math.sin(time * s.speed + s.phase);
        const fade = clamp((260 - s.y) / 300, 0, 1);
        ctx.globalAlpha = (0.25 + 0.6 * twinkle) * fade;
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;

      // Moon, kept near the top of whatever the screen shows
      const mx = view.w - 140;
      const my = view.top < -140 ? view.top + 130 : 90;
      ctx.drawImage(this.moonCanvas, mx - 100, my - 100);

      // Clouds drifting slowly
      const drift = (distance * 0.04 + time * 6) % this.fieldW;
      for (const cl of this.clouds) {
        let cx = cl.x - drift;
        if (cx < -cl.w) cx += this.fieldW;
        if (cx > view.w + cl.w || cl.y + cl.h < view.top) continue;
        ctx.fillStyle = `rgba(255, 214, 222, ${cl.a})`;
        ctx.beginPath();
        ctx.ellipse(cx, cl.y, cl.w / 2, cl.h, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - cl.w * 0.22, cl.y + 4, cl.w * 0.3, cl.h * 0.8, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + cl.w * 0.2, cl.y + 2, cl.w * 0.28, cl.h * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    drawLayers(ctx, distance, view) {
      for (const layer of this.layers) {
        const off = (distance * layer.factor) % this.tileW;
        for (let x = -off; x < view.w; x += this.tileW) ctx.drawImage(layer.canvas, x, 0);
      }
    }

    drawGround(ctx, distance, view) {
      const H = this.H;
      const W = view.w;
      const gy = CONFIG.GROUND_Y;

      // Sidewalk
      ctx.fillStyle = ART.sidewalk;
      ctx.fillRect(0, gy, W, 44);
      ctx.fillStyle = ART.sidewalkTop;
      ctx.fillRect(0, gy, W, 5);
      const seam = 96;
      const off = distance % seam;
      ctx.fillStyle = ART.seam;
      for (let x = -off; x < W; x += seam) ctx.fillRect(x, gy + 5, 3, 39);
      for (let x = -off, i = Math.floor(distance / seam); x < W; x += seam, i++) {
        if ((i * 7919) % 5 === 0) {
          ctx.strokeStyle = ART.seam;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + 20, gy + 12);
          ctx.lineTo(x + 38, gy + 24);
          ctx.lineTo(x + 32, gy + 38);
          ctx.stroke();
        }
        if ((i * 104729) % 7 === 0) {
          // A little tuft of grass between the slabs
          ctx.fillStyle = ART.leafLight;
          ctx.beginPath();
          ctx.moveTo(x + 60, gy + 6);
          ctx.lineTo(x + 63, gy - 4);
          ctx.lineTo(x + 66, gy + 6);
          ctx.moveTo(x + 64, gy + 6);
          ctx.lineTo(x + 68, gy - 2);
          ctx.lineTo(x + 70, gy + 6);
          ctx.fill();
        }
      }

      // Curb
      ctx.fillStyle = ART.curb;
      ctx.fillRect(0, gy + 44, W, 6);

      // Road, wet, catching the warm lights
      ctx.fillStyle = ART.road;
      ctx.fillRect(0, gy + 50, W, H - gy - 50);
      ctx.fillStyle = ART.lane;
      const laneOff = (distance * 1.3) % 120;
      for (let x = -laneOff; x < W; x += 120) ctx.fillRect(x, gy + 72, 60, 4);
      if (!this.roadGradient) {
        const refl = ctx.createLinearGradient(0, gy + 50, 0, H);
        refl.addColorStop(0, 'rgba(255, 190, 120, 0.12)');
        refl.addColorStop(1, 'rgba(255, 140, 160, 0.06)');
        this.roadGradient = refl;
      }
      ctx.fillStyle = this.roadGradient;
      ctx.fillRect(0, gy + 50, W, H - gy - 50);
    }

    updateRain(dt, scroll, view) {
      const H = this.H;
      const spanW = view.w + 200;
      for (const d of this.rain) {
        d.y += d.speed * d.depth * dt;
        d.x -= (80 + scroll * 0.25) * d.depth * dt;
        if (d.y > H + 20) {
          d.y = view.top - 30 - Math.random() * 60;
          d.x = Math.random() * spanW;
        }
        if (d.x < -20) d.x += spanW;
      }
    }

    drawRain(ctx, view) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#e4dcff';
      for (const d of this.rain) {
        if (d.x > view.w + 10 || d.y + d.len < view.top) continue;
        ctx.globalAlpha = 0.08 + d.depth * 0.16;
        ctx.lineWidth = d.depth * 1.3;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - d.len * 0.16, d.y + d.len);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /* ========================================================================
     4a. JIMOTHY SPRITE — the illustrated raccoon, pre-rendered to frames
     ====================================================================== */

  /**
   * The illustration follows a small contract: { bounds, draw(ctx, state) }
   * with the origin at the point on the ground under the body centre, +x to
   * the right, y negative upwards, and state = { pose, t, time } where pose is
   * 'run' | 'jump' | 'fall' | 'dead' and t is the gait phase in [0, 1).
   */
  const JimothySprite = (() => {
    const host = {};
    /* Jimothy the raccoon - procedural painterly Canvas sprite (candidate-1)
       Origin (0,0) = ground under the body centre, +x right, y negative = up. Faces right. */
    (function () {
      'use strict';
      var TAU = Math.PI * 2;

      function mulberry32(a) {
        return function () {
          a |= 0; a = a + 0x6D2B79F5 | 0;
          var t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
      }
      function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

      // ---- palette: grizzled grey (slightly warm) raccoon fur, dark -> pale ----
      var RAMP = [[40, 37, 34], [57, 53, 49], [76, 71, 66], [96, 90, 84], [117, 110, 103], [139, 132, 124], [160, 153, 145], [181, 175, 167], [201, 196, 188], [221, 217, 210]];
      var FURA = [], FURB = [];
      for (var ci = 0; ci < RAMP.length; ci++) {
        var c = RAMP[ci];
        FURA.push('rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',0.66)');
        FURB.push('rgba(' + (c[0] + 6) + ',' + (c[1] + 2) + ',' + (c[2] - 6) + ',0.66)'); // warmer twin
      }
      var WIDTHS = [0.7, 1.0, 1.35];
      var LEG_UP = '#4a4541', LEG_LO = '#2f2c29', PAW = '#171514';
      var WHITE = '#f1eee8', MASK = '#151312', NOSE = '#0e0d0c';

      // ---- batched stroke renderer ----
      function Batch() { this.keys = []; this.map = {}; }
      Batch.prototype.add = function (x, y, x2, y2, color, w) {
        var k = color + '|' + w;
        var arr = this.map[k];
        if (!arr) { arr = this.map[k] = [color, w]; this.keys.push(k); }
        arr.push(x, y, x2, y2);
      };
      Batch.prototype.flush = function (ctx) {
        for (var i = 0; i < this.keys.length; i++) {
          var arr = this.map[this.keys[i]];
          ctx.strokeStyle = arr[0]; ctx.lineWidth = arr[1];
          ctx.beginPath();
          for (var j = 2; j < arr.length; j += 4) { ctx.moveTo(arr[j], arr[j + 1]); ctx.lineTo(arr[j + 2], arr[j + 3]); }
          ctx.stroke();
        }
        this.keys = []; this.map = {};
      };

      // ---- cubic bezier helpers: p = [x0,y0,x1,y1,x2,y2,x3,y3] ----
      function bez(p, t) {
        var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
      }
      function bezD(p, t) {
        var u = 1 - t;
        return [3 * u * u * (p[2] - p[0]) + 6 * u * t * (p[4] - p[2]) + 3 * t * t * (p[6] - p[4]),
                3 * u * u * (p[3] - p[1]) + 6 * u * t * (p[5] - p[3]) + 3 * t * t * (p[7] - p[5])];
      }
      function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

      // ---- body silhouette (body frame), starts at the nose, goes over the back ----
      var BODY = [
        [68, -56, 64, -66, 58, -78, 47, -83],    // nose -> top of head
        [47, -83, 36, -88, 14, -96, -6, -95],    // head -> top of the hunched back
        [-6, -95, -24, -94, -38, -84, -43, -72], // back -> tail base
        [-43, -72, -48, -60, -46, -47, -40, -39], // rump
        [-40, -39, -32, -31, -8, -29, 10, -32],  // belly
        [10, -32, 26, -34, 38, -38, 47, -44],    // chest -> throat
        [47, -44, 55, -48, 63, -48, 68, -56]     // chin -> nose
      ];
      var SEG_W = [0.11, 0.18, 0.12, 0.10, 0.17, 0.12, 0.08];
      function pickSeg(rng) {
        var r = rng(), acc = 0;
        for (var i = 0; i < SEG_W.length; i++) { acc += SEG_W[i]; if (r < acc) return i; }
        return SEG_W.length - 1;
      }
      function bodyPath(ctx) {
        ctx.beginPath();
        ctx.moveTo(BODY[0][0], BODY[0][1]);
        for (var i = 0; i < BODY.length; i++) { var s = BODY[i]; ctx.bezierCurveTo(s[2], s[3], s[4], s[5], s[6], s[7]); }
        ctx.closePath();
      }

      // local tone of the body coat, 0 = darkest (top of back) .. 1 = palest (belly/throat)
      function tone(x, y) {
        var v = (y + 95) / 64;
        v = v * v * 0.6 + v * 0.4;
        if (x > 40) v = v * 0.55 + 0.3;              // head: flatter mid grey
        if (x > 30 && y > -52) v += 0.2;             // throat/chest pale
        if (x < -20 && y < -60) v -= 0.08;           // rump top darker
        return clamp(v, 0, 1);
      }
      function furColor(rng, idx) {
        idx = clamp(Math.round(idx), 0, 9);
        return (rng() < 0.35 ? FURB : FURA)[idx];
      }
      function bodyStrokeColor(x, y, rng) {
        var v = tone(x, y);
        var idx = v * 8 + (rng() - 0.5) * 2.6;
        var g = rng();
        if (g < 0.09) idx -= 2.5; else if (g < 0.16) idx += 2.2; // dark / pale guard hairs
        return furColor(rng, idx);
      }
      function pickW(rng) { var r = rng(); return WIDTHS[r < 0.5 ? 0 : (r < 0.85 ? 1 : 2)]; }

      // strokes sampled inside a rotated ellipse; direction = radial*ur + flow (local frame)
      function furRegion(B, rng, cx, cy, rx, ry, rot, n, fx, fy, radial, lmin, lmax) {
        var cr = Math.cos(rot), sr = Math.sin(rot);
        for (var i = 0; i < n; i++) {
          var a = rng() * TAU, r = Math.sqrt(rng());
          var ux = Math.cos(a) * r, uy = Math.sin(a) * r;
          var lx = ux * rx, ly = uy * ry;
          var x = cx + lx * cr - ly * sr, y = cy + lx * sr + ly * cr;
          var dx = ux * radial + fx, dy = uy * radial + fy;
          var ddx = dx * cr - dy * sr, ddy = dx * sr + dy * cr;
          var dl = Math.hypot(ddx, ddy) || 1;
          var len = lmin + rng() * (lmax - lmin);
          B.add(x, y, x + ddx / dl * len, y + ddy / dl * len, bodyStrokeColor(x, y, rng), pickW(rng));
        }
      }
      // fluffy outline: strokes starting just inside the silhouette, pointing outward + flow
      function edgeFluff(B, rng, n, inset, lmin, lmax, fx, fy) {
        for (var i = 0; i < n; i++) {
          var s = BODY[pickSeg(rng)], t = rng();
          var p = bez(s, t), d = bezD(s, t); var dl = Math.hypot(d[0], d[1]) || 1;
          var nx = -d[1] / dl, ny = d[0] / dl; // outward normal
          var k = rng() * inset;
          var x = p[0] - nx * k, y = p[1] - ny * k;
          var ddx = nx + fx * (0.6 + rng() * 0.8), ddy = ny + fy * (0.6 + rng() * 0.8);
          var l2 = Math.hypot(ddx, ddy) || 1;
          var len = lmin + rng() * (lmax - lmin);
          var col;
          if (x > 46) { len *= 0.55; col = y > -57 ? (rng() < 0.6 ? WHITE : FURA[8]) : bodyStrokeColor(x, y, rng); }
          else col = bodyStrokeColor(x, y, rng);
          B.add(x, y, x + ddx / l2 * len, y + ddy / l2 * len, col, pickW(rng));
        }
      }

      // ---- tail: bushy club with dark bands ----
      var RINGS = [0.3, 0.46, 0.62, 0.78];
      function ringAmt(t) {
        var m = 0;
        for (var i = 0; i < RINGS.length; i++) { var d = Math.abs(t - RINGS[i]); if (d < 0.05) m = 1; }
        if (t > 0.92) m = 1;
        return m;
      }
      function tailW(t) {
        var w = 7 + 6 * Math.sin(Math.PI * (0.15 + 0.75 * t));
        if (t > 0.8) w *= 1 - (t - 0.8) * 2;
        return Math.max(w, 3);
      }
      function drawTail(ctx, B, rng, P) {
        var N = 24, prev = bez(P, 0);
        for (var i = 1; i <= N; i++) {
          var t = i / N, p = bez(P, t), tm = (t + (i - 1) / N) / 2;
          ctx.strokeStyle = ringAmt(tm) > 0.5 ? '#232120' : (tm < 0.18 ? '#847d75' : '#bbb5ab');
          ctx.lineWidth = tailW(tm) * 2;
          ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
          prev = p;
        }
        for (i = 0; i < 230; i++) {
          t = rng(); var d = rng() * 2 - 1; d = d * Math.sqrt(Math.abs(d)) * (d < 0 ? -1 : 1) * (d < 0 ? -1 : 1);
          p = bez(P, t); var dv = bezD(P, t); var dl = Math.hypot(dv[0], dv[1]) || 1;
          var tx = dv[0] / dl, ty = dv[1] / dl, nx = -ty, ny = tx;
          var w = tailW(t);
          var x = p[0] + nx * d * w, y = p[1] + ny * d * w;
          var sgn = d < 0 ? -1 : 1, ad = Math.abs(d);
          var ddx = nx * sgn * (0.6 + ad) + tx * 0.45, ddy = ny * sgn * (0.6 + ad) + ty * 0.45;
          var l2 = Math.hypot(ddx, ddy) || 1;
          var len = 2 + rng() * 3;
          var ring = ringAmt(t);
          var idx;
          if (ring > 0.5) idx = rng() * 1.8 + (rng() < 0.1 ? 2.5 : 0);
          else idx = 7.2 + (rng() - 0.5) * 2.2 + (ny * sgn < 0 ? -0.9 : 0.5) + (rng() < 0.08 ? -3 : 0);
          if (t < 0.18) idx -= 1.5 * (1 - t / 0.18);
          B.add(x, y, x + ddx / l2 * len, y + ddy / l2 * len, furColor(rng, idx), pickW(rng));
        }
        B.flush(ctx);
      }

      // ---- legs ----
      function ik(hip, foot, L1, L2, bend) {
        var dx = foot[0] - hip[0], dy = foot[1] - hip[1]; var d = Math.hypot(dx, dy);
        var maxd = L1 + L2 - 0.3;
        if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; foot = [hip[0] + dx, hip[1] + dy]; }
        if (d < 0.001) { d = 0.001; dx = 0; dy = 0.001; }
        var a = (d * d + L1 * L1 - L2 * L2) / (2 * d);
        var h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
        var ux = dx / d, uy = dy / d;
        return { j: [hip[0] + ux * a - uy * h * bend, hip[1] + uy * a + ux * h * bend], foot: foot };
      }
      function line(ctx, a, b, w, c) {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      function taper(ctx, a, b, w0, w1, c0, c1, n) {
        for (var i = 0; i < n; i++) {
          var p = lerp(a, b, i / n), q = lerp(a, b, (i + 1) / n), f = (i + 0.5) / n;
          line(ctx, p, q, w0 + (w1 - w0) * f, f < 0.5 ? c0 : c1);
        }
      }
      function limbFur(B, rng, a, b, w0, w1, n, idx0, idx1, far) {
        var dx = b[0] - a[0], dy = b[1] - a[1]; var dl = Math.hypot(dx, dy) || 1;
        var ux = dx / dl, uy = dy / dl, nx = -uy, ny = ux;
        for (var i = 0; i < n; i++) {
          var t = rng(), s = rng() * 2 - 1;
          var w = (w0 + (w1 - w0) * t) * 0.5;
          var p = lerp(a, b, t);
          var x = p[0] + nx * s * w, y = p[1] + ny * s * w;
          var ddx = ux * 0.85 + nx * s * 0.9, ddy = uy * 0.85 + ny * s * 0.9; var l2 = Math.hypot(ddx, ddy) || 1;
          var len = 2.5 + rng() * 3;
          var idx = idx0 + (idx1 - idx0) * t + (rng() - 0.5) * 2.2 + (s < -0.3 ? 0.8 : 0) - (far ? 0.8 : 0);
          B.add(x, y, x + ddx / l2 * len, y + ddy / l2 * len, furColor(rng, idx), WIDTHS[rng() < 0.6 ? 0 : 1]);
        }
      }

      // L: { hip, foot, joint?, kind:'hind'|'front', far, bend }
      function drawLeg(ctx, B, rng, L) {
        var hind = L.kind === 'hind';
        var L1 = hind ? 30 : 29, L2 = hind ? 26 : 29;
        var j, foot = L.foot;
        if (L.joint) j = L.joint; else { var r = ik(L.hip, L.foot, L1, L2, L.bend === undefined ? 1 : L.bend); j = r.j; foot = r.foot; }
        var far = !!L.far;
        var up = far ? 'rgba(59,55,51,0.9)' : 'rgba(78,73,68,0.88)', up2 = far ? '#33302c' : '#3f3b37', lo = far ? '#252321' : LEG_LO, paw = far ? '#121110' : PAW;
        var wUp = hind ? 18 : 12, wMid = hind ? 9 : 6.8, wLo = hind ? 7 : 5.4;
        taper(ctx, L.hip, j, wUp, wMid, up, up2, 4);
        taper(ctx, j, foot, wLo, wLo * 0.85, lo, lo, 2);
        limbFur(B, rng, L.hip, j, wUp, wMid, hind ? 48 : 30, 4.0, 1.6, far);
        limbFur(B, rng, j, foot, wLo, wLo * 0.85, hind ? 12 : 9, 1.2, 0.6, far);
        B.flush(ctx);
        // paw
        var lifted = foot[1] < -3;
        var k, a;
        if (hind) {
          var fd = lifted ? [0.7, 0.71] : [1, 0];
          var toe = [foot[0] + fd[0] * 10, foot[1] + fd[1] * 10];
          line(ctx, foot, toe, 5, paw);
          for (k = -2; k <= 2; k++) {
            a = Math.atan2(fd[1], fd[0]) + k * 0.2;
            line(ctx, [toe[0] - fd[0] * 2, toe[1] - fd[1] * 2], [toe[0] + Math.cos(a) * 5.5, toe[1] + Math.sin(a) * 5.5], 1.5, paw);
          }
        } else if (lifted) {
          line(ctx, foot, [foot[0] + 1.5, foot[1] + 3.5], 4.4, paw);
          for (k = 0; k < 5; k++) {
            a = Math.PI * 0.5 + (k - 2) * 0.26 + 0.12;
            line(ctx, [foot[0] + 1.5, foot[1] + 3], [foot[0] + 1.5 + Math.cos(a) * 6, foot[1] + 3 + Math.sin(a) * 6], 1.4, paw);
          }
        } else {
          var palm = [foot[0] + 4, foot[1]];
          line(ctx, foot, palm, 4.4, paw);
          for (k = 0; k < 5; k++) {
            a = (k - 2.2) * 0.25;
            line(ctx, palm, [palm[0] + Math.cos(a) * 6, palm[1] + Math.sin(a) * 6 + 0.5], 1.4, paw);
          }
        }
      }

      function gaitFoot(phase, cx, stride, lift) {
        phase -= Math.floor(phase);
        if (phase < 0.5) { var s = phase / 0.5; return [cx + stride / 2 - stride * s, 0]; }
        var s2 = (phase - 0.5) / 0.5;
        return [cx - stride / 2 + stride * s2, -lift * Math.sin(Math.PI * s2)];
      }

      // ---- ears: rounded triangle, grey with dark inside and a pale rim ----
      function drawEar(ctx, cx, cy, r, tilt) {
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(tilt);
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.6);
        ctx.quadraticCurveTo(-r * 1.1, -r * 0.9, -r * 0.2, -r * 1.25);
        ctx.quadraticCurveTo(r * 0.5, -r * 1.3, r * 0.95, r * 0.1);
        ctx.quadraticCurveTo(r * 1.0, r * 0.5, r * 0.8, r * 0.7);
        ctx.closePath();
        ctx.fillStyle = '#7b746b'; ctx.fill();
        ctx.strokeStyle = '#d6d1c7'; ctx.lineWidth = 1.0; ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-r * 0.5, r * 0.55);
        ctx.quadraticCurveTo(-r * 0.6, -r * 0.5, -r * 0.1, -r * 0.75);
        ctx.quadraticCurveTo(r * 0.35, -r * 0.7, r * 0.55, r * 0.1);
        ctx.quadraticCurveTo(r * 0.6, r * 0.5, r * 0.45, r * 0.6);
        ctx.closePath();
        ctx.fillStyle = '#272422'; ctx.fill();
        ctx.restore();
      }

      // ---- face ----
      function drawFace(ctx, B, rng, pose, time) {
        // grey cheek behind the mask, slightly darker
        ctx.fillStyle = 'rgba(96,90,84,0.6)';
        ctx.beginPath(); ctx.ellipse(41, -62, 8, 9, 0.3, 0, TAU); ctx.fill();
        // black mask around the eye (wide at the cheek, pointed toward the nose)
        ctx.fillStyle = MASK;
        ctx.beginPath();
        ctx.moveTo(36, -66);
        ctx.quadraticCurveTo(44, -71, 56, -69);
        ctx.quadraticCurveTo(61, -67, 63, -62);
        ctx.quadraticCurveTo(63, -58, 59, -56.5);
        ctx.quadraticCurveTo(50, -55, 42, -58);
        ctx.quadraticCurveTo(37, -61, 36, -66);
        ctx.closePath(); ctx.fill();
        // white brow: crescent over the top and front of the mask
        ctx.strokeStyle = WHITE; ctx.lineWidth = 3.4;
        ctx.beginPath(); ctx.moveTo(40, -73); ctx.quadraticCurveTo(52, -74.5, 60.5, -68.5); ctx.quadraticCurveTo(64.5, -65, 65, -60.5); ctx.stroke();
        // grey nose bridge stripe (forehead to nose)
        ctx.strokeStyle = '#5b5650'; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(50, -80); ctx.quadraticCurveTo(60, -72, 67, -59); ctx.stroke();
        // white muzzle / cheek patch below the mask
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.moveTo(45, -56.5);
        ctx.quadraticCurveTo(54, -54.5, 62, -56.5);
        ctx.quadraticCurveTo(68, -55, 66.5, -51);
        ctx.quadraticCurveTo(63, -47, 55, -47);
        ctx.quadraticCurveTo(48, -48.5, 45, -56.5);
        ctx.closePath(); ctx.fill();
        // soft fur feathering on the face
        for (var i = 0; i < 50; i++) {
          var a = rng() * TAU, r = 0.75 + rng() * 0.35;
          var x = 53 + Math.cos(a) * 11 * r, y = -62 + Math.sin(a) * 9 * r;
          var len = 1.5 + rng() * 2;
          var c = y < -68 ? (rng() < 0.4 ? WHITE : FURA[5]) : (y > -57 ? WHITE : 'rgba(21,19,18,0.8)');
          if (x < 42) c = FURA[4 + Math.floor(rng() * 2)];
          B.add(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, c, 0.9);
        }
        B.flush(ctx);
        // nose
        ctx.fillStyle = NOSE;
        ctx.beginPath(); ctx.ellipse(67.6, -56.6, 3.7, 3.1, -0.3, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath(); ctx.ellipse(66.6, -58.2, 1.2, 0.7, -0.4, 0, TAU); ctx.fill();
        // mouth
        ctx.strokeStyle = '#3a3532'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(66, -53); ctx.quadraticCurveTo(64, -49.5, 58.5, -50.5); ctx.stroke();
        // whisker dots
        ctx.fillStyle = '#8a847b';
        ctx.beginPath(); ctx.arc(60, -54, 0.6, 0, TAU); ctx.arc(62.5, -53, 0.6, 0, TAU); ctx.arc(60.5, -51.8, 0.6, 0, TAU); ctx.fill();
        // eye
        var ex = 54, ey = -63;
        if (pose === 'dead') {
          ctx.strokeStyle = WHITE; ctx.lineWidth = 1.8;
          ctx.beginPath(); ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3); ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3); ctx.stroke();
          ctx.fillStyle = '#e27b8c';
          ctx.beginPath(); ctx.ellipse(61.5, -46.5, 2.3, 4.2, 0.25, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#c75d70'; ctx.lineWidth = 0.8;
          ctx.beginPath(); ctx.moveTo(61.8, -49); ctx.lineTo(62.3, -44); ctx.stroke();
        } else {
          var blink = (time % 3.7) < 0.11;
          if (blink) {
            ctx.strokeStyle = '#2a2622'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(ex - 2.5, ey + 0.5); ctx.quadraticCurveTo(ex, ey + 1.6, ex + 2.5, ey + 0.3); ctx.stroke();
          } else {
            ctx.fillStyle = '#2d2824';
            ctx.beginPath(); ctx.ellipse(ex, ey, 3.3, 3, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = '#040404';
            ctx.beginPath(); ctx.ellipse(ex + 0.2, ey, 2.6, 2.5, 0, 0, TAU); ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath(); ctx.arc(ex + 0.9, ey - 1.1, 1.15, 0, TAU); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.beginPath(); ctx.arc(ex - 0.9, ey + 1.2, 0.55, 0, TAU); ctx.fill();
          }
        }
      }

      // ---- pose setup ----
      var HIP_N = [-26, -53], HIP_F = [-32, -55], SH_N = [36, -56], SH_F = [30, -58];
      function poseParams(pose, t) {
        var P = { rot: 0, dx: 0, dy: 0, px: 0, py: -55, legs: [], ears: { near: [45, -82, 6.2, 0.28], far: [36.5, -84, 5.3, 0.0] } };
        if (pose === 'run') {
          P.dy = Math.sin(t * TAU * 2) * 1.2;
          P.rot = Math.sin(t * TAU * 2 + 1) * 0.015;
          P.tail = [-40, -70, -58, -92, -82, -80, -70, -50];
          P.legs = [
            { kind: 'front', hip: SH_F, foot: gaitFoot(t + 0.5, 28, 30, 12), far: true },
            { kind: 'hind', hip: HIP_F, foot: gaitFoot(t, -28, 34, 10), far: true },
            { kind: 'hind', hip: HIP_N, foot: gaitFoot(t + 0.5, -26, 34, 10) },
            { kind: 'front', hip: SH_N, foot: gaitFoot(t, 30, 30, 13) }
          ];
        } else if (pose === 'jump') {
          P.rot = -0.16; P.dy = -2;
          P.tail = [-40, -70, -54, -98, -78, -94, -72, -68];
          P.ears = { near: [41, -84, 6.5, 0.95], far: [33, -85, 5.5, 0.8] };
          P.legs = [
            { kind: 'front', hip: SH_F, joint: [20, -38], foot: [31, -32], far: true },
            { kind: 'hind', hip: HIP_F, foot: [-66, -30], far: true },
            { kind: 'hind', hip: HIP_N, foot: [-62, -22] },
            { kind: 'front', hip: SH_N, joint: [25, -34], foot: [38, -29] }
          ];
        } else if (pose === 'fall') {
          P.rot = 0.13; P.dy = -1;
          P.tail = [-40, -70, -58, -92, -82, -82, -70, -56];
          P.ears = { near: [44, -83, 6.5, 0.5], far: [35.5, -84.5, 5.5, 0.35] };
          P.legs = [
            { kind: 'front', hip: SH_F, foot: [44, -18], far: true },
            { kind: 'hind', hip: HIP_F, foot: [-16, -20], far: true },
            { kind: 'hind', hip: HIP_N, foot: [-6, -15] },
            { kind: 'front', hip: SH_N, foot: [53, -13] }
          ];
        } else { // dead: flopped flat, limbs sprawled on the ground
          P.rot = 0.08; P.dy = 20;
          P.tail = [-40, -70, -60, -74, -80, -60, -82, -44];
          P.ears = { near: [44, -82, 6.5, 0.75], far: [35, -84, 5.5, -0.55] };
          P.legs = [
            { kind: 'front', hip: SH_F, joint: [44, -44], foot: [58, -36], far: true },
            { kind: 'hind', hip: HIP_F, joint: [-50, -44], foot: [-66, -36], far: true },
            { kind: 'hind', hip: HIP_N, joint: [-46, -36], foot: [-62, -32] },
            { kind: 'front', hip: SH_N, joint: [48, -38], foot: [62, -33] }
          ];
        }
        return P;
      }

      function draw(ctx, state) {
        ctx.save();
        try {
          ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.shadowColor = 'rgba(0,0,0,0)';
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          if (ctx.setLineDash) ctx.setLineDash([]);
          var rng = mulberry32(20240613);
          var B = new Batch();
          var pose = (state && state.pose) || 'run';
          var t = (state && typeof state.t === 'number') ? state.t : 0;
          var time = (state && typeof state.time === 'number') ? state.time : 0;
          var P = poseParams(pose, t);

          ctx.translate(P.dx, P.dy);
          ctx.translate(P.px, P.py); ctx.rotate(P.rot); ctx.translate(-P.px, -P.py);

          // 1. tail (behind everything)
          drawTail(ctx, B, rng, P.tail);
          // 2. far legs + far ear
          drawLeg(ctx, B, rng, P.legs[0]);
          drawLeg(ctx, B, rng, P.legs[1]);
          drawEar(ctx, P.ears.far[0], P.ears.far[1], P.ears.far[2], P.ears.far[3]);
          // 3. body: base fill + soft shading + fur
          ctx.fillStyle = '#8b847b'; bodyPath(ctx); ctx.fill();
          ctx.save(); bodyPath(ctx); ctx.clip();
          var g = ctx.createRadialGradient(-6, -104, 4, -6, -104, 70);
          g.addColorStop(0, 'rgba(48,44,41,0.95)'); g.addColorStop(0.55, 'rgba(70,65,60,0.55)'); g.addColorStop(1, 'rgba(90,84,78,0)');
          ctx.fillStyle = g; ctx.fillRect(-60, -110, 130, 90);
          g = ctx.createRadialGradient(2, -26, 2, 2, -26, 42);
          g.addColorStop(0, 'rgba(200,195,187,0.9)'); g.addColorStop(0.5, 'rgba(180,174,166,0.5)'); g.addColorStop(1, 'rgba(160,153,145,0)');
          ctx.fillStyle = g; ctx.fillRect(-60, -110, 130, 90);
          g = ctx.createRadialGradient(48, -44, 1, 48, -44, 22);
          g.addColorStop(0, 'rgba(214,210,203,0.9)'); g.addColorStop(1, 'rgba(200,195,187,0)');
          ctx.fillStyle = g; ctx.fillRect(20, -70, 60, 40);
          ctx.fillStyle = 'rgba(128,121,113,0.5)'; ctx.beginPath(); ctx.ellipse(52, -70, 14, 12, 0.4, 0, TAU); ctx.fill();
          ctx.restore();
          // interior fur (flow: from head toward tail and down)
          furRegion(B, rng, -14, -62, 33, 31, 0, 330, -0.85, 0.5, 0.5, 2.5, 5.5);
          furRegion(B, rng, 18, -60, 27, 27, 0, 220, -0.8, 0.55, 0.5, 2.5, 5.5);
          furRegion(B, rng, 50, -68, 16, 14, 0.35, 70, -0.3, 0.45, 0.9, 1.5, 3.5);
          edgeFluff(B, rng, 260, 2.5, 2.5, 5.5, -0.5, 0.4);
          B.flush(ctx);
          // 4. near legs
          drawLeg(ctx, B, rng, P.legs[2]);
          drawLeg(ctx, B, rng, P.legs[3]);
          // 5. face + near ear
          drawEar(ctx, P.ears.near[0], P.ears.near[1], P.ears.near[2], P.ears.near[3]);
          drawFace(ctx, B, rng, pose, time);
        } catch (e) {
          // never throw into the game loop
        } finally {
          ctx.restore();
        }
      }

      host.JimothySprite = {
        bounds: { left: -47, right: 70, top: -96 },
        draw: draw
      };
    })();
    return host.JimothySprite;
  })();

  /** Pre-renders a sprite into offscreen canvases so each frame is one drawImage. */
  class SpriteSheet {
    constructor(sprite, { runFrames = 12, scale = 3 } = {}) {
      this.sprite = sprite;
      this.scale = scale;
      this.runFrames = runFrames;
      // Generous box in sprite coordinates; covers everything the contract allows.
      this.box = { x: -100, y: -118, w: 180, h: 124 };
      this.frames = { run: [], jump: null, fall: null, dead: null };
      this.ok = false;
      try {
        this.build();
        this.ok = true;
      } catch (_) {
        this.ok = false;
      }
    }

    renderFrame(state) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(this.box.w * this.scale);
      c.height = Math.ceil(this.box.h * this.scale);
      const ctx = c.getContext('2d');
      ctx.setTransform(this.scale, 0, 0, this.scale, -this.box.x * this.scale, -this.box.y * this.scale);
      this.sprite.draw(ctx, state);
      return c;
    }

    build() {
      for (let i = 0; i < this.runFrames; i++) {
        this.frames.run.push(this.renderFrame({ pose: 'run', t: i / this.runFrames, time: 0 }));
      }
      this.frames.jump = this.renderFrame({ pose: 'jump', t: 0, time: 0 });
      this.frames.fall = this.renderFrame({ pose: 'fall', t: 0, time: 0 });
      this.frames.dead = this.renderFrame({ pose: 'dead', t: 0, time: 0 });
    }

    frame(pose, t) {
      if (pose === 'run') {
        const i = Math.floor((((t % 1) + 1) % 1) * this.runFrames) % this.runFrames;
        return this.frames.run[i];
      }
      return this.frames[pose] || this.frames.run[0];
    }

    /** Draws a frame with the sprite origin at the current transform origin. */
    draw(ctx, pose, t) {
      ctx.drawImage(this.frame(pose, t), this.box.x, this.box.y, this.box.w, this.box.h);
    }
  }

  /* ========================================================================
     4. ENTITIES
     ====================================================================== */

  class Player {
    constructor() {
      this.homeX = CONFIG.PLAYER_X;
      this.sheet = null;
      this.spriteScale = CONFIG.SPRITE_SCALE;
      this.spriteOffX = 0;
      if (JimothySprite && JimothySprite.bounds) {
        const sheet = new SpriteSheet(JimothySprite);
        if (sheet.ok) {
          const b = JimothySprite.bounds;
          const S = this.spriteScale;
          this.sheet = sheet;
          this.w = (b.right - b.left) * S;
          this.h = -b.top * S;
          // Body box centre may not sit at the sprite origin; shift so it does.
          this.spriteOffX = -((b.left + b.right) / 2) * S;
        }
      }
      if (!this.sheet) {
        this.w = 64;
        this.h = 54;
      }
      this.reset();
    }

    reset() {
      // The death knockback pushes Jimothy off screen, so x must come back too.
      this.x = this.homeX;
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
      if (this.sheet) {
        // The fluffy coat and head poke past this box on purpose: a brush
        // with fur should never count as a hit.
        return { x: this.x + this.w * 0.19, y: this.y + this.h * 0.14, w: this.w * 0.62, h: this.h * 0.86 };
      }
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

      if (this.sheet) {
        const pose = this.dead ? 'dead' : airborne ? (this.vy < 0 ? 'jump' : 'fall') : 'run';
        const phase = (this.runPhase / (Math.PI * 2)) % 1;
        ctx.save();
        ctx.translate(cx + this.spriteOffX, feet - hop);
        if (this.dead) ctx.rotate(this.deadRot);
        else if (this.flipping) ctx.rotate(this.flipAngle);
        else ctx.rotate(lean);
        const S = this.spriteScale;
        ctx.scale(S * (2 - this.squash), S * this.squash);
        this.sheet.draw(ctx, pose, phase);
        ctx.restore();
        return;
      }

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
      this.announced = false;
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
      ctx.font = `bold 13px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('JIM ♥', w / 2, 46);
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
      ctx.font = `bold 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('ANIMAL', 46 + (w - 46) / 2, 21);
      ctx.fillText('CONTROL', 46 + (w - 46) / 2, 34);
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

    hearts(x, y, count) {
      for (let i = 0; i < count; i++) {
        this.spawn({
          x: x + rand(-10, 10), y: y + rand(-6, 6),
          vx: rand(-30, 30), vy: rand(-120, -70),
          life: 0.9, maxLife: 0.9,
          size: 10 + Math.random() * 6,
          color: i % 2 ? ART.heart : ART.bulbPink,
          gravity: -30,
          square: false,
          shape: 'heart',
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
        if (p.shape === 'heart') {
          const r = s / 2;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y + r);
          ctx.bezierCurveTo(p.x - r * 1.6, p.y - r * 0.4, p.x - r * 0.7, p.y - r * 1.5, p.x, p.y - r * 0.6);
          ctx.bezierCurveTo(p.x + r * 0.7, p.y - r * 1.5, p.x + r * 1.6, p.y - r * 0.4, p.x, p.y + r);
          ctx.fill();
        } else if (p.square) {
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
      ctx.font = `bold 20px ${FONT}`;
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
      this.nextObstacleX = this.game.view.w + 500;
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
      const spawnEdge = g.distance + g.view.w + 200;
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
          const approachTime = (g.view.w + 200) / (speed + def.speed);
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
      // Camera: the visible logical rect is x in [0, w], y in [top, HEIGHT]. Bottom-anchored.
      this.view = { w: CONFIG.WIDTH, h: CONFIG.HEIGHT, top: 0, scale: 1, dpr: 1 };

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
        btnFull: document.getElementById('btn-fullscreen'),
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

    /**
     * Fit the camera to whatever shape the stage has. The 540px-tall play
     * strip is always fully visible and anchored to the bottom; wide screens
     * see more road ahead, tall (portrait) screens see more sky above.
     */
    resize() {
      const rect = this.stage.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      const bw = Math.round(rect.width * dpr);
      const bh = Math.round(rect.height * dpr);
      if (this.canvas.width !== bw || this.canvas.height !== bh) {
        this.canvas.width = bw;
        this.canvas.height = bh;
      }
      // CSS px per logical px: as large as possible while showing the full
      // strip height and at least MIN_VIEW_W of road.
      let scale = Math.min(rect.height / CONFIG.HEIGHT, rect.width / CONFIG.MIN_VIEW_W);
      if (rect.width / scale > CONFIG.MAX_VIEW_W) scale = rect.width / CONFIG.MAX_VIEW_W;
      const v = this.view;
      v.scale = scale;
      v.dpr = dpr;
      v.w = rect.width / scale;
      v.h = rect.height / scale;
      v.top = CONFIG.HEIGHT - v.h;
      // On narrow screens Jimothy stands further left so obstacles are seen earlier.
      const p = this.player;
      p.homeX = v.w < 720 ? CONFIG.PLAYER_X_NARROW : CONFIG.PLAYER_X;
      if (!p.dead) p.x = p.homeX;
      this.buildVignette();
    }

    /** The soft edge darkening is rendered once per resize instead of every frame. */
    buildVignette() {
      const v = this.view;
      const c = this.vignette || document.createElement('canvas');
      const w = Math.max(1, Math.round(v.w / 2));
      const h = Math.max(1, Math.round(v.h / 2));
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const rad = Math.max(w, h);
      const grad = g.createRadialGradient(w / 2, h / 2, rad * 0.35, w / 2, h / 2, rad * 0.8);
      grad.addColorStop(0, 'rgba(40, 20, 50, 0)');
      grad.addColorStop(1, 'rgba(40, 20, 50, 0.4)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      this.vignette = c;
    }

    /* ----- Fullscreen ----- */

    get fullscreenSupported() {
      const el = this.stage;
      return !!(el.requestFullscreen || el.webkitRequestFullscreen) && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
    }

    get isFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement);
    }

    toggleFullscreen() {
      if (!this.fullscreenSupported) return;
      try {
        if (this.isFullscreen) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          const r = exit.call(document);
          if (r && r.catch) r.catch(() => {});
        } else {
          const req = this.stage.requestFullscreen || this.stage.webkitRequestFullscreen;
          const r = req.call(this.stage, { navigationUI: 'hide' });
          if (r && r.catch) r.catch(() => {});
        }
      } catch (_) {
        /* unsupported or denied: nothing to do */
      }
    }

    updateFullscreenButton() {
      const b = this.dom.btnFull;
      if (!b) return;
      b.hidden = !this.fullscreenSupported;
      const on = this.isFullscreen;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = on ? 'Exit fullscreen (F)' : 'Fullscreen (F)';
      this.stage.classList.toggle('is-fullscreen', on);
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
          case 'KeyF':
            this.toggleFullscreen();
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

      if (this.dom.btnFull) {
        this.dom.btnFull.addEventListener('pointerdown', (e) => e.stopPropagation());
        this.dom.btnFull.addEventListener('click', (e) => {
          e.stopPropagation();
          this.toggleFullscreen();
        });
      }
      const onFullscreenChange = () => {
        this.updateFullscreenButton();
        this.resize();
      };
      document.addEventListener('fullscreenchange', onFullscreenChange);
      document.addEventListener('webkitfullscreenchange', onFullscreenChange);
      this.updateFullscreenButton();

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
      this.dom.btnMute.textContent = muted ? '🔇' : '🔊';
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
        kicker: 'Taking a breather',
        title: 'Paused',
        sub: 'Jimothy is catching his breath behind a Ballard dumpster.',
        button: 'Resume',
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
        kicker: '♥ Team Jimothy ♥',
        title: 'Ready, Jimothy?',
        sub: "Ballard's roundest raccoon is hungry. The streets are not safe. Let's eat anyway.",
        button: 'Start',
        stats: false,
      });
    }

    showGameOverOverlay() {
      const quips = [
        'Ballard wins this round. Ballard will not gloat.',
        'Jimothy will be back. Jimothy is always back.',
        'That pizza was worth it. Probably.',
        'Animal Control: 1. Jimothy: still the most Seattle animal possible.',
        'A neighbor already left out a snack for next time.',
        'Somebody is already posting this to r/JimothyTheRaccoon.',
        'Bonked. Nobody saw. Nobody but you.',
        'He is fine. He is a little embarrassed. He is fine.',
      ];
      this.showOverlay({
        kicker: this.isNewRecord ? '♥ New record ♥' : 'Oh no',
        title: this.isNewRecord ? 'New record!' : 'Bonked!',
        sub: pick(quips),
        button: 'Run again',
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
      this.background.updateRain(dt, scroll, this.view);
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
        if (!o.announced && o.screenX(this.distance) < this.view.w + 20) {
          o.announced = true;
          this.announceObstacle(o);
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

    /** Sound cue the moment a cat or the Animal Control truck enters the screen. */
    announceObstacle(o) {
      if (o.type === 'CAT') {
        this.audio.meow(0.7);
      } else if (o.type === 'TRUCK') {
        // Long enough for the truck to drive right across the screen
        const crossing = (this.view.w + o.w) / (this.speed + o.ownSpeed);
        this.audio.siren(crossing, 0.9, -0.6);
      }
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
      this.particles.burst(cx, cy, 12, colors, 200, 0.55, 300);
      this.particles.hearts(cx, cy - 6, 3);
      this.texts.add(cx, cy - 14, `+${CONFIG.ITEM_POINTS}`, '#fff6e8');
    }

    /* ----- Render ----- */

    render() {
      const ctx = this.ctx;
      const v = this.view;
      const k = v.scale * v.dpr;
      ctx.setTransform(k, 0, 0, k, 0, -v.top * k);

      this.background.drawSky(ctx, this.time, this.distance, v);
      this.background.drawLayers(ctx, this.distance, v);
      this.background.drawGround(ctx, this.distance, v);

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
      this.background.drawRain(ctx, v);

      // Soft vignette, warm rather than black (pre-rendered on resize)
      if (this.vignette) ctx.drawImage(this.vignette, 0, v.top, v.w, v.h);

      if (this.state === STATE.PLAYING || this.state === STATE.PAUSED) this.drawRunInfo(ctx);
    }

    drawRunInfo(ctx) {
      const meters = Math.floor(this.distance / CONFIG.PX_PER_METER);
      const mult = (this.speed / CONFIG.BASE_SPEED).toFixed(1);
      const top = this.view.top;
      ctx.font = `600 15px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(255, 246, 232, 0.8)';
      ctx.fillText(`${meters} m`, 16, top + 90);
      ctx.fillStyle = 'rgba(255, 210, 122, 0.85)';
      ctx.fillText(`speed x${mult}`, 16, top + 110);
      if (this.player.jumpsLeft === 1 && !this.player.onGround) {
        ctx.fillStyle = 'rgba(255, 179, 193, 0.9)';
        ctx.fillText('double jump ready ♥', 16, top + 130);
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
