// STORMDOCK bots — five attackers (Storm) and four defender teammates
// (Harbor) driven by a waypoint graph: they buy, rush or hold, react to
// gunfire, plant and defuse, and retake. A bot is a capsule + a name tag;
// its brain is a small state machine with human-like reaction delays.
import * as THREE from '../vendor/three/three.module.min.js';
import { PALETTE } from './palette.js';
import { WEAPONS, damageAtRange } from './weapons.js';

export const BOT_NAMES_HARBOR = ['DOCK', 'REEF', 'TIDE', 'ANCHOR'];
export const BOT_NAMES_STORM = ['GALE', 'SURGE', 'BREAKER', 'MONSOON', 'TEMPEST'];

function bfsPath(nodes, fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, -1]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of nodes[cur].links) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      if (nb === toId) {
        const path = [toId];
        let c = toId;
        while (prev.get(c) !== -1) {
          c = prev.get(c);
          path.unshift(c);
        }
        return path;
      }
      queue.push(nb);
    }
  }
  return [toId];
}

function nearestNode(nodes, x, z) {
  let best = 0;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n.id;
    }
  }
  return best;
}

function makeNameSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.font = 'bold 34px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.9)';
  g.strokeText(text, 128, 32);
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(2.4, 0.6, 1);
  return sprite;
}

export class Bot {
  constructor(scene, { team, name, isCarrier = false }) {
    this.team = team;
    this.name = name;
    this.isCarrier = isCarrier;
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.speed = 3.4 + Math.random() * 0.7;
    this.weaponId = team === 'storm' ? 'vk47' : 'sentinel';
    this.mag = WEAPONS[this.weaponId].mag;
    this.reserve = WEAPONS[this.weaponId].reserve;
    this.reloadUntil = 0;
    this.lastShotAt = -10;
    this.reactAt = 0; // earliest time this bot may shoot at a seen target
    this.target = null;
    this.path = [];
    this.pathIdx = 0;
    this.waitUntil = 0;
    this.holdPos = null;
    this.planting = null;
    this.defusing = null;
    this.aggro = null; // {x, z} last heard gunfire
    this.aggroUntil = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    this.strafeUntil = 0;
    this.flashUntil = 0;

    const color = team === 'harbor' ? PALETTE.harbor : PALETTE.storm;
    const dark = team === 'harbor' ? PALETTE.harborDark : PALETTE.stormDark;
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.7, metalness: 0.3 });
    const vestMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.85, 4, 10), bodyMat);
    body.position.y = 1.05;
    body.castShadow = true;
    this.group.add(body);
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.4), vestMat);
    vest.position.y = 1.25;
    vest.castShadow = true;
    this.group.add(vest);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0x2b2b26, roughness: 0.5, metalness: 0.4 }));
    head.position.y = 1.86;
    head.castShadow = true;
    this.group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.1),
      new THREE.MeshBasicMaterial({ color }));
    visor.position.set(0, 1.88, 0.2);
    this.group.add(visor);
    // Gun: a dark box held forward, so the bot reads as armed at a glance.
    this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85),
      new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.8 }));
    this.gun.position.set(0.28, 1.3, 0.45);
    this.group.add(this.gun);
    // Bomb pack on the carrier's back.
    if (isCarrier) {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.22),
        new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.7 }));
      pack.position.set(0, 1.3, -0.3);
      this.group.add(pack);
      const blink = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06),
        new THREE.MeshBasicMaterial({ color: PALETTE.bombLight }));
      blink.position.set(0, 1.58, -0.42);
      this.group.add(blink);
      this.bombBlink = blink;
    }
    const tag = makeNameSprite(name, team === 'harbor' ? '#7cc4ff' : '#ffb066');
    tag.position.y = 2.35;
    this.group.add(tag);
    this.tag = tag;
    scene.add(this.group);
  }

  get eyePos() {
    return new THREE.Vector3(this.pos.x, 1.62, this.pos.z);
  }

  reset(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.health = 100;
    this.armor = 0;
    this.alive = true;
    this.mag = WEAPONS[this.weaponId].mag;
    this.reserve = WEAPONS[this.weaponId].reserve;
    this.reloadUntil = 0;
    this.target = null;
    this.path = [];
    this.pathIdx = 0;
    this.waitUntil = 0;
    this.holdPos = null;
    this.planting = null;
    this.defusing = null;
    this.aggro = null;
    this.group.visible = true;
    this.group.position.copy(this.pos);
  }

  damage(amount) {
    if (!this.alive) return 0;
    let remaining = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, remaining * 0.5);
      this.armor -= absorbed;
      remaining -= absorbed;
    }
    this.health -= remaining;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.group.visible = false;
    }
    return remaining;
  }

  setPath(nodes, toId) {
    const from = nearestNode(nodes, this.pos.x, this.pos.z);
    this.path = bfsPath(nodes, from, toId);
    this.pathIdx = 0;
  }

  // Move along the current path; returns true while still walking.
  followPath(dt, nodes) {
    if (this.pathIdx >= this.path.length) return false;
    const node = nodes[this.path[this.pathIdx]];
    const dx = node.x - this.pos.x;
    const dz = node.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.9) {
      this.pathIdx += 1;
      return this.pathIdx < this.path.length;
    }
    const step = Math.min(dist, this.speed * dt);
    this.pos.x += (dx / dist) * step;
    this.pos.z += (dz / dist) * step;
    this.yaw = Math.atan2(dx, dz);
    return true;
  }

  hearShot(x, z, now) {
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d < 55) {
      this.aggro = { x, z };
      this.aggroUntil = now + 4;
    }
  }
}

