/* ===== level.js — builds the abandoned hospital ward from primitives =====
 * Compact layout: one E-W hallway with rooms branching N/S + west reception
 * and east generator/exit. All colliders are axis-aligned 2D AABBs.
 */
(function (global) {
  'use strict';

  const WALL_H = 3.4;
  const WALL_T = 0.28;

  class Level {
    constructor(scene) {
      this.scene = scene;
      this.group = new THREE.Group();
      this.colliders = [];      // {minX,maxX,minZ,maxZ}
      this.doors = {};          // name -> door obj
      this.lights = [];         // flickerable lights
      this.anchors = {};        // named Vector3 positions
      this.playerStart = new THREE.Vector3();
      this.enemySpawn = new THREE.Vector3();
      this.exitDoorName = 'exit';
      this.bounds = { minX: -32, maxX: 32, minZ: -14, maxZ: 14 };
      this.fogColor = 0x05080a;
    }

    /* ---------- shared materials (built once) ---------- */
    _mats() {
      if (this._matCache) return this._matCache;
      const U = global.Utils;
      const wallTex = U.wallTexture('#3a4248', { seed: 11, noise: 22, streaks: 26, blots: 9, blotColor: '#2a0808' });
      wallTex.repeat.set(2, 1);
      const wallTex2 = U.wallTexture('#33403a', { seed: 42, noise: 24, streaks: 30, blots: 6, blotColor: '#1a1408' });
      wallTex2.repeat.set(2, 1);
      const floorTex = U.floorTexture('#24282a', { seed: 5, tile: 80, cracks: 12 });
      floorTex.repeat.set(8, 8);
      const ceilTex = U.ceilTexture('#262a2c', { seed: 9, stains: 10 });
      ceilTex.repeat.set(6, 6);

      this._matCache = {
        wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.96, metalness: 0.0, color: 0x9aa0a4 }),
        wall2: new THREE.MeshStandardMaterial({ map: wallTex2, roughness: 0.96, metalness: 0.0, color: 0x8a9094 }),
        floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.98, metalness: 0.0, color: 0x909898 }),
        ceil: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 1.0, metalness: 0.0, color: 0x6a7072 }),
        metal: new THREE.MeshStandardMaterial({ color: 0x3a4044, roughness: 0.55, metalness: 0.75 }),
        metalDark: new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 0.6, metalness: 0.7 }),
        wood: new THREE.MeshStandardMaterial({ color: 0x3a2c1e, roughness: 0.85, metalness: 0.05 }),
        white: new THREE.MeshStandardMaterial({ color: 0xb8b8b0, roughness: 0.7, metalness: 0.1 }),
        sheet: new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.95, metalness: 0.0, transparent: true, opacity: 0.9 }),
        curtain: new THREE.MeshStandardMaterial({ color: 0x4a5a58, roughness: 1.0, metalness: 0.0, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
        glass: new THREE.MeshStandardMaterial({ color: 0x223030, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.25 }),
        red: new THREE.MeshStandardMaterial({ color: 0x6a1818, roughness: 0.7, metalness: 0.2, emissive: 0x440000, emissiveIntensity: 0.4 }),
        redBright: new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 1.6, roughness: 0.5 }),
        glow: new THREE.MeshStandardMaterial({ color: 0x88ffcc, emissive: 0x44ffaa, emissiveIntensity: 1.0, roughness: 0.4 }),
        glowRed: new THREE.MeshStandardMaterial({ color: 0xff8080, emissive: 0xff5050, emissiveIntensity: 0.8, roughness: 0.4 }),
        enemy: new THREE.MeshStandardMaterial({ color: 0xc8c4be, roughness: 1.0, metalness: 0.0, emissive: 0x080808 }),
        enemyGown: new THREE.MeshStandardMaterial({ color: 0x70788a, roughness: 1.0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      };
      return this._matCache;
    }

    /* ---------- primitive adders ---------- */
    addBox(cx, cy, cz, sx, sy, sz, mat, collide = true) {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      const m = new THREE.Mesh(g, mat);
      m.position.set(cx, cy, cz);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      if (collide) {
        this.colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 });
      }
      return m;
    }

    addCyl(cx, cy, cz, r, h, mat, collide = true) {
      const g = new THREE.CylinderGeometry(r, r, h, 12);
      const m = new THREE.Mesh(g, mat);
      m.position.set(cx, cy, cz);
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
      if (collide) this.colliders.push({ minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r });
      return m;
    }

    // Wall as axis-aligned box (collider in XZ). dir: 'x' = runs along x (long in x), 'z' = runs along z.
    addWall(cx, cz, length, dir, mat, height = WALL_H, thickness = WALL_T) {
      const sx = dir === 'x' ? length : thickness;
      const sz = dir === 'z' ? length : thickness;
      return this.addBox(cx, height / 2, cz, sx, height, sz, mat, true);
    }

    /* Build a 4-walled room. Door gap on one side.
       x0,z0,x1,z1 = interior bounds. side: 'N','S','E','W'. */
    addRoom(name, x0, z0, x1, z1, doorSide, doorCenter, doorWidth, matKey) {
      const M = this._mats(); const mat = M[matKey || 'wall'];
      const t = WALL_T;
      const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      // north wall (z = min z)
      const nz = Math.min(z0, z1) - t / 2;
      // south wall
      const sz_ = Math.max(z0, z1) + t / 2;
      const wwx = Math.min(x0, x1) - t / 2;
      const eex = Math.max(x0, x1) + t / 2;

      const gapHalf = doorWidth / 2;
      const seg = (side) => {
        // returns two wall specs if door on this side splits it, else one full
      };

      // helper to add a wall along X (horizontal, at given z) possibly split by a door at doorCenter
      const wallX = (z, fullX0, fullX1) => {
        if (doorSide === sideOfZ(z)) {
          // split into two around doorCenter
          const a0 = fullX0, a1 = doorCenter - gapHalf;
          const b0 = doorCenter + gapHalf, b1 = fullX1;
          if (a1 - a0 > 0.05) this.addWall((a0 + a1) / 2, z, a1 - a0, 'x', mat);
          if (b1 - b0 > 0.05) this.addWall((b0 + b1) / 2, z, b1 - b0, 'x', mat);
        } else {
          this.addWall((fullX0 + fullX1) / 2, z, fullX1 - fullX0, 'x', mat);
        }
      };
      const wallZ = (x, fullZ0, fullZ1) => {
        if (doorSide === sideOfX(x)) {
          const a0 = fullZ0, a1 = doorCenter - gapHalf;
          const b0 = doorCenter + gapHalf, b1 = fullZ1;
          if (a1 - a0 > 0.05) this.addWall(x, (a0 + a1) / 2, a1 - a0, 'z', mat);
          if (b1 - b0 > 0.05) this.addWall(x, (b0 + b1) / 2, b1 - b0, 'z', mat);
        } else {
          this.addWall(x, (fullZ0 + fullZ1) / 2, fullZ1 - fullZ0, 'z', mat);
        }
      };
      const sideOfZ = (z) => z < cz ? 'N' : 'S';
      const sideOfX = (x) => x < cx ? 'W' : 'E';

      wallX(nz, wwx, eex);                       // north wall
      wallX(sz_, wwx, eex);                      // south wall
      wallZ(wwx, nz, sz_);                        // west wall
      wallZ(eex, nz, sz_);                        // east wall
    }

    /* ---------- door (swinging, with collider) ---------- */
    // side: which side of the gap the hinge is; hingeAt: 'left'|'right' along the wall run dir
    addDoor(name, cx, cz, width, runDir, hingeSide, opts = {}) {
      const M = this._mats();
      const frameMat = M.metalDark, doorMat = opts.locked ? M.metalDark : M.metal;
      const thick = 0.12, h = 2.6;

      // pivot at hinge edge
      const off = hingeSide === 'left' ? -width / 2 : width / 2;
      const px = runDir === 'x' ? cx + off : cx;
      const pz = runDir === 'z' ? cz + off : cz;

      const pivot = new THREE.Group();
      pivot.position.set(px, 0, pz);
      this.group.add(pivot);

      const leaf = new THREE.Group();
      const leafGeo = runDir === 'x'
        ? new THREE.BoxGeometry(width, h, thick)
        : new THREE.BoxGeometry(thick, h, width);
      const leafMesh = new THREE.Mesh(leafGeo, doorMat);
      // position leaf so its edge is at pivot
      if (runDir === 'x') leafMesh.position.set((hingeSide === 'left' ? 1 : -1) * width / 2, h / 2, 0);
      else leafMesh.position.set(0, h / 2, (hingeSide === 'left' ? 1 : -1) * width / 2);
      leafMesh.castShadow = true; leafMesh.receiveShadow = true;
      leaf.add(leafMesh);
      // handle
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), M.metalDark);
      if (runDir === 'x') handle.position.set((hingeSide === 'left' ? 1 : -1) * (width - 0.15), 1.2, 0.06);
      else handle.position.set(0.06, 1.2, (hingeSide === 'left' ? 1 : -1) * (width - 0.15));
      leaf.add(handle);
      pivot.add(leaf);

      // frame top
      const frameTop = new THREE.Mesh(
        runDir === 'x' ? new THREE.BoxGeometry(width + 0.2, 0.18, 0.4) : new THREE.BoxGeometry(0.4, 0.18, width + 0.2),
        frameMat);
      frameTop.position.set(cx, h + 0.09, cz);
      this.group.add(frameTop);

      // locked indicator (red light) if locked
      let lockLight = null;
      if (opts.locked) {
        lockLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), M.redBright);
        lockLight.position.set(cx, 1.5, cz + (runDir === 'x' ? 0.18 : 0));
        this.group.add(lockLight);
      }

      // collider when closed
      const col = {
        minX: cx - (runDir === 'x' ? width / 2 : thick / 2 + 0.06),
        maxX: cx + (runDir === 'x' ? width / 2 : thick / 2 + 0.06),
        minZ: cz - (runDir === 'z' ? width / 2 : thick / 2 + 0.06),
        maxZ: cz + (runDir === 'z' ? width / 2 : thick / 2 + 0.06),
      };

      const door = {
        name, pivot, leaf, leafMesh, cx, cz, width, runDir, hingeSide,
        open: false, opening: false, openAmount: 0,
        locked: !!opts.locked, code: opts.code || null,
        collider: col, lockLight, mat: doorMat, opts,
        autoCloseT: 0,
      };
      this.doors[name] = door;
      if (!door.open) this.colliders.push(col);
      // expose a player-facing interaction anchor (in front of the door, at handle height)
      this.anchors['door_' + name] = new THREE.Vector3(cx, 1.2, cz);
      return door;
    }

    // player-facing: toggle a door open/closed (only if unlocked). Returns true if state changed.
    toggleDoor(name) {
      const d = this.doors[name];
      if (!d || d.locked) return false;
      if (d.open) { this.closeDoor(name); global.Audio.doorCreak(); return true; }
      return this.openDoor(name);
    }

    openDoor(name) {
      const d = this.doors[name]; if (!d || d.open || d.locked) return false;
      d.open = true;
      // remove collider
      const i = this.colliders.indexOf(d.collider);
      if (i >= 0) this.colliders.splice(i, 1);
      global.Audio && global.Audio.doorCreak();
      return true;
    }
    closeDoor(name) {
      const d = this.doors[name]; if (!d || !d.open) return;
      d.open = false;
      if (!this.colliders.includes(d.collider)) this.colliders.push(d.collider);
    }
    unlockDoor(name) {
      const d = this.doors[name]; if (!d) return;
      d.locked = false;
      if (d.lockLight) { d.lockLight.material = this._mats().glow; d.lockLight.material = new THREE.MeshStandardMaterial({ color: 0x40ff80, emissive: 0x20ff60, emissiveIntensity: 1.4 }); }
    }

    /* ---------- ceiling light (flickerable) ---------- */
    addCeilingLight(cx, cz, color = 0xbfe0d0, intensity = 0.5) {
      const M = this._mats();
      // housing
      const house = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 0.4), M.metalDark);
      house.position.set(cx, WALL_H - 0.08, cz);
      this.group.add(house);
      // glowing panel
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.04, 0.34),
        new THREE.MeshStandardMaterial({ color: 0xcfeae0, emissive: color, emissiveIntensity: 0.9 }));
      panel.position.set(cx, WALL_H - 0.14, cz);
      this.group.add(panel);
      const light = new THREE.PointLight(color, intensity, 9, 2.0);
      light.position.set(cx, WALL_H - 0.3, cz);
      light.castShadow = false; // perf
      this.group.add(light);
      const ref = { light, panel, baseIntensity: intensity, flicker: 0, broken: false, cx, cz, color };
      this.lights.push(ref);
      return ref;
    }

    /* ---------- PROPS ---------- */
    propBed(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      // frame
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.3, 2.1), M.metalDark);
      frame.position.y = 0.45; frame.castShadow = true; frame.receiveShadow = true; g.add(frame);
      // mattress
      const mat = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.18, 2.0), M.sheet);
      mat.position.y = 0.69; mat.castShadow = true; g.add(mat);
      // pillow
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.3), M.white);
      pil.position.set(0, 0.82, -0.78); g.add(pil);
      // headboard
      const hb = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.7, 0.06), M.metalDark);
      hb.position.set(0, 0.7, -1.05); g.add(hb);
      // IV stand
      const iv = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.8, 8), M.metal);
      iv.position.set(0.75, 0.9, -0.4); g.add(iv);
      const ivBag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.05), M.glass);
      ivBag.position.set(0.75, 1.7, -0.4); g.add(ivBag);
      this.group.add(g);
      this.colliders.push({ minX: cx - 0.55, maxX: cx + 0.55, minZ: cz - 1.1, maxZ: cz + 1.1 });
      return g;
    }

    propCurtain(cx, cz, w = 2.4, h = 2.2, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, 0.04), M.metalDark);
      rail.position.y = h; g.add(rail);
      const cur = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.curtain);
      cur.position.y = h / 2; cur.position.z = 0.0;
      g.add(cur);
      this.group.add(g);
      return g;
    }

    propDesk(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.8), M.wood);
      top.position.y = 0.95; top.castShadow = true; top.receiveShadow = true; g.add(top);
      const side1 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.06), M.wood);
      side1.position.set(0, 0.45, -0.37); g.add(side1);
      // legs
      for (const sx of [-0.85, 0.85]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), M.wood);
        leg.position.set(sx, 0.45, 0.35); g.add(leg);
      }
      this.group.add(g);
      this.colliders.push({ minX: cx - 0.95, maxX: cx + 0.95, minZ: cz - 0.45, maxZ: cz + 0.45 });
      return g;
    }

    propShelf(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      for (let i = 0; i < 3; i++) {
        const sh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.5), M.metalDark);
        sh.position.y = 0.5 + i * 0.7; sh.castShadow = true; g.add(sh);
      }
      // back
      const back = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.1, 0.05), M.metalDark);
      back.position.set(0, 1.1, -0.24); g.add(back);
      // boxes
      const boxMat = M.wood;
      const rng = global.Utils.makeRng((cx * 13 + cz) | 0);
      for (let i = 0; i < 4; i++) {
        const bx = (rng() - 0.5) * 1.0, bz = (rng() - 0.5) * 0.3;
        const by = 0.5 + (i % 2) * 0.7 + 0.1;
        const bs = 0.25 + rng() * 0.2;
        const box = new THREE.Mesh(new THREE.BoxGeometry(bs, bs, bs), boxMat);
        box.position.set(bx, by, bz); box.castShadow = true; g.add(box);
      }
      this.group.add(g);
      this.colliders.push({ minX: cx - 0.75, maxX: cx + 0.75, minZ: cz - 0.3, maxZ: cz + 0.3 });
      return g;
    }

    propLocker(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.0, 0.5), M.metal);
      body.position.y = 1.0; body.castShadow = true; body.receiveShadow = true; g.add(body);
      const door1 = new THREE.Mesh(new THREE.BoxGeometry(0.33, 1.9, 0.04), M.metalDark);
      door1.position.set(-0.17, 1.0, 0.26); g.add(door1);
      const door2 = new THREE.Mesh(new THREE.BoxGeometry(0.33, 1.9, 0.04), M.metalDark);
      door2.position.set(0.17, 1.0, 0.26); g.add(door2);
      this.group.add(g);
      this.colliders.push({ minX: cx - 0.4, maxX: cx + 0.4, minZ: cz - 0.3, maxZ: cz + 0.3 });
      return g;
    }

    propWheelchair(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), M.metalDark);
      seat.position.y = 0.55; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.06), M.metalDark);
      back.position.set(0, 0.9, -0.28); g.add(back);
      // big wheels
      for (const sx of [-0.36, 0.36]) {
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 20), M.metalDark);
        w.position.set(sx, 0.32, -0.1); w.rotation.y = Math.PI / 2; g.add(w);
      }
      // casters
      for (const sx of [-0.25, 0.25]) {
        const w = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 12), M.metalDark);
        w.position.set(sx, 0.12, 0.3); w.rotation.y = Math.PI / 2; g.add(w);
      }
      this.group.add(g);
      return g; // no collider — it moves
    }

    propGurney(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 1.9), M.sheet);
      top.position.y = 0.85; top.castShadow = true; g.add(top);
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 1.9), M.metalDark);
      side.position.y = 0.7; g.add(side);
      for (const sx of [-0.35, 0.35]) for (const sz of [-0.8, 0.8]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.06), M.metalDark);
        leg.position.set(sx, 0.42, sz); g.add(leg);
        const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.025, 6, 10), M.metalDark);
        wheel.position.set(sx, 0.08, sz); wheel.rotation.y = Math.PI / 2; g.add(wheel);
      }
      this.group.add(g);
      this.colliders.push({ minX: cx - 0.45, maxX: cx + 0.45, minZ: cz - 1.0, maxZ: cz + 1.0 });
      return g;
    }

    propMonitor(cx, cz) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0.95, cz);
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), M.metalDark);
      g.add(body);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x0a3a2a, emissive: 0x0a5a3a, emissiveIntensity: 0.6 }));
      screen.position.set(0, 0, 0.16); g.add(screen);
      this.group.add(g);
      return g;
    }

    propMirror(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 0.06), M.metalDark);
      frame.position.y = 1.4; g.add(frame);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), M.glass);
      glass.position.set(0, 1.4, 0.035); g.add(glass);
      this.group.add(g);
      return g;
    }

    propPhone(cx, cz) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0.95, cz);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.2), M.metalDark);
      g.add(base);
      const handset = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 0.06), M.wood);
      handset.position.y = 0.06; g.add(handset);
      this.group.add(g);
      return g;
    }

    // a glowing battery pack pickup — accepts a Vector3 anchor (uses its y)
    propBattery(anchor) {
      const M = this._mats();
      const g = new THREE.Group();
      g.position.set(anchor.x, anchor.y, anchor.z);
      // battery body
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 12),
        new THREE.MeshStandardMaterial({ color: 0x2a8a4a, emissive: 0x1a5a2a, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 }));
      body.castShadow = true;
      g.add(body);
      // + terminal cap
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8), M.metal);
      cap.position.y = 0.13; g.add(cap);
      // label band
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.061, 0.061, 0.04, 12),
        new THREE.MeshStandardMaterial({ color: 0xeeeeee, emissive: 0x444444, emissiveIntensity: 0.3 }));
      band.position.y = 0.0; g.add(band);
      // faint glow so it's findable in the dark
      const glow = new THREE.PointLight(0x40ff80, 0.5, 2.2, 2);
      glow.position.y = 0.1; g.add(glow);
      this.group.add(g);
      return g;
    }

    bloodDecal(cx, cz, sx = 1.5, sz = 1.5, seed = 1) {
      const tex = global.Utils.bloodTexture(seed);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(cx, 0.012, cz);
      this.group.add(m);
      return m;
    }

    roomSign(cx, cz, text, rotY = 0) {
      const tex = global.Utils.signTexture(text);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, emissive: 0x222222, emissiveIntensity: 0.3, side: THREE.DoubleSide }));
      m.position.set(cx, 2.5, cz); m.rotation.y = rotY;
      this.group.add(m);
      return m;
    }

    /* ============================ BUILD ============================ */
    build() {
      const M = this._mats();
      const U = global.Utils;
      // -------- floor & ceiling (whole map) --------
      const fw = this.bounds.maxX - this.bounds.minX;
      const fd = this.bounds.maxZ - this.bounds.minZ;
      const fcx = (this.bounds.maxX + this.bounds.minX) / 2;
      const fcz = (this.bounds.maxZ + this.bounds.minZ) / 2;
      const floorMat = M.floor.clone();
      floorMat.map = M.floor.map.clone();
      floorMat.map.repeat.set(fw / 4, fd / 4);
      floorMat.map.needsUpdate = true;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), floorMat);
      floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
      this.group.add(floor);

      const ceilMat = M.ceil.clone();
      ceilMat.map = M.ceil.map.clone();
      ceilMat.map.repeat.set(fw / 4, fd / 4);
      ceilMat.map.needsUpdate = true;
      const ceil = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd), ceilMat);
      ceil.rotation.x = Math.PI / 2; ceil.position.y = WALL_H;
      this.group.add(ceil);

      // outer perimeter walls (so player can't leave bounds)
      this.addWall(fcx, this.bounds.minZ - WALL_T / 2, fw, 'x', M.wall);   // north
      this.addWall(fcx, this.bounds.maxZ + WALL_T / 2, fw, 'x', M.wall);   // south
      this.addWall(this.bounds.minX - WALL_T / 2, fcz, fd, 'z', M.wall);   // west
      this.addWall(this.bounds.maxX + WALL_T / 2, fcz, fd, 'z', M.wall);   // east

      /* ===== Layout (top-down, x east+, z south+) =====
         Hallway: x[-20,20], z[-3,3]
         N rooms (z negative): 301, 309, NurseStation
         S rooms (z positive): Reception(west end), Storage, Generator
         Exit: east end of hallway (x=+20 wall), big locked door
      */
      const H = { x0: -20, x1: 20, z0: -3, z1: 3 };

      // ---- Reception (south-west) ----
      // interior x[-30,-14], z[3,11]; door on north wall (z=3) at x=-22 → hallway? 
      // Actually reception connects to hallway west end. Let me door it on its east wall into a small foyer at hallway west.
      // Simpler: reception interior x[-30,-20], z[-3,11]; door on east wall (x=-20) into hallway west end.
      this.addRoom('reception', -30, -3, -20, 11, 'E', 4, 1.6, 'wall2');
      this.doors_reception = this.addDoor('door_reception', -20, 4, 1.6, 'z', 'left', { });

      // ---- Hallway is open (walls are the room walls + perimeter). Add hallway end decor later. ----

      // ---- Patient Room 301 (north) interior x[-16,-8], z[-11,-3]; door south wall z=-3 at x=-12 ----
      this.addRoom('r301', -16, -11, -8, -3, 'S', -12, 1.6, 'wall');
      this.addDoor('door_301', -12, -3, 1.6, 'x', 'left', {});

      // ---- Patient Room 309 (north) interior x[-4,4], z[-11,-3]; door south wall z=-3 at x=0; LOCKED w/ code ----
      this.addRoom('r309', -4, -11, 4, -3, 'S', 0, 1.6, 'wall');
      this.addDoor('door_309', 0, -3, 1.6, 'x', 'left', { locked: true, code: '3094' });

      // ---- Nurse station (north) interior x[8,16], z[-11,-3]; door south wall z=-3 at x=12 ----
      this.addRoom('nurse', 8, -11, 16, -3, 'S', 12, 1.6, 'wall2');
      this.addDoor('door_nurse', 12, -3, 1.6, 'x', 'right', {});

      // ---- Storage room (south) interior x[6,14], z[3,11]; door north wall z=3 at x=10 ----
      this.addRoom('storage', 6, 3, 14, 11, 'N', 10, 1.6, 'wall');
      this.addDoor('door_storage', 10, 3, 1.6, 'x', 'left', {});

      // ---- Generator room (south-east) interior x[16,30], z[3,11]; door north wall z=3 at x=20 ----
      this.addRoom('gen', 16, 3, 30, 11, 'N', 20, 1.6, 'wall2');
      this.addDoor('door_gen', 20, 3, 1.6, 'x', 'right', { });
      // generator room is accessible; the fuse panel itself requires 3 fuse keys

      // ---- EXIT door: east wall of hallway at x=20, big door, locked until power ----
      // exit gap in east perimeter? We built solid east perimeter. Make a dedicated exit alcove.
      // Place exit door on east wall of hallway: replace by adding a door at x=20, z=0 (vertical run dir z)
      this.addDoor('exit', 20, 0, 2.0, 'z', 'left', { locked: true });
      // a glowing EXIT sign above
      const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x2a8a4a, emissive: 0x2a8a4a, emissiveIntensity: 1.0, side: THREE.DoubleSide }));
      exitSign.position.set(19.85, 2.6, 0); exitSign.rotation.y = -Math.PI / 2;
      this.group.add(exitSign);
      this.anchors.exitSign = new THREE.Vector3(19.85, 2.6, 0);

      // -------- ceiling lights --------
      // hallway lights (some broken/flickering)
      const hallLights = [];
      for (let x = -16; x <= 16; x += 8) {
        const l = this.addCeilingLight(x, 0, 0xbfe0d0, 0.45);
        if (Math.random() < 0.5) { l.flicker = 1; }
        hallLights.push(l);
      }
      // reception light
      const recLight = this.addCeilingLight(-25, 4, 0xbfe0d0, 0.5); recLight.flicker = 0.4;
      // 301
      const l301 = this.addCeilingLight(-12, -7, 0xc0e0d8, 0.4); l301.flicker = 0.8;
      // 309 — mostly dark, one broken
      const l309 = this.addCeilingLight(0, -7, 0x80a0a0, 0.15); l309.broken = true; l309.flicker = 1;
      // nurse
      const lnurse = this.addCeilingLight(12, -7, 0xbfe0d0, 0.45); lnurse.flicker = 0.3;
      // storage
      const lstor = this.addCeilingLight(10, 7, 0xa0c0b8, 0.35); lstor.flicker = 0.6;
      // generator
      const lgen = this.addCeilingLight(23, 7, 0xa0b8a0, 0.3); lgen.flicker = 0.5;

      // a couple broken/bare bulbs (dim red emergency light)
      const emerg = new THREE.PointLight(0xff3010, 0.6, 7, 2);
      emerg.position.set(0, WALL_H - 0.3, -7); this.group.add(emerg);
      this.lights.push({ light: emerg, panel: null, baseIntensity: 0.6, flicker: 1, broken: false, color: 0xff3010, emergency: true, cx: 0, cz: -7 });

      // -------- room signs --------
      this.roomSign(-12, -2.6, '301', 0);
      this.roomSign(0, -2.6, '309', 0);
      this.roomSign(12, -2.6, 'NURSE', 0);
      this.roomSign(10, 2.6, 'STORAGE', Math.PI);
      this.roomSign(20, 2.6, 'GENERATOR', Math.PI);
      this.roomSign(-20, 4, 'RECEPTION', -Math.PI / 2);

      // -------- props per room --------
      // Reception: desk, phone, chair, papers, blood
      this.propDesk(-26, 6, 0);
      this.propPhone(-26, 6.2);
      this.propChair(-25, 4.5);
      this.bloodDecal(-23, 8, 2, 1.6, 3);
      this.addBox(-26, 0.5, 9.5, 1.6, 1.0, 0.4, M.wood); // cabinet
      this.colliders.pop(); this.colliders.push({ minX: -26.8, maxX: -25.2, minZ: 9.3, maxZ: 9.7 });

      // Hallway: wheelchair (will be moved by scare), a gurney, some debris
      this.wheelchairRef = this.propWheelchair(-6, 1.6, 0.3);
      this.propGurney(6, -1.5, 0);
      this.addBox(2, 0.2, 1.8, 0.6, 0.4, 0.6, M.metalDark); // debris
      this.colliders.push({ minX: 1.7, maxX: 2.3, minZ: 1.5, maxZ: 2.1 });
      this.bloodDecal(-8, 0.5, 2.5, 1.2, 5);
      this.bloodDecal(14, 1.2, 1.6, 1.6, 8);

      // Room 301: bed, curtain, locker, note on bed
      this.propBed(-13, -7, 0);
      this.propCurtain(-10, -7, 1.8, 2.2, 0);
      this.propLocker(-15.4, -4, Math.PI / 2);
      this.propMonitor(-13, -8.2);
      this.bloodDecal(-12, -9.5, 1.8, 1.2, 11);

      // Room 309: bed (overturned?), heavy blood, curtain with shadow anchor
      this.propBed(2, -6, Math.PI);
      this.propCurtain(-2, -6, 2.0, 2.2, 0);
      this.propLocker(3.6, -4, -Math.PI / 2);
      this.bloodDecal(0, -7, 3, 2, 21);
      this.bloodDecal(2, -9, 1.5, 1.2, 22);
      // a creepy chair facing corner
      this.propChair(3.5, -10, Math.PI);

      // Nurse station: desk, monitor, lockers, meds shelf
      this.propDesk(12, -7, 0);
      this.propMonitor(12, -6);
      this.propShelf(15, -10, 0);
      this.propLocker(9, -4, Math.PI / 2);
      this.propChair(11, -5, 0);

      // Storage: shelves, boxes, a fuse-key hiding spot behind boxes
      this.propShelf(8, 4.5, Math.PI / 2);
      this.propShelf(13, 9, 0);
      this.propLocker(7.5, 10, 0);
      // big pile of boxes (key 2 hides behind these)
      for (let i = 0; i < 5; i++) {
        const bx = 12 + (i % 3) * 0.5, bz = 4 + Math.floor(i / 3) * 0.5;
        this.addBox(bx, 0.3 + (i % 2) * 0.5, bz, 0.5, 0.5, 0.5, M.wood);
      }
      this.bloodDecal(10, 8, 1.4, 1.4, 31);

      // Generator room: a big, obvious generator machine with a visible fuse panel.
      // Machine body — taller & wider so it reads as "the generator"
      this.addBox(24, 0.9, 6.5, 2.2, 1.8, 1.4, M.metalDark); // main body
      this.colliders.push({ minX: 22.9, maxX: 25.1, minZ: 5.8, maxZ: 7.2 });
      // top housing with vents
      this.addBox(24, 1.95, 6.5, 2.0, 0.5, 1.2, M.metal);
      this.colliders.pop();
      // exhaust pipe up to ceiling
      const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.6, 10), M.metalDark);
      exh.position.set(24.7, 2.7, 6.5); this.group.add(exh);
      // side pipes
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 8), M.metal);
        p.position.set(26, 2.5, 4 + i * 1.5); p.rotation.z = Math.PI / 2;
        this.group.add(p);
      }
      // FUSE PANEL — a bright plate on the front (north face, -z) of the generator, facing the door
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.7, emissive: 0x0a0a0a });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.08), panelMat);
      panel.position.set(24, 1.4, 5.78);                 // front face of body (body front at z=5.8)
      this.group.add(panel);
      // "FUSE PANEL" label strip
      const labelStrip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.02),
        new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x111111 }));
      labelStrip.position.set(24, 1.78, 5.75); this.group.add(labelStrip);
      // THREE FUSE SLOTS — visible cylinders; red (empty) now, turn green when filled by game._placeFuses
      this.fuseSlots = [];
      const slotMatEmpty = new THREE.MeshStandardMaterial({ color: 0x3a0a0a, emissive: 0x6a0808, emissiveIntensity: 0.7, roughness: 0.5 });
      for (let i = 0; i < 3; i++) {
        const sx = 24 - 0.4 + i * 0.4;
        const slot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 14), slotMatEmpty.clone());
        slot.position.set(sx, 1.35, 5.7); slot.rotation.x = Math.PI / 2;
        this.group.add(slot);
        // a small key-shape indicator inside
        const ind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.16), M.metalDark);
        ind.position.set(sx, 1.35, 5.7); this.group.add(ind);
        this.fuseSlots.push({ ring: slot, indicator: ind, filled: false });
      }
      // a big lever on the right side of the panel
      const leverBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 10), M.metalDark);
      leverBase.position.set(24.85, 1.4, 5.78); leverBase.rotation.x = Math.PI / 2; this.group.add(leverBase);
      this.genLever = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.04), M.metalDark);
      this.genLever.position.set(24.85, 1.6, 5.78); this.group.add(this.genLever);
      // indicator lights above panel (red = no power, green = power on)
      this.genLightRed = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xff3030, emissive: 0xff2020, emissiveIntensity: 1.4 }));
      this.genLightRed.position.set(23.4, 1.95, 5.7); this.group.add(this.genLightRed);
      const redLamp = new THREE.PointLight(0xff2020, 0.4, 3, 2); redLamp.position.set(23.4, 1.95, 5.6); this.group.add(redLamp);
      this.genLightGreen = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x103010, emissive: 0x002000, emissiveIntensity: 0.1 }));
      this.genLightGreen.position.set(23.7, 1.95, 5.7); this.group.add(this.genLightGreen);
      // a green lamp that lights up on power
      this.genGreenLamp = new THREE.PointLight(0x20ff40, 0.0, 3, 2); this.genGreenLamp.position.set(23.7, 1.95, 5.6); this.group.add(this.genGreenLamp);
      // GENERATOR sign above
      this.roomSign(24, 2.4, 'GENERATOR', Math.PI);
      this.anchors.genPanel = new THREE.Vector3(24, 1.4, 5.5);

      // -------- interactable anchors --------
      // note 1 (reception desk): "Do not open Room 309"
      this.anchors.note1 = new THREE.Vector3(-26, 0.98, 6.2);
      // note 2 (room 301): part of code "3 0 _ _"
      this.anchors.note2 = new THREE.Vector3(-13, 0.78, -8.0);
      // note 3 (nurse station): part of code "_ _ 9 4"
      this.anchors.note3 = new THREE.Vector3(12, 0.98, -6.5);
      // note 4 (storage, optional flavor + hint)
      this.anchors.note4 = new THREE.Vector3(10, 0.0, 8.5);
      // fuse key 1: room 301 on bed
      this.anchors.key1 = new THREE.Vector3(-13, 0.85, -7.0);
      // fuse key 2: storage behind boxes
      this.anchors.key2 = new THREE.Vector3(12.6, 0.25, 4.3);
      // fuse key 3: room 309 (triggers scare)
      this.anchors.key3 = new THREE.Vector3(2, 0.85, -6.0);
      // keypad: next to room 309 door
      this.anchors.keypad = new THREE.Vector3(0.9, 1.4, -3.0);
      // generator fuse slots
      this.anchors.fuseSlots = new THREE.Vector3(24, 1.4, 5.2); // in front of the fuse panel (south side)
      // exit door
      this.anchors.exit = new THREE.Vector3(19.5, 1.6, 0);

      // battery pickups — placed in 3 rooms so the flashlight can be recharged
      // battery 1: nurse station desk
      this.anchors.batt1 = new THREE.Vector3(13, 0.98, -6.5);
      // battery 2: storage room floor
      this.anchors.batt2 = new THREE.Vector3(8.5, 0.15, 9.5);
      // battery 3: reception cabinet
      this.anchors.batt3 = new THREE.Vector3(-26, 0.98, 9.5);
      // battery 4: hallway gurney (extra, hard mode)
      this.anchors.batt4 = new THREE.Vector3(6, 0.9, -1.5);
      // place visible battery props (store references so they can be hidden on pickup)
      this.batteryMeshes = {};
      ['batt1','batt2','batt3','batt4'].forEach((id) => {
        this.batteryMeshes[id] = this.propBattery(this.anchors[id]);
      });
      // mirror (nurse station) — scare
      this.anchors.mirror = new THREE.Vector3(15.4, 0, -8);
      this.propMirror(15.4, -8, -Math.PI / 2);
      // phone (reception) — scare
      this.anchors.phone = new THREE.Vector3(-26, 0.95, 6.2);

      // player start: reception, near east door
      this.playerStart.set(-24, 1.7, 4);
      // enemy spawn: deep in room 309
      this.enemySpawn.set(0, 0, -9);

      // hide the enemy initially (game.js will manage)
      this.scene.add(this.group);
      return this;
    }

    propChair(cx, cz, rotY = 0) {
      const M = this._mats();
      const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = rotY;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.45), M.metalDark);
      seat.position.y = 0.5; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.05), M.metalDark);
      back.position.set(0, 0.75, -0.2); g.add(back);
      for (const sx of [-0.18, 0.18]) for (const sz of [-0.18, 0.18]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), M.metalDark);
        leg.position.set(sx, 0.25, sz); g.add(leg);
      }
      this.group.add(g);
      return g;
    }

    /* ---- door swing animation (called each frame) ----
     * Animate pivot rotation toward openAmount target. Door opens AWAY from the
     * side the player interacts from is overkill; we just swing on its hinge.   */
    updateDoors(dt) {
      for (const name in this.doors) {
        const d = this.doors[name];
        const target = d.open ? 1 : 0;
        if (d.openAmount !== target) {
          // swing speed
          const spd = 3.2;
          if (d.openAmount < target) d.openAmount = Math.min(target, d.openAmount + spd * dt);
          else d.openAmount = Math.max(target, d.openAmount - spd * dt);
          // hinge swing direction: hingeSide 'left' swings one way, 'right' the other
          const dir = (d.hingeSide === 'left') ? -1 : 1;
          d.pivot.rotation.y = dir * d.openAmount * (Math.PI / 2 * 0.85);
        }
      }
    }

    /* ---- flicker update (called each frame) ---- */
    updateFlicker(dt, enemyProximity = 0) {
      const t = performance.now() * 0.001;
      for (const L of this.lights) {
        if (L.emergency) {
          // steady dim red, but pulses faster when enemy near
          L.light.intensity = L.baseIntensity * (0.7 + 0.3 * Math.sin(t * (3 + enemyProximity * 6)));
          continue;
        }
        if (L.broken) {
          // occasional sputter
          L.light.intensity = (Math.random() < 0.04) ? L.baseIntensity * 0.3 : 0.0;
          if (L.panel) L.panel.material.emissiveIntensity = L.light.intensity > 0 ? 0.4 : 0.02;
          continue;
        }
        let inten = L.baseIntensity;
        // base flicker
        if (L.flicker > 0) {
          const n = Math.sin(t * 13 + L.cx) * Math.sin(t * 7.3 + L.cz * 3);
          inten *= (0.7 + 0.3 * n);
          if (Math.random() < 0.02 * L.flicker) inten *= 0.2;
        }
        // enemy proximity dims lights
        if (enemyProximity > 0) {
          inten *= (1 - 0.5 * enemyProximity);
          if (Math.random() < 0.15 * enemyProximity) inten *= 0.1;
        }
        L.light.intensity = Math.max(0, inten);
        if (L.panel) L.panel.material.emissiveIntensity = Math.max(0.02, inten * 1.2);
      }
    }

    setLightsPowered(on) {
      for (const L of this.lights) {
        if (L.emergency) continue;
        L._powered = on;
        if (on) {
          L.baseIntensity = L._origBase || L.baseIntensity;
        } else {
          if (!L._origBase) L._origBase = L.baseIntensity;
          L.baseIntensity = L.broken ? 0 : L.baseIntensity * 0.25;
        }
      }
    }

    // fill fuse slot `i` (0..2): turns it green and lights the indicator
    setFuseSlot(i, filled) {
      if (!this.fuseSlots || !this.fuseSlots[i]) return;
      const s = this.fuseSlots[i];
      s.filled = filled;
      if (filled) {
        s.ring.material.color.setHex(0x0a3a0a);
        s.ring.material.emissive.setHex(0x20ff40);
        s.ring.material.emissiveIntensity = 0.9;
      } else {
        s.ring.material.color.setHex(0x3a0a0a);
        s.ring.material.emissive.setHex(0x6a0808);
        s.ring.material.emissiveIntensity = 0.7;
      }
    }

    // flip the generator power indicator: green lamp on, red lamp off, lever down
    setGeneratorPower(on) {
      if (on) {
        if (this.genLightRed) { this.genLightRed.material.color.setHex(0x301010); this.genLightRed.material.emissive.setHex(0x100000); this.genLightRed.material.emissiveIntensity = 0.2; }
        if (this.genLightGreen) { this.genLightGreen.material.color.setHex(0x30ff40); this.genLightGreen.material.emissive.setHex(0x20ff40); this.genLightGreen.material.emissiveIntensity = 1.6; }
        if (this.genGreenLamp) this.genGreenLamp.intensity = 0.8;
        if (this.genLever) this.genLever.rotation.z = -0.9;  // lever thrown
      } else {
        if (this.genLightRed) { this.genLightRed.material.color.setHex(0xff3030); this.genLightRed.material.emissive.setHex(0xff2020); this.genLightRed.material.emissiveIntensity = 1.4; }
        if (this.genLightGreen) { this.genLightGreen.material.color.setHex(0x103010); this.genLightGreen.material.emissive.setHex(0x002000); this.genLightGreen.material.emissiveIntensity = 0.1; }
        if (this.genGreenLamp) this.genGreenLamp.intensity = 0.0;
        if (this.genLever) this.genLever.rotation.z = 0;
      }
    }
  }

  global.Level = Level;
})(window);
