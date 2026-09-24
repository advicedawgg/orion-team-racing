// fx.js — particles & skid marks. Fixed pools, CPU-updated camera-facing quads in TWO draw
// calls (additive: flames/sparks/glints; alpha: dust/smoke/sand/splash) + ONE skid-mark mesh.
// No lights are ever added or removed at runtime.
//
//   const fx = createFx(scene);
//   fx.kart(k, rig, dt, cam)   // per kart per frame: exhaust flames, drift sparks, dust, skids
//   fx.burst(kind, pos, opts)  // one-shots: 'land', 'fizzle', 'overheat', 'wall', 'splash', 'poof', 'pad', 'turbo'
//   fx.update(dt, camera)      // once per frame, after emitting
import * as THREE from 'three';

const MAX = 1400, MAX_SKID = 1600;

/** Exhaust / spark colour by charge stage (DESIGN.md "The feel"). */
export const FLAME = {
  charging: 0xa8dcff,   // blue-white while the meter fills
  red: 0xff8a1f,        // orange in the red window
  boost1: 0xffb02e, boost2: 0xffd23f,
  boost3: 0xb54dff,     // purple: stage-3 turbo
  smoke: 0x2a2530,
};
const SURF_DUST = { sand: 0xf3dfae, grass: 0x7cc35a, snow: 0xffffff, dirt: 0xa77f55, mud: 0x6d5236, rock: 0x9a9084, road: 0xd9d4c8, ice: 0xe6f6ff, lava: 0xff7a2a };

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makePool(scene, additive, tex) {
  const pos = new Float32Array(MAX * 4 * 3), col = new Float32Array(MAX * 4 * 4), uv = new Float32Array(MAX * 4 * 2);
  const idx = new Uint16Array(MAX * 6);
  for (let i = 0; i < MAX; i++) {
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false, fog: !additive });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false; mesh.renderOrder = additive ? 3 : 2; mesh.name = additive ? 'fx:add' : 'fx:alpha';
  scene.add(mesh);
  const P = [];
  for (let i = 0; i < MAX; i++) P.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0 });
  return { mesh, g, pos, col, P, cur: 0, additive };
}