// ---------------------------------------------------------------------------
// BotManager — owns all nine bots, their round plans and their trigger
// fingers. Vision is a range + field-of-view + wall test; shots are hitscan
// with a reaction delay and a spread that grows when the bot is moving.
// ---------------------------------------------------------------------------
export class BotManager {
  constructor(scene, world, hooks) {
    this.scene = scene;
    this.world = world;
    this.hooks = hooks; // { onBotShot(bot, targetPos, hit, dmg, head), onBotKilled(bot, killer), onPlantStart, onPlantDone, onDefuseStart, onDefuseDone, los(from, to), damagePlayer(amount, head, bot), damageBot(bot, amount, head) }
    this.bots = [];
    for (const name of BOT_NAMES_HARBOR) {
      this.bots.push(new Bot(scene, { team: 'harbor', name }));
    }
    for (let i = 0; i < BOT_NAMES_STORM.length; i++) {
      this.bots.push(new Bot(scene, { team: 'storm', name: BOT_NAMES_STORM[i], isCarrier: i === 0 }));
    }
    this.carrier = this.bots.find((b) => b.isCarrier);
    this.roundPlan = new Map(); // bot -> { site, hold }
    this.now = 0;
  }

  get alive() {
    return this.bots.filter((b) => b.alive);
  }

  aliveCount(team) {
    return this.bots.filter((b) => b.alive && b.team === team).length;
  }

  resetRound(rng, sites) {
    const harborSpawns = this.world.spawns.harbor;
    const stormSpawns = this.world.spawns.storm;
    let hi = 0;
    let si = 0;
    this.roundPlan.clear();
    // Attackers pick a site as a pack; defenders split: 2 to A, 2 to B, 1 mid.
    const attackSite = rng() < 0.5 ? 'A' : 'B';
    for (const bot of this.bots) {
      if (bot.team === 'harbor') {
        const [x, z] = harborSpawns[hi % harborSpawns.length];
        hi += 1;
        bot.reset(x, z, 0);
        const hold = hi % 3 === 0 ? 'mid' : hi % 3 === 1 ? 'A' : 'B';
        this.roundPlan.set(bot, { site: hold, hold: true });
      } else {
        const [x, z] = stormSpawns[si % stormSpawns.length];
        si += 1;
        bot.reset(x, z, Math.PI);
        this.roundPlan.set(bot, { site: attackSite, hold: false });
      }
      bot.weaponId = bot.team === 'storm' ? (bot.name === 'TEMPEST' ? 'longshot' : 'vk47') : 'sentinel';
      bot.armor = 50;
    }
  }

