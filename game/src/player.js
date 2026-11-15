// STORMDOCK player — first-person movement with pointer-lock look, AABB
// collision against the world's colliders, and a simple step-up feel.
import * as THREE from '../vendor/three/three.module.min.js';

const EYE = 1.62;
const RADIUS = 0.42;

export class Player {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, EYE, 30);
    this.yaw = 0; // facing north (-z), toward mid
    this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.onGround = true;
    this.stepAcc = 0;
    this.onStep = null;
    this.bobPhase = 0;
  }

  reset(x, z, yaw) {
    this.pos.set(x, EYE, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.health = 100;
    this.armor = 0;
    this.alive = true;
  }

  applyLook(dx, dy, sensitivity = 0.0021, scoped = false) {
    const s = scoped ? sensitivity * 0.45 : sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get right() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  damage(amount, head) {
    if (!this.alive) return 0;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, remaining * 0.5);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    if (head) remaining *= 1.0; // headshot multiplier already applied by the shooter
    this.health -= remaining;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return remaining;
  }

  heal(amount) {
    this.health = Math.min(100, this.health + amount);
  }

  collideAxis(nx, nz) {
    for (const c of this.colliders) {
      if (c.height < EYE - 0.4) continue; // low crates are stepped over visually, not walls
      const cx = Math.max(c.minX, Math.min(nx, c.maxX));
      const cz = Math.max(c.minZ, Math.min(nz, c.maxZ));
      const dx = nx - cx;
      const dz = nz - cz;
      if (dx * dx + dz * dz < RADIUS * RADIUS) return false;
    }
    if (Math.abs(nx) > 47.4 || Math.abs(nz) > 35.4) return false;
    return true;
  }

  update(dt, input, speedBase = 5.4) {
    if (!this.alive) return;
    const { x, z } = input.axis();
    const moving = x !== 0 || z !== 0;
    const speed = speedBase * (input.walk ? 0.55 : 1) * (input.crouch ? 0.6 : 1);
    const fwd = this.forward;
    const rgt = this.right;
    const wishX = (fwd.x * z + rgt.x * x) * speed;
    const wishZ = (fwd.z * z + rgt.z * x) * speed;
    const accel = 14;
    this.vel.x += (wishX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ - this.vel.z) * Math.min(1, accel * dt);
    const nx = this.pos.x + this.vel.x * dt;
    if (this.collideAxis(nx, this.pos.z)) this.pos.x = nx;
    else this.vel.x = 0;
    const nz = this.pos.z + this.vel.z * dt;
    if (this.collideAxis(this.pos.x, nz)) this.pos.z = nz;
    else this.vel.z = 0;
    const planarSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (planarSpeed > 0.6) {
      this.stepAcc += planarSpeed * dt;
      this.bobPhase += planarSpeed * dt * 1.6;
      if (this.stepAcc > 2.4) {
        this.stepAcc = 0;
        if (this.onStep) this.onStep();
      }
    }
    const bobY = Math.sin(this.bobPhase * 2) * 0.035 * Math.min(1, planarSpeed / 5);
    const targetY = EYE + bobY - (input.crouch ? 0.35 : 0);
    this.pos.y += (targetY - this.pos.y) * Math.min(1, 12 * dt);
    this.camera.position.copy(this.pos);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
