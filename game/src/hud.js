// STORMDOCK HUD — every DOM overlay the player sees: crosshair, health,
// money, ammo, round score, timer, killfeed, buy menu, banners, minimap.
// The game logic never touches the DOM directly; it talks through here.
import { WEAPONS, UTILITY } from './weapons.js';
import { hexCss } from './palette.js';

const el = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.buyOpen = false;
    this.onBuy = null;
    this.onCloseBuy = null;
    this.onRespawn = null;
    this.minimap = el('minimap');
    this.mmCtx = this.minimap ? this.minimap.getContext('2d') : null;
  }

  setCrosshairSpread(px) {
    const gap = 6 + px * 26;
    document.documentElement.style.setProperty('--xhair-gap', `${gap.toFixed(1)}px`);
    const xhair = el('crosshair');
    if (xhair) xhair.style.opacity = px > 0.85 ? '0.55' : '1';
  }

  setScoped(scoped) {
    document.body.classList.toggle('scoped', scoped);
  }

  showHitmarker(head, kill) {
    const hm = el('hitmarker');
    if (!hm) return;
    hm.classList.remove('show', 'kill', 'head');
    void hm.offsetWidth;
    hm.classList.add('show');
    if (kill) hm.classList.add('kill');
    if (head) hm.classList.add('head');
  }

  damageFlash(fromAngle) {
    const dmg = el('damage-vignette');
    if (!dmg) return;
    dmg.classList.remove('show');
    void dmg.offsetWidth;
    dmg.classList.add('show');
    const dir = el('damage-dir');
    if (dir && fromAngle !== null) {
      dir.style.transform = `translate(-50%, -50%) rotate(${fromAngle}rad)`;
      dir.classList.remove('show');
      void dir.offsetWidth;
      dir.classList.add('show');
    }
  }

  updateStats({ health, armor, money, weapon, mag, reserve, reloading, team, kills }) {
    const setText = (id, text) => {
      const n = el(id);
      if (n) n.textContent = text;
    };
    setText('health-num', String(Math.ceil(health)));
    const hp = el('health-bar');
    if (hp) hp.style.width = `${Math.max(0, health)}%`;
    const ap = el('armor-bar');
    if (ap) ap.style.width = `${Math.max(0, armor)}%`;
    setText('money-num', `$${money}`);
    setText('ammo-mag', reloading ? '--' : String(mag));
    setText('ammo-reserve', String(reserve));
    setText('weapon-name', weapon ? weapon.name : '');
    setText('kills-num', String(kills || 0));
    const hpWrap = el('health-wrap');
    if (hpWrap) hpWrap.classList.toggle('low', health <= 30);
  }

  updateRound({ round, scoreHarbor, scoreStorm, phase, timeLeft, bombLeft, aliveHarbor, aliveStorm }) {
    const setText = (id, text) => {
      const n = el(id);
      if (n) n.textContent = text;
    };
    setText('round-num', `ROUND ${round}`);
    setText('score-harbor', String(scoreHarbor));
    setText('score-storm', String(scoreStorm));
    setText('alive-harbor', `● ${aliveHarbor}`);
    setText('alive-storm', `● ${aliveStorm}`);
    const timer = el('timer');
    if (timer) {
      const t = phase === 'planted' ? bombLeft : timeLeft;
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60).toString().padStart(2, '0');
      timer.textContent = `${m}:${s}`;
      timer.classList.toggle('danger', t <= 10);
      timer.classList.toggle('bomb', phase === 'planted');
    }
    const phaseLabel = el('phase-label');
    if (phaseLabel) {
      phaseLabel.textContent =
        phase === 'freeze' ? 'BUY PHASE' : phase === 'live' ? 'DEFEND THE SITES' : phase === 'planted' ? 'BOMB PLANTED' : phase === 'over' ? 'ROUND OVER' : 'MATCH OVER';
    }
  }

  killfeed(text, good) {
    const feed = el('killfeed');
    if (!feed) return;
    const row = document.createElement('div');
    row.className = 'kf-row' + (good ? ' good' : '');
    row.textContent = text;
    feed.prepend(row);
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
    setTimeout(() => row.classList.add('fade'), 4200);
  }

  banner(title, sub, good) {
    const b = el('banner');
    if (!b) return;
    b.querySelector('.banner-title').textContent = title;
    b.querySelector('.banner-sub').textContent = sub || '';
    b.classList.remove('show', 'good', 'bad');
    void b.offsetWidth;
    const tone = good === true ? 'good' : good === false ? 'bad' : null;
    b.classList.add('show');
    if (tone) b.classList.add(tone);
  }

  hideBanner() {
    const b = el('banner');
    if (b) b.classList.remove('show');
  }

  showCenter(text, sub) {
    const c = el('center-msg');
    if (!c) return;
    c.querySelector('.center-title').textContent = text;
    c.querySelector('.center-sub').textContent = sub || '';
    c.classList.add('show');
  }

  hideCenter() {
    const c = el('center-msg');
    if (c) c.classList.remove('show');
  }

  showPlantProgress(label, frac) {
    const p = el('plant-bar');
    if (!p) return;
    p.classList.add('show');
    p.querySelector('.plant-label').textContent = label;
    p.querySelector('.plant-fill').style.width = `${Math.round(frac * 100)}%`;
  }

  hidePlantProgress() {
    const p = el('plant-bar');
    if (p) p.classList.remove('show');
  }

  // ---- buy menu ------------------------------------------------------------
  openBuy(money, owned) {
    this.buyOpen = true;
    const menu = el('buy-menu');
    if (!menu) return;
    menu.classList.add('show');
    const list = el('buy-list');
    list.innerHTML = '';
    const addRow = (key, name, price, desc, disabled) => {
      const row = document.createElement('button');
      row.className = 'buy-row' + (disabled ? ' disabled' : '');
      row.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${name}</span><span class="buy-desc">${desc}</span><span class="buy-price">$${price}</span>`;
      if (!disabled) {
        row.addEventListener('click', () => {
          if (this.onBuy) this.onBuy(key);
        });
      }
      list.appendChild(row);
    };
    const defs = [
      ['1', 'p2000', 'P2000', 'Free sidearm', ''],
      ['2', 'mp5', 'MP5 Storm', 'Fast SMG, close range', ''],
      ['3', 'vk47', 'VK-47', 'Hard-hitting rifle', ''],
      ['4', 'sentinel', 'AR-15 Sentinel', 'Accurate rifle', ''],
      ['5', 'longshot', 'Longshot .50', 'One-shot sniper', ''],
    ];
    for (const [key, id, name, desc] of defs) {
      const w = WEAPONS[id];
      addRow(key, name, w.price, desc, money < w.price);
    }
    addRow('6', UTILITY.kevlar.name, UTILITY.kevlar.price, 'Halves damage taken', money < UTILITY.kevlar.price);
    addRow('7', UTILITY.helmet.name, UTILITY.helmet.price, 'Kevlar + head protection', money < UTILITY.helmet.price);
    addRow('8', UTILITY.kit.name, UTILITY.kit.price, 'Defuse in half the time', money < UTILITY.kit.price);
    const moneyEl = el('buy-money');
    if (moneyEl) moneyEl.textContent = `$${money}`;
  }

  closeBuy() {
    this.buyOpen = false;
    const menu = el('buy-menu');
    if (menu) menu.classList.remove('show');
  }

  showMenu(title, sub, buttonLabel) {
    const m = el('menu');
    if (!m) return;
    m.querySelector('.menu-title').textContent = title;
    m.querySelector('.menu-sub').textContent = sub || '';
    m.querySelector('.menu-button').textContent = buttonLabel || 'DEPLOY';
    m.classList.add('show');
  }

  hideMenu() {
    const m = el('menu');
    if (m) m.classList.remove('show');
  }

  bindMenuButton(fn) {
    const b = el('menu');
    if (b) b.querySelector('.menu-button').addEventListener('click', fn);
  }

  showDeath(killerName, weaponName) {
    const d = el('death-screen');
    if (!d) return;
    d.querySelector('.death-killer').textContent = killerName ? `Eliminated by ${killerName}` : 'Eliminated';
    d.querySelector('.death-weapon').textContent = weaponName || '';
    d.classList.add('show');
  }

  hideDeath() {
    const d = el('death-screen');
    if (d) d.classList.remove('show');
  }

  // ---- minimap: top-down dots on the port ----------------------------------
  drawMinimap({ player, bots, bombSite, bombPlanted, sites }) {
    if (!this.mmCtx) return;
    const ctx = this.mmCtx;
    const W = 168;
    const H = 126;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(8,12,20,0.82)';
    ctx.fillRect(0, 0, W, H);
    const toMap = (x, z) => [((x + 48) / 96) * W, ((z + 36) / 72) * H];
    // Site letters.
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const key of ['A', 'B']) {
      const s = sites[key];
      const [mx, my] = toMap(s.x, s.z);
      ctx.fillStyle = bombPlanted && bombSite === key ? '#ff3b30' : 'rgba(255,107,94,0.85)';
      ctx.beginPath();
      ctx.arc(mx, my, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0e14';
      ctx.fillText(key, mx, my + 0.5);
    }
    // Bots: blue teammates, orange enemies (only show enemies when close to
    // the player or recently heard — here, always, the map is small).
    for (const bot of bots) {
      if (!bot.alive) continue;
      const [mx, my] = toMap(bot.pos.x, bot.pos.z);
      ctx.fillStyle = bot.team === 'harbor' ? '#3fa7ff' : '#ff7a2a';
      ctx.beginPath();
      ctx.arc(mx, my, 3.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (player.alive) {
      const [mx, my] = toMap(player.pos.x, player.pos.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(mx, my, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx - Math.sin(player.yaw) * 10, my - Math.cos(player.yaw) * 10);
      ctx.stroke();
    }
  }

  setBombIndicator(state) {
    const b = el('bomb-indicator');
    if (!b) return;
    b.classList.toggle('show', state === 'planted');
    if (state === 'carried') b.textContent = 'BOMB IN PLAY';
    else if (state === 'planted') b.textContent = '⚠ BOMB PLANTED';
    else b.textContent = '';
  }
}
