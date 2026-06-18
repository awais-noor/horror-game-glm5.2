/* ===== player.js — first-person controller, flashlight, collision, stamina, health ===== */
(function (global) {
  'use strict';

  class Player {
    constructor(camera, level, input, difficulty) {
      this.camera = camera;
      this.level = level;
      this.input = input;
      this.diff = difficulty; // 'easy' | 'hard'

      this.pos = level.playerStart.clone();
      this.yaw = 0; this.pitch = 0;
      this.vel = new THREE.Vector3();

      this.eyeHeight = 1.7;
      this.crouchHeight = 1.0;
      this.curEye = 1.7;

      this.radius = 0.32;
      this.walkSpeed = 2.6;
      this.sprintSpeed = 4.8;
      this.crouchSpeed = 1.3;

      this.stamina = 1.0;
      this.staminaDrain = 0.5;   // per sec sprinting
      this.staminaRegen = 0.35;
      this.sprinting = false;
      this.crouching = false;
      this.moving = false;

      // health (0..100). Weapon deals damage per hit; hard mode dies in 1 hit, easy in 2.
      this.maxHealth = 100;
      this.health = 100;
      this.maxHits = difficulty === 'hard' ? 1 : 2;   // # of hits to kill
      this.hits = 0;

      // flashlight
      this.flashOn = true;
      this.battery = 1.0;
      this.batteryDrain = difficulty === 'hard' ? 0.028 : 0.013; // per sec
      this.flashlight = null; // SpotLight
      this.flashTarget = new THREE.Object3D();
      this._setupFlashlight();

      // footstep timer
      this._stepT = 0;
      this._bobT = 0;
      this._hideStaminaFlash = 0;

      // damage cooldown
      this.invuln = 0;

      this._bound = false;
    }

    _setupFlashlight() {
      // attach flashlight + target to camera so they follow view
      const spot = new THREE.SpotLight(0xfff2d8, 2.6, 16, Math.PI / 7, 0.45, 1.2);
      spot.position.set(0, 0, 0.2);
      spot.castShadow = false; // perf — keep off; rely on strong cone + ambient
      this.camera.add(spot);
      this.camera.add(this.flashTarget);
      this.flashTarget.position.set(0, 0, -1);
      spot.target = this.flashTarget;
      this.flashlight = spot;

      // tiny glow bulb at camera (so near view isn't pure black)
      this.glow = new THREE.PointLight(0xffe8c0, 0.35, 3.5, 2);
      this.glow.position.set(0, 0, 0.2);
      this.camera.add(this.glow);
    }

    setDifficulty(d) {
      this.diff = d;
      this.maxHits = d === 'hard' ? 1 : 2;
      this.batteryDrain = d === 'hard' ? 0.028 : 0.013;
    }

    reset() {
      this.pos.copy(this.level.playerStart);
      this.yaw = Math.PI / 2; this.pitch = 0; // face east (down hallway)
      this.vel.set(0, 0, 0);
      this.battery = 1.0;
      this.health = this.maxHealth;
      this.hits = 0;
      this.invuln = 0;
      this.flashOn = true;
      this.stamina = 1.0;
      this.curEye = this.eyeHeight;
    }

    /* ---------- collision: circle vs AABBs (resolve per-axis) ---------- */
    _collide(nx, nz) {
      const r = this.radius;
      let x = nx, z = nz;
      for (let iter = 0; iter < 2; iter++) {
        for (const c of this.level.colliders) {
          // closest point
          const cx = Math.max(c.minX, Math.min(x, c.maxX));
          const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
          const dx = x - cx, dz = z - cz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            const d = Math.sqrt(d2) || 0.0001;
            const push = (r - d);
            x += (dx / d) * push;
            z += (dz / d) * push;
          }
        }
      }
      // clamp to level bounds (minus radius)
      const b = this.level.bounds;
      x = Math.max(b.minX + r + 0.1, Math.min(b.maxX - r - 0.1, x));
      z = Math.max(b.minZ + r + 0.1, Math.min(b.maxZ - r - 0.1, z));
      return { x, z };
    }

    update(dt) {
      const inp = this.input;

      // ---- mouse look ----
      const sens = 0.0022;
      this.yaw -= inp.mouseDX * sens;
      this.pitch -= inp.mouseDY * sens;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));

      // ---- movement ----
      this.crouching = inp.held('ControlLeft') || inp.held('ControlRight');
      const wantSprint = inp.held('ShiftLeft') && !this.crouching && this.stamina > 0.05;
      this.sprinting = wantSprint && (inp.held('KeyW') || inp.held('KeyA') || inp.held('KeyS') || inp.held('KeyD'));

      let speed = this.crouchSpeed;
      if (this.crouching) speed = this.crouchSpeed;
      else if (this.sprinting) speed = this.sprintSpeed;
      else speed = this.walkSpeed;

      const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const move = new THREE.Vector3();
      if (inp.held('KeyW')) move.add(forward);
      if (inp.held('KeyS')) move.sub(forward);
      if (inp.held('KeyD')) move.add(right);
      if (inp.held('KeyA')) move.sub(right);

      this.moving = move.lengthSq() > 0;
      if (this.moving) move.normalize();

      // accelerate / damp
      const targetVX = move.x * speed;
      const targetVZ = move.z * speed;
      const accel = this.moving ? 12 : 8;
      this.vel.x = global.Utils.damp(this.vel.x, targetVX, accel, dt);
      this.vel.z = global.Utils.damp(this.vel.z, targetVZ, accel, dt);

      const nx = this.pos.x + this.vel.x * dt;
      const nz = this.pos.z + this.vel.z * dt;
      const resolved = this._collide(nx, nz);
      this.pos.x = resolved.x; this.pos.z = resolved.z;

      // ---- crouch height smooth ----
      const targetEye = this.crouching ? this.crouchHeight : this.eyeHeight;
      this.curEye = global.Utils.damp(this.curEye, targetEye, 10, dt);

      // ---- head bob ----
      let bobY = 0, bobX = 0;
      if (this.moving) {
        this._bobT += dt * (this.sprinting ? 14 : 9);
        const amp = this.sprinting ? 0.06 : (this.crouching ? 0.02 : 0.04);
        bobY = Math.sin(this._bobT * 2) * amp;
        bobX = Math.cos(this._bobT) * amp * 0.5;
      } else {
        this._bobT = 0;
      }

      // ---- apply to camera ----
      this.camera.position.set(this.pos.x, this.curEye + bobY, this.pos.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw + bobX * 0.02;
      this.camera.rotation.x = this.pitch;

      // ---- stamina ----
      if (this.sprinting) this.stamina = Math.max(0, this.stamina - this.staminaDrain * dt);
      else this.stamina = Math.min(1, this.stamina + this.staminaRegen * dt);

      // ---- flashlight battery ----
      if (this.flashOn) {
        this.battery = Math.max(0, this.battery - this.batteryDrain * dt);
        if (this.battery <= 0) { this.flashOn = false; this._setFlash(); }
      }
      // intensity scales with battery
      if (this.flashOn) {
        const f = 0.4 + 0.6 * this.battery;
        this.flashlight.intensity = 2.6 * f * (0.92 + 0.08 * Math.sin(performance.now() * 0.02));
        this.glow.intensity = 0.35 * f;
      }

      // ---- footsteps ----
      if (this.moving) {
        this._stepT -= dt;
        const interval = this.sprinting ? 0.32 : (this.crouching ? 0.55 : 0.45);
        if (this._stepT <= 0) {
          global.Audio.footstep();
          this._stepT = interval;
        }
      } else this._stepT = 0;

      // ---- toggle flashlight ----
      if (inp.pressed('KeyF') && this.battery > 0) { this.flashOn = !this.flashOn; this._setFlash(); global.Audio.beep(false); }

      // ---- invulnerability timer ----
      if (this.invuln > 0) this.invuln -= dt;
    }

    _setFlash() {
      this.flashlight.visible = this.flashOn;
      this.glow.visible = this.flashOn;
    }

    // called by enemy when its weapon strike lands
    takeHit() {
      if (this.invuln > 0) return false;
      this.hits++;
      // each hit deals an even slice of maxHealth so hard=dies in 1 hit, easy in 2
      const dmg = Math.ceil(this.maxHealth / this.maxHits);
      this.health = Math.max(0, this.health - dmg);
      this.invuln = 1.2;
      global.Audio.sting();
      return true;
    }
    isDead() { return this.health <= 0 || this.hits >= this.maxHits; }
    revive() { this.hits = 0; this.health = this.maxHealth; this.invuln = 0; this.battery = Math.max(this.battery, 0.4); }
    // picked up a battery pack
    addBattery(amount = 0.5) {
      this.battery = Math.min(1, this.battery + amount);
      if (this.battery > 0 && !this.flashOn) { this.flashOn = true; this._setFlash(); }
    }
  }

  global.Player = Player;
})(window);
