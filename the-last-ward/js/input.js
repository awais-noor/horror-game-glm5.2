/* ===== input.js — keyboard, mouse-look (pointer lock), edge events ===== */
(function (global) {
  'use strict';

  class Input {
    constructor(domElement) {
      this.dom = domElement;
      this.keys = Object.create(null);
      this.keysDown = Object.create(null);   // edge (this frame)
      this.keysUp = Object.create(null);     // edge (this frame)

      this.mouseDX = 0; this.mouseDY = 0;
      this.locked = false;
      this.mouseJustClicked = false;

      this._onKeyDown = this._onKeyDown.bind(this);
      this._onKeyUp = this._onKeyUp.bind(this);
      this._onMouseMove = this._onMouseMove.bind(this);
      this._onMouseDown = this._onMouseDown.bind(this);
      this._onLockChange = this._onLockChange.bind(this);

      window.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('keyup', this._onKeyUp);
      document.addEventListener('mousemove', this._onMouseMove);
      document.addEventListener('mousedown', this._onMouseDown);
      document.addEventListener('pointerlockchange', this._onLockChange);
    }

    requestLock() {
      if (!this.locked && this.dom.requestPointerLock) {
        this.dom.requestPointerLock();
      }
    }
    exitLock() { if (this.locked && document.exitPointerLock) document.exitPointerLock(); }

    _onLockChange() {
      this.locked = (document.pointerLockElement === this.dom);
      if (!this.locked) {
        // clear movement keys so player doesn't keep walking when unlocked
        this.keys = Object.create(null);
      }
    }
    _onKeyDown(e) {
      // prevent default for game keys to avoid page scroll etc.
      const k = e.code;
      if (['ShiftLeft','ControlLeft','ControlRight','Space','Tab','KeyW','KeyA','KeyS','KeyD'].includes(k)) e.preventDefault();
      if (!this.keys[k]) this.keysDown[k] = true;
      this.keys[k] = true;
    }
    _onKeyUp(e) {
      const k = e.code;
      this.keys[k] = false;
      this.keysUp[k] = true;
    }
    _onMouseMove(e) {
      if (this.locked) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    }
    _onMouseDown(e) {
      this.mouseJustClicked = true;
    }

    // call at end of frame
    endFrame() {
      this.keysDown = Object.create(null);
      this.keysUp = Object.create(null);
      this.mouseDX = 0; this.mouseDY = 0;
      this.mouseJustClicked = false;
    }

    pressed(code) { return !!this.keysDown[code]; }   // edge: just pressed this frame
    released(code) { return !!this.keysUp[code]; }
    held(code) { return !!this.keys[code]; }
    anyHeld(codes) { return codes.some(c => this.keys[c]); }

    dispose() {
      window.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('keyup', this._onKeyUp);
      document.removeEventListener('mousemove', this._onMouseMove);
      document.removeEventListener('mousedown', this._onMouseDown);
      document.removeEventListener('pointerlockchange', this._onLockChange);
    }
  }

  global.Input = Input;
})(window);
