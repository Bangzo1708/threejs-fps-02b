// STORMDOCK input — keyboard + mouse with pointer lock, kept apart from the
// game logic so the same bindings work in the menu, in a round and in a shot.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.mouseDownEdge = false;
    this.locked = false;
    this.onLockChange = null;
    this.onKey = null;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (this.onKey) this.onKey(e.code, true);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (this.onKey) this.onKey(e.code, false);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    canvas.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouseDown = true;
      this.mouseDownEdge = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this.mouseDown = false;
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock();
  }

  axis() {
    // Returns {x, z}: x is strafe right, z is forward, from WASD.
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z -= 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (x !== 0 && z !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      z *= inv;
    }
    return { x, z };
  }

  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    return { dx, dy };
  }

  consumeClickEdge() {
    const edge = this.mouseDownEdge;
    this.mouseDownEdge = false;
    return edge;
  }

  get walk() {
    return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
  }

  get crouch() {
    return this.keys.has('ControlLeft') || this.keys.has('KeyC');
  }
}
