// STORMDOCK palette — one place for every colour the port uses, so the night
// look stays consistent across the world, the HUD and the tracers.
export const PALETTE = {
  sky: 0x0a0e1a,
  fog: 0x0b101d,
  moon: 0x9fb4ff,
  floodWarm: 0xffc46b,
  floodCool: 0x9fd8ff,
  asphalt: 0x1a1d22,
  asphaltWet: 0x232830,
  lineYellow: 0xd8a920,
  lineWhite: 0xcfd4d8,
  // Shipping containers: rust red, ocean blue, moss green, sand, slate.
  containers: [0x8c2f26, 0x1f4d6b, 0x3d5a34, 0x9a7b2d, 0x39424e, 0x6b3a5e],
  crane: 0xd8a920,
  craneDark: 0x5a4a12,
  warehouse: 0x2c343c,
  warehouseRoof: 0x1e242b,
  // Teams: Harbor defenders are cool blue, Storm attackers are hot orange.
  harbor: 0x3fa7ff,
  harborDark: 0x1c5f9e,
  storm: 0xff7a2a,
  stormDark: 0x9e4a12,
  tracerHarbor: 0x7cc4ff,
  tracerStorm: 0xffb066,
  muzzle: 0xffd27a,
  bombLight: 0xff3b30,
  plantGreen: 0x39d353,
  rain: 0x8fa8c8,
};

export function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}
