// hdracers.js — the optional HD driver tier (charfab GLBs in assets/models/<id>.glb). HD agent owns.
//
// The procedural racers in racers.js are always present; this module only swaps the DRIVER for an
// AI-generated textured model. The kart stays procedural. The game must run with no GLBs at all:
// loadHDRacer() rejects when a model is missing and the caller keeps its procedural driver.
//
// API (used by racers.js buildRacer(id, { hd: true })):
//   hasHD(id)                    -> bool, sync: is a GLB shipped for this racer?
//   loadHDRacer(id, opts)        -> Promise<{ root, rig }>
//       root : THREE.Group. ORIGIN = THE SEAT CONTACT POINT (where the driver's bottom touches the
//              seat), facing +Z, Y up, metres. Parent it to the kart's seat anchor (racers.js
//              rig.driver) and hide the procedural driver meshes. Includes a small steering wheel
//              the hands grip (opts.wheel === false to omit it and use the kart's own).
//       rig  : opaque state for animateHD. rig.head is an Object3D (child of root) that tracks the
//              top of the head every frame — for TNT-on-head. rig.wheel is the steering wheel group.
//       opts : { height } standing height in m (default per racer, see HD_MODELS),
//              { wheel } bool, { wheelAt: [x,y,z], wheelR, wheelTilt } wheel centre in root space
//              (default [0,.21,.37] r .15 tilt .5 = racers.js WHEEL relative to its HIP pivot; pulled
//              toward the shoulders if the arms can't reach), { lean } multiplier on the lean (default 1).
//   animateHD(rig, s, dt)        -> same state object as racers.js animateRacer(rig, s, dt).
//              Leans the spine INTO the corner (+steer = left = lean toward +X), exaggerates in a
//              slide, turns the head into the turn, hands stay on the wheel which turns with steer,
//              tucks during boost, bobs on landing, flails when hit/spinning, arms up to cheer,
//              slumps when sad. Call it every render frame after the kart has been positioned.
//   preloadHD(ids)               -> Promise, warms the loader cache (menus can call it early).
//
// Two model kinds (HD_MODELS[id].kind):
//   'rig'    - Make-It-Animatable mixamorig skeleton, bound in the A-pose the render was made in.
//              We pose it seated at load (thighs forward, knees bent, arms by two-bone IK to the
//              wheel) and drive the lean from bones every frame.
//   'static' - a mesh generated already in its driving pose (creatures without a humanoid body).
//              The whole mesh leans/bobs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

/** Shipped HD models. `height` = standing height in metres the model is scaled to. `yaw` fixes a
 *  static model's facing (radians about +Y). Keep in sync with assets/models/README.md. */
export const HD_MODELS = {
  orion:   { kind: 'rig', height: 1.50 },
  kingdad: { kind: 'rig', height: 1.62 },
  mum:     { kind: 'rig', height: 1.50 },
  sootie:  { kind: 'rig', height: 1.20 },
};

export function hasHD(id) { return Object.prototype.hasOwnProperty.call(HD_MODELS, id); }

const MODEL_URL = id => HD_MODELS[id]?.url ?? new URL(`../assets/models/${id}.glb`, import.meta.url).href;
let loader = null;
function getLoader() {
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  return loader;
}

const B = n => 'mixamorig' + n;   // GLTFLoader sanitises "mixamorig:Hips" -> "mixamorigHips"
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

/** rotate `bone` in world space so the direction to `child` becomes world `dir` */
function aimBone(bone, child, dir) {
  const a = bone.getWorldPosition(_v1), b = child.getWorldPosition(_v2);
  const d = b.sub(a); if (d.lengthSq() < 1e-12) return;
  d.normalize();
  _q1.setFromUnitVectors(d, _v3.copy(dir).normalize());
  bone.getWorldQuaternion(_q2);
  bone.parent.getWorldQuaternion(_q3).invert();
  bone.quaternion.copy(_q3.multiply(_q1.multiply(_q2)));
  bone.updateMatrixWorld(true);
}