export function createFx(scene) {
  const tex = softDot();
  const add = makePool(scene, true, tex), alp = makePool(scene, false, tex);
  const tmpC = new THREE.Color(), _v = new THREE.Vector3(), _w = new THREE.Vector3();

  // skid marks: ring buffer of quads
  const sPos = new Float32Array(MAX_SKID * 4 * 3), sCol = new Float32Array(MAX_SKID * 4 * 4), sIdx = new Uint16Array(MAX_SKID * 6);
  for (let i = 0; i < MAX_SKID; i++) sIdx.set([i * 4, i * 4 + 2, i * 4 + 1, i * 4 + 1, i * 4 + 2, i * 4 + 3], i * 6);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage));
  sg.setAttribute('color', new THREE.BufferAttribute(sCol, 4).setUsage(THREE.DynamicDrawUsage));
  sg.setIndex(new THREE.BufferAttribute(sIdx, 1));
  const skidMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, side: THREE.DoubleSide }));
  skidMesh.frustumCulled = false; skidMesh.name = 'fx:skids'; skidMesh.renderOrder = 1;
  scene.add(skidMesh);
  let skidCur = 0, skidDirty = false;
  const skidLast = new Map();   // key kart.index*4+wheel → {x,y,z}

  function spawn(pool, o) {
    const p = pool.P[pool.cur]; pool.cur = (pool.cur + 1) % MAX;
    p.life = p.max = o.life ?? 0.5;
    p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx ?? 0; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0;
    p.s0 = o.s0 ?? 0.4; p.s1 = o.s1 ?? 0.1; p.grav = o.grav ?? 0; p.drag = o.drag ?? 1.5;
    tmpC.set(o.color ?? 0xffffff); p.r = tmpC.r; p.g = tmpC.g; p.b = tmpC.b; p.a = o.alpha ?? 1;
    return p;
  }
  const rnd = (a = 1) => (Math.random() - 0.5) * 2 * a;

  const fx = {
    add, alp, q: 1,
    /** Emit per-kart effects. `near` = distance to camera; far karts emit less. */
    kart(k, rig, dt, camPos) {
      if (k.respawnT > 0) return;
      const dx = k.pos.x - camPos.x, dz = k.pos.z - camPos.z, d2 = dx * dx + dz * dz;
      if (d2 > 90 * 90) return;
      const lod = (d2 < 30 * 30 ? 1 : 0.4) * fx.q;   // fx.q: quality (main.js: 1 high, 0.5 low)
      const fx_ = Math.sin(k.yaw), fz_ = Math.cos(k.yaw);
      const vx = k.vel.x, vz = k.vel.z;
      // --- exhaust flames at the exhaust anchors
      let flameC = null, rate = 0, big = 0.35;
      // sizes/alpha tuned so the flames stay vivid but never white-out the kart in the chase cam
      // (additive quads stacked at the pipe tips used to saturate to a white blob over the driver)
      if (k.boostT > 0) { flameC = k.boostTier >= 3 ? FLAME.boost3 : k.boostTier === 2 ? FLAME.boost2 : FLAME.boost1; rate = 34; big = k.boostTier >= 3 ? 0.4 : 0.34; }
      else if (k.drift && !k.overheat && k.turbos < 3) { flameC = k.inRed ? FLAME.red : FLAME.charging; rate = 26; big = 0.17 + 0.13 * k.charge; }
      const ex = rig?.exhausts?.length ? rig.exhausts : null;
      const anchors = [];
      if (ex) for (const a of ex) { a.getWorldPosition(_v); anchors.push([_v.x, _v.y, _v.z]); }
      else anchors.push([k.pos.x - fx_ * 0.9, k.pos.y + 0.5, k.pos.z - fz_ * 0.9]);
      if (flameC != null) {
        const n = rate * dt * lod;
        for (const a of anchors) for (let i = 0; i < n + (Math.random() < n % 1 ? 1 : 0); i++) {
          spawn(add, { x: a[0], y: a[1], z: a[2], vx: vx * 0.6 - fx_ * 5 + rnd(0.8), vy: 0.6 + rnd(0.5), vz: vz * 0.6 - fz_ * 5 + rnd(0.8),
            life: 0.14 + Math.random() * 0.07, s0: big, s1: 0.05, color: flameC, drag: 3, alpha: 0.55 });
        }
      }
      if (k.overheat || k.fizzleT > 0) {
        for (const a of anchors) if (Math.random() < 30 * dt * lod) spawn(alp, { x: a[0], y: a[1], z: a[2], vx: vx * 0.5 + rnd(0.6), vy: 1.2 + Math.random(), vz: vz * 0.5 + rnd(0.6), life: 0.8, s0: 0.35, s1: 1.0, color: FLAME.smoke, alpha: 0.75, drag: 2 });
      }
      // --- wheels: drift sparks, dust off-road, skid marks
      const wheels = rig?.wheels;
      const rear = [];
      if (wheels && wheels.length >= 4) { for (const w of [wheels[2], wheels[3]]) { w.getWorldPosition(_w); rear.push([_w.x, k.pos.y, _w.z]); } }
      else { const lx = fz_, lz = -fx_; for (const s of [1, -1]) rear.push([k.pos.x + lx * 0.5 * s - fx_ * 0.55, k.pos.y, k.pos.z + lz * 0.5 * s - fz_ * 0.55]); }
      const onGround = !k.air;
      const speed = Math.abs(k.speed);
      if (k.drift && onGround) {
        const sc = k.overheat ? 0x555555 : k.inRed ? 0xff9b2a : k.turbos >= 2 ? 0xc27bff : 0xfff0a0;
        for (const r of rear) if (Math.random() < 40 * dt * lod) {
          spawn(add, { x: r[0], y: r[1] + 0.12, z: r[2], vx: vx * 0.2 + rnd(3) + k.drift * fz_ * 2, vy: 2 + Math.random() * 3, vz: vz * 0.2 + rnd(3) - k.drift * fx_ * 2, life: 0.3, s0: 0.14, s1: 0.04, color: sc, grav: 18, drag: 1 });
        }
      }
      if (onGround && speed > 6 && !k.onRoad && k.surface !== 'gap') {
        const dc = SURF_DUST[k.surface] ?? 0xe8dcc0;
        const heavy = k.drift ? 1.6 : 1;
        for (const r of rear) if (Math.random() < 13 * heavy * dt * lod) {
          spawn(alp, { x: r[0] + rnd(0.2), y: r[1] + 0.1, z: r[2] + rnd(0.2), vx: vx * 0.3 + rnd(1.2) - fx_ * 2, vy: 1.2 + Math.random() * 1.6 * heavy, vz: vz * 0.3 + rnd(1.2) - fz_ * 2,
            life: 0.45 + Math.random() * 0.25, s0: 0.22, s1: 0.75 + 0.25 * heavy, color: dc, alpha: 0.55, grav: 6, drag: 2.5 });
        }
      }
      // skid marks while sliding (or hard braking) on the ground
      const skid = onGround && (k.drift || (k.throttle < 0.1 && speed > 12 && k.ctrl?.brake > 0.5));
      for (let w = 0; w < rear.length; w++) {
        const key = k.index * 4 + w, r = rear[w];
        const last = skidLast.get(key);
        if (!skid || d2 > 70 * 70) { skidLast.delete(key); continue; }
        if (last && (r[0] - last[0]) ** 2 + (r[2] - last[2]) ** 2 < 0.35 ** 2) continue;
        if (last) {
          const i = skidCur; skidCur = (skidCur + 1) % MAX_SKID;
          const lx = fz_ * 0.13, lz = -fx_ * 0.13, y0 = last[1] + 0.035, y1 = r[1] + 0.035;
          sPos.set([last[0] + lx, y0, last[2] + lz, last[0] - lx, y0, last[2] - lz, r[0] + lx, y1, r[2] + lz, r[0] - lx, y1, r[2] - lz], i * 12);
          const a = k.onRoad ? 0.5 : 0.28;
          const c = k.onRoad ? [0.1, 0.1, 0.12] : [0.55, 0.45, 0.3];
          for (let q = 0; q < 4; q++) sCol.set([c[0], c[1], c[2], a], i * 16 + q * 4);
          skidDirty = true;
        }
        skidLast.set(key, r);
      }
    },

    /** One-shot effects. */
    burst(kind, p, o = {}) {
      const n = o.n ?? 12;
      if (kind === 'land' || kind === 'poof') {
        const c = kind === 'poof' ? 0xffffff : (SURF_DUST[o.surface] ?? 0xeee6d6);
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; spawn(alp, { x: p.x + Math.cos(a) * 0.6, y: p.y + 0.2, z: p.z + Math.sin(a) * 0.6, vx: Math.cos(a) * 4, vy: 0.8 + Math.random(), vz: Math.sin(a) * 4, life: 0.6, s0: 0.5, s1: 1.4, color: c, alpha: 0.85, drag: 3 }); }
      } else if (kind === 'fizzle' || kind === 'overheat') {
        for (let i = 0; i < n; i++) spawn(alp, { x: p.x + rnd(0.3), y: p.y + 0.5, z: p.z + rnd(0.3), vx: rnd(1.5), vy: 1.5 + Math.random() * 1.5, vz: rnd(1.5), life: 0.9, s0: 0.4, s1: 1.3, color: FLAME.smoke, alpha: 0.85, drag: 2 });
      } else if (kind === 'wall') {
        for (let i = 0; i < n; i++) spawn(add, { x: p.x + rnd(0.4), y: p.y + 0.4, z: p.z + rnd(0.4), vx: rnd(6), vy: 2 + Math.random() * 4, vz: rnd(6), life: 0.35, s0: 0.16, s1: 0.04, color: 0xffe08a, grav: 20, drag: 1 });
      } else if (kind === 'splash') {
        for (let i = 0; i < 28; i++) spawn(alp, { x: p.x + rnd(0.8), y: p.y, z: p.z + rnd(0.8), vx: rnd(3), vy: 5 + Math.random() * 6, vz: rnd(3), life: 0.9, s0: 0.45, s1: 0.2, color: 0xe8fbff, alpha: 0.9, grav: 22, drag: 0.5 });
      } else if (kind === 'turbo' || kind === 'pad') {
        const c = o.color ?? (kind === 'pad' ? 0xffc23a : FLAME.boost2);
        for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2; spawn(add, { x: p.x, y: p.y + 0.5, z: p.z, vx: Math.cos(a) * 4 + (o.vx || 0) * 0.5, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 4 + (o.vz || 0) * 0.5, life: 0.35, s0: 0.36, s1: 0.05, color: c, drag: 3, alpha: 0.7 }); }
      } else if (kind === 'sparkle') {
        for (let i = 0; i < n; i++) spawn(add, { x: p.x + rnd(0.8), y: p.y + 0.5 + Math.random(), z: p.z + rnd(0.8), vx: rnd(1), vy: 1 + Math.random(), vz: rnd(1), life: 0.7, s0: 0.25, s1: 0.02, color: o.color ?? 0xfff3a0, drag: 1 });
      }
    },

    clearSkids() { sCol.fill(0); skidLast.clear(); skidDirty = true; },

    update(dt, camera) {
      const e = camera.matrixWorld.elements;
      const rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6];
      const cx = e[12], cy = e[13], cz = e[14];
      for (const pool of [add, alp]) {
        const { pos, col, P } = pool;
        let live = 0;
        for (let i = 0; i < MAX; i++) {
          const p = P[i];
          const o3 = i * 12, o4 = i * 16;
          if (p.life <= 0) { if (col[o4 + 3] !== 0 || col[o4 + 7] !== 0) { col.fill(0, o4, o4 + 16); pos.fill(0, o3, o3 + 12); } continue; }
          p.life -= dt; live++;
          const dr = Math.exp(-p.drag * dt);
          p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.grav * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const t = 1 - Math.max(0, p.life) / p.max;
          let s = p.s0 + (p.s1 - p.s0) * t;
          let a = pool.additive ? p.a * (1 - t) : p.a * (1 - t * t);
          // near the camera: shrink (a quad never covers more than ~10% of the screen height) and,
          // for glowing sprites, fade out — flames/sparks flying back past the lens were big white blobs
          const dd = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2);
          if (s > dd * 0.075) s = dd * 0.075;
          if (dd < 5) { const f = Math.max(0, (dd - 1.2) / 3.8); a *= pool.additive ? f * f * (3 - 2 * f) : 0.35 + 0.65 * f; }
          const Rx = rx * s, Ry = ry * s, Rz = rz * s, Ux = ux * s, Uy = uy * s, Uz = uz * s;
          pos[o3] = p.x - Rx - Ux; pos[o3 + 1] = p.y - Ry - Uy; pos[o3 + 2] = p.z - Rz - Uz;
          pos[o3 + 3] = p.x + Rx - Ux; pos[o3 + 4] = p.y + Ry - Uy; pos[o3 + 5] = p.z + Rz - Uz;
          pos[o3 + 6] = p.x + Rx + Ux; pos[o3 + 7] = p.y + Ry + Uy; pos[o3 + 8] = p.z + Rz + Uz;
          pos[o3 + 9] = p.x - Rx + Ux; pos[o3 + 10] = p.y - Ry + Uy; pos[o3 + 11] = p.z - Rz + Uz;
          const r = pool.additive ? p.r * a : p.r, g = pool.additive ? p.g * a : p.g, b = pool.additive ? p.b * a : p.b;
          for (let q = 0; q < 4; q++) { col[o4 + q * 4] = r; col[o4 + q * 4 + 1] = g; col[o4 + q * 4 + 2] = b; col[o4 + q * 4 + 3] = a; }
        }
        pool.live = live;
        pool.g.attributes.position.needsUpdate = true;
        pool.g.attributes.color.needsUpdate = true;
      }
      if (skidDirty) { sg.attributes.position.needsUpdate = true; sg.attributes.color.needsUpdate = true; skidDirty = false; }
    },
    get live() { return (add.live || 0) + (alp.live || 0); },
  };
  return fx;
}
