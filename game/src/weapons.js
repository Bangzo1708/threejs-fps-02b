// STORMDOCK weapons — every gun is data here, so the buy menu, the HUD and
// the shooting code all read the same numbers. Damage falls off with range
// and headshots multiply it; accuracy rewards standing still and tapping.
export const WEAPONS = {
  p2000: {
    name: 'P2000', kind: 'pistol', price: 0, damage: 35, headMult: 4.0,
    rpm: 360, mag: 13, reserve: 52, reload: 1.1, spread: 0.011, moveSpread: 0.02,
    range: 42, auto: false, zoom: 1, tracer: 'harbor',
  },
  mp5: {
    name: 'MP5 Storm', kind: 'smg', price: 1500, damage: 26, headMult: 4.0,
    rpm: 750, mag: 30, reserve: 120, reload: 1.9, spread: 0.016, moveSpread: 0.03,
    range: 38, auto: true, zoom: 1, tracer: 'harbor',
  },
  vk47: {
    name: 'VK-47', kind: 'rifle', price: 2700, damage: 36, headMult: 4.0,
    rpm: 600, mag: 30, reserve: 90, reload: 2.2, spread: 0.009, moveSpread: 0.026,
    range: 70, auto: true, zoom: 1, tracer: 'storm',
  },
  sentinel: {
    name: 'AR-15 Sentinel', kind: 'rifle', price: 3100, damage: 33, headMult: 4.0,
    rpm: 666, mag: 25, reserve: 75, reload: 2.1, spread: 0.007, moveSpread: 0.022,
    range: 75, auto: true, zoom: 1.15, tracer: 'harbor',
  },
  longshot: {
    name: 'Longshot .50', kind: 'sniper', price: 4750, damage: 110, headMult: 2.5,
    rpm: 48, mag: 5, reserve: 15, reload: 3.0, spread: 0.001, moveSpread: 0.09,
    range: 120, auto: false, zoom: 2.4, tracer: 'storm',
  },
};

export const UTILITY = {
  kevlar: { name: 'Kevlar Vest', price: 650 },
  helmet: { name: 'Kevlar + Helmet', price: 1000 },
  flash: { name: 'Flashbang', price: 200 },
  smoke: { name: 'Smoke Grenade', price: 300 },
  kit: { name: 'Defuse Kit', price: 400 },
};

export function damageAtRange(def, distance, head) {
  const falloff = distance <= def.range * 0.5 ? 1 : Math.max(0.45, 1 - (distance - def.range * 0.5) / def.range);
  let dmg = def.damage * falloff;
  if (head) dmg *= def.headMult;
  return dmg;
}

// A weapon instance: ammo, cooldowns, recoil state, bloom. Pure logic, no DOM.
export class WeaponState {
  constructor(defId) {
    this.setWeapon(defId);
    this.recoil = 0;
    this.bloom = 0;
    this.lastShotAt = -10;
    this.reloadingUntil = 0;
  }

  setWeapon(defId) {
    this.defId = defId;
    this.def = WEAPONS[defId];
    this.mag = this.def.mag;
    this.reserve = this.def.reserve;
    this.reloadingUntil = 0;
  }

  get interval() {
    return 60 / this.def.rpm;
  }

  canFire(now) {
    return now - this.lastShotAt >= this.interval && now >= this.reloadingUntil && this.mag > 0;
  }

  fire(now) {
    this.mag -= 1;
    this.lastShotAt = now;
    this.recoil = Math.min(1, this.recoil + (this.def.kind === 'sniper' ? 0.9 : 0.22));
    this.bloom = Math.min(1, this.bloom + 0.16);
  }

  startReload(now) {
    if (this.mag === this.def.mag || this.reserve <= 0 || now < this.reloadingUntil) return false;
    this.reloadingUntil = now + this.def.reload;
    return true;
  }

  finishReload() {
    const need = this.def.mag - this.mag;
    const take = Math.min(need, this.reserve);
    this.mag += take;
    this.reserve -= take;
    this.reloadingUntil = 0;
  }

  get reloading() {
    return this.reloadingUntil > 0;
  }

  update(now, moving) {
    this.recoil = Math.max(0, this.recoil - 0.045);
    this.bloom = Math.max(0, this.bloom - (moving ? 0.008 : 0.03));
    if (this.reloadingUntil > 0 && now >= this.reloadingUntil) this.finishReload();
  }

  currentSpread(moving, scoped) {
    let s = this.def.spread + (moving ? this.def.moveSpread : 0) + this.bloom * 0.02;
    if (scoped) s *= 0.35;
    return s + this.recoil * 0.012;
  }
}