  planMove(bot, now) {
    const plan = this.roundPlan.get(bot);
    if (!plan) return;
    const nodes = this.world.waypoints;
    if (bot.team === 'storm') {
      const site = this.world.sites[plan.site];
      const targetId = plan.site === 'A' ? 19 : 20;
      if (!bot.path.length || bot.pathIdx >= bot.path.length) {
        // Already at the site? Hold and wait for the plant.
        const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
        if (d < site.radius) return;
        bot.setPath(nodes, targetId);
      }
    } else if (plan.hold) {
      const anchor = plan.site === 'A' ? { x: -26, z: -10 } : plan.site === 'B' ? { x: 26, z: 6 } : { x: 0, z: 2 };
      const d = Math.hypot(anchor.x - bot.pos.x, anchor.z - bot.pos.z);
      if (d > 3 && (!bot.path.length || bot.pathIdx >= bot.path.length)) {
        const targetId = plan.site === 'A' ? 15 : plan.site === 'B' ? 17 : 3;
        bot.setPath(nodes, targetId);
      }
    }
  }

  // Who can this bot see? The player and every enemy bot, filtered by range,
  // a 100-degree view cone and a wall test supplied by the game.
  acquire(bot, player, now) {
    if (now < bot.flashUntil) return null;
    const candidates = [];
    // The player is Harbor: only Storm bots may target them.
    if (player.alive && bot.team === 'storm') {
      candidates.push({ kind: 'player', x: player.pos.x, z: player.pos.z, y: 1.4, ref: player });
    }
    for (const other of this.bots) {
      if (!other.alive || other.team === bot.team) continue;
      candidates.push({ kind: 'bot', x: other.pos.x, z: other.pos.z, y: 1.3, ref: other });
    }
    let best = null;
    let bestD = Infinity;
    const eye = bot.eyePos;
    for (const c of candidates) {
      const dx = c.x - eye.x;
      const dz = c.z - eye.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 46) continue;
      const ang = Math.atan2(dx, dz);
      let diff = Math.abs(ang - bot.yaw);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff > 1.05 && dist > 6) continue; // outside the view cone
      if (!this.hooks.los(eye, new THREE.Vector3(c.x, c.y, c.z))) continue;
      if (dist < bestD) {
        bestD = dist;
        best = { ...c, dist };
      }
    }
    if (best && !bot.target) {
      // First sight: a human-like reaction delay before the first shot.
      bot.reactAt = now + 0.35 + Math.random() * 0.45;
    }
    return best;
  }

  botShoot(bot, target, now) {
    const def = WEAPONS[bot.weaponId];
    if (now - bot.lastShotAt < 60 / def.rpm) return;
    if (now < bot.reloadUntil) return;
    if (bot.mag <= 0) {
      bot.reloadUntil = now + def.reload;
      bot.mag = def.mag;
      bot.reserve = Math.max(0, bot.reserve - def.mag);
      return;
    }
    bot.lastShotAt = now;
    bot.mag -= 1;
    // Spread grows with distance and bot movement; headshots are rare luck.
    const moving = bot.pathIdx < bot.path.length;
    const spread = def.spread * (moving ? 2.2 : 1) + target.dist * 0.00045;
    const roll = Math.random();
    const hitChance = Math.max(0.12, 0.62 - target.dist * 0.007 - spread * 4);
    const hit = roll < hitChance;
    const head = hit && Math.random() < 0.14;
    const dmg = hit ? damageAtRange(def, target.dist, head) : 0;
    this.hooks.onBotShot(bot, target, hit, dmg, head);
    if (bot.mag === 0) {
      bot.reloadUntil = now + def.reload;
      bot.mag = def.mag;
      bot.reserve = Math.max(0, bot.reserve - def.mag);
    }
  }

  update(dt, now, player, match) {
    this.now = now;
    const phase = match.phase;
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      if (bot.bombBlink) bot.bombBlink.visible = Math.floor(now * 2) % 2 === 0;
      // Freeze phase: nobody moves, nobody shoots — the buy phase is sacred.
      if (phase === 'freeze') continue;
      // Planting / defusing take both hands: the bot stands still.
      if (bot.planting) {
        bot.planting.t += dt;
        if (bot.planting.t >= 3) {
          const site = bot.planting.site;
          bot.planting = null;
          this.hooks.onPlantDone(bot, site);
        }
        continue;
      }
      if (bot.defusing) {
        bot.defusing.t += dt;
        if (bot.defusing.t >= bot.defusing.need) {
          bot.defusing = null;
          this.hooks.onDefuseDone(bot);
        }
        continue;
      }
      bot.target = this.acquire(bot, player, now);
      if (bot.target) {
        // Face the target, strafe a little, and shoot once reacted.
        const dx = bot.target.x - bot.pos.x;
        const dz = bot.target.z - bot.pos.z;
        bot.yaw = Math.atan2(dx, dz);
        if (now > bot.strafeUntil) {
          bot.strafeDir *= -1;
          bot.strafeUntil = now + 0.7 + Math.random() * 0.9;
        }
        if (bot.target.dist > 9) {
          bot.pos.x += Math.sin(bot.yaw + Math.PI / 2) * bot.strafeDir * bot.speed * 0.35 * dt;
          bot.pos.z += Math.cos(bot.yaw + Math.PI / 2) * bot.strafeDir * bot.speed * 0.35 * dt;
        }
        if (now >= bot.reactAt) this.botShoot(bot, bot.target, now);
        // A carrier who sees the player still plants if already on site.
        if (bot.isCarrier && phase === 'live' && match.bomb.state === 'carried') {
          const site = this.world.sites[this.roundPlan.get(bot).site];
          if (Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z) < site.radius - 1 && !bot.target) {
            this.startPlant(bot, this.roundPlan.get(bot).site);
          }
        }
        continue;
      }
      // No target: follow the round plan.
      if (phase === 'freeze') continue;
      if (phase === 'planted') {
        // Defenders retake the planted site; attackers hold around it.
        const site = match.bomb.site;
        if (bot.team === 'harbor') {
          const targetId = site === 'A' ? 19 : 20;
          const d = Math.hypot(this.world.sites[site].x - bot.pos.x, this.world.sites[site].z - bot.pos.z);
          if (d < 2.5 && match.bomb.state === 'planted') {
            this.startDefuse(bot);
            continue;
          }
          if (!bot.path.length || bot.pathIdx >= bot.path.length) bot.setPath(this.world.waypoints, targetId);
          bot.followPath(dt, this.world.waypoints);
        } else {
          const sitePos = this.world.sites[site];
          const d = Math.hypot(sitePos.x - bot.pos.x, sitePos.z - bot.pos.z);
          if (d > 9 && (!bot.path.length || bot.pathIdx >= bot.path.length)) {
            bot.setPath(this.world.waypoints, site === 'A' ? 19 : 20);
          } else if (d > 9) {
            bot.followPath(dt, this.world.waypoints);
          } else if (now > bot.waitUntil) {
            bot.waitUntil = now + 2 + Math.random() * 3;
            bot.yaw += (Math.random() - 0.5) * 2;
          }
        }
        continue;
      }
      // Live, no plant yet.
      if (bot.team === 'storm') {
        const plan = this.roundPlan.get(bot);
        const site = this.world.sites[plan.site];
        const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
        if (bot.isCarrier && d < site.radius - 1 && match.bomb.state === 'carried') {
          this.startPlant(bot, plan.site);
          continue;
        }
        this.planMove(bot, now);
        bot.followPath(dt, this.world.waypoints);
      } else {
        // Defender: walk to the hold anchor, then watch the lane.
        this.planMove(bot, now);
        if (bot.followPath(dt, this.world.waypoints)) {
          // walking
        } else if (now > bot.waitUntil) {
          bot.waitUntil = now + 1.5 + Math.random() * 2.5;
          bot.yaw += (Math.random() - 0.5) * 1.6;
        }
        // If gunfire was heard nearby, peek toward it.
        if (bot.aggro && now < bot.aggroUntil) {
          const dx = bot.aggro.x - bot.pos.x;
          const dz = bot.aggro.z - bot.pos.z;
          if (Math.hypot(dx, dz) > 4) bot.yaw = Math.atan2(dx, dz);
        }
      }
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
    }
    // Keep every visible bot's group transform in sync.
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      bot.group.position.copy(bot.pos);
      bot.group.rotation.y = bot.yaw;
    }
  }

  startPlant(bot, site) {
    bot.planting = { site, t: 0 };
    bot.path = [];
    this.hooks.onPlantStart(bot, site);
  }

  startDefuse(bot) {
    const hasKit = false; // bots buy kits rarely; keep defuse at full time
    bot.defusing = { t: 0, need: hasKit ? 5 : 10 };
    bot.path = [];
    this.hooks.onDefuseStart(bot);
  }

  hearShot(x, z, now) {
    for (const bot of this.bots) if (bot.alive) bot.hearShot(x, z, now);
  }
}

