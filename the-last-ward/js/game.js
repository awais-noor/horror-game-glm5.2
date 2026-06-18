/* ===== game.js — main controller: states, render loop, interactions, UI ===== */
(function (global) {
  'use strict';

  class Game {
    constructor() {
      this.state = 'menu'; // menu | intro | playing | paused | dead | won | notes | keypad
      this.diff = 'easy';

      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.clock = new THREE.Clock();
      this.input = null;
      this.level = null;
      this.player = null;
      this.enemy = null;
      this.scares = null;

      // interaction
      this.interactables = []; // {id, pos, radius, prompt, action, once, done, condition}
      this.curInteract = null;
      this.keysCollected = 0;
      this.fusesPlaced = 0;
      this.powerRestored = false;
      this.codeEntered = false;
      this.notesRead = new Set();
      this.finalChaseStarted = false;

      // UI handles
      this.el = {};
      this._toastT = 0; this._subT = 0;
      this._prevTime = 0;

      this._bindUI();
    }

    /* ---------- DOM hookup ---------- */
    _id(s) { return document.getElementById(s); }
    _bindUI() {
      const $ = (s) => this.el[s] = this._id(s);
      ['menuScreen','introScreen','pauseScreen','deathScreen','winScreen','quitScreen','controlsScreen',
       'btnStart','btnEasy','btnHard','btnControls','btnQuit','btnBackFromControls',
       'btnEnterWard','btnResume','btnPauseControls','btnQuitToMenu',
       'btnRetry','btnDeathQuit','btnPlayAgain','btnWinMenu',
       'btnQuitConfirm','btnQuitCancel',
       'loadingScreen','hud','interactPrompt','toast','subtitle','statusBox',
       'batteryFill','batteryText','keysText','objText','hintBox','hitFlash','hurtPulse',
       'healthFill','healthText',
       'noteOverlay','noteTitle','noteBody','keypadOverlay','keypadDisplay','keypadGrid','kpClear','kpEnter',
       'cinemabars','fade','endingText','crosshair','deathSub','winSub'].forEach($);
      // there are two cinemabars (top/bottom); grab both
      this.el.cinemaTop = document.getElementById('cinemabars');
      this.el.cinemaBottom = document.querySelector('#cinemabars.bottom');

      const bind = (id, fn) => this.el[id].addEventListener('click', fn);
      bind('btnStart', () => this._startIntro());
      bind('btnEasy', () => this._setDiff('easy'));
      bind('btnHard', () => this._setDiff('hard'));
      bind('btnControls', () => this._show('controlsScreen'));
      bind('btnBackFromControls', () => this._show('menuScreen'));
      bind('btnQuit', () => this._show('quitScreen'));
      bind('btnQuitConfirm', () => { try { window.close(); } catch (e) {} alert('You can close this tab now.'); });
      bind('btnQuitCancel', () => this._show('menuScreen'));
      bind('btnEnterWard', () => this._beginPlay());
      bind('btnResume', () => this.resume());
      bind('btnPauseControls', () => this._show('controlsScreen'));
      bind('btnQuitToMenu', () => this._quitToMenu());
      bind('btnRetry', () => this._retry());
      bind('btnDeathQuit', () => this._quitToMenu());
      bind('btnPlayAgain', () => this._retry());
      bind('btnWinMenu', () => this._quitToMenu());

      // note/keypad close
      window.addEventListener('keydown', (e) => {
        if (this.state === 'notes' && (e.code === 'KeyE' || e.code === 'Escape')) this._closeNote();
        else if (this.state === 'keypad' && e.code === 'Escape') this._closeKeypad(false);
      });

      // build keypad buttons
      this._buildKeypad();

      // click anywhere on canvas to (re)lock pointer when playing
      const onClick = () => {
        if (this.state === 'playing' && this.input && !this.input.locked) this.input.requestLock();
      };
      document.addEventListener('click', onClick);
    }

    _buildKeypad() {
      const grid = this.el.keypadGrid;
      const layout = ['1','2','3','4','5','6','7','8','9','','0',''];
      this.keypadBuf = '';
      layout.forEach((k) => {
        const b = document.createElement('button');
        if (k === '') { b.disabled = true; b.style.visibility = 'hidden'; }
        else { b.textContent = k; b.addEventListener('click', () => this._keypadPress(k)); }
        grid.appendChild(b);
      });
      this.el.kpClear.addEventListener('click', () => { this.keypadBuf = ''; this._updateKeypad(); });
      this.el.kpEnter.addEventListener('click', () => this._keypadEnter());
    }
    _keypadPress(k) {
      if (this.keypadBuf.length >= 4) return;
      this.keypadBuf += k;
      this._updateKeypad();
      global.Audio.beep(false);
    }
    _updateKeypad() {
      let s = '';
      for (let i = 0; i < 4; i++) s += (this.keypadBuf[i] || '_') + ' ';
      this.el.keypadDisplay.textContent = s.trim();
    }
    _keypadEnter() {
      if (this.keypadBuf.length !== 4) return;
      const correct = this.keypadBuf === '3094';
      if (correct) {
        this.level.unlockDoor('door_309');
        this.level.openDoor('door_309');
        this.codeEntered = true;
        global.Audio.powerUp();
        this._closeKeypad(true);
        this.toast('Room 309 unlocks with a heavy clunk.', 3.0);
        this.setObjective('Enter Room 309. Retrieve the final fuse key. Beware.');
        // update hint
        this.setHint('Find the 3rd fuse key inside Room 309.');
      } else {
        this.el.keypadDisplay.style.color = '#ff5050';
        global.Audio.sting();
        setTimeout(() => { this.el.keypadDisplay.style.color = '#4af0a0'; this.keypadBuf = ''; this._updateKeypad(); }, 600);
      }
    }

    _setDiff(d) {
      this.diff = d;
      this.el.btnEasy.classList.toggle('active', d === 'easy');
      this.el.btnHard.classList.toggle('active', d === 'hard');
    }

    _show(screen) {
      ['menuScreen','introScreen','pauseScreen','deathScreen','winScreen','quitScreen','controlsScreen']
        .forEach(s => this.el[s].classList.add('hidden'));
      if (screen) this.el[screen].classList.remove('hidden');
    }

    _startIntro() {
      // init audio on user gesture
      global.Audio.init(); global.Audio.resume();
      this._show('introScreen');
    }

    /* ---------- begin play ---------- */
    _beginPlay() {
      this._show(null);
      this.el.hud.classList.add('active');
      this.el.loadingScreen.style.display = 'flex';

      // init three.js if not yet
      if (!this.renderer) this._initThree();

      // (re)build level + entities
      this._buildWorld();

      setTimeout(() => {
        this.el.loadingScreen.style.display = 'none';
        this.state = 'playing';
        global.Audio.startAmbient();
        this.scares.active = true;
        this.input.requestLock();
        this.setObjective('Read the note on the reception desk.');
        this.setHint('WASD move · Mouse look · F flashlight · E interact · Shift sprint · Ctrl crouch');
        if (!this._loopRunning) { this._loopRunning = true; this._loop(); }
      }, 700);
    }

    _initThree() {
      const container = this._id('game');
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.outputEncoding = THREE.sRGBEncoding;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 0.85;
      this.renderer.shadowMap.enabled = false;
      container.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();
      this.scene.fog = new THREE.FogExp2(0x05080a, 0.11);
      this.scene.background = new THREE.Color(0x05080a);

      this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 80);
      this.scene.add(this.camera);

      // very dim ambient so unlit areas aren't pure black
      this.ambient = new THREE.AmbientLight(0x202830, 0.18);
      this.scene.add(this.ambient);
      // a faint hemisphere for shape
      this.hemi = new THREE.HemisphereLight(0x1a2028, 0x05080a, 0.12);
      this.scene.add(this.hemi);

      this.input = new global.Input(this.renderer.domElement);

      window.addEventListener('resize', () => this._onResize());
      // (ESC → pause/resume is handled centrally in _bindUI)
    }

    _onResize() {
      if (!this.renderer) return;
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    _buildWorld() {
      // clear previous
      if (this.level) { this.scene.remove(this.level.group); this.level = null; }
      if (this.enemy) { this.scene.remove(this.enemy.mesh); this.enemy = null; }
      this.interactables = [];
      this.keysCollected = 0; this.fusesPlaced = 0;
      this.powerRestored = false; this.codeEntered = false;
      this.notesRead.clear(); this.finalChaseStarted = false;

      this.level = new global.Level(this.scene);
      this.level.build();
      // generator starts unpowered: slots empty, red light on
      this.level.setGeneratorPower(false);
      for (let i = 0; i < 3; i++) this.level.setFuseSlot(i, false);

      this.player = new global.Player(this.camera, this.level, this.input, this.diff);
      this.player.reset();

      this.enemy = new global.Enemy(this.level, this.diff);
      this.enemy.hide();

      this.scares = new global.ScareManager(this.level, this.enemy, this.player, this);
      this.scares.setDifficulty(this.diff);
      this.scares.reset();

      this._registerInteractables();
      this._updateHUD();
    }

    _registerInteractables() {
      const L = this.level;
      // NOTE 1 — reception
      this.addInteract('note1', L.anchors.note1, 1.6, 'Press E to read note', () => this._openNote('note1'));
      // NOTE 2 — room 301 (code part 1)
      this.addInteract('note2', L.anchors.note2, 1.6, 'Press E to read note', () => this._openNote('note2'));
      // NOTE 3 — nurse station (code part 2)
      this.addInteract('note3', L.anchors.note3, 1.6, 'Press E to read note', () => this._openNote('note3'));
      // NOTE 4 — storage (flavor + hint about generator)
      this.addInteract('note4', L.anchors.note4, 1.6, 'Press E to read note', () => this._openNote('note4'));
      // KEY 1 — room 301
      this.addInteract('key1', L.anchors.key1, 1.6, 'Press E to take FUSE KEY', () => this._collectKey(1));
      // KEY 2 — storage (behind boxes)
      this.addInteract('key2', L.anchors.key2, 1.6, 'Press E to take FUSE KEY', () => this._collectKey(2));
      // KEY 3 — room 309
      this.addInteract('key3', L.anchors.key3, 1.6, 'Press E to take FUSE KEY', () => this._collectKey(3), () => this.codeEntered);
      // KEYPAD — room 309 door
      this.addInteract('keypad', L.anchors.keypad, 1.6, 'Press E to use keypad', () => this._openKeypad(), () => !this.codeEntered);
      // FUSE SLOTS — generator panel. Always interactable so the player understands what's needed.
      this.addInteract('fuses', L.anchors.fuseSlots, 1.8, 'Press E to inspect fuse panel', () => this._placeFuses(), () => !this.powerRestored);
      // EXIT
      this.addInteract('exit', L.anchors.exit, 2.2, 'Press E to escape', () => this._tryExit(), () => this.powerRestored);

      // DOORS — open/close. Reception (escape first room), 301, nurse, storage, gen.
      // (Room 309's door is opened via the keypad; the exit via power.)
      this.addInteract('door_reception', L.anchors.door_door_reception, 1.8, 'Press E to open door', () => this._toggleDoor('door_reception'));
      this.addInteract('door_301',      L.anchors.door_door_301,      1.8, 'Press E to open door', () => this._toggleDoor('door_301'));
      this.addInteract('door_nurse',    L.anchors.door_door_nurse,    1.8, 'Press E to open door', () => this._toggleDoor('door_nurse'));
      this.addInteract('door_storage',  L.anchors.door_door_storage,  1.8, 'Press E to open door', () => this._toggleDoor('door_storage'));
      this.addInteract('door_gen',      L.anchors.door_door_gen,      1.8, 'Press E to open door', () => this._toggleDoor('door_gen'));

      // BATTERY pickups — recharge the flashlight. Each restores 50% battery.
      ['batt1','batt2','batt3','batt4'].forEach((id) => {
        this.addInteract(id, L.anchors[id], 1.4, 'Press E to take BATTERY', () => this._collectBattery(id));
      });

      // create visible meshes for keys (glowing) + keypad
      const M = L._mats();
      this._keyMeshes = {};
      ['key1','key2','key3'].forEach((id) => {
        const k = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 16), M.glowRed);
        const stem = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.03,0.12), M.metalDark);
        stem.position.z = 0.08; k.add(stem);
        k.position.copy(L.anchors[id]); k.position.y = 0.85;
        L.group.add(k);
        this._keyMeshes[id] = k;
      });
      // keypad box mounted on the south wall of Room 309 (z = -3), facing +z into the hallway
      const kp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.06), M.metalDark);
      kp.position.set(L.anchors.keypad.x, L.anchors.keypad.y, L.anchors.keypad.z);
      kp.lookAt(L.anchors.keypad.x, L.anchors.keypad.y, L.anchors.keypad.z + 1);
      L.group.add(kp);
      const kpScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x0a3a2a, emissive: 0x0a5a3a, emissiveIntensity: 0.7 }));
      kpScreen.position.set(L.anchors.keypad.x, L.anchors.keypad.y, L.anchors.keypad.z + 0.04);
      kpScreen.lookAt(L.anchors.keypad.x, L.anchors.keypad.y, L.anchors.keypad.z + 1);
      L.group.add(kpScreen);
    }

    addInteract(id, pos, radius, prompt, action, condition) {
      this.interactables.push({ id, pos: pos.clone(), radius, prompt, action, condition, done: false });
    }
    setInteractTarget(id, pos, prompt) {
      // dynamic target (e.g., phone) — add or update
      let it = this.interactables.find(i => i.id === id);
      if (!it) { it = { id, pos: pos.clone(), radius: 1.8, prompt, action: () => this.scares.answerPhone(), condition: () => true, done: false }; this.interactables.push(it); }
      else { it.pos.copy(pos); it.prompt = prompt; it.done = false; }
    }
    clearInteractTarget(id) {
      const i = this.interactables.findIndex(x => x.id === id);
      if (i >= 0) this.interactables.splice(i, 1);
      if (this.curInteract && this.curInteract.id === id) { this.curInteract = null; this._hidePrompt(); }
    }

    /* ---------- notes ---------- */
    _openNote(id) {
      const notes = {
        note1: {
          title: 'SHIFT LOG — NIGHT 14',
          body: `<p>If you're reading this, you woke up here too.</p>
                 <p>Do <span class="red">NOT</span> open Room 309. They sealed it for a reason. The patients who vanished — they were last seen in there.</p>
                 <p>The exit runs on the backup generator in the east room. It needs <span class="red">three fuse keys</span> before it'll turn over.</p>
                 <p class="close-hint">— J. Marin, head of maintenance</p>`,
        },
        note2: {
          title: 'PATIENT 301 — INTAKE',
          body: `<p>Admitted: emaciated male, found wandering the east wing.</p>
                 <p>Keeps repeating numbers. Says the "door code" came to him in a dream.</p>
                 <p>He wrote it on the wall before we sedated him:</p>
                 <p class="code">3 &nbsp; 0 &nbsp; _ &nbsp; _</p>
                 <p class="close-hint">(two digits missing…)</p>`,
        },
        note3: {
          title: 'NURSE STATION — MEMO',
          body: `<p>Subject 309 was the last. Tall. Wouldn't speak. Wouldn't eat.</p>
                 <p>The door to 309 was fitted with a 4-digit lock. The second half of the code is on the back of this memo:</p>
                 <p class="code">_ &nbsp; _ &nbsp; 9 &nbsp; 4</p>
                 <p>Combine the two halves. <span class="red">Do not enter.</span></p>
                 <p class="close-hint">— D. Kessler, RN</p>`,
        },
        note4: {
          title: 'SCRAP OF PAPER',
          body: `<p>…the generator takes the three fuse keys. Slot them in, throw the lever. Door to the east unlocks.</p>
                 <p>But once the power's on, <span class="red">it</span> wakes up too. I heard it. Right behind me.</p>
                 <p>Run. Don't look back.</p>
                 <p class="close-hint">(illegible signature)</p>`,
        },
      };
      const n = notes[id];
      if (!n) return;
      this.el.noteTitle.textContent = n.title;
      this.el.noteBody.innerHTML = n.body;
      this.el.noteOverlay.classList.add('show');
      this.state = 'notes';
      this.notesRead.add(id);
      this.input.exitLock();
      global.Audio.doorCreak(); // paper rustle-ish
      // easy mode: after reading notes 2 and 3, hint the full code
      if (this.diff === 'easy' && this.notesRead.has('note2') && this.notesRead.has('note3')) {
        setTimeout(() => this.toast('Code combined: 3 0 9 4 (Easy mode hint)', 4.0), 600);
      }
      // update objective after first note
      if (id === 'note1') this.setObjective('Find the 3 fuse keys. First key is in Room 301.');
      if (id === 'note2' && this.keysCollected === 0) this.setObjective('Take the fuse key on the bed in Room 301.');
    }
    _closeNote() {
      this.el.noteOverlay.classList.remove('show');
      this.state = 'playing';
      this.input.requestLock();
    }

    /* ---------- keypad ---------- */
    _openKeypad() {
      this.el.keypadOverlay.classList.add('show');
      this.state = 'keypad';
      this.keypadBuf = ''; this._updateKeypad();
      this.input.exitLock();
    }
    _closeKeypad(success) {
      this.el.keypadOverlay.classList.remove('show');
      this.state = 'playing';
      this.input.requestLock();
    }

    /* ---------- collect keys ---------- */
    _collectKey(n) {
      const id = 'key' + n;
      const it = this.interactables.find(i => i.id === id);
      if (!it || it.done) return;
      it.done = true;
      this.keysCollected++;
      // hide mesh
      if (this._keyMeshes[id]) this._keyMeshes[id].visible = false;
      global.Audio.beep(true);
      this.toast(`Fuse Key ${n}/3 collected`, 2.5);
      this._updateHUD();

      if (n === 1) {
        this.setObjective('Find the 2nd fuse key in the storage room (behind boxes).');
        this.setHint('Storage room is south of the hallway. Search behind the boxes.');
      } else if (n === 2) {
        this.setObjective('Find the code (notes) and unlock Room 309 for the 3rd key.');
        this.setHint('Read notes in Room 301 and the Nurse Station. Enter the code at the keypad by Room 309.');
      } else if (n === 3) {
        // THE BIG SCARE
        this.setObjective('RUN to the generator room! Place all 3 fuse keys and restore power.');
        this.setHint('Generator room: east, south of the hallway. Place fuses → restore power → exit unlocks.');
        this.finalChaseStarted = true;
        this.scares.triggerRoom309Scare();
      }
    }

    /* ---------- collect battery ---------- */
    _collectBattery(id) {
      const it = this.interactables.find(i => i.id === id);
      if (!it || it.done) return;
      it.done = true;
      // hide the battery mesh
      if (this.level.batteryMeshes && this.level.batteryMeshes[id]) this.level.batteryMeshes[id].visible = false;
      this.player.addBattery(0.5);
      global.Audio.beep(true);
      this.toast('Battery +50% — flashlight recharged', 2.5);
      this._updateHUD();
    }

    /* ---------- place fuses / restore power ---------- */
    _placeFuses() {
      if (this.powerRestored) { this.toast('The generator is already running.', 2.0); return; }
      if (this.keysCollected < 3) {
        this.toast(`The fuse panel needs 3 fuse keys. You have ${this.keysCollected}/3.`, 3.0, true);
        this.setHint('Find all 3 fuse keys, then return here to restore power.');
        return;
      }
      this.fusesPlaced = 3;
      // fill the three fuse slots with a short delay between each, for visible feedback
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          this.level.setFuseSlot(i, true);
          global.Audio.beep(true);
        }, i * 350);
      }
      // after the last slot, restore power
      setTimeout(() => {
        this.powerRestored = true;
        this.level.setLightsPowered(true);
        this.level.setGeneratorPower(true);
        global.Audio.powerUp();
        global.Audio.startGeneratorHum();
        this.level.unlockDoor('exit');
        this.toast('POWER RESTORED. The exit is unlocked. RUN.', 3.5, true);
        this.setObjective('ESCAPE through the east exit door!');
        this.setHint('Run east down the hallway to the green EXIT sign.');
        // enemy goes full chase for the escape
        this.enemy.provoke();
        this._updateHUD();
      }, 3 * 350 + 200);
    }

    _tryExit() {
      if (!this.powerRestored) { this.toast('The door is locked. No power.', 2.0); return; }
      this._win();
    }

    /* toggle a room door open/closed (door must be unlocked) */
    _toggleDoor(name) {
      const d = this.level.doors[name];
      if (!d) return;
      if (d.locked) { this.toast('It won\'t budge. Locked.', 1.8); return; }
      this.level.toggleDoor(name);
    }

    /* ---------- pause / resume ---------- */
    pause() {
      if (this.state !== 'playing') return;
      this.state = 'paused';
      this.input.exitLock();
      this._show('pauseScreen');
    }
    resume() {
      if (this.state !== 'paused') return;
      this._show(null);
      this.state = 'playing';
      this.input.requestLock();
    }
    _quitToMenu() {
      this.state = 'menu';
      this.scares && (this.scares.active = false);
      global.Audio.stopAmbient();
      this.input && this.input.exitLock();
      this.el.hud.classList.remove('active');
      this._show('menuScreen');
    }
    _retry() {
      this._show(null);
      this._beginPlay();
    }

    /* ---------- death ---------- */
    _die(reason) {
      if (this.state !== 'playing') return;
      this.state = 'dead';
      this.input.exitLock();
      global.Audio.stopAmbient();
      global.Audio.sting();
      this.el.deathSub.textContent = reason || 'SUBJECT 309 FOUND YOU';
      this._show('deathScreen');
    }

    /* ---------- win ---------- */
    _win() {
      this.state = 'won';
      this.scares.active = false;
      this.input.exitLock();
      this.el.hud.classList.remove('active');
      // cinematic: black bars + fade
      this.el.cinemaTop.classList.add('on'); this.el.cinemaBottom.classList.add('on');
      this.el.fade.classList.add('on');
      global.Audio.stopAmbient();
      global.Audio.doorSlam();
      setTimeout(() => {
        this.el.endingText.innerHTML = 'You escaped…<br><br><span class="red">but Room 309 is open now.</span>';
        this.el.endingText.classList.add('show');
      }, 2200);
      setTimeout(() => {
        this.el.endingText.classList.remove('show');
        this.el.cinemaTop.classList.remove('on'); this.el.cinemaBottom.classList.remove('on');
        this.el.fade.classList.remove('on');
        this._show('winScreen');
      }, 7500);
    }

    /* ---------- UI helpers ---------- */
    toast(msg, dur = 2.5, red = false) {
      this.el.toast.textContent = msg;
      this.el.toast.classList.toggle('red', red);
      this.el.toast.classList.add('show');
      this._toastT = dur;
    }
    subtitle(msg, dur = 3.0) {
      this.el.subtitle.textContent = msg;
      this.el.subtitle.classList.add('show');
      this._subT = dur;
    }
    setObjective(t) { this.el.objText.textContent = '▸ ' + t; }
    setHint(t) { this.el.hintBox.textContent = t; }
    _hidePrompt() { this.el.interactPrompt.classList.remove('show'); }

    _updateHUD() {
      const b = this.player.battery;
      this.el.batteryFill.style.width = (b * 100) + '%';
      this.el.batteryFill.classList.toggle('low', b < 0.4 && b >= 0.15);
      this.el.batteryFill.classList.toggle('crit', b < 0.15);
      this.el.batteryText.querySelector('.num').textContent = Math.round(b * 100) + '%';
      this.el.keysText.querySelector('.num').textContent = this.keysCollected + ' / 3';

      // health bar
      const h = this.player.health / this.player.maxHealth;
      this.el.healthFill.style.width = (h * 100) + '%';
      this.el.healthFill.classList.toggle('ok', h > 0.6);
      this.el.healthFill.classList.toggle('med', h > 0.3 && h <= 0.6);
      this.el.healthFill.classList.toggle('crit', h <= 0.3);
      this.el.healthText.querySelector('.num').textContent = Math.round(h * 100) + '%';

      // hurt pulse when low health or one hit from death
      const atRisk = this.player.hits >= this.player.maxHits - 1;
      this.el.hurtPulse.classList.toggle('on', (atRisk || h <= 0.35) && this.state === 'playing');
    }

    /* ---------- interaction detection ---------- */
    _updateInteraction() {
      if (this.state !== 'playing') { this._hidePrompt(); return; }
      const p = this.player.pos;
      let best = null, bestD = Infinity;
      for (const it of this.interactables) {
        if (it.done) continue;
        if (it.condition && !it.condition()) continue;
        const d = Math.hypot(p.x - it.pos.x, p.z - it.pos.z);
        if (d < it.radius && d < bestD) { bestD = d; best = it; }
      }
      this.curInteract = best;
      if (best) {
        // dynamic prompt for doors (open/close)
        let promptText = best.prompt;
        if (best.id && best.id.indexOf('door_') === 0) {
          const dn = best.id; // door interactable id IS the door name
          const dd = this.level.doors[dn];
          if (dd) promptText = dd.open ? 'Press E to close door' : 'Press E to open door';
        } else if (best.id === 'fuses') {
          // generator fuse panel — show what's needed
          if (this.powerRestored) promptText = 'Generator running';
          else if (this.keysCollected >= 3) promptText = 'Press E to place 3 fuse keys & restore power';
          else promptText = `Press E to inspect — needs 3 fuse keys (you have ${this.keysCollected})`;
        }
        this.el.interactPrompt.innerHTML = promptText.replace('Press E', '<span class="ek">[ E ]</span>');
        this.el.interactPrompt.classList.add('show');
        if (this.input.pressed('KeyE')) best.action();
      } else {
        this._hidePrompt();
      }
    }

    /* ---------- main loop ---------- */
    _loop() {
      requestAnimationFrame(() => this._loop());
      const dt = Math.min(0.05, this.clock.getDelta());

      if (this.state === 'playing') {
        this.player.update(dt);
        // enemy update
        const pp = this.player.pos;
        const prox = this.enemy.proximity(pp);
        this.enemy.update(dt, pp, {
          canAttack: this.player.invuln <= 0,
          onAttack: () => {
            const hit = this.player.takeHit();
            if (hit) {
              this.el.hitFlash.classList.add('on');
              setTimeout(() => this.el.hitFlash.classList.remove('on'), 300);
              this._updateHUD();
              if (this.player.isDead()) { this._die('SUBJECT 309 FOUND YOU'); return; }
              else { this.toast('You were struck! Survive…', 2.0, true); }
            }
          }
        });
        // if the enemy attack killed the player this frame, skip the rest of the world update
        if (this.state !== 'playing') { this.input.endFrame(); return; }
        // animate doors (swing open/closed)
        this.level.updateDoors(dt);
        // flicker lights by proximity
        this.level.updateFlicker(dt, prox);
        // heartbeat when near
        if (prox > 0.35) {
          if (!global.Audio._heartbeatOn) global.Audio.startHeartbeat(50 + prox * 60);
          else global.Audio.setHeartbeatBpm(50 + prox * 80);
        } else if (global.Audio._heartbeatOn && prox < 0.2) global.Audio.stopHeartbeat();
        // ambient audio updates
        global.Audio.update(dt, { beeps: true, crying: true });
        // scares
        this.scares.update(dt);
        // interaction
        this._updateInteraction();
        // HUD
        this._updateHUD();
        // toast/subtitle timers
        if (this._toastT > 0) { this._toastT -= dt; if (this._toastT <= 0) this.el.toast.classList.remove('show'); }
        if (this._subT > 0) { this._subT -= dt; if (this._subT <= 0) this.el.subtitle.classList.remove('show'); }
        // low-battery heartbeat-style flicker handled by HUD already
      } else if (this.state === 'paused' || this.state === 'notes' || this.state === 'keypad') {
        // freeze world but let doors finish swinging + a gentle flicker behind overlays
        this.level && this.level.updateDoors(dt);
        this.level && this.level.updateFlicker(dt, 0);
      }

      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
      this.input && this.input.endFrame();
    }
  }

  // boot
  global.game = new Game();
  window.addEventListener('load', () => {
    // hide loading after a tick (three.js loads sync here)
    setTimeout(() => {
      const ls = document.getElementById('loadingScreen');
      if (ls && !global.game.renderer) ls.style.display = 'none';
    }, 400);
  });
})(window);
