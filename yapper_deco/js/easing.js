// Cubic-bezier easing: presets plus a solver for arbitrary control points.

export const PRESETS = [
  { name: "Linear", p: [0, 0, 1, 1] },
  { name: "Ease", p: [0.25, 0.1, 0.25, 1] },
  { name: "Ease in", p: [0.42, 0, 1, 1] },
  { name: "Ease out", p: [0, 0, 0.58, 1] },
  { name: "Ease in out", p: [0.42, 0, 0.58, 1] },
  { name: "Back out", p: [0.34, 1.56, 0.64, 1] },
  { name: "Anticipate", p: [0.36, -0.2, 0.66, 1] },
  { name: "Snap", p: [0.72, 0, 0.84, 0] },
];

const A = (a, b) => 1 - 3 * b + 3 * a;
const B = (a, b) => 3 * b - 6 * a;
const C = (a) => 3 * a;

const calcBezier = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;

function slope(t, a, b) {
  return 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
}

/** x -> t for the x component, Newton-Raphson with a bisection fallback. */
function solveT(x, x1, x2) {
  let t = x;
  for (let i = 0; i < 6; i++) {
    const dx = slope(t, x1, x2);
    if (Math.abs(dx) < 1e-6) break;
    const err = calcBezier(t, x1, x2) - x;
    if (Math.abs(err) < 1e-6) return t;
    t -= err / dx;
  }
  let lo = 0, hi = 1;
  t = x;
  for (let i = 0; i < 22; i++) {
    const err = calcBezier(t, x1, x2) - x;
    if (Math.abs(err) < 1e-6) break;
    if (err > 0) hi = t; else lo = t;
    t = (lo + hi) / 2;
  }
  return t;
}

/** Progress 0..1 -> eased 0..1 (may overshoot for springy curves). */
export function ease(easing, x) {
  if (!easing || easing.type === "hold") return x >= 1 ? 1 : 0;
  const p = easing.p || [0.42, 0, 0.58, 1];
  if (p[0] === 0 && p[1] === 0 && p[2] === 1 && p[3] === 1) return x;
  return calcBezier(solveT(Math.min(1, Math.max(0, x)), p[0], p[2]), p[1], p[3]);
}

export function bezierPoints(easing) {
  return (easing && easing.p) || [0.42, 0, 0.58, 1];
}

export function matchPreset(p) {
  return PRESETS.find((preset) => preset.p.every((v, i) => Math.abs(v - p[i]) < 0.02));
}

export function easingLabel(easing) {
  if (!easing) return "Ease in out";
  if (easing.type === "hold") return "Hold";
  const preset = matchPreset(bezierPoints(easing));
  return preset ? preset.name : "Custom curve";
}
