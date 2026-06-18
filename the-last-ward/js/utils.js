/* ===== utils.js — shared helpers & small procedural texture factory ===== */
(function (global) {
  'use strict';

  const Utils = {};

  Utils.lerp = (a, b, t) => a + (b - a) * t;
  Utils.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  Utils.smoothstep = (e0, e1, x) => {
    const t = Utils.clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  Utils.rand = (a, b) => a + Math.random() * (b - a);
  Utils.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  Utils.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  Utils.dist2 = (ax, ay, az, bx, by, bz) => {
    const dx = ax - bx, dy = ay - by, dz = az - bz;
    return dx * dx + dy * dy + dz * dz;
  };
  Utils.dist = (ax, ay, az, bx, by, bz) => Math.sqrt(Utils.dist2(ax, ay, az, bx, by, bz));
  // signed approach speed-independent: returns -1..1 damp factor
  Utils.damp = (a, b, lambda, dt) => Utils.lerp(a, b, 1 - Math.exp(-lambda * dt));

  /* ---- Tiny seeded RNG (mulberry32) ---- */
  Utils.makeRng = (seed) => {
    let s = seed >>> 0;
    return () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---- Procedural canvas textures (so we ship zero image assets) ---- */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // Grungy wall: base color + noise + streaks + grime
  Utils.wallTexture = (baseHex, opts = {}) => {
    const w = opts.w || 256, h = opts.h || 256;
    const c = makeCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = baseHex; x.fillRect(0, 0, w, h);
    const rng = Utils.makeRng(opts.seed || 1234);
    // fine noise
    const img = x.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * (opts.noise || 26);
      d[i] = Utils.clamp(d[i] + n, 0, 255);
      d[i + 1] = Utils.clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = Utils.clamp(d[i + 2] + n, 0, 255);
    }
    x.putImageData(img, 0, 0);
    // grime streaks
    x.globalAlpha = 0.18;
    for (let i = 0; i < (opts.streaks || 18); i++) {
      x.strokeStyle = rng() > 0.5 ? '#1a1612' : '#2a2620';
      x.lineWidth = 1 + rng() * 3;
      const sx = rng() * w;
      x.beginPath();
      x.moveTo(sx, 0);
      x.lineTo(sx + (rng() - 0.5) * 30, h);
      x.stroke();
    }
    // blood / rust blotches
    x.globalAlpha = 0.22;
    for (let i = 0; i < (opts.blots || 6); i++) {
      x.fillStyle = opts.blotColor || '#3a0c0c';
      const bx = rng() * w, by = rng() * h, r = 6 + rng() * 28;
      x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  };

  // Floor tile texture (cracked linoleum)
  Utils.floorTexture = (baseHex, opts = {}) => {
    const w = opts.w || 256, h = opts.h || 256;
    const c = makeCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = baseHex; x.fillRect(0, 0, w, h);
    const rng = Utils.makeRng(opts.seed || 7);
    // tile grid
    const ts = opts.tile || 64;
    x.strokeStyle = 'rgba(0,0,0,0.45)'; x.lineWidth = 2;
    for (let i = 0; i <= w; i += ts) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); }
    for (let j = 0; j <= h; j += ts) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
    // grime per tile
    const img = x.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * 30;
      d[i] = Utils.clamp(d[i] + n, 0, 255);
      d[i + 1] = Utils.clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = Utils.clamp(d[i + 2] + n, 0, 255);
    }
    x.putImageData(img, 0, 0);
    // dark scuff streaks
    x.globalAlpha = 0.15;
    for (let i = 0; i < 30; i++) {
      x.strokeStyle = '#0a0a08'; x.lineWidth = 1 + rng() * 2;
      x.beginPath();
      x.moveTo(rng() * w, rng() * h);
      x.lineTo(rng() * w, rng() * h);
      x.stroke();
    }
    // cracks
    x.globalAlpha = 0.4; x.strokeStyle = '#000';
    for (let i = 0; i < (opts.cracks || 8); i++) {
      x.lineWidth = 0.6 + rng() * 1.2;
      let px = rng() * w, py = rng() * h;
      x.beginPath(); x.moveTo(px, py);
      const segs = 3 + (rng() * 4) | 0;
      for (let s = 0; s < segs; s++) { px += (rng() - 0.5) * 50; py += (rng() - 0.5) * 50; x.lineTo(px, py); }
      x.stroke();
    }
    x.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return tex;
  };

  // Ceiling texture (stained panels)
  Utils.ceilTexture = (baseHex, opts = {}) => {
    const w = opts.w || 256, h = opts.h || 256;
    const c = makeCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = baseHex; x.fillRect(0, 0, w, h);
    const rng = Utils.makeRng(opts.seed || 99);
    const img = x.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rng() - 0.5) * 18;
      d[i] = Utils.clamp(d[i] + n, 0, 255);
      d[i + 1] = Utils.clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = Utils.clamp(d[i + 2] + n, 0, 255);
    }
    x.putImageData(img, 0, 0);
    // water stains
    x.globalAlpha = 0.2;
    for (let i = 0; i < (opts.stains || 8); i++) {
      x.fillStyle = rng() > 0.5 ? '#3a2a14' : '#2a2418';
      const bx = rng() * w, by = rng() * h, r = 14 + rng() * 40;
      x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
  };

  // A simple decal-like label texture for room numbers / signs
  Utils.signTexture = (text, fg = '#c8d0d0', bg = 'rgba(20,24,26,0.9)') => {
    const c = makeCanvas(256, 128), x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 256, 128);
    x.fillStyle = fg;
    x.font = 'bold 64px "Courier New", monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(text, 128, 70);
    // rust border
    x.strokeStyle = '#5a3a1a'; x.lineWidth = 4; x.strokeRect(8, 8, 240, 112);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  };

  // blood smear decal (transparent texture)
  Utils.bloodTexture = (seed = 1) => {
    const c = makeCanvas(128, 128), x = c.getContext('2d');
    const rng = Utils.makeRng(seed);
    x.clearRect(0, 0, 128, 128);
    x.fillStyle = '#3a0606';
    for (let i = 0; i < 5; i++) {
      const bx = 64 + (rng() - 0.5) * 60, by = 30 + rng() * 40, r = 12 + rng() * 22;
      x.globalAlpha = 0.5 + rng() * 0.4;
      x.beginPath(); x.arc(bx, by, r, 0, Math.PI * 2); x.fill();
    }
    // drip
    x.globalAlpha = 0.6; x.strokeStyle = '#2a0404'; x.lineWidth = 4 + rng() * 4;
    x.beginPath(); x.moveTo(64, 50); x.lineTo(62 + (rng() - 0.5) * 8, 120); x.stroke();
    x.globalAlpha = 1;
    const tex = new THREE.CanvasTexture(c);
    return tex;
  };

  global.Utils = Utils;
})(window);
