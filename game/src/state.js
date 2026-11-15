// STORMDOCK match state — rounds, economy, the bomb, win conditions.
// Pure logic: no three.js, no DOM, so the rules can be unit-tested in Node.
export const ROUND = {
  FREEZE: 'freeze',
  LIVE: 'live',
  PLANTED: 'planted',
  OVER: 'over',
  MATCH_OVER: 'match_over',
};

export const WIN_ROUNDS = 8;
export const MAX_ROUNDS = 15;
export const FREEZE_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 10;
export const DEFUSE_KIT_SECONDS = 5;
export const BOMB_SECONDS = 40;

export const ECONOMY = {
  start: 800,
  kill: 300,
  win: 3250,
  loss: 1900,
  lossStreakBonus: 500,
  maxLossBonus: 1400,
  plantBonus: 300,
};

export class MatchState {
  constructor() {
    this.resetMatch();
  }

  resetMatch() {
    this.round = 1;
    this.scoreHarbor = 0;
    this.scoreStorm = 0;
    this.phase = ROUND.FREEZE;
    this.phaseT = FREEZE_SECONDS;
    this.bomb = { state: 'carried', site: null, planter: null, plantT: 0, defuseT: 0, defuser: null };
    this.money = { harbor: 800, storm: 800 };
    this.lossStreak = { harbor: 0, storm: 0 };
    this.lastWinner = null;
    this.lastWinReason = '';
    this.kills = { harbor: 0, storm: 0 };
  }

  startRound() {
    this.phase = ROUND.FREEZE;
    this.phaseT = FREEZE_SECONDS;
    this.bomb = { state: 'carried', site: null, planter: null, plantT: 0, defuseT: 0, defuser: null };
  }

  get roundTimeLeft() {
    return Math.max(0, this.phaseT);
  }

  get bombTimeLeft() {
    if (this.bomb.state !== 'planted') return 0;
    return Math.max(0, BOMB_SECONDS - this.bomb.plantT);
  }

  update(dt) {
    if (this.phase === ROUND.FREEZE || this.phase === ROUND.LIVE) {
      this.phaseT -= dt;
      if (this.phase === ROUND.FREEZE && this.phaseT <= 0) {
        this.phase = ROUND.LIVE;
        this.phaseT = ROUND_SECONDS;
      } else if (this.phase === ROUND.LIVE && this.phaseT <= 0) {
        // Time out with no plant: defenders win the round.
        this.endRound('harbor', 'time');
      }
    } else if (this.phase === ROUND.PLANTED) {
      this.bomb.plantT += dt;
      if (this.bomb.plantT >= BOMB_SECONDS) this.endRound('storm', 'detonation');
    }
    return this.phase;
  }

  plant(site, planter) {
    if (this.phase !== ROUND.LIVE || this.bomb.state !== 'carried') return false;
    this.bomb.state = 'planted';
    this.bomb.site = site;
    this.bomb.planter = planter;
    this.bomb.plantT = 0;
    this.phase = ROUND.PLANTED;
    return true;
  }

  startDefuse(who, hasKit) {
    if (this.bomb.state !== 'planted' || this.bomb.defuser) return false;
    this.bomb.defuser = who;
    this.bomb.defuseT = 0;
    this.bomb.defuseNeed = hasKit ? DEFUSE_KIT_SECONDS : DEFUSE_SECONDS;
    return true;
  }

  updateDefuse(dt) {
    if (this.bomb.state !== 'planted' || !this.bomb.defuser) return false;
    this.bomb.defuseT += dt;
    if (this.bomb.defuseT >= this.bomb.defuseNeed) {
      this.bomb.state = 'defused';
      this.endRound('harbor', 'defuse');
      return true;
    }
    return false;
  }

  cancelDefuse() {
    this.bomb.defuser = null;
    this.bomb.defuseT = 0;
  }

  awardKill(team) {
    this.kills[team] += 1;
    this.money[team] += ECONOMY.kill;
  }

  endRound(winner, reason) {
    if (this.phase === ROUND.OVER || this.phase === ROUND.MATCH_OVER) return;
    this.lastWinner = winner;
    this.lastWinReason = reason;
    const loser = winner === 'harbor' ? 'storm' : 'harbor';
    this.money[winner] += ECONOMY.win;
    this.lossStreak[loser] += 1;
    const bonus = Math.min(ECONOMY.maxLossBonus, (this.lossStreak[loser] - 1) * ECONOMY.lossStreakBonus);
    this.money[loser] += ECONOMY.loss + bonus;
    this.lossStreak[winner] = 0;
    if (winner === 'harbor') this.scoreHarbor += 1;
    else this.scoreStorm += 1;
    if (this.scoreHarbor >= WIN_ROUNDS || this.scoreStorm >= WIN_ROUNDS || this.round >= MAX_ROUNDS) {
      this.phase = ROUND.MATCH_OVER;
    } else {
      this.phase = ROUND.OVER;
    }
  }

  nextRound() {
    if (this.phase === ROUND.MATCH_OVER) return false;
    this.round += 1;
    this.startRound();
    return true;
  }

  get matchWinner() {
    if (this.phase !== ROUND.MATCH_OVER) return null;
    if (this.scoreHarbor === this.scoreStorm) return this.scoreHarbor >= this.scoreStorm ? 'harbor' : 'storm';
    return this.scoreHarbor > this.scoreStorm ? 'harbor' : 'storm';
  }

  winReasonText() {
    const map = {
      elimination: 'Enemy team eliminated',
      time: 'Time expired — site held',
      detonation: 'Bomb detonated',
      defuse: 'Bomb defused',
    };
    return map[this.lastWinReason] || this.lastWinReason;
  }
}
