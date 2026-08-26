'use strict';
import { SCENE } from './world.js';

// The scene is drawn at a TRUE SCALE: a fixed number of design units per CPU
// core, identical on every node. That is what makes the fence comparable --
// a fence 90 units wide means 3 cores reserved wherever you see it. The cost is
// that a real cluster no longer fits on screen, so the scene gets a camera.
export const PX_PER_CORE = 32;
export const MIN_NODE_W = 34;      // a sub-core node still needs to be clickable

// Steps for the +/- keys. `fit` is not restricted to these: snapping to a ladder
// wastes space whenever one axis is the binding constraint.
const ZOOMS = [0.4, 0.55, 0.75, 1, 1.4, 2];
const ZOOM_MIN = 0.25, ZOOM_MAX = 2;

export function createCamera() {
  let x = 0, y = 0;                 // world coords at the top-left of the viewport
  // True scale by default; whatever you settle on is remembered, the same way
  // skin, view and graphics tier are.
  let z = 1;
  try {
    const saved = parseFloat(localStorage.getItem('k8sfarm.zoom'));
    if (Number.isFinite(saved) && saved >= ZOOM_MIN && saved <= ZOOM_MAX) z = saved;
  } catch {}
  const persist = () => { try { localStorage.setItem('k8sfarm.zoom', String(z)); } catch {} };
  let world = { w: SCENE.w, h: SCENE.h };
  let vx = 0, vy = 0;               // pan velocity, for smooth key-held movement

  const zoom = () => z;

  function setWorld(w, h) {
    world = { w: Math.max(1, w), h: Math.max(1, h) };
    clamp();
  }

  // Keep the world in view. When it is smaller than the viewport on an axis it
  // is centred rather than pinned to a corner.
  function clamp() {
    const z = zoom();
    const viewW = SCENE.w / z, viewH = SCENE.h / z;
    if (world.w <= viewW) x = (world.w - viewW) / 2;
    else x = Math.max(0, Math.min(world.w - viewW, x));
    if (world.h <= viewH) y = (world.h - viewH) / 2;
    else y = Math.max(0, Math.min(world.h - viewH, y));
  }

  function pan(dx, dy) { x += dx; y += dy; clamp(); }

  // Zoom about the centre of the viewport, so the thing you were looking at
  // stays roughly where it was.
  function setZoom(next) {
    const z1 = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, next));
    if (Math.abs(z1 - z) < 1e-6) return;
    const z0 = z;
    const cx = x + SCENE.w / z0 / 2, cy = y + SCENE.h / z0 / 2;
    z = z1;
    x = cx - SCENE.w / z / 2;
    y = cy - SCENE.h / z / 2;
    clamp();
    persist();
  }

  // Step to the next ladder value past the current zoom, so +/- still feels
  // like discrete notches even after a continuous `fit`.
  function zoomIn() { setZoom(ZOOMS.find((v) => v > z + 1e-6) ?? ZOOM_MAX); }
  function zoomOut() {
    const below = ZOOMS.filter((v) => v < z - 1e-6);
    setZoom(below.length ? below[below.length - 1] : ZOOM_MIN);
  }

  // Pick the largest zoom step at which the whole world is visible.
  function fit() {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
        Math.min(SCENE.w / world.w, SCENE.h / world.h)));
    x = (world.w - SCENE.w / z) / 2;
    y = (world.h - SCENE.h / z) / 2;
    clamp();
    persist();
  }

  // Held keys accelerate, released keys glide to a stop: nicer than teleporting
  // a step per keydown repeat, and independent of the OS key-repeat rate.
  function step(dt, input) {
    const accel = 2600 / zoom();
    const damp = Math.pow(0.0016, dt / 1000);
    let ax = 0, ay = 0;
    if (input.left) ax -= 1;
    if (input.right) ax += 1;
    if (input.up) ay -= 1;
    if (input.down) ay += 1;
    if (ax || ay) {
      const m = Math.hypot(ax, ay) || 1;
      vx += (ax / m) * accel * (dt / 1000);
      vy += (ay / m) * accel * (dt / 1000);
    }
    vx *= damp; vy *= damp;
    const max = 900 / zoom();
    vx = Math.max(-max, Math.min(max, vx));
    vy = Math.max(-max, Math.min(max, vy));
    if (Math.abs(vx) < 0.4) vx = 0;
    if (Math.abs(vy) < 0.4) vy = 0;
    if (vx || vy) pan(vx * (dt / 1000), vy * (dt / 1000));
    return !!(vx || vy);
  }

  // Bring a world point to the middle of the viewport.
  function centerOn(wx, wy) {
    x = wx - SCENE.w / z / 2;
    y = wy - SCENE.h / z / 2;
    vx = vy = 0;
    clamp();
  }

  // Is this world point currently visible?
  function isVisible(wx, wy) {
    return wx >= x && wx <= x + SCENE.w / z && wy >= y && wy <= y + SCENE.h / z;
  }

  // Viewport (design units) -> world.
  function toWorld(px, py) {
    const z = zoom();
    return { x: x + (px - SCENE.x) / z, y: y + (py - SCENE.y) / z };
  }

  function canScroll() {
    const z = zoom();
    return world.w > SCENE.w / z + 0.5 || world.h > SCENE.h / z + 0.5;
  }

  return {
    pan, step, fit, zoomIn, zoomOut, setWorld, toWorld, centerOn, isVisible, canScroll,
    zoomTo: setZoom,
    get x() { return x; }, get y() { return y; },
    get zoom() { return zoom(); },
    get world() { return world; },
    get zoomLabel() { return `${Math.round(zoom() * 100)}%`; },
  };
}
