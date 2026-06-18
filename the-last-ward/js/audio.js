/* ===== audio.js — fully synthesized horror sound via Web Audio API ===== */
/* No audio files. Everything is generated: drones, whispers, stings, beeps,
   footsteps, doors, heartbeat, phone, generator hum, breathing.            */
(function (global) {
  'use strict';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.musicGain = null;   // ambient bed
      this.sfxGain = null;     // one-shots
      this.enabled = false;
      this.started = false;
      this._ambientNodes = [];
      this._whisperTimer = 0;
      this._heartbeatOn = false;
      this._heartbeatTimer = 0;
      this._heartbeatBpm = 60;
      this._beepTimer = 0;
      this._cryingTimer = 0;
      this._genHum = null;
    }

    init() {
      if (this.started) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.master.connect(this.ctx.destination);

        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.0;
        this.musicGain.connect(this.master);

        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = 0.9;
        this.sfxGain.connect(this.master);

        this.started = true;
        this.enabled = true;
      } catch (e) {
        console.warn('Audio init failed', e);
      }
    }

    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

    /* ---------- ambient drone bed ---------- */
    startAmbient() {
      if (!this.ctx || this._ambientNodes.length) return;
      const ctx = this.ctx, now = ctx.currentTime;
      // low drone: two detuned oscillators + filtered noise
      const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 58.7;
      const o3 = ctx.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 110;
      const og = ctx.createGain(); og.gain.value = 0.0;
      o1.connect(og); o2.connect(og); o3.connect(og);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
      og.connect(lp); lp.connect(this.musicGain);

      // wind/noise bed
      const noise = this._noiseBuffer(3);
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 320; nf.Q.value = 0.6;
      const ng = ctx.createGain(); ng.gain.value = 0.04;
      src.connect(nf); nf.connect(ng); ng.connect(this.musicGain);

      o1.start(); o2.start(); o3.start(); src.start();
      og.gain.setValueAtTime(0.0, now);
      og.gain.linearRampToValueAtTime(0.16, now + 4);

      this._ambientNodes = [o1, o2, o3, src, og, lp, nf, ng];

      // fade music gain in
      this.musicGain.gain.setValueAtTime(0.0, now);
      this.musicGain.gain.linearRampToValueAtTime(0.7, now + 5);
    }

    stopAmbient() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, now);
      this.musicGain.gain.linearRampToValueAtTime(0.0, now + 1.5);
      const nodes = this._ambientNodes;
      setTimeout(() => { nodes.forEach(n => { try { n.stop && n.stop(); n.disconnect(); } catch (e) {} }); }, 1800);
      this._ambientNodes = [];
      this.stopHeartbeat();
      this.stopGeneratorHum();
    }

    _noiseBuffer(seconds) {
      const ctx = this.ctx;
      const len = ctx.sampleRate * seconds;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    /* ---------- one-shot SFX ---------- */
    // generic envelope tone
    _tone(freq, dur, type = 'sine', vol = 0.3, attack = 0.005, dest) {
      if (!this.ctx) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
      const g = ctx.createGain();
      o.connect(g); g.connect(dest || this.sfxGain);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(vol, now + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.start(now); o.stop(now + dur + 0.02);
    }

    // noise burst with envelope & filter
    _noiseBurst(dur, vol, filterType, freq, Q, dest) {
      if (!this.ctx) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(dur + 0.05);
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = Q || 1;
      const g = ctx.createGain();
      src.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
      g.gain.setValueAtTime(vol, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      src.start(now); src.stop(now + dur + 0.02);
    }

    footstep() {
      this._noiseBurst(0.08, 0.18, 'lowpass', 220 + Math.random() * 60, 1);
    }
    footstepHeavy() { this._noiseBurst(0.12, 0.28, 'lowpass', 140, 1); }

    doorCreak() {
      if (!this.ctx) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(120, now);
      o.frequency.exponentialRampToValueAtTime(260, now + 1.2);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0, now);
      g.gain.linearRampToValueAtTime(0.12, now + 0.1);
      g.gain.linearRampToValueAtTime(0.0, now + 1.3);
      o.connect(f); f.connect(g); g.connect(this.sfxGain);
      o.start(now); o.stop(now + 1.4);
    }

    doorSlam() {
      this._noiseBurst(0.18, 0.5, 'lowpass', 180, 1);
      this._tone(70, 0.3, 'sine', 0.4);
    }

    sting() {
      // sharp violin-ish dissonant stab
      if (!this.ctx) return;
      const ctx = this.ctx, now = ctx.currentTime;
      [880, 932, 1245, 1318].forEach((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const g = ctx.createGain();
        o.connect(g); g.connect(this.sfxGain);
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
        o.start(now); o.stop(now + 1.0);
      });
      // sub boom
      this._tone(42, 1.2, 'sine', 0.5);
      this._noiseBurst(0.3, 0.3, 'highpass', 2000, 0.5);
    }

    whisper() {
      // filtered noise shaped like a breathy whisper
      if (!this.ctx) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this._noiseBuffer(1.4);
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1200; f.Q.value = 5;
      const g = ctx.createGain();
      src.connect(f); f.connect(g); g.connect(this.sfxGain);
      // amplitude wobble to mimic syllables
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 7;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg); lg.connect(g.gain);
      g.gain.value = 0.08;
      g.gain.setValueAtTime(0.0, now);
      g.gain.linearRampToValueAtTime(0.12, now + 0.2);
      g.gain.linearRampToValueAtTime(0.0, now + 1.3);
      lfo.start(now); lfo.stop(now + 1.4);
      src.start(now); src.stop(now + 1.4);
    }

    breath() {
      // in-out breathing
      this._noiseBurst(0.5, 0.12, 'bandpass', 700, 3);
      setTimeout(() => this._noiseBurst(0.6, 0.10, 'bandpass', 500, 3), 550);
    }

    beep(medical = true) {
      const f = medical ? 880 : 660;
      this._tone(f, 0.06, 'square', 0.06);
    }

    phoneRing() {
      if (!this.ctx) return;
      const ring = () => {
        this._tone(1400, 0.18, 'sine', 0.12);
        setTimeout(() => this._tone(2060, 0.18, 'sine', 0.12), 220);
      };
      ring();
      setTimeout(ring, 600);
    }

    /* ---------- generator hum (toggle) ---------- */
    startGeneratorHum() {
      if (!this.ctx || this._genHum) return;
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 120;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 200;
      const g = ctx.createGain(); g.gain.value = 0.0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(this.musicGain);
      o.start(); o2.start();
      g.gain.linearRampToValueAtTime(0.10, ctx.currentTime + 2);
      this._genHum = { o, o2, g };
    }
    stopGeneratorHum() {
      if (!this._genHum) return;
      const { o, o2, g } = this._genHum; this._genHum = null;
      const now = this.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.linearRampToValueAtTime(0.0, now + 0.8);
      setTimeout(() => { try { o.stop(); o2.stop(); } catch (e) {} }, 1000);
    }

    powerUp() {
      // rising hum as power restores
      if (!this.ctx) return;
      const ctx = this.ctx, now = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(40, now);
      o.frequency.exponentialRampToValueAtTime(120, now + 2.5);
      const g = ctx.createGain(); g.gain.value = 0.0;
      g.gain.linearRampToValueAtTime(0.18, now + 2.5);
      g.gain.linearRampToValueAtTime(0.0, now + 3.2);
      o.connect(g); g.connect(this.sfxGain);
      o.start(now); o.stop(now + 3.3);
      // relay clunks
      setTimeout(() => this.doorSlam(), 2500);
    }

    /* ---------- heartbeat ---------- */
    startHeartbeat(bpm = 60) {
      this._heartbeatOn = true; this._heartbeatBpm = bpm; this._heartbeatTimer = 0;
    }
    stopHeartbeat() { this._heartbeatOn = false; }
    setHeartbeatBpm(b) { this._heartbeatBpm = b; }
    _heartBeat() {
      // thump-thump
      this._tone(60, 0.12, 'sine', 0.45);
      setTimeout(() => this._tone(48, 0.16, 'sine', 0.35), 160);
    }

    /* ---------- per-frame update (called by game loop) ---------- */
    update(dt, opts = {}) {
      if (!this.ctx || !this.enabled) return;
      // heartbeat
      if (this._heartbeatOn) {
        this._heartbeatTimer -= dt;
        if (this._heartbeatTimer <= 0) {
          this._heartBeat();
          this._heartbeatTimer = 60 / this._heartbeatBpm;
        }
      }
      // random distant beeps
      if (opts.beeps) {
        this._beepTimer -= dt;
        if (this._beepTimer <= 0) { this.beep(true); this._beepTimer = 4 + Math.random() * 9; }
      }
      // distant crying
      if (opts.crying) {
        this._cryingTimer -= dt;
        if (this._cryingTimer <= 0) {
          this._noiseBurst(1.2 + Math.random(), 0.05, 'bandpass', 500 + Math.random() * 300, 4);
          this._cryingTimer = 12 + Math.random() * 20;
        }
      }
    }

    // duck music briefly for a sting
    duck(amount = 0.3, time = 1.2) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const g = this.musicGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(amount, now + 0.05);
      g.linearRampToValueAtTime(0.7, now + time);
    }
  }

  global.Audio = new AudioEngine();
})(window);
