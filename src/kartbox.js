// kartbox.js — core's emergency fallback racer: a chunky box kart. Used only when
// src/racers.js is missing or throws, so a broken character file never breaks the race.
// Same API as racers.js (buildRacer / animateRacer / RACERS).
import * as THREE from 'three';

export const RACERS = [
  { id: 'orion', name: 'Orion', stats: { speed: 3, accel: 3, turn: 3 }, colors: { kart: 0x2f6fdc, accent: 0xffd23f, trim: 0xc22532 } },
  { id: 'sootie', name: 'Sootie', stats: { speed: 2, accel: 3, turn: 4 }, colors: { kart: 0xff6fae, accent: 0x8ff0b4, trim: 0x2b2431 } },
  { id: 'kingdad', name: 'King Dad', stats: { speed: 5, accel: 2, turn: 2 }, colors: { kart: 0xd0342c, accent: 0xffd23f, trim: 0x2f6fd0 } },
  { id: 'mum', name: 'Mum', stats: { speed: 2, accel: 4, turn: 3 }, colors: { kart: 0x9b59d0, accent: 0xffe066, trim: 0xf4ecff } },
  { id: 'grumblin', name: 'Grumbles', stats: { speed: 4, accel: 2, turn: 3 }, colors: { kart: 0xff8a2a, accent: 0x4caf50, trim: 0x3a3f52 } },
  { id: 'jelly', name: 'Wibble', stats: { speed: 2, accel: 2, turn: 5 }, colors: { kart: 0x2ec4e0, accent: 0xff8ad8, trim: 0xfff0fb } },
  { id: 'zapdrone', name: 'Zappy', stats: { speed: 2, accel: 5, turn: 2 }, colors: { kart: 0x2d3142, accent: 0x8fe3ff, trim: 0xffd23f } },
  { id: 'prickle', name: 'Prickles', stats: { speed: 4, accel: 3, turn: 2 }, colors: { kart: 0x7ed957, accent: 0x8a5a2b, trim: 0xf7eccb } },
];

export function buildRacer(id) {
  const def = RACERS.find(r => r.id === id) || RACERS[0];
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const mk = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: c })); m.position.set(x, y, z); m.castShadow = true; body.add(m); return m; };
  mk(1.1, 0.35, 1.7, def.colors.kart, 0, 0.4, 0);
  mk(0.5, 0.6, 0.5, def.colors.accent, 0, 0.85, -0.2);
  const head = mk(0.45, 0.45, 0.45, 0xffd9b0, 0, 1.35, -0.2);
  const wheels = [], exhausts = [];
  for (const [x, z] of [[0.55, 0.55], [-0.55, 0.55], [0.55, -0.5], [-0.55, -0.5]]) {
    const w = mk(0.25, 0.5, 0.5, 0x222222, x, 0.25, z); wheels.push(w);
  }
  for (const x of [0.17, -0.17]) { const o = new THREE.Object3D(); o.position.set(x, 0.6, -0.95); body.add(o); exhausts.push(o); }
  return { root, rig: { body, head, wheels, exhausts } };
}
export function animateRacer(rig, s) {
  rig.body.rotation.z = -(s.steer || 0) * 0.08;
  rig.body.rotation.x = s.hitT > 0 && s.hitT < 1 ? s.hitT * Math.PI * 2 : 0;
  rig.body.rotation.y = s.spinT > 0 ? s.spinT * 12 : 0;
}
export function renderPortrait() { return document.createElement('canvas'); }
