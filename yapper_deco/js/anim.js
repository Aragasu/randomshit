// Keyframe interpolation. Each keyframe owns the curve on its outgoing segment.

import { ease } from "./easing.js";
import { lerp } from "./util.js";

const PROPS = ["x", "y", "scale", "rotation", "opacity"];

export function sampleLayer(layer, time) {
  const kfs = layer.keyframes;
  if (!kfs || kfs.length === 0) {
    return { x: layer.x, y: layer.y, scale: layer.scale, rotation: layer.rotation, opacity: layer.opacity };
  }
  if (kfs.length === 1 || time <= kfs[0].t) return pick(kfs[0]);
  const last = kfs[kfs.length - 1];
  if (time >= last.t) return pick(last);

  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t <= time) i++;
  const a = kfs[i], b = kfs[i + 1];
  const span = b.t - a.t;
  const raw = span <= 0 ? 1 : (time - a.t) / span;
  const t = ease(a.easing, raw);
  const out = {};
  for (const prop of PROPS) out[prop] = lerp(a[prop], b[prop], t);
  return out;
}

function pick(kf) {
  return { x: kf.x, y: kf.y, scale: kf.scale, rotation: kf.rotation, opacity: kf.opacity };
}

/** Sample at a given time with easing bypassed — used for snapping/ghosts. */
export function sampleRaw(layer, time) {
  return sampleLayer(layer, time);
}

export function animationSpan(project) {
  let max = 0;
  for (const layer of project.layers) {
    for (const kf of layer.keyframes) max = Math.max(max, kf.t);
  }
  return max;
}
