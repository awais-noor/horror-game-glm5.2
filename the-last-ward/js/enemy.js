/* ===== enemy.js — Subject 309: tall ghost patient with state machine =====
 * States: HIDDEN, WATCHING (distant, vanishes), STALKING (slow approach),
 *         CHASING (fast, when provoked), LURKING (cooldown).
 * Behaves differently by difficulty. Not always chasing — sometimes just watches.
 */
(function (global) {
  'use strict';

  class Enemy {
    constructor(level, difficulty) {
      this.level = level;
      this.diff = difficulty;
      this.mesh = null;
      this.pos = level.enemySpawn.clone();
      this.state = 'HIDDEN';
      this.visible = false;
      this.alpha = 0;
      this.speed = difficulty === 'hard' ? 2.4 : 1.5;
      this.chaseSpeed = difficulty === 'hard' ? 3.8 : 2.7;
      this.watchDist = 11;      // prefers to watch from this distance
      this.attackRange = 1.4;
      this.attackCooldown = 0;
      this.stateT = 0;
      this.nextActionT = 0;
      this.targetPos = this.pos.clone();
      this.lastSeenPlayer = 0;  // time since last had LOS
      this._build();
      this._pickWatchSpot();
    }

    _build() {
      const M = this.level._mats();
      const g = new THREE.Group();
      // tall thin body
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.5, 10), M.enemy);
      body.position.y = 1.55; body.castShadow = true; g.add(body);
      // gown (skirt) — torn
      const gown = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.2, 10, 1, true), M.enemyGown);
      gown.position.y = 0.95; g.add(gown);
      // arms (long, thin) hanging — right arm holds weapon, raised when attacking
      const armGeo = new THREE.CylinderGeometry(0.05, 0.04, 1.1, 6);
      const armL = new THREE.Mesh(armGeo, M.enemy); armL.position.set(-0.22, 1.3, 0); armL.rotation.z = 0.12; g.add(armL);
      // right arm as a pivot group so we can swing it
      this.armRPivot = new THREE.Group();
      this.armRPivot.position.set(0.22, 1.8, 0);
      const armR = new THREE.Mesh(armGeo, M.enemy); armR.position.set(0, -0.55, 0); armR.rotation.z = -0.12;
      this.armRPivot.add(armR);
      g.add(this.armRPivot);
      // WEAPON: rusty surgical cleaver in the right hand
      const weapon = new THREE.Group();
      weapon.position.set(0, -1.1, 0.05);
      // handle
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.9 }));
      handle.position.y = -0.1;
      weapon.add(handle);
      // blade — wide, blood-stained
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.4, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.4, metalness: 0.8, emissive: 0x220000, emissiveIntensity: 0.2 }));
      blade.position.y = -0.42;
      weapon.add(blade);
      // blood drip on blade
      const blood = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.15, 0.025),
        new THREE.MeshStandardMaterial({ color: 0x5a0808, roughness: 0.6, emissive: 0x2a0000, emissiveIntensity: 0.3 }));
      blood.position.set(0.05, -0.55, 0.012);
      weapon.add(blood);
      this.armRPivot.add(weapon);
      this.weapon = weapon;
      // head — pale, slightly elongated
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 12), M.enemy);
      head.position.y = 2.45; head.scale.y = 1.25; g.add(head);
      // eyes — small dark sockets with faint glow
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x220000 });
      const eyeGeo = new THREE.SphereGeometry(0.035, 6, 6);
      const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.06, 2.48, 0.14); g.add(eyeL);
      const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.06, 2.48, 0.14); g.add(eyeR);
      // jaw gape (dark) — a small box
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.05), new THREE.MeshBasicMaterial({ color: 0x110000 }));
      mouth.position.set(0, 2.35, 0.15); g.add(mouth);

      // a faint point light so it's slightly visible in dark when close
      this.glow = new THREE.PointLight(0x88aa99, 0.0, 4, 2);
      this.glow.position.y = 2.4; g.add(this.glow);

      g.visible = false;
      this.mesh = g;
      this.body = body; this.head = head; this.armL = armL; this.armR = armR;
      this.level.scene.add(g);
    }

    _pickWatchSpot() {
      // pick a spot at ~watchDist from player, ideally in a hallway or doorway
      const p = this.level.playerStart;
      const ang = Math.random() * Math.PI * 2;
      const r = this.watchDist;
      this.targetPos.set(p.x + Math.cos(ang) * r, 0, p.z + Math.sin(ang) * r);
      // clamp to bounds
      const b = this.level.bounds;
      this.targetPos.x = global.Utils.clamp(this.targetPos.x, b.minX + 1, b.maxX - 1);
      this.targetPos.z = global.Utils.clamp(this.targetPos.z, b.minZ + 1, b.maxZ - 1);
    }

    /* ---------- LOS check (raycast vs wall colliders in XZ) ---------- */
    hasLOS(px, pz) {
      // step along the line; if any collider blocks, false
      const dx = px - this.pos.x, dz = pz - this.pos.z;
      const dist = Math.hypot(dx, dz);
      const steps = Math.ceil(dist / 0.3);
      const sx = dx / steps, sz = dz / steps;
      let x = this.pos.x, z = this.pos.z;
      for (let i = 0; i < steps; i++) {
        x += sx; z += sz;
        for (const c of this.level.colliders) {
          if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return false;
        }
      }
      return true;
    }

    distToPlayer(px, pz) { return Math.hypot(px - this.pos.x, pz - this.pos.z); }

    /* ---------- external triggers ---------- */
    provoke() {
      // force into chase (used by final scare / when key3 collected)
      this.state = 'CHASING';
      this.visible = true;
      this.stateT = 0;
      this._appear();
    }
    hide() {
      this.state = 'HIDDEN';
      this.visible = false;
      this.alpha = 0;
      this.mesh.visible = false;
    }
    appearAt(x, z, watch = true) {
      this.pos.set(x, 0, z);
      this.visible = true;
      this.state = watch ? 'WATCHING' : 'STALKING';
      this.stateT = 0;
      this._appear();
    }
    _appear() {
      this.mesh.visible = true;
      this.mesh.position.copy(this.pos);
      this.alpha = 0;
    }

    /* ---------- per-frame ---------- */
    update(dt, playerPos, opts = {}) {
      this.stateT += dt;
      const d = this.distToPlayer(playerPos.x, playerPos.z);
      const los = this.hasLOS(playerPos.x, playerPos.z);
      if (los) this.lastSeenPlayer = 0; else this.lastSeenPlayer += dt;

      // difficulty: hard = more aggressive
      const hard = this.diff === 'hard';

      switch (this.state) {
        case 'HIDDEN': {
          // schedule an appearance — first one is quick so the player sees the threat early
          if (this.nextActionT <= 0) {
            this.nextActionT = hard ? global.Utils.rand(8, 14) : global.Utils.rand(10, 18);
          }
          this.nextActionT -= dt;
          if (this.nextActionT <= 0) {
            this._pickWatchSpot();
            this.pos.copy(this.targetPos);
            this.state = 'WATCHING';
            this.stateT = 0;
            this._appear();
            // whisper cue when it shows up
            if (global.Audio) global.Audio.whisper();
          }
          break;
        }
        case 'WATCHING': {
          // stand still, face player, fade in/out subtly
          this._face(playerPos);
          // after a while, vanish (especially if player looks away / gets close)
          const lookingAway = !los;
          let dur = hard ? global.Utils.rand(5, 9) : global.Utils.rand(6, 11);
          if (this.stateT > dur || d < 4.5) {
            this.hide();
            this.nextActionT = hard ? global.Utils.rand(10, 18) : global.Utils.rand(16, 28);
            // sometimes transition to stalking instead
            if (hard && Math.random() < 0.4) {
              this.state = 'STALKING'; this._appear(); this.stateT = 0;
            }
          }
          break;
        }
        case 'STALKING': {
          // slowly creep toward player but keep some distance; vanish if spotted
          this._moveToward(playerPos, this.speed * 0.6, dt, 5);
          this._face(playerPos);
          if (los && d < 6 && Math.random() < 0.01) {
            // spotted — back off
            this.hide();
            this.nextActionT = global.Utils.rand(8, 16);
          }
          if (this.stateT > 18) { this.hide(); this.nextActionT = global.Utils.rand(10, 20); }
          break;
        }
        case 'CHASING': {
          // full chase toward last known position
          const target = los ? playerPos : this._lastKnown || playerPos;
          if (los) this._lastKnown = playerPos.clone();
          // lunge slightly faster when in striking distance
          const spd = d < this.attackRange * 1.6 ? this.chaseSpeed * 1.15 : this.chaseSpeed;
          this._moveToward(target, spd, dt);
          this._face(target);
          // attack: swing weapon & deal damage on cooldown
          if (d < this.attackRange && this.attackCooldown <= 0 && opts.canAttack) {
            this._attackAnim = 0.35;            // start swing animation
            this.attackCooldown = hard ? 1.0 : 1.6;
            // damage lands at the apex of the swing (~0.18s in)
            setTimeout(() => { opts.onAttack && opts.onAttack(); }, 180);
          }
          // if lost player for long, give up to lurking
          if (this.lastSeenPlayer > (hard ? 8 : 5)) {
            this.state = 'LURKING'; this.stateT = 0;
          }
          break;
        }
        case 'LURKING': {
          // fade out, wait, then re-stalk or chase
          this.alpha = Math.max(0, this.alpha - dt * 0.6);
          if (this.stateT > (hard ? 3 : 5)) {
            if (hard && Math.random() < 0.6) { this.state = 'CHASING'; this._appear(); this.stateT = 0; }
            else this.hide();
          }
          break;
        }
      }

      // visibility / fade
      if (this.visible) {
        // base alpha by state
        let targetA = 0.85;
        if (this.state === 'WATCHING') targetA = 0.55 + 0.2 * Math.sin(this.stateT * 1.5);
        if (this.state === 'STALKING') targetA = 0.7;
        if (this.state === 'LURKING') targetA = 0.0;
        this.alpha = global.Utils.damp(this.alpha, targetA, 4, dt);
        this.mesh.visible = this.alpha > 0.02;
        // fade materials
        this._setAlpha(this.alpha);
        this.glow.intensity = (this.state === 'CHASING' ? 0.6 : 0.2) * this.alpha;
      } else {
        this.mesh.visible = false;
        this.glow.intensity = 0;
      }

      // place mesh
      this.mesh.position.copy(this.pos);
      // subtle sway
      this.mesh.position.y = Math.sin(performance.now() * 0.002) * 0.05;

      // attack cooldown
      if (this.attackCooldown > 0) this.attackCooldown -= dt;

      // weapon-arm animation: raised & swaying when chasing, swing on attack
      const t = performance.now() * 0.001;
      if (this.state === 'CHASING') {
        // raise the weapon arm; idle sway
        const s = Math.sin(t * 9);
        this.armRPivot.rotation.x = -1.1 + s * 0.18;     // arm raised overhead
        this.armL.rotation.x = s * 0.5;
        this.head.rotation.x = 0.2;
        // attack swing: a quick downward chop
        if (this._attackAnim > 0) {
          this._attackAnim -= dt;
          const a = global.Utils.clamp(this._attackAnim / 0.35, 0, 1); // 1→0
          // 0.35s swing: wind up then slam down
          const slam = a > 0.5 ? (1 - a) * 2 * -0.6 : (a) * 2 * 1.4;
          this.armRPivot.rotation.x = -1.1 + slam;
        }
      } else {
        // hanging arm, slight sway
        this.armRPivot.rotation.x = Math.sin(t * 2) * 0.08;
        this.armL.rotation.x = 0;
        this.head.rotation.x = 0;
      }
    }

    _face(p) {
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      this.mesh.rotation.y = Math.atan2(dx, dz);
    }
    _moveToward(target, speed, dt, keepDist = 0) {
      const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
      const d = Math.hypot(dx, dz) || 0.0001;
      if (keepDist && d < keepDist) return;
      const ux = dx / d, uz = dz / d;
      let nx = this.pos.x + ux * speed * dt;
      let nz = this.pos.z + uz * speed * dt;
      // simple wall avoidance: try axis-separated moves
      const r = 0.4;
      const blocked = (x, z) => {
        for (const c of this.level.colliders) {
          if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true;
        }
        return false;
      };
      if (blocked(nx, nz)) {
        if (!blocked(nx, this.pos.z)) nz = this.pos.z;
        else if (!blocked(this.pos.x, nz)) nx = this.pos.x;
        else { nx = this.pos.x; nz = this.pos.z; }
      }
      const b = this.level.bounds;
      nx = global.Utils.clamp(nx, b.minX + 0.5, b.maxX - 0.5);
      nz = global.Utils.clamp(nz, b.minZ + 0.5, b.maxZ - 0.5);
      this.pos.x = nx; this.pos.z = nz;
    }
    _setAlpha(a) {
      const M = this.level._mats();
      [M.enemy, M.enemyGown].forEach(m => {
        if (!m) return;
        m.transparent = true;
        m.opacity = a;
      });
    }

    setDifficulty(d) {
      this.diff = d;
      this.speed = d === 'hard' ? 2.4 : 1.5;
      this.chaseSpeed = d === 'hard' ? 3.8 : 2.7;
    }

    // proximity 0..1 for flicker/heartbeat (closer + chasing = higher)
    proximity(playerPos) {
      const d = this.distToPlayer(playerPos.x, playerPos.z);
      let p = global.Utils.clamp(1 - d / 12, 0, 1);
      if (this.state === 'CHASING') p = Math.max(p, 0.7);
      if (!this.visible) p *= 0.3;
      return p;
    }
  }

  global.Enemy = Enemy;
})(window);
