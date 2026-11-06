const ACTIONS = { KeyR: 'reload', Digit1: 'slot1', Digit2: 'slot2', KeyQ: 'swap', KeyG: 'frag', KeyV: 'knife', KeyE: 'knife', KeyF: 'knife' };

/**
 * First-person controls: pointer-locked mouse look plus keyboard. Mouse movement is applied to yaw/pitch
 * every frame (smooth at any refresh rate); `command()` packages the current state for one simulation tick.
 */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);
    this.mouse = { down: false, right: false };
    this.yaw = 0;
    this.pitch = 0;
    this.lookX = 0;          // this frame's mouse movement (for weapon sway)
    this.lookY = 0;
    this.sensitivity = 2;    // menu setting, 1-5
    this.crouch = false;     // C toggles crouch
    this.actions = [];       // one-shot presses consumed by the next tick
    this.enabled = false;
    this.lastWheel = 0;
    this.onUnlock = null;
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    addEventListener('mousemove', e => {
      if (!this.locked) return;
      const k = this.sensitivity * 0.0011 * (this.zoom || 1);
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - e.movementY * k));
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    canvas.addEventListener('mousedown', e => {
      if (!this.locked) return;
      if (e.button === 0) this.mouse.down = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.enabled && performance.now() - this.lastWheel > 250) {
        this.lastWheel = performance.now();
        this.actions.push('swap');
      }
    }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      if (!this.locked) { this.release(); this.onUnlock?.(); }
    });
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  lock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      p?.catch?.(() => this.canvas.requestPointerLock());   // unadjusted movement is not supported everywhere
    } catch {
      this.canvas.requestPointerLock();
    }
  }

  unlock() { if (this.locked) document.exitPointerLock(); }

  press(e) {
    this.keys[e.code] = true;
    if (e.repeat) return;
    if (e.code === 'KeyC') this.crouch = !this.crouch;
    else if (ACTIONS[e.code]) this.actions.push(ACTIONS[e.code]);
  }

  command() {
    const k = this.keys;
    const cmd = {
      f: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0),
      s: (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0),
      yaw: this.yaw,
      pitch: this.pitch,
      fire: this.mouse.down,
      ads: this.mouse.right,
      sprint: !!(k.ShiftLeft || k.ShiftRight),
      crouch: this.crouch,
      jump: !!k.Space,
      actions: this.actions,
    };
    if (cmd.sprint && cmd.f > 0) this.crouch = cmd.crouch = false;   // sprinting stands you up
    this.actions = [];
    return cmd;
  }

  release() {
    for (const key in this.keys) this.keys[key] = false;
    this.mouse.down = this.mouse.right = false;
    this.actions.length = 0;
  }
}