/** the rig's own frame (left=+x, up=+y, forward=+z) from thighs, hips and head */
function rigFrame(get) {
  const l = get(B('LeftUpLeg')).getWorldPosition(new THREE.Vector3());
  const r = get(B('RightUpLeg')).getWorldPosition(new THREE.Vector3());
  const y = get(B('Head')).getWorldPosition(new THREE.Vector3()).sub(get(B('Hips')).getWorldPosition(new THREE.Vector3())).normalize();
  const x = l.sub(r); x.addScaledVector(y, -x.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

// seated pose, in the character's frame (left=+x, up=+y, forward=+z); sx = +1 left side, -1 right
const SEAT = {
  thigh: sx => new THREE.Vector3(sx * 0.16, 0.10, 1),
  shin: sx => new THREE.Vector3(sx * 0.04, -0.62, 0.80),
  foot: () => new THREE.Vector3(0, 0.25, 1),
  spineLean: 0.10,   // rad forward
};
const SPINE = ['Spine', 'Spine1', 'Spine2'];
const ANIM_BONES = ['Hips', ...SPINE, 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand'];

function prepMaterials(obj) {
  obj.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = false;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      // TRELLIS bakes a metallic-roughness texture; cartoon characters under a sky with no env map
      // turn murky with any metalness, so flatten it to a soft plastic.
      m.metalness = 0; if (m.metalnessMap) m.metalnessMap = null;
      m.roughness = 0.72; if (m.roughnessMap) m.roughnessMap = null;
      m.needsUpdate = true;
    }
  });
}

/** min y of skinned vertices behind the hip joint (the seat contact), in template space */
function seatContactY(scene, hips) {
  let minY = Infinity; const v = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 40000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld);
      if (v.z < hips.z + 0.02 && v.z > hips.z - 0.35 && Math.abs(v.x - hips.x) < 0.25 && v.y < minY) minY = v.y;
    }
  });
  return minY;
}

const templates = new Map();
function loadTemplate(id) {
  let p = templates.get(id);
  if (!p) {
    p = getLoader().loadAsync(MODEL_URL(id)).then(gltf => buildTemplate(id, gltf));
    p.catch(() => templates.delete(id));   // allow a retry later
    templates.set(id, p);
  }
  return p;
}
export function preloadHD(ids = Object.keys(HD_MODELS)) {
  return Promise.allSettled(ids.filter(hasHD).map(loadTemplate));
}

function buildTemplate(id, gltf) {
  const def = HD_MODELS[id] || { kind: 'rig', height: 1.4 };
  const scene = gltf.scene;
  prepMaterials(scene);
  const holder = new THREE.Group(); holder.add(scene);
  if (def.kind === 'static') return buildStaticTemplate(def, holder, scene);
  const get = n => scene.getObjectByName(n);
  if (!get(B('Hips')) || !get(B('Head'))) throw new Error(`hd ${id}: no mixamorig skeleton`);
  // 1. stand up facing +Z (the exporter's armature transform is baked into the bind matrices)
  scene.updateMatrixWorld(true);
  scene.quaternion.copy(rigFrame(get).invert());
  scene.updateMatrixWorld(true);
  // 2. scale the skinned bind pose to the standing height
  const box = new THREE.Box3().setFromObject(scene, true);
  const s = def.height / Math.max(1e-6, box.max.y - box.min.y);
  scene.scale.setScalar(s); scene.updateMatrixWorld(true);
  // 3. seated pose: legs forward, knees bent, slight forward lean
  for (const sx of [1, -1]) {
    const side = sx > 0 ? 'Left' : 'Right';
    const up = get(B(side + 'UpLeg')), leg = get(B(side + 'Leg')), foot = get(B(side + 'Foot')), toe = get(B(side + 'ToeBase'));
    if (up && leg) aimBone(up, leg, SEAT.thigh(sx));
    if (leg && foot) aimBone(leg, foot, SEAT.shin(sx));
    if (foot && toe) aimBone(foot, toe, SEAT.foot());
  }
  const spine = get(B('Spine'));
  if (spine) { spine.quaternion.multiply(localAxisRot(spine, X, SEAT.spineLean)); scene.updateMatrixWorld(true); }
  // 4. put the seat contact at the origin, hips straight above it
  const hipsW = get(B('Hips')).getWorldPosition(new THREE.Vector3());
  const seatY = seatContactY(scene, hipsW);
  scene.position.set(-hipsW.x, -(isFinite(seatY) ? seatY : hipsW.y - 0.08 * def.height), -hipsW.z);
  scene.updateMatrixWorld(true);
  // 5. measurements the animator needs, in template (= root) space
  const w = n => get(B(n)).getWorldPosition(new THREE.Vector3());
  const shoulderL = w('LeftArm'), shoulderR = w('RightArm');
  const armLen = shoulderL.distanceTo(w('LeftForeArm')) + w('LeftForeArm').distanceTo(w('LeftHand'));
  const shoulderMid = shoulderL.clone().add(shoulderR).multiplyScalar(0.5);
  const headTop = new THREE.Box3().setFromObject(scene, true).max.y;
  const base = {};
  for (const n of ANIM_BONES) { const b = get(B(n)); if (b) base[n] = b.quaternion.clone(); }
  scene.traverse(o => { if (o.isSkinnedMesh) { o.computeBoundingSphere(); o.boundingSphere.radius *= 1.35; } });
  return {
    kind: 'rig', def, holder, base, armLen, headTop,
    shoulderMid, shoulderHalf: shoulderL.distanceTo(shoulderR) / 2,
    headH: headTop - w('Head').y,
  };
}

