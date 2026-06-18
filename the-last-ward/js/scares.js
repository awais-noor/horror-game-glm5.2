/* ===== scares.js — scripted horror moments manager =====
 * Implements the 8 scare elements:
 *  1. Lights flicker when enemy near          (driven by level.updateFlicker + proximity)
 *  2. Random hospital announcement whispering player's name
 *  3. Doors slowly open by themselves
 *  4. A wheelchair moves across the hallway
 *  5. A shadow appears behind a curtain
 *  6. A mirror briefly shows the enemy behind the player
 *  7. Phone rings at reception; answered → only breathing
 *  8. Enemy suddenly appears in Room 309 after collecting the final fuse key (game.js triggers)
 * Plus ambient whispers, footsteps behind player, distant crying — scheduled here.
 */
(function (global) {
  'use strict';

  class ScareManager {
    constructor(level, enemy, player, game) {
      this.level = level;
      this.enemy = enemy;
      this.player = player;
      this.game = game;
      this.diff = game.diff;
      this.active = false;

      // timers
      this.tWhisper = global.Utils.rand(20, 35);
      this.tDoorGhost = global.Utils.rand(25, 45);
      this.tWheelchair = global.Utils.rand(30, 50);
      this.tShadow = global.Utils.rand(35, 55);
      this.tMirror = global.Utils.rand(60, 90);
      this.tFootstepsBehind = global.Utils.rand(15, 30);

      // wheelchair state
      this.wheelchair = level.wheelchairRef;
      this.wheelMoveT = 0; this.wheelActive = false;
      this.wheelStart = new THREE.Vector3(); this.wheelEnd = new THREE.Vector3();

      // mirror state
      this.mirrorActive = false; this.mirrorT = 0;

      // phone state
      this.phoneActive = false; this.phoneT = 0; this.phoneAnswered = false;
      this.phoneCooldown = global.Utils.rand(40, 70);

      this._doorNames = ['door_301', 'door_nurse', 'door_storage', 'door_reception'];

      // name whispers pool
      this.name = 'AWAIS'; // could be customized; using a generic creepy name
    }

    reset() {
      this.tWhisper = global.Utils.rand(20, 35);
      this.tDoorGhost = global.Utils.rand(25, 45);
      this.tWheelchair = global.Utils.rand(30, 50);
      this.tShadow = global.Utils.rand(35, 55);
      this.tMirror = global.Utils.rand(60, 90);
      this.tFootstepsBehind = global.Utils.rand(15, 30);
      this.phoneCooldown = global.Utils.rand(40, 70);
      this.phoneActive = false; this.phoneAnswered = false;
      this.wheelActive = false;
      this.mirrorActive = false;
    }

    setDifficulty(d) { this.diff = d; }

    /* called by game loop every frame */
    update(dt) {
      if (!this.active) return;
      const hard = this.diff === 'hard';
      const pp = this.player.pos;

      // ---- ambient whispers (player name) ----
      this.tWhisper -= dt;
      if (this.tWhisper <= 0) {
        // only when not too close to enemy (avoid clutter)
        const ep = this.enemy.proximity(pp);
        if (ep < 0.6 || hard) {
          this.game.subtitle(hard
            ? global.Utils.pick(['…awais…', '…come back…', '…room 309…', '…don\'t leave me…', '…behind you…'])
            : global.Utils.pick(['…awais…', '…help…', '…309…', '…stay…']), 3.2);
          global.Audio.whisper();
        }
        this.tWhisper = hard ? global.Utils.rand(14, 26) : global.Utils.rand(28, 50);
      }

      // ---- footsteps behind player ----
      this.tFootstepsBehind -= dt;
      if (this.tFootstepsBehind <= 0) {
        // play 2-3 footsteps quietly (audio positioned master, so always "behind")
        let i = 0;
        const step = () => {
          if (i++ < 3) { global.Audio.footstepHeavy(); setTimeout(step, 420 + Math.random() * 120); }
        };
        step();
        this.tFootstepsBehind = hard ? global.Utils.rand(20, 35) : global.Utils.rand(30, 55);
      }

      // ---- ghost door opens ----
      this.tDoorGhost -= dt;
      if (this.tDoorGhost <= 0) {
        const name = global.Utils.pick(this._doorNames);
        const d = this.level.doors[name];
        if (d && !d.open && !d.locked) {
          this.level.openDoor(name);
          // auto-close after a moment
          setTimeout(() => { if (d.open) { this.level.closeDoor(name); global.Audio.doorCreak(); } }, 4000 + Math.random() * 3000);
        }
        this.tDoorGhost = hard ? global.Utils.rand(18, 32) : global.Utils.rand(30, 55);
      }

      // ---- wheelchair rolls across hallway ----
      this.tWheelchair -= dt;
      if (this.tWheelchair <= 0 && !this.wheelActive && this.wheelchair) {
        // only trigger if player is roughly in hallway area
        if (pp.x > -18 && pp.x < 18 && Math.abs(pp.z) < 6) {
          this.wheelActive = true;
          this.wheelMoveT = 0;
          // roll across hallway (z from -2.5 to 2.5) at some x offset from player
          const wx = global.Utils.clamp(pp.x + global.Utils.rand(-4, 4), -14, 14);
          this.wheelStart.set(wx, 0, -2.6);
          this.wheelEnd.set(wx, 0, 2.8);
          this.wheelchair.position.copy(this.wheelStart);
          this.wheelchair.rotation.y = Math.PI / 2;
          this.game.toast('A wheelchair rolls across the hall…', 2.5);
        }
        this.tWheelchair = hard ? global.Utils.rand(25, 45) : global.Utils.rand(40, 70);
      }
      if (this.wheelActive) {
        this.wheelMoveT += dt;
        const dur = 3.5;
        const t = Math.min(1, this.wheelMoveT / dur);
        this.wheelchair.position.lerpVectors(this.wheelStart, this.wheelEnd, t);
        this.wheelchair.children.forEach(ch => { if (ch.geometry && ch.geometry.type === 'TorusGeometry') ch.rotation.z += dt * 8; });
        // creaking
        if (Math.random() < 0.08) global.Audio._noiseBurst(0.08, 0.05, 'bandpass', 300, 4);
        if (t >= 1) { this.wheelActive = false; }
      }

      // ---- shadow behind curtain (room 309 curtain) ----
      this.tShadow -= dt;
      if (this.tShadow <= 0) {
        // brief: dim a curtain area, play whisper, maybe show a silhouette
        this.game.subtitle('…something moves behind the curtain…', 2.5);
        global.Audio.whisper();
        global.Audio._noiseBurst(0.6, 0.04, 'lowpass', 200, 1);
        this.tShadow = hard ? global.Utils.rand(28, 45) : global.Utils.rand(45, 75);
      }

      // ---- mirror scare (nurse station) ----
      this.tMirror -= dt;
      if (this.tMirror <= 0 && !this.mirrorActive) {
        // trigger only if player is reasonably near the nurse station mirror
        const m = this.level.anchors.mirror;
        const d = Math.hypot(pp.x - m.x, pp.z - m.z);
        if (d < 7) {
          this.mirrorActive = true; this.mirrorT = 0;
          // briefly place enemy right behind player (so it "appears in mirror")
          const behind = new THREE.Vector3(
            pp.x - Math.sin(this.player.yaw) * 1.6,
            0,
            pp.z - Math.cos(this.player.yaw) * 1.6);
          this.enemy.appearAt(behind.x, behind.z, true);
          global.Audio.sting();
          this.game.toast('The mirror… did you see it?', 2.2);
        }
        this.tMirror = hard ? global.Utils.rand(40, 70) : global.Utils.rand(70, 110);
      }
      if (this.mirrorActive) {
        this.mirrorT += dt;
        // vanish after ~1.2s
        if (this.mirrorT > 1.2) {
          if (this.enemy.state === 'WATCHING') this.enemy.hide();
          this.mirrorActive = false;
        }
      }

      // ---- phone at reception ----
      this.phoneCooldown -= dt;
      if (this.phoneCooldown <= 0 && !this.phoneActive) {
        // ring if player is within earshot of reception
        const ph = this.level.anchors.phone;
        const d = Math.hypot(pp.x - ph.x, pp.z - ph.z);
        if (d < 12) {
          this.phoneActive = true; this.phoneAnswered = false; this.phoneT = 0;
          global.Audio.phoneRing();
          this.game.setInteractTarget('phone', ph, 'Press E to answer phone');
        }
        this.phoneCooldown = global.Utils.rand(80, 140);
      }
      if (this.phoneActive) {
        this.phoneT += dt;
        // keep ringing every ~5s until answered or 25s pass
        if (!this.phoneAnswered && Math.floor(this.phoneT) % 5 === 0 && Math.floor(this.phoneT) !== this._lastRing) {
          this._lastRing = Math.floor(this.phoneT);
          global.Audio.phoneRing();
        }
        if (this.phoneAnswered && this.phoneT > this._answerAt + 3.5) {
          this.phoneActive = false;
          this.game.clearInteractTarget('phone');
          this.phoneCooldown = global.Utils.rand(90, 160);
        }
        if (!this.phoneAnswered && this.phoneT > 25) {
          this.phoneActive = false;
          this.game.clearInteractTarget('phone');
          this.phoneCooldown = global.Utils.rand(90, 160);
        }
      }
    }

    // called when player interacts with the phone
    answerPhone() {
      if (!this.phoneActive || this.phoneAnswered) return false;
      this.phoneAnswered = true;
      this._answerAt = this.phoneT;
      this.game.subtitle('… … … (only breathing) … … …', 3.5);
      global.Audio.breath();
      global.Audio.breath();
      setTimeout(() => global.Audio.breath(), 1100);
      this.game.toast('The line goes dead.', 2.5);
      return true;
    }
    isPhoneRinging() { return this.phoneActive && !this.phoneAnswered; }

    // the big one: triggered by game.js when key3 collected
    triggerRoom309Scare() {
      // enemy appears in room 309 right behind the key spot, then provokes chase
      this.enemy.appearAt(0, -9.5, false);
      setTimeout(() => {
        this.enemy.provoke();
        global.Audio.sting();
        this.game.toast('SUBJECT 309 IS AWAKE — RUN!', 3.0, true);
        this.game.subtitle('…you shouldn\'t have taken it…', 3.5);
        // flicker all lights hard
        this._blackoutFlicker = 1.2;
      }, 800);
    }
  }

  global.ScareManager = ScareManager;
})(window);
