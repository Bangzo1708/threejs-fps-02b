// STORMDOCK world — a night container port in a storm: wet asphalt, stacked
// shipping containers, two gantry cranes over site A, a warehouse at site B,
// floodlights cutting through rain. All geometry is built from boxes and
// cylinders at load time; no model files, no network.
import * as THREE from '../vendor/three/three.module.min.js';
import { PALETTE } from './palette.js';

export const MAP = { halfX: 48, halfZ: 36, wallHeight: 7 };

// Container footprint in metres (a 20ft box, slightly shrunk for gaps).
const BOX_L = 6.1;
const BOX_W = 2.6;
const BOX_H = 2.6;

function makeTextSprite(text, color, scale = 4) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 256, 256);
  g.font = 'bold 170px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 14;
  g.strokeStyle = 'rgba(0,0,0,0.85)';
  g.strokeText(text, 128, 138);
  g.fillStyle = color;
  g.fillText(text, 128, 138);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

function box(w, h, d, color, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.85,
    metalness: opts.metalness ?? 0.25,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(opts.x ?? 0, (opts.y ?? 0) + h / 2, opts.z ?? 0);
  if (opts.ry) mesh.rotation.y = opts.ry;
  mesh.castShadow = opts.shadow !== false;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildWorld(scene) {
  const colliders = [];
  const addCollider = (x, z, hw, hd, height = 99) => {
    colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, height });
  };

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.fog, 18, 95);

  // ---- lights: cold moon + warm floodlights -------------------------------
  const hemi = new THREE.HemisphereLight(0x2a3a55, 0x0c0e12, 1.15);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(PALETTE.moon, 0.9);
  moon.position.set(-30, 42, -18);
  scene.add(moon);

  const floodPositions = [
    [-38, -28], [38, -28], [-38, 28], [38, 28], [0, -20], [0, 20],
  ];
  const floodLights = [];
  for (const [fx, fz] of floodPositions) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.24, 11, 8),
      new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6, metalness: 0.7 }),
    );
    pole.position.set(fx, 5.5, fz);
    pole.castShadow = true;
    scene.add(pole);
    const head = box(1.4, 0.5, 0.7, 0x1c2026, { x: fx, y: 10.8, z: fz, roughness: 0.5, metalness: 0.6 });
    scene.add(head);
    const warm = (fx + fz) % 2 === 0;
    const spot = new THREE.SpotLight(warm ? PALETTE.floodWarm : PALETTE.floodCool, 1400, 55, 0.62, 0.55, 1.6);
    spot.position.set(fx, 10.8, fz);
    spot.target.position.set(fx * 0.55, 0, fz * 0.55);
    scene.add(spot);
    scene.add(spot.target);
    floodLights.push(spot);
    // Fake volumetric cone so the beam reads in the rain.
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(7.5, 11, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: warm ? PALETTE.floodWarm : PALETTE.floodCool,
        transparent: true, opacity: 0.06, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    cone.position.set((fx + fx * 0.55) / 2, 5.4, (fz + fz * 0.55) / 2);
    const dir = new THREE.Vector3(fx * 0.55 - fx, -10.8, fz * 0.55 - fz).normalize();
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
    scene.add(cone);
  }

  // ---- ground: wet asphalt with painted lane lines and puddles ------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP.halfX * 2, MAP.halfZ * 2),
    new THREE.MeshStandardMaterial({ color: PALETTE.asphaltWet, roughness: 0.32, metalness: 0.55 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.lineYellow });
  const lineMatW = new THREE.MeshBasicMaterial({ color: PALETTE.lineWhite });
  const paintLine = (x, z, w, d, mat) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, z);
    scene.add(m);
  };
  // Centre dashes down mid and along both lanes.
  for (let z = -30; z <= 30; z += 6) paintLine(0, z, 0.35, 2.6, lineMat);
  for (let x = -40; x <= 40; x += 6) paintLine(x, -24, 2.6, 0.35, lineMatW);
  for (let x = -40; x <= 40; x += 6) paintLine(x, 24, 2.6, 0.35, lineMatW);
  // Site boxes.
  paintLine(-32, -12, 14, 0.3, lineMatW);
  paintLine(-32, 12 - 24, 14, 0.3, lineMatW);
  paintLine(32, 8 - 7, 14, 0.3, lineMatW);
  paintLine(32, 8 + 7, 14, 0.3, lineMatW);

  // Puddles: dark, almost-mirror discs that catch the floodlights.
  const puddleMat = new THREE.MeshStandardMaterial({ color: 0x0a0f16, roughness: 0.05, metalness: 1 });
  const puddleSpots = [[-8, 6, 4], [10, -14, 5], [-20, 14, 3.5], [24, -8, 4.5], [4, 24, 3], [-4, -26, 4], [34, 18, 3], [-36, -2, 3.5]];
  for (const [px, pz, r] of puddleSpots) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(r, 24), puddleMat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(px, 0.015, pz);
    scene.add(p);
  }

  // ---- perimeter walls ----------------------------------------------------
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x232a33, roughness: 0.9, metalness: 0.2 });
  const mkWall = (w, h, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  };
  mkWall(MAP.halfX * 2 + 2, MAP.wallHeight, 1, 0, -MAP.halfZ - 0.5);
  mkWall(MAP.halfX * 2 + 2, MAP.wallHeight, 1, 0, MAP.halfZ + 0.5);
  mkWall(1, MAP.wallHeight, MAP.halfZ * 2 + 2, -MAP.halfX - 0.5, 0);
  mkWall(1, MAP.wallHeight, MAP.halfZ * 2 + 2, MAP.halfX + 0.5, 0);

  // ---- rain ----------------------------------------------------------------
  const RAIN_COUNT = 1600;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 3);
  const rainVel = new Float32Array(RAIN_COUNT);
  for (let i = 0; i < RAIN_COUNT; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * 110;
    rainPos[i * 3 + 1] = Math.random() * 28;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 84;
    rainVel[i] = 22 + Math.random() * 14;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({
    color: PALETTE.rain, size: 0.09, transparent: true, opacity: 0.55, sizeAttenuation: true,
  }));
  scene.add(rain);
  const updateRain = (dt, cx, cz) => {
    const pos = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN_COUNT; i++) {
      pos[i * 3 + 1] -= rainVel[i] * dt;
      pos[i * 3] -= rainVel[i] * dt * 0.12; // wind slant
      if (pos[i * 3 + 1] < 0) {
        pos[i * 3 + 1] = 24 + Math.random() * 4;
        pos[i * 3] = cx + (Math.random() - 0.5) * 110;
        pos[i * 3 + 2] = cz + (Math.random() - 0.5) * 84;
      }
    }
    rainGeo.attributes.position.needsUpdate = true;
  };

  // ---- shipping containers: cover, lanes and the two bomb sites -----------
  // Each entry: [x, z, rotationY (0 = long axis east-west), stack height].
  const containerSpecs = [
    // Mid plaza cross.
    [-6, -4, 0, 1], [6, 4, 0, 1], [-2, 10, Math.PI / 2, 2], [4, -10, Math.PI / 2, 1],
    [0, 0, 0, 2], [-10, 2, Math.PI / 2, 1], [12, -2, Math.PI / 2, 1],
    // A lane (west): a corridor of stacks leading to the crane yard.
    [-16, -14, 0, 1], [-22, -20, Math.PI / 2, 2], [-26, -6, 0, 1],
    [-34, -20, Math.PI / 2, 1], [-40, -8, 0, 2], [-28, -14, Math.PI / 2, 1],
    [-18, -24, 0, 1], [-36, -24, 0, 1],
    // B lane (east): staggered stacks toward the warehouse.
    [16, 14, 0, 1], [22, 20, Math.PI / 2, 2], [26, 6, 0, 1],
    [34, 20, Math.PI / 2, 1], [40, 8, 0, 2], [28, 14, Math.PI / 2, 1],
    [18, 24, 0, 1], [38, 2, Math.PI / 2, 1],
    // Spawn cover.
    [-8, 28, 0, 1], [8, 28, 0, 1], [-8, -28, 0, 1], [8, -28, 0, 1],
    // Flank pockets.
    [-14, 18, Math.PI / 2, 1], [14, -18, Math.PI / 2, 1],
  ];
  let colorIdx = 0;
  for (const [cx, cz, ry, stack] of containerSpecs) {
    const color = PALETTE.containers[colorIdx++ % PALETTE.containers.length];
    for (let level = 0; level < stack; level++) {
      const c = box(BOX_L, BOX_H, BOX_W, color, {
        x: cx, y: level * BOX_H, z: cz, ry,
        roughness: 0.62, metalness: 0.45,
      });
      scene.add(c);
      // Corrugation: three thin ribs on the long faces.
      for (let r = -1; r <= 1; r++) {
        const rib = box(0.12, BOX_H - 0.3, BOX_W + 0.08, color, {
          x: cx + (ry === 0 ? r * 1.8 : 0), y: level * BOX_H + 0.15, z: cz + (ry === 0 ? 0 : r * 1.8),
          roughness: 0.62, metalness: 0.45, shadow: false,
        });
        scene.add(rib);
      }
    }
    const hw = ry === 0 ? BOX_L / 2 : BOX_W / 2;
    const hd = ry === 0 ? BOX_W / 2 : BOX_L / 2;
    addCollider(cx, cz, hw + 0.1, hd + 0.1, stack * BOX_H);
  }

  // ---- gantry cranes over site A -------------------------------------------
  const craneMat = new THREE.MeshStandardMaterial({ color: PALETTE.crane, roughness: 0.55, metalness: 0.6 });
  const craneDark = new THREE.MeshStandardMaterial({ color: PALETTE.craneDark, roughness: 0.7, metalness: 0.4 });
  const buildCrane = (cx, cz) => {
    const group = new THREE.Group();
    for (const [lx, lz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 16, 0.9), craneMat);
      leg.position.set(lx, 8, lz);
      leg.castShadow = true;
      group.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 2.2), craneMat);
    beam.position.set(0, 16.4, 0);
    beam.castShadow = true;
    group.add(beam);
    const trolley = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.2, 1.8), craneDark);
    trolley.position.set(1.5, 15.2, 0);
    group.add(trolley);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7, 6), craneDark);
    cable.position.set(1.5, 11.4, 0);
    group.add(cable);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), craneDark);
    hook.position.set(1.5, 7.2, 0);
    hook.castShadow = true;
    group.add(hook);
    group.position.set(cx, 0, cz);
    scene.add(group);
    for (const [lx, lz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) addCollider(cx + lx, cz + lz, 0.6, 0.6, 16);
  };
  buildCrane(-32, -18);
  buildCrane(-40, -2);

  // ---- warehouse at site B --------------------------------------------------
  const warehouse = new THREE.Group();
  const wWall = new THREE.MeshStandardMaterial({ color: PALETTE.warehouse, roughness: 0.85, metalness: 0.3 });
  const wRoof = new THREE.MeshStandardMaterial({ color: PALETTE.warehouseRoof, roughness: 0.7, metalness: 0.4 });
  const mkPart = (w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    warehouse.add(m);
    return m;
  };
  // Shell with a wide open doorway facing west (toward mid).
  mkPart(18, 8, 0.6, 0, 4, -6, wWall);
  mkPart(18, 8, 0.6, 0, 4, 6, wWall);
  mkPart(0.6, 8, 12.6, 9, 4, 0, wWall);
  mkPart(6, 8, 0.6, -6, 4, -6, wWall);
  mkPart(6, 8, 0.6, 6, 4, -6, wWall);
  mkPart(6, 8, 0.6, -6, 4, 6, wWall);
  mkPart(6, 8, 0.6, 6, 4, 6, wWall);
  mkPart(18, 2.5, 0.6, 0, 6.75, 0, wWall); // lintel over the doorway
  mkPart(19.5, 0.5, 14, 0, 8.2, 0, wRoof);
  // Interior crates + a hanging lamp.
  mkPart(3, 2.4, 3, -4, 1.2, -3, wWall);
  mkPart(3, 2.4, 3, 4, 1.2, 3, wWall);
  const lamp = new THREE.PointLight(0xffd9a0, 60, 22, 1.8);
  lamp.position.set(0, 7, 0);
  warehouse.add(lamp);
  warehouse.position.set(38, 0, 8);
  scene.add(warehouse);
  addCollider(38 - 9, 8, 0.4, 6.3, 8);
  addCollider(38 + 9, 8, 0.4, 6.3, 8);
  addCollider(38, 8 - 6, 9, 0.4, 8);
  addCollider(38, 8 + 6, 9, 0.4, 8);
  addCollider(34, 5, 1.6, 1.6, 2.4);
  addCollider(42, 11, 1.6, 1.6, 2.4);

  // ---- bomb sites: glowing rings + floating letters -------------------------
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.bombLight, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const mkRing = (x, z) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(5.4, 6.4, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    scene.add(ring);
    return ring;
  };
  const ringA = mkRing(-32, -12);
  const ringB = mkRing(32, 8);
  const letterA = makeTextSprite('A', '#ff6b5e', 5);
  letterA.position.set(-32, 9, -12);
  scene.add(letterA);
  const letterB = makeTextSprite('B', '#ff6b5e', 5);
  letterB.position.set(32, 9, 8);
  scene.add(letterB);
  // Bomb prop (hidden until planted, shown by the game).
  const bomb = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.35, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.8 }),
  );
  bomb.add(bombBody);
  const bombLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.06, 0.12),
    new THREE.MeshBasicMaterial({ color: PALETTE.bombLight }),
  );
  bombLight.position.set(0, 0.2, 0);
  bomb.add(bombLight);
  bomb.visible = false;
  scene.add(bomb);

  // ---- spawns, sites and the bot waypoint graph ----------------------------
  const sites = {
    A: { name: 'Crane Yard', x: -32, z: -12, radius: 6.5, ring: ringA },
    B: { name: 'Warehouse', x: 32, z: 8, radius: 6.5, ring: ringB },
  };
  const spawns = {
    harbor: [[-4, 30], [0, 31], [4, 30], [-2, 27], [2, 27]],
    storm: [[-4, -30], [0, -31], [4, -30], [-2, -27], [2, -27]],
  };
  // Waypoints: lanes from each spawn through mid to both sites.
  const waypoints = [
    { id: 0, x: 0, z: -30, links: [1, 6] },
    { id: 1, x: 0, z: -19, links: [0, 2, 6, 7] },
    { id: 2, x: 0, z: -8, links: [1, 3, 8] },
    { id: 3, x: 0, z: 0, links: [2, 4, 9, 10] },
    { id: 4, x: 0, z: 12, links: [3, 5, 11] },
    { id: 5, x: 0, z: 30, links: [4, 11, 12] },
    { id: 6, x: -13, z: -19, links: [0, 1, 13] },
    { id: 7, x: 13, z: -19, links: [1, 14] },
    { id: 8, x: -13, z: -8, links: [2, 13, 15] },
    { id: 9, x: -13, z: 2, links: [3, 15, 16] },
    { id: 10, x: 13, z: -2, links: [3, 14, 17] },
    { id: 11, x: 13, z: 12, links: [4, 17, 18] },
    { id: 12, x: -13, z: 22, links: [5, 16] },
    { id: 13, x: -24, z: -17, links: [6, 8, 19] },
    { id: 14, x: 24, z: -14, links: [7, 17, 20] },
    { id: 15, x: -24, z: -4, links: [8, 9, 19] },
    { id: 16, x: -24, z: 12, links: [9, 12, 21] },
    { id: 17, x: 24, z: 2, links: [10, 11, 20] },
    { id: 18, x: 24, z: 20, links: [11, 21] },
    { id: 19, x: -32, z: -12, links: [13, 15] },
    { id: 20, x: 32, z: 8, links: [14, 17] },
    { id: 21, x: -24, z: 22, links: [16, 18] },
  ];

  return {
    colliders, addCollider, floodLights, updateRain, makeTextSprite, box,
    sites, spawns, waypoints, bomb, PALETTE,
  };
}