function buildStaticTemplate(def, holder, scene) {
  scene.rotation.y = def.yaw || 0;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene, true);
  const s = def.height / Math.max(1e-6, box.max.y - box.min.y);
  scene.scale.multiplyScalar(s); scene.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(scene, true), c = b2.getCenter(new THREE.Vector3());
  scene.position.set(-c.x, -b2.min.y + (def.lift || 0), -c.z + (def.dz || 0));
  scene.updateMatrixWorld(true);
  return { kind: 'static', def, holder, headTop: b2.max.y - b2.min.y };
}

/** quaternion rotating a bone about a ROOT-space axis, expressed in the bone's local frame */
function localAxisRot(bone, axisRoot, angle, out = new THREE.Quaternion()) {
  bone.getWorldQuaternion(_q2);
  const rootQ = rootQuat(bone);
  _v4.copy(axisRoot).applyQuaternion(rootQ).applyQuaternion(_q2.invert());
  return out.setFromAxisAngle(_v4.normalize(), angle);
}
/** world quaternion of the HD root the bone lives under (identity for a detached template) */
function rootQuat(bone) {
  let o = bone; while (o.parent && !o.userData.hdRoot) o = o.parent;
  return o.userData.hdRoot ? o.getWorldQuaternion(_q3) : _q3.identity();
}

function makeWheel(r) {
  const g = new THREE.Group(); g.name = 'hdWheel';
  const m = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.5 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.12, 8, 20), m);
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.5 }));
  hub.rotation.x = Math.PI / 2; g.add(hub);
  for (const a of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(r * 0.1, r, r * 0.08), m);
    sp.position.set(Math.sin(a) * r * 0.5, -Math.cos(a) * r * 0.5, 0); sp.rotation.z = a; g.add(sp);
  }
  const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.08, r * 1.6, 6), m);
  col.rotation.x = Math.PI / 2; col.position.z = r * 0.8; g.add(col);
  return g;
}

export async function loadHDRacer(id, opts = {}) {
  if (!hasHD(id)) throw new Error(`no HD model for ${id}`);
  const t = await loadTemplate(id);
  const root = new THREE.Group(); root.name = 'hd:' + id; root.userData.hdRoot = true;
  const inner = t.kind === 'rig' ? cloneSkinned(t.holder) : t.holder.clone(true);
  root.add(inner);
  const k = opts.height && t.def.height ? opts.height / t.def.height : 1;
  inner.scale.setScalar(k);
  const head = new THREE.Object3D(); head.name = 'hdHeadTop'; head.position.y = t.headTop * k; root.add(head);
  const rig = { id, kind: t.kind, root, inner, head, t, k, lean: opts.lean ?? 1, sp: { lean: 0, yaw: 0, tuck: 0, bob: 0, arms: 0, cheer: 0, wheelA: 0 } };
  if (t.kind === 'rig') {
    const get = n => inner.getObjectByName(B(n));
    rig.bones = {}; for (const n of ANIM_BONES) { const b = get(n); if (b) rig.bones[n] = b; }
    for (const n of ['LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']) rig.bones[n] = get(n);
    // wheel: where racers.js puts the kart's own steering wheel (WHEEL.c relative to the HIP pivot the
    // root hangs from), pulled back toward the shoulders only if this driver's arms cannot reach it
    const L = t.armLen * k, sm = t.shoulderMid.clone().multiplyScalar(k);
    const wc = new THREE.Vector3(...(opts.wheelAt || [0, 0.21, 0.37]));
    const reach = L * 0.9, d = wc.distanceTo(sm);
    if (d > reach) wc.sub(sm).multiplyScalar(reach / d).add(sm);
    rig.wheelR = opts.wheelR || 0.15;
    rig.wheelTilt = opts.wheelTilt ?? 0.5;   // top of the wheel leans back toward the driver
    rig.wheelC = wc;
    if (opts.wheel !== false) {
      rig.wheel = makeWheel(rig.wheelR); rig.wheel.position.copy(wc); rig.wheel.rotation.x = -rig.wheelTilt; root.add(rig.wheel);
    }
    animateHD(rig, {}, 1);   // settle the hands on the wheel
  }
  return { root, rig };
}

