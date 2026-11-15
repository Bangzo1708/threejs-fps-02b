// STORMDOCK — a round-based tactical FPS in a stormy night container port.
// Single-player against nine bots: five Harbor defenders (you are one of
// them) hold two bomb sites against five Storm attackers. Rounds, money,
// a buy menu, a bomb to plant and defuse, and gunplay where stopping to aim
// pays. Runs in a desktop browser from static files, no build step, no
// network: three.js 0.187.0 is vendored under game/vendor/three/.
//
// ?shot=start|play|end with &seed=N stages a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { buildWorld, MAP } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { WEAPONS, UTILITY, WeaponState, damageAtRange } from './weapons.js';
import { MatchState, ROUND } from './state.js';
import { BotManager } from './bots.js';
import { HUD } from './hud.js';
import { PALETTE } from './palette.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number(params.get('seed') || '1');

// Deterministic RNG (mulberry32) so screenshot shots stage identically.
function mulberry32(a) {
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(seedParam * 2654435761 + 97);
const rand = (a, b) => a + rng() * (b - a);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.08, 220);
    this.camera.rotation.order = 'YXZ';

    this.world = buildWorld(this.scene);
    this.audio = new AudioEngine();
    this.input = new Input(this.canvas);
    this.player = new Player(this.camera, this.world.colliders);
    this.player.onStep = () => this.audio.step();
    this.match = new MatchState();
    this.hud = new HUD();
    this.weapon = new WeaponState('p2000');
    this.owned = new Set(['p2000']);
    this.hasKit = false;
    this.scoped = false;
    this.now = 0;
    this.kills = 0;
    this.spectating = null;
    this.trauma = 0;
    this.lastBeepAt = 0;
    this.planting = null; // {site, t} while the player plants (defenders never plant; unused)
    this.defusing = false;
    this.roundOverAt = 0;
    this.started = false;
    this.frozen = false;

    this.bots = new BotManager(this.scene, this.world, {
      los: (from, to) => this.lineOfSight(from, to),
      onBotShot: (bot, target, hit, dmg, head) => this.onBotShot(bot, target, hit, dmg, head),
      onPlantStart: (bot, site) => this.onBotPlantStart(bot, site),
      onPlantDone: (bot, site) => this.onBotPlantDone(bot, site),
      onDefuseStart: (bot) => this.onBotDefuseStart(bot),
      onDefuseDone: (bot) => this.onBotDefuseDone(bot),
    });

    this.buildViewmodel();
    this.buildEffects();
    this.bindUI();
    window.addEventListener('resize', () => this.onResize());
  }

  buildViewmodel() {
    this.viewmodel = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2c343c, roughness: 0.5, metalness: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.42), dark);
    this.viewmodel.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.26, 8), accent);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.025, -0.3);
    this.viewmodel.add(barrel);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.05, 0.06), accent);
    sight.position.set(0, 0.07, -0.1);
    this.viewmodel.add(sight);
    this.viewmodel.position.set(0.26, -0.27, -0.5);
    this.viewmodel.scale.setScalar(0.8);
    this.viewmodel.rotation.y = -0.1;
    this.camera.add(this.viewmodel);
    this.scene.add(this.camera);
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0.28, -0.2, -1.1);
    this.camera.add(this.muzzle);
    this.muzzleLight = new THREE.PointLight(PALETTE.muzzle, 0, 9, 1.8);
    this.muzzle.add(this.muzzleLight);
  }

  buildEffects() {
    // Tracer pool: fading lines from muzzle to impact.
    this.tracers = [];
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.tracerIdx = 0;
    // Impact sparks pool.
    this.sparks = [];
    for (let i = 0; i < 6; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      const mat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.12, transparent: true, opacity: 0 });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.scene.add(pts);
      this.sparks.push({ pts, life: 0, vel: [] });
    }
    this.sparkIdx = 0;
    // Explosion light, reused.
    this.boomLight = new THREE.PointLight(0xff7733, 0, 40, 1.5);
    this.scene.add(this.boomLight);
  }

  bindUI() {
    this.hud.bindMenuButton(() => this.deploy());
    document.getElementById('spectate-btn').addEventListener('click', () => {
      this.hud.hideDeath();
      this.startSpectate();
    });
    this.hud.onBuy = (key) => this.buy(key);
    this.input.onKey = (code, down) => {
      if (!down || !this.started) return;
      if (code === 'KeyB') {
        if (this.match.phase === ROUND.FREEZE) {
          if (this.hud.buyOpen) this.hud.closeBuy();
          else this.hud.openBuy(this.match.money.harbor, this.owned);
        }
      }
      if (code === 'Escape' && this.hud.buyOpen) this.hud.closeBuy();
      if (code === 'KeyR') this.reload();
      if (this.hud.buyOpen && /^Digit[1-8]$/.test(code)) this.buy(code.slice(5));
      if (/^Digit[1-5]$/.test(code) && !this.hud.buyOpen) {
        const ids = ['p2000', 'mp5', 'vk47', 'sentinel', 'longshot'];
        const id = ids[Number(code.slice(5)) - 1];
        if (id && this.owned.has(id)) this.switchWeapon(id);
      }
      if (code === 'KeyM') this.audio.setMuted(!this.audio.muted);
    };
    this.input.onLockChange = (locked) => {
      if (!locked && this.started && !shot && this.player.alive && this.match.phase !== ROUND.MATCH_OVER) {
        this.hud.showCenter('PAUSED — CLICK TO RESUME', 'Click the game to lock the mouse again');
      } else {
        this.hud.hideCenter();
      }
    };
    this.canvas.addEventListener('click', () => {
      if (this.started && !this.input.locked && !this.hud.buyOpen) this.input.requestLock();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.setScoped(true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.setScoped(false);
    });
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  deploy() {
    this.audio.ensure();
    this.hud.hideMenu();
    this.input.requestLock();
    if (this.started) return;
    this.started = true;
    this.startRound();
  }

  startRound() {
    // After a finished round the match advances its counter; the very first
    // round of a match starts from the fresh state resetMatch left behind.
    if (this.match.phase === ROUND.OVER) this.match.nextRound();
    else this.match.startRound();
    this.bots.resetRound(rng, this.world.sites);
    const [px, pz] = this.world.spawns.harbor[0];
    this.player.reset(px, pz, 0);
    this.spectating = null;
    this.hud.hideDeath();
    this.weapon = new WeaponState('p2000');
    this.owned = new Set(['p2000']);
    this.hasKit = false;
    this.defusing = false;
    this.world.bomb.visible = false;
    this.hud.setBombIndicator('carried');
    this.hud.banner(`ROUND ${this.match.round}`, 'Buy phase — press B for equipment', null);
    setTimeout(() => this.hud.hideBanner(), 2600);
    this.hud.openBuy(this.match.money.harbor, this.owned);
    this.updateHUD();
  }

  buy(key) {
    if (this.match.phase !== ROUND.FREEZE) return;
    const money = this.match.money.harbor;
    const defs = {
      1: { id: 'p2000', price: 0 },
      2: { id: 'mp5', price: WEAPONS.mp5.price },
      3: { id: 'vk47', price: WEAPONS.vk47.price },
      4: { id: 'sentinel', price: WEAPONS.sentinel.price },
      5: { id: 'longshot', price: WEAPONS.longshot.price },
      6: { id: 'kevlar', price: UTILITY.kevlar.price },
      7: { id: 'helmet', price: UTILITY.helmet.price },
      8: { id: 'kit', price: UTILITY.kit.price },
    };
    const item = defs[key];
    if (!item || money < item.price) return;
    this.match.money.harbor -= item.price;
    if (item.id === 'kevlar') {
      this.player.armor = Math.max(this.player.armor, 50);
    } else if (item.id === 'helmet') {
      this.player.armor = 100;
    } else if (item.id === 'kit') {
      this.hasKit = true;
    } else {
      this.owned.add(item.id);
      this.switchWeapon(item.id);
    }
    this.audio.buy();
    this.hud.openBuy(this.match.money.harbor, this.owned);
    this.updateHUD();
  }

  switchWeapon(id) {
    this.weapon = new WeaponState(id);
    this.setScoped(false);
    this.updateHUD();
  }

  reload() {
    if (!this.player.alive || this.weapon.reloading) return;
    if (this.weapon.startReload(this.now)) this.audio.reload();
  }

  // ---- shooting ------------------------------------------------------------
  // Ray vs AABB (slab test) for walls/containers, then vs bot spheres.
  rayHitsWall(origin, dir, maxDist) {
    let best = maxDist;
    for (const c of this.world.colliders) {
      const t = this.rayAABB(origin, dir, c);
      if (t !== null && t < best) best = t;
    }
    return best;
  }

  rayAABB(origin, dir, c) {
    let tmin = 0;
    let tmax = Infinity;
    const axes = [
      [origin.x, dir.x, c.minX, c.maxX],
      [origin.y, dir.y, 0, c.height],
      [origin.z, dir.z, c.minZ, c.maxZ],
    ];
    for (const [o, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-8) {
        if (o < mn || o > mx) return null;
      } else {
        let t1 = (mn - o) / d;
        let t2 = (mx - o) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  rayHitsBot(origin, dir, maxDist) {
    let best = null;
    for (const bot of this.bots.bots) {
      if (!bot.alive || bot.team === 'harbor') continue;
      for (const [y, r, head] of [[1.86, 0.3, true], [1.25, 0.5, false]]) {
        const center = new THREE.Vector3(bot.pos.x, y, bot.pos.z);
        const oc = new THREE.Vector3().subVectors(center, origin);
        const tca = oc.dot(dir);
        if (tca < 0 || tca > maxDist) continue;
        const d2 = oc.lengthSq() - tca * tca;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (!best || t < best.t) best = { bot, t, head, point: origin.clone().addScaledVector(dir, t) };
      }
    }
    return best;
  }

  lineOfSight(from, to) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.01) return true;
    dir.normalize();
    return this.rayHitsWall(from, dir, dist) >= dist - 0.05;
  }

  muzzleWorld() {
    const p = new THREE.Vector3();
    this.muzzle.getWorldPosition(p);
    return p;
  }

  fireWeapon() {
    const now = this.now;
    if (!this.player.alive || !this.weapon.canFire(now)) {
      if (this.weapon.mag === 0 && !this.weapon.reloading) this.audio.dryFire();
      return;
    }
    this.weapon.fire(now);
    this.audio.shot(this.weapon.def.kind);
    const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 1;
    const spread = this.weapon.currentSpread(moving, this.scoped);
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.x += (rng() * 2 - 1) * spread;
    dir.y += (rng() * 2 - 1) * spread;
    dir.z += (rng() * 2 - 1) * spread;
    dir.normalize();
    const origin = this.camera.position.clone();
    const wallT = this.rayHitsWall(origin, dir, 150);
    const botHit = this.rayHitsBot(origin, dir, Math.min(wallT, 150));
    let end;
    if (botHit) {
      end = botHit.point;
      const dmg = damageAtRange(this.weapon.def, botHit.t, botHit.head);
      const dealt = botHit.bot.damage(dmg);
      this.hud.showHitmarker(botHit.head, !botHit.bot.alive);
      this.audio.hit(botHit.head);
      if (!botHit.bot.alive) this.onKill(botHit.bot, botHit.head);
    } else {
      end = origin.clone().addScaledVector(dir, wallT);
      if (wallT < 150) this.spawnSparks(end, 10);
    }
    this.spawnTracer(this.muzzleWorld(), end, this.weapon.def.kind === 'sniper' ? 0xffd27a : 0x7cc4ff);
    this.muzzleLight.intensity = 26;
    this.trauma = Math.min(1, this.trauma + (this.weapon.def.kind === 'sniper' ? 0.5 : 0.16));
    this.viewmodel.position.z = -0.5 + 0.09;
    this.bots.hearShot(this.player.pos.x, this.player.pos.z, now);
    this.updateHUD();
  }

  spawnTracer(from, to, color) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.life = 0.09;
  }

  spawnSparks(at, count) {
    const s = this.sparks[this.sparkIdx];
    this.sparkIdx = (this.sparkIdx + 1) % this.sparks.length;
    const pos = s.pts.geometry.attributes.position.array;
    s.vel = [];
    for (let i = 0; i < 24; i++) {
      if (i < count) {
        pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
        s.vel.push(new THREE.Vector3((rng() - 0.5) * 4, rng() * 3, (rng() - 0.5) * 4));
      } else {
        pos[i * 3 + 1] = -100;
        s.vel.push(new THREE.Vector3());
      }
    }
    s.pts.geometry.attributes.position.needsUpdate = true;
    s.pts.material.opacity = 0.95;
    s.life = 0.4;
  }

  onKill(bot, head) {
    this.kills += 1;
    this.match.awardKill('harbor');
    this.hud.killfeed(`YOU ▸ ${bot.name}${head ? ' (headshot)' : ''}`, true);
    this.audio.roundEnd(true);
    this.checkElimination();
    this.updateHUD();
  }

  onBotShot(bot, target, hit, dmg, head) {
    // Tracer from the bot's gun to the target point.
    const from = bot.eyePos.clone();
    from.y -= 0.25;
    from.add(new THREE.Vector3(Math.sin(bot.yaw) * 0.3, 0, Math.cos(bot.yaw) * 0.3));
    const to = target.kind === 'player'
      ? new THREE.Vector3(this.player.pos.x, 1.4, this.player.pos.z)
      : new THREE.Vector3(target.x, target.y, target.z);
    this.spawnTracer(from, to, bot.team === 'harbor' ? 0x7cc4ff : 0xffb066);
    this.audio.shot(WEAPONS[bot.weaponId].kind);
    if (!hit) return;
    if (target.kind === 'player') {
      const dealt = this.player.damage(dmg, head);
      const ang = Math.atan2(bot.pos.x - this.player.pos.x, bot.pos.z - this.player.pos.z) - this.player.yaw;
      this.hud.damageFlash(ang);
      this.trauma = Math.min(1, this.trauma + 0.35);
      if (!this.player.alive) this.onPlayerDeath(bot);
      this.updateHUD();
    } else {
      const victim = target.ref;
      const dealt = victim.damage(dmg);
      this.hud.killfeed(`${bot.name} ▸ ${victim.name}${head ? ' (headshot)' : ''}`, bot.team === 'harbor');
      if (!victim.alive) {
        this.match.awardKill(bot.team);
        if (victim === this.bots.carrier && this.match.bomb.state === 'carried') {
          this.hud.killfeed('Bomb carrier down — the bomb is loose', false);
        }
        this.checkElimination();
      }
    }
  }

  onPlayerDeath(killerBot) {
    this.setScoped(false);
    this.hud.closeBuy();
    this.hud.showDeath(killerBot ? killerBot.name : null, killerBot ? WEAPONS[killerBot.weaponId].name : '');
    document.exitPointerLock?.();
    this.checkElimination();
  }

  startSpectate() {
    const alive = this.bots.bots.filter((b) => b.alive && b.team === 'harbor');
    this.spectating = alive.length ? alive[0] : null;
    if (!this.spectating) {
      const any = this.bots.bots.filter((b) => b.alive);
      this.spectating = any.length ? any[0] : null;
    }
  }

  checkElimination() {
    const harborAlive = this.bots.aliveCount('harbor') + (this.player.alive ? 1 : 0);
    const stormAlive = this.bots.aliveCount('storm');
    if (this.match.phase === ROUND.PLANTED) {
      // With the bomb down, wiping the attackers does not end the round.
      if (harborAlive === 0) this.match.endRound('storm', 'elimination');
      return;
    }
    if (this.match.phase !== ROUND.LIVE && this.match.phase !== ROUND.FREEZE) return;
    if (stormAlive === 0) this.match.endRound('harbor', 'elimination');
    else if (harborAlive === 0) this.match.endRound('storm', 'elimination');
  }

  // ---- bomb: plant (bots) and defuse (player + bots) -----------------------
  onBotPlantStart(bot, site) {
    this.hud.killfeed(`${bot.name} is planting at site ${site}…`, false);
    this.audio.plantBeep();
  }

  onBotPlantDone(bot, site) {
    if (!this.match.plant(site, bot)) return;
    const s = this.world.sites[site];
    this.world.bomb.position.set(s.x, 0.35, s.z);
    this.world.bomb.visible = true;
    this.hud.setBombIndicator('planted');
    this.hud.banner('BOMB PLANTED', `Site ${site} — ${this.world.sites[site].name}. Defuse it!`, false);
    this.audio.plantBeep(true);
    this.checkElimination();
  }

  onBotDefuseStart(bot) {
    this.hud.killfeed(`${bot.name} is defusing the bomb…`, true);
  }

  onBotDefuseDone(bot) {
    if (this.match.bomb.state === 'planted') this.match.endRound('harbor', 'defuse');
  }

  tryDefuse(dt) {
    if (this.match.bomb.state !== 'planted' || !this.player.alive) return;
    const s = this.world.sites[this.match.bomb.site];
    const d = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z);
    const holdingE = this.input.keys.has('KeyE');
    if (d > 2.6 || !holdingE) {
      if (this.defusing) {
        this.defusing = false;
        this.match.cancelDefuse();
        this.hud.hidePlantProgress();
      }
      return;
    }
    if (!this.defusing) {
      if (!this.match.startDefuse('player', this.hasKit)) return;
      this.defusing = true;
    }
    const done = this.match.updateDefuse(dt);
    this.hud.showPlantProgress('DEFUSING', this.match.bomb.defuseT / this.match.bomb.defuseNeed);
    if (done) {
      this.defusing = false;
      this.hud.hidePlantProgress();
      this.world.bomb.visible = false;
    }
  }

  explodeBomb() {
    const s = this.world.sites[this.match.bomb.site];
    this.world.bomb.visible = false;
    this.boomLight.position.set(s.x, 3, s.z);
    this.boomLight.intensity = 400;
    this.audio.explosion();
    this.trauma = 1;
    const d = Math.hypot(s.x - this.player.pos.x, s.z - this.player.pos.z);
    if (d < 26 && this.player.alive) {
      this.player.damage(120 - d * 2, false);
      if (!this.player.alive) this.onPlayerDeath(null);
    }
  }

  setScoped(scoped) {
    if (this.weapon.def.kind !== 'sniper' && scoped) return;
    this.scoped = scoped;
    this.camera.fov = scoped ? 32 : 78;
    this.camera.updateProjectionMatrix();
    this.hud.setScoped(scoped);
    this.viewmodel.visible = !scoped;
  }

  // ---- round flow + HUD sync ------------------------------------------------
  updateHUD() {
    this.hud.updateStats({
      health: this.player.health,
      armor: this.player.armor,
      money: this.match.money.harbor,
      weapon: this.weapon.def,
      mag: this.weapon.mag,
      reserve: this.weapon.reserve,
      reloading: this.weapon.reloading,
      team: 'harbor',
      kills: this.kills,
    });
    this.hud.updateRound({
      round: this.match.round,
      scoreHarbor: this.match.scoreHarbor,
      scoreStorm: this.match.scoreStorm,
      phase: this.match.phase,
      timeLeft: this.match.roundTimeLeft,
      bombLeft: this.match.bombTimeLeft,
      aliveHarbor: this.bots.aliveCount('harbor') + (this.player.alive ? 1 : 0),
      aliveStorm: this.bots.aliveCount('storm'),
    });
    this.hud.drawMinimap({
      player: this.player,
      bots: this.bots.bots,
      bombSite: this.match.bomb.site,
      bombPlanted: this.match.bomb.state === 'planted',
      sites: this.world.sites,
    });
  }

  onRoundOver() {
    const won = this.match.lastWinner === 'harbor';
    if (this.match.bomb.state === 'planted' && this.match.lastWinReason === 'detonation') this.explodeBomb();
    this.hud.banner(
      won ? 'HARBOR WINS' : 'STORM WINS',
      `${this.match.winReasonText()} · ${this.match.scoreHarbor} — ${this.match.scoreStorm}`,
      won,
    );
    this.audio.roundEnd(won);
    this.hud.closeBuy();
    this.hud.setBombIndicator(this.match.bomb.state);
    if (this.match.phase === ROUND.MATCH_OVER) {
      setTimeout(() => {
        const winner = this.match.matchWinner;
        this.hud.showMenu(
          winner === 'harbor' ? 'HARBOR TAKES THE PORT' : 'STORM TAKES THE PORT',
          `Final score ${this.match.scoreHarbor} — ${this.match.scoreStorm}. ${this.kills} eliminations. Play again for another shift on the docks.`,
          'PLAY AGAIN',
        );
        document.exitPointerLock?.();
      }, 2500);
    }
    this.roundOverAt = this.now;
  }

  update(dt) {
    this.now += dt;
    // Rain follows the player so the storm never thins out.
    this.world.updateRain(dt, this.player.pos.x, this.player.pos.z);
    // Muzzle light and explosion light decay.
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 260);
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 320);
    // Tracers and sparks fade.
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      }
    }
    for (const s of this.sparks) {
      if (s.life > 0) {
        s.life -= dt;
        const pos = s.pts.geometry.attributes.position.array;
        for (let i = 0; i < s.vel.length; i++) {
          pos[i * 3] += s.vel[i].x * dt;
          pos[i * 3 + 1] += s.vel[i].y * dt;
          pos[i * 3 + 2] += s.vel[i].z * dt;
          s.vel[i].y -= 9 * dt;
        }
        s.pts.geometry.attributes.position.needsUpdate = true;
        s.pts.material.opacity = Math.max(0, s.life / 0.4) * 0.95;
      }
    }
    if (!this.started) {
      // Idle menu orbit: slow drift over the port.
      const t = this.now * 0.05;
      this.camera.position.set(Math.sin(t) * 26, 15, Math.cos(t) * 20);
      this.camera.lookAt(0, 1, 0);
      return;
    }
    const prevPhase = this.match.phase;
    if (this.match.phase === ROUND.OVER || this.match.phase === ROUND.MATCH_OVER) {
      if (this.now - this.roundOverAt > 3.5 && this.match.phase === ROUND.OVER) {
        this.startRound();
        return;
      }
    } else {
      this.match.update(dt);
      if (prevPhase !== this.match.phase && this.match.phase === ROUND.LIVE) {
        this.hud.closeBuy();
        this.hud.banner('GO GO GO', 'Storm is pushing the sites', null);
        setTimeout(() => this.hud.hideBanner(), 1500);
      }
    }
    // Bomb beeps speed up as the timer runs down.
    if (this.match.bomb.state === 'planted') {
      const left = this.match.bombTimeLeft;
      const gap = left > 20 ? 1 : left > 10 ? 0.6 : 0.3;
      if (this.now - this.lastBeepAt > gap) {
        this.lastBeepAt = this.now;
        this.audio.plantBeep();
      }
    }
    // Player look + movement (frozen during buy-freeze only for shooting).
    if (this.player.alive && this.input.locked) {
      const { dx, dy } = this.input.consumeMouse();
      this.player.applyLook(dx, dy, 0.0021, this.scoped);
    }
    if (this.player.alive) {
      this.player.update(dt, this.input, 5.4);
      this.weapon.update(this.now, Math.hypot(this.player.vel.x, this.player.vel.z) > 1);
      // Firing: hold for autos, click for semi-autos.
      if (this.input.locked && this.match.phase !== ROUND.FREEZE) {
        if (this.weapon.def.auto ? this.input.mouseDown : this.input.consumeClickEdge()) {
          this.fireWeapon();
        }
      }
      this.tryDefuse(dt);
      // Crosshair spread follows the weapon state.
      const moving = Math.hypot(this.player.vel.x, this.player.vel.z) > 1;
      this.hud.setCrosshairSpread(this.weapon.currentSpread(moving, this.scoped) * 22);
      // Viewmodel recoil recovery.
      this.viewmodel.position.z += ((-0.5) - this.viewmodel.position.z) * Math.min(1, 10 * dt);
      this.viewmodel.position.y = -0.26 + Math.sin(this.player.bobPhase * 2) * 0.006;
    } else if (this.spectating) {
      // Death cam: over the shoulder of a living teammate.
      const b = this.spectating;
      this.camera.position.set(b.pos.x - Math.sin(b.yaw) * 2.4, 2.6, b.pos.z - Math.cos(b.yaw) * 2.4);
      this.camera.lookAt(b.pos.x, 1.4, b.pos.z);
      if (!b.alive) this.startSpectate();
    }
    // Bots act.
    this.bots.update(dt, this.now, this.player, this.match);
    // A round can end anywhere — timeout, elimination, detonation, defuse —
    // so the round-over banner, sound and intermission timer are fired once,
    // here, whenever the phase just flipped to OVER or MATCH_OVER.
    if (
      (this.match.phase === ROUND.OVER || this.match.phase === ROUND.MATCH_OVER) &&
      prevPhase !== ROUND.OVER &&
      prevPhase !== ROUND.MATCH_OVER &&
      prevPhase !== this.match.phase
    ) {
      this.onRoundOver();
    }
    // Camera shake from damage and explosions.
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      const s = this.trauma * this.trauma * 0.02;
      this.camera.rotation.x += (rng() - 0.5) * s;
      this.camera.rotation.y += (rng() - 0.5) * s;
    }
    this.updateHUD();
  }

  loop() {
    let last = performance.now();
    const tick = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      this.update(dt);
      this.renderer.render(this.scene, this.camera);
      if (!this.frozen) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---- deterministic screenshot staging -------------------------------------
  runShot(kind) {
    this.audio.ensure();
    this.started = true;
    this.hud.hideMenu();
    this.startRound();
    const placeBots = (positions) => {
      let i = 0;
      for (const bot of this.bots.bots) {
        if (i >= positions.length) break;
        const [x, z, yaw] = positions[i++];
        bot.reset(x, z, yaw);
      }
    };
    if (kind === 'start') {
      // Buy phase: player at Harbor spawn, teammates beside them, floodlit
      // containers ahead, buy menu open.
      this.player.reset(0, 30, 0);
      placeBots([[-3, 28, 0], [3, 28, 0], [-6, 26, 0], [6, 26, 0]]);
      this.hud.openBuy(this.match.money.harbor, this.owned);
    } else if (kind === 'play') {
      // Mid-round firefight: player in the open strip east of mid, aiming
      // north-east at two Storm bots pushing down the lane, tracer in flight.
      this.match.phase = ROUND.LIVE;
      this.match.phaseT = 62;
      this.hud.closeBuy();
      this.hud.hideBanner();
      // A-site yard: open ground, cranes behind the bots, clear lanes.
      this.player.reset(-20, -12, Math.PI / 2);
      this.weapon = new WeaponState('sentinel');
      this.owned.add('sentinel');
      // Stage the fight by team: Storm bots push across the yard in front of
      // the player, Harbor teammates hold behind them.
      const stormBots = this.bots.bots.filter((b) => b.team === 'storm');
      const harborBots = this.bots.bots.filter((b) => b.team === 'harbor');
      stormBots[0].reset(-31, -9, -Math.PI / 2);
      stormBots[1].reset(-26, -20, -Math.PI / 2);
      stormBots[2].reset(-33, -6, -Math.PI / 2);
      harborBots[1].reset(-14, -8, Math.PI / 2);
      harborBots[2].reset(-12, -16, Math.PI / 2);
      this.player.applyLook(0, 0);
      // A live tracer + a muzzle flash for the frame.
      this.spawnTracer(this.muzzleWorld(), new THREE.Vector3(-31, 1.3, -9), 0x7cc4ff);
      this.muzzleLight.intensity = 20;
    } else {
      // Round end: Harbor just won at site A, banner up, bomb defused.
      this.match.phase = ROUND.OVER;
      this.match.scoreHarbor = 3;
      this.match.scoreStorm = 2;
      this.match.lastWinner = 'harbor';
      this.match.lastWinReason = 'defuse';
      this.player.reset(-28, -6, 0.6);
      placeBots([[-30, -10, 0.4], [-34, -14, 0.8], [0, 0, 0]]);
      this.hud.closeBuy();
      this.hud.banner('HARBOR WINS', 'Bomb defused · 3 — 2', true);
    }
    this.updateHUD();
    // Render twice so shadows and lights settle, then freeze.
    this.update(0.016);
    this.renderer.render(this.scene, this.camera);
    this.update(0.016);
    this.renderer.render(this.scene, this.camera);
    this.frozen = true;
    window.__shotReady = true;
    window.__game = this;
  }
}

const game = new Game();
window.__game = game;
if (shot) {
  game.runShot(shot);
} else {
  game.loop();
}


