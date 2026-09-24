// camera.js — CTR-style chase camera. Low behind the kart, lags its heading a little so a
// power slide visibly swings the kart body, looks ahead into corners, kicks the FOV on boost,
// and never dips under the terrain.
import * as THREE from 'three';

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export const CAM = {
  dist: 5.4, height: 2.05, lookUp: 1.0, lookFwd: 5, fov: 66, fovBoost: 11, fovSpeed: 5,
  yawLag: 5.5, slideLag: 3.2, aheadS: 16, aheadW: 0.22, minClear: 1.1,
  wallMargin: 0.9, tunnelCap: 5.5,   // camera stays this far inside the boundary line; max height over the road in a tunnel
};

export class ChaseCam {
  constructor(camera) {
    this.cam = camera;
    this.yaw = 0; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.y = 0; this.fovK = 0; this.shakeA = 0; this.pinned = null; this.intro = 0;
    this._v = new THREE.Vector3(); this._q = { x: 0, y: 0, z: 0 }; this._pr = {}; this.push = 0;
    this.fovMul = 1;   // 2P split screen: a half-height view keeps ~the 1P horizontal FOV with a smaller vertical one (main.js)
  }
  /** debug: pin the camera at [x,y,z,tx,ty,tz] (URL ?cam=) */
  pin(arr) { this.pinned = arr; }
  shake(a) { this.shakeA = Math.min(1, this.shakeA + a); }
  snap(k) { this.yaw = k.yaw; this.y = k.pos.y; this.fovK = 0; this.push = 0; }

  /**
   * @param k kart (physics state), p interpolated position {x,y,z}, yaw interpolated travel yaw
   * @param track the track model, groundAt(x,z) terrain/road height for clip avoidance
   */
  update(dt, k, p, yaw, track, groundAt) {
    const c = this.cam;
    if (this.pinned) {
      const a = this.pinned; c.position.set(a[0], a[1], a[2]); c.lookAt(a[3], a[4], a[5]);
      c.fov = CAM.fov * this.fovMul; c.updateProjectionMatrix(); return;
    }
    // heading: travel yaw, nudged toward the road ahead so the view opens into the corner
    let target = yaw;
    if (track) {
      const ahead = track.frameAt(k.s + CAM.aheadS + Math.max(0, k.speed) * 0.3).yaw;
      target = yaw + clamp(wrapA(ahead - yaw), -0.5, 0.5) * CAM.aheadW;
    }
    const lag = k.drift ? CAM.slideLag : CAM.yawLag;
    this.yaw += wrapA(target - this.yaw) * Math.min(1, lag * dt);
    const back = k.speed < -1 ? 0.75 : 1;
    const dist = CAM.dist + clamp(k.speed / 30, 0, 1.2) * 0.9;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    // vertical: follow smoothly (hops and bumps shouldn't jolt the view)
    this.y += (p.y - this.y) * Math.min(1, (k.air ? 3.5 : 9) * dt);
    const pos = this._v.set(p.x - fx * dist * back, this.y + CAM.height, p.z - fz * dist * back);
    // wall collision (cheap): the boundary is a line at lat = ±lim along the track, so keep the
    // camera inside it (minus a margin) by sliding it sideways. Stops the boom poking through
    // castle parapets, the spiral's tower, tunnel walls and cliff faces on the outside of hairpins.
    // 'fall' edges (Star Road) have no wall. Also caps the height under tunnel roofs.
    if (track) {
      this._q.x = pos.x; this._q.y = p.y; this._q.z = pos.z;
      const pr = track.project(this._q, k.si ?? -1, this._pr);
      if (!pr.gap) {
        const m = CAM.wallMargin;
        const hiL = pr.limL - m, hiR = -(pr.limR - m);
        let d = 0;
        if (pr.lat > hiL && isFinite(pr.limL)) d = hiL - pr.lat;
        else if (pr.lat < hiR && isFinite(pr.limR)) d = hiR - pr.lat;
        // ease out of a correction instead of snapping back (the boom swings across a corner)
        this.push = d !== 0 && Math.abs(d) > Math.abs(this.push) ? d : this.push + (d - this.push) * Math.min(1, 8 * dt);
        if (Math.abs(this.push) > 1e-3) { pos.x += pr.lx * this.push; pos.z += pr.lz * this.push; }
        if (pr.tunnel) pos.y = Math.min(pos.y, pr.cy + CAM.tunnelCap);
      } else this.push *= Math.exp(-8 * dt);
    }
    if (groundAt) {
      const g = groundAt(pos.x, pos.z, k.si, p.y);   // hint + kart height: stay on the kart's level where the track passes over itself
      if (isFinite(g)) pos.y = Math.max(pos.y, g + CAM.minClear);
    }
    // shake (landing, walls, hits)
    if (this.shakeA > 0.001) {
      const t = performance.now() / 1000, a = this.shakeA * 0.35;
      pos.x += Math.sin(t * 47) * a; pos.y += Math.sin(t * 59 + 1) * a * 0.7; pos.z += Math.sin(t * 53 + 2) * a;
      this.shakeA *= Math.exp(-6 * dt);
    }
    c.position.copy(pos);
    this.look.set(p.x + fx * CAM.lookFwd, this.y + CAM.lookUp, p.z + fz * CAM.lookFwd);
    c.lookAt(this.look);
    // FOV: speed + boost kick
    const boost = k.boostT > 0 ? 1 : 0;
    this.fovK += (boost - this.fovK) * Math.min(1, (boost ? 6 : 2.2) * dt);
    const fov = (CAM.fov + CAM.fovBoost * this.fovK + CAM.fovSpeed * clamp(k.speed / 22, 0, 1.3)) * this.fovMul;
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  }
}