const approach = (cur, tgt, rate, dt) => cur + (tgt - cur) * Math.min(1, rate * dt);
const _qa = new THREE.Quaternion(), _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _pole = new THREE.Vector3();

/** two-bone IK: aim upper/lower so the end reaches `target` (world), elbow toward `pole` (world dir) */
function ik2(upper, lower, end, target, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E0 = lower.getWorldPosition(new THREE.Vector3()), H0 = end.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E0), b = E0.distanceTo(H0);
  const toT = target.clone().sub(S); let d = toT.length();
  if (d < 1e-6) return;
  const dir = toT.divideScalar(d);
  d = Math.min(d, (a + b) * 0.999); d = Math.max(d, Math.abs(a - b) * 1.01);
  const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - x * x));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0).addScaledVector(dir, -dir.y);
  perp.normalize();
  const elbow = S.clone().addScaledVector(dir, x).addScaledVector(perp, h);
  aimBone(upper, lower, elbow.clone().sub(S));
  const E = lower.getWorldPosition(new THREE.Vector3());
  aimBone(lower, end, S.addScaledVector(dir, d).sub(E));
}

/**
 * Per-frame animation. `s` is the same state racers.js animateRacer gets:
 * { speed, maxSpeed, steer (+1 = left), throttle, drift (-1|0|1), driftAngle, charge, boostT, air,
 *   airT, landT, hitT (0..1), hitKind, spinT, cheer, sad, t }
 */
