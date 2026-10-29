// letterviews.js — the C-T-R letter tokens in 3D (src/letters.js is the pure state; DESIGN.md "Modes and UI").
//
// Three chunky extruded letters (LETTER_SHAPES — no font), each in its own colour with a soft additive halo,
// spinning and bobbing over the road. A collected one pops (scales up, fades) and is gone for the race.
// 6 draw calls while all three are up (3 meshes + 3 halo sprites), no lights, no shadows. Geometries,
// materials and the halo texture are built once and reused by every race (leakcheck stays flat).
//
//   const LV = createLetterViews({ scene });
//   LV.attach(race)      // race.letters set → build; null / none → nothing shown
//   LV.update(dt, t)     // spin, bob, pop the collected ones
//   LV.detach()
import * as THREE from 'three';
import { LETTER_SHAPES, LETTER_COLORS, LETTER } from './letters.js';

let shared = null;
function build() {
  if (shared) return shared;
  const H = LETTER.H;
  const geos = LETTER_SHAPES.map(sh => {
    const shape = new THREE.Shape(sh.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const h of sh.holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.045, bevelSegments: 2, curveSegments: 4 });
    g.translate(-sh.w / 2, -0.5, -0.1);
    g.scale(H, H, H);
    g.computeVertexNormals();
    return g;
  });
  const mats = LETTER_COLORS.map(c => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0 }));
  // halo: a soft radial glow, tinted per letter, additive
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const halos = LETTER_COLORS.map(c => new THREE.SpriteMaterial({ map: tex, color: c, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  shared = { geos, mats, halos, tex };
  return shared;
}

export function createLetterViews({ scene }) {
  let group = null, items = [], L = null, t = 0;
  function detach() {
    if (group) scene.remove(group);
    group = null; items = []; L = null;
  }
  return {
    attach(race) {
      detach();
      L = race?.letters || null;
      if (!L || !L.list.length) { L = null; return; }
      const S = build();
      group = new THREE.Group(); group.name = 'ctr-letters';
      items = L.list.map(e => {
        const mesh = new THREE.Mesh(S.geos[e.i], S.mats[e.i]);
        mesh.castShadow = false; mesh.receiveShadow = false;
        const halo = new THREE.Sprite(S.halos[e.i]); halo.scale.setScalar(LETTER.H * 2.1);
        const root = new THREE.Group(); root.add(halo, mesh);
        root.position.set(e.x, e.cy, e.z);
        root.name = 'letter:' + e.ch;
        group.add(root);
        return { e, root, mesh, halo, pop: -1, phase: e.i * 2.1 };
      });
      scene.add(group);
    },
    update(dt) {
      if (!L) return;
      t += dt;
      for (const it of items) {
        if (!it.root.visible) continue;
        if (L.got[it.e.i] && it.pop < 0) it.pop = 0;
        if (it.pop >= 0) {                       // collected: swell and vanish over 0.35 s
          it.pop += dt;
          const u = it.pop / 0.35;
          if (u >= 1) { it.root.visible = false; continue; }
          it.root.scale.setScalar(1 + u * 0.9);
          it.mesh.rotation.y += dt * 14;
          continue;
        }
        it.mesh.rotation.y = t * 1.7 + it.phase;
        it.root.position.y = it.e.cy + Math.sin(t * 2.2 + it.phase) * 0.22;
        it.halo.material.opacity = 0.6 + 0.2 * Math.sin(t * 3 + it.phase);
      }
    },
    detach,
    get group() { return group; },
  };
}