export function animateHD(rig, s = {}, dt = 1 / 60) {
  const sp = rig.sp, t = s.t ?? (sp.time = (sp.time || 0) + dt);
  const steer = s.steer || 0, drift = s.drift || 0;
  const hit = (s.hitT > 0 && s.hitT < 1) || s.spinT > 0;
  const flail = hit ? 1 : 0;
  // CTR lean: into the corner, more in a slide
  const leanT = (steer * 0.30 + drift * 0.22) * rig.lean * (hit ? 0.3 : 1);
  sp.lean = approach(sp.lean, leanT, 8, dt);
  sp.yaw = approach(sp.yaw, steer * 0.38 + drift * 0.18, 7, dt);
  sp.tuck = approach(sp.tuck, s.boostT > 0 ? 1 : 0, 6, dt);
  sp.arms = approach(sp.arms, flail, 10, dt);
  sp.cheer = approach(sp.cheer, s.cheer ? 1 : 0, 5, dt);
  sp.sad = approach(sp.sad || 0, s.sad ? 1 : 0, 4, dt);
  sp.wheelA = approach(sp.wheelA, hit ? 0 : steer * 0.9 + drift * 0.3, 10, dt);
  const land = s.landT != null && s.landT < 0.3 ? Math.sin(s.landT / 0.3 * Math.PI) * (1 - s.landT / 0.3) : 0;
  const bump = (s.speed || 0) > 1 ? Math.sin(t * 17) * 0.012 * Math.min(1, (s.speed || 0) / 20) : 0;

  if (rig.kind === 'static') {
    const i = rig.inner;
    i.rotation.set(sp.tuck * 0.12 - land * 0.1, sp.yaw * 0.5 + (hit ? Math.sin(t * 25) * 0.3 : 0), -sp.lean * 0.9);
    i.position.y = bump + (s.cheer ? Math.abs(Math.sin(t * 6)) * 0.08 : 0);
    i.scale.set(rig.k * (1 + land * 0.1), rig.k * (1 - land * 0.15), rig.k * (1 + land * 0.1));
    return;
  }
  const bn = rig.bones, base = rig.t.base;
  for (const n in base) if (bn[n]) bn[n].quaternion.copy(base[n]);
  rig.root.updateWorldMatrix(true, true);
  // spine: roll into the corner, pitch forward on boost / land squash / sad slump, wobble when hit
  const wob = flail * Math.sin(t * 22) * 0.25;
  const pitch = sp.tuck * 0.10 + land * 0.18 + sp.sad * 0.25 - sp.cheer * 0.12;
  for (const n of SPINE) {
    const b = bn[n]; if (!b) continue;
    b.quaternion.multiply(localAxisRot(b, Z, (-sp.lean + wob) / 3, _qa));
    b.quaternion.multiply(localAxisRot(b, X, pitch / 3, _qa));
    b.updateMatrixWorld(true);
  }
  // head: look into the turn, keep the eyes roughly level against the lean, nod
  for (const [n, f] of [['Neck', 0.4], ['Head', 0.6]]) {
    const b = bn[n]; if (!b) continue;
    b.quaternion.multiply(localAxisRot(b, Y, sp.yaw * f + flail * Math.sin(t * 17) * 0.3 * f, _qa));
    b.quaternion.multiply(localAxisRot(b, Z, sp.lean * 0.45 * f, _qa));
    b.quaternion.multiply(localAxisRot(b, X, (-sp.tuck * 0.12 - sp.sad * 0.35 + bump * 4) * f, _qa));
    b.updateMatrixWorld(true);
  }
  // hands: on the wheel (turning with steer), up in the air to cheer, flailing when hit
  const R = rig.wheelR, a = sp.wheelA, tilt = rig.wheelTilt, wc = rig.wheelC;
  if (rig.wheel) rig.wheel.rotation.set(-tilt, 0, -a, 'XYZ');
  const rootQ = rig.root.getWorldQuaternion(new THREE.Quaternion());
  const L = rig.t.armLen * rig.k;
  for (const sx of [1, -1]) {
    const side = sx > 0 ? 'Left' : 'Right';
    const up = bn[side + 'Arm'], lo = bn[side + 'ForeArm'], hand = bn[side + 'Hand'];
    if (!up || !lo || !hand) continue;
    // grip at 9-and-3 on the rim, rotated by the wheel angle (top of the wheel moves toward +x on +a)
    const u0 = sx * R * 0.95, cu = Math.cos(a), su = Math.sin(a);
    const u = u0 * cu, v = -u0 * su;
    _ta.set(wc.x + u, wc.y + v * Math.cos(tilt), wc.z - v * Math.sin(tilt) - 0.02);
    const sh = up.getWorldPosition(new THREE.Vector3()); rig.root.worldToLocal(sh);
    if (sp.cheer > 0.01 || sp.arms > 0.01) {
      const wave = Math.sin(t * 9 + sx) * 0.25;
      _tb.set(sh.x + sx * L * (0.75 + wave * 0.15), sh.y + L * 1.1, sh.z + L * 0.1);   // a wide V: big heads, short arms
      const fl = _v4.set(sh.x + sx * L * (0.8 + Math.sin(t * 19 + sx * 2) * 0.2), sh.y + L * (0.3 + Math.sin(t * 23 + sx) * 0.5), sh.z + L * 0.2 * Math.cos(t * 15));
      _tb.lerp(fl, sp.arms / Math.max(1e-3, sp.arms + sp.cheer));
      _ta.lerp(_tb, Math.min(1, sp.cheer + sp.arms));
    }
    rig.root.localToWorld(_ta);
    _pole.set(sx * 0.7, -0.75, -0.25).applyQuaternion(rootQ);
    ik2(up, lo, hand, _ta, _pole);
  }
  rig.head.position.y = rig.t.headTop * rig.k * (1 - land * 0.1) - sp.sad * 0.05;
}
