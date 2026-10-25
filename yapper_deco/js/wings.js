// "Fallen wings" — an original deco, built here rather than traced from anyone
// else's art: three fanned ranks of feather paths per side, long trailing
// primaries, a lit inner edge, a slow rustle that runs shoulder-to-tip, and a
// few feathers shaking loose and drifting.
//
// Everything is a plain path layer with keyframes, so the whole thing opens in
// the editor as something you can pull apart and repaint.

import { makeLayer } from "./state.js";
import { uid } from "./util.js";

const INK = "#17142f";
const DEEP = "#341a63";
const PLUM = "#4a2688";
const VIOLET = "#6b3fc4";
const LILAC = "#a898ff";
const ORCHID = "#8f74e8";
const PALE = "#e3d6ff";
const EMBER = "#ff9ec4";

const SIZE = 512;
const CX = 256;
const CY = 244;
const RIM = 168;
const STRIP = 412;   // keep art clear of the dark name strip
const EDGE = 12;
const DURATION = 3000;

/** How far a feather can run from `x,y` before it leaves the canvas. */
function room(x, y, dirX, dirY) {
  const limits = [];
  if (dirX > 1e-4) limits.push((SIZE - EDGE - x) / dirX);
  if (dirX < -1e-4) limits.push((EDGE - x) / dirX);
  if (dirY > 1e-4) limits.push((STRIP - y) / dirY);
  if (dirY < -1e-4) limits.push((EDGE - y) / dirY);
  return Math.max(0, Math.min(...limits));
}

/** A feather as a closed path, drawn upright around its own centre. */
function featherNodes(length, width, bend) {
  const half = length / 2;
  return [
    { x: 0, y: half, out: { x: -width * 0.42, y: -length * 0.2 } },
    { x: -width / 2 + bend * 0.22, y: -length * 0.08, out: { x: -width * 0.16, y: -length * 0.3 } },
    // A short, sideways handle at the tip keeps the point sharp; a long one
    // pulls the curve past the tip and pushes the art into the name strip.
    { x: bend, y: -half, out: { x: width * 0.34, y: length * 0.08 } },
    { x: width / 2 + bend * 0.26, y: -length * 0.06, out: { x: width * 0.44, y: length * 0.22 } },
  ];
}

/** Smooth a point list into path nodes (Catmull-Rom handles). */
function smoothNodes(points, closed = true) {
  return points.map((p, i) => {
    const prev = points[(i - 1 + points.length) % points.length];
    const next = points[(i + 1) % points.length];
    const wrap = closed || (i > 0 && i < points.length - 1);
    return {
      x: p.x,
      y: p.y,
      out: wrap ? { x: (next.x - prev.x) / 6, y: (next.y - prev.y) / 6 } : { x: 0, y: 0 },
    };
  });
}

const mirrorNodes = (nodes) => nodes.map((n) => ({
  ...n,
  x: -n.x,
  out: n.out ? { x: -n.out.x, y: n.out.y } : undefined,
}));

const lerp = (a, b, t) => a + (b - a) * t;

// Ranks, back to front. `roots` walks the shoulder arc, `angles` is the
// feather direction it points in (0 = straight down, -90 = left, -180 = up).
// The wings hang: they take hold high beside the head and trail down the sides.
const RANKS = [
  {
    label: "Primary",
    count: 9,
    radius: RIM + 24,
    roots: [-118, -22],
    angles: [-168, -112],
    fills: [DEEP, PLUM],
    strokeWidth: 3,
    lengthScale: 0.92,
    widest: 58,
    taper: [178, 104],
    sway: 3.2,
  },
  {
    label: "Secondary",
    count: 7,
    radius: RIM + 36,
    roots: [-126, -30],
    angles: [-150, -98],
    fills: [VIOLET],
    strokeWidth: 2.4,
    lengthScale: 0.66,
    widest: 44,
    taper: [130, 72],
    sway: 4,
  },
  {
    label: "Covert",
    count: 5,
    radius: RIM + 48,
    roots: [-120, -42],
    angles: [-132, -86],
    fills: [ORCHID],
    strokeWidth: 2,
    lengthScale: 0.45,
    widest: 30,
    taper: [86, 46],
    sway: 5,
  },
];

function featherLayer(config) {
  const { side, rank, index, fill } = config;
  const t = rank.count === 1 ? 0 : index / (rank.count - 1);
  const rootAngle = lerp(rank.roots[0], rank.roots[1], t);
  const dirAngle = lerp(rank.angles[0], rank.angles[1], t);

  const rad = (rootAngle * Math.PI) / 180;
  const rootX = CX + Math.sin(rad) * rank.radius;
  const rootY = CY - Math.cos(rad) * rank.radius;
  // Mirror by flipping the x axis: same shape, same sway, opposite side.
  const x = side < 0 ? rootX : SIZE - rootX;
  const rotation = side < 0 ? dirAngle : -dirAngle;

  const dirX = Math.sin((rotation * Math.PI) / 180);
  const dirY = -Math.cos((rotation * Math.PI) / 180);
  const reach = room(x, rootY, dirX, dirY) * rank.lengthScale;
  // Each rank tapers from a short shoulder feather to a long tip, so the wing
  // reads as a wing and not a column of identical leaves.
  const [short, long] = rank.taper;
  const cap = short + (long - short) * t ** 1.7;
  const length = Math.max(40, Math.min(reach, cap));
  const width = Math.min(rank.widest, Math.max(18, length * 0.34));
  const bend = -side * (6 + length * 0.06);

  const cx = x + dirX * (length / 2);
  const cy = rootY + dirY * (length / 2);

  const nodes = featherNodes(length, width, bend);
  const sway = rank.sway * -side;
  const drift = 1.6;

  const at = (time, rot, scale, extra = 0) => ({
    id: uid("k"),
    t: time,
    x: cx + dirX * extra,
    y: cy + dirY * extra,
    scale,
    rotation: rot,
    opacity: 1,
    easing: { type: "bezier", p: [0.42, 0, 0.58, 1] },
  });

  const phase = index * 90 + rank.radius / 8;
  const keyframes = [
    at(0, rotation, 1),
    at(760 + phase, rotation + sway, 1.03, drift),
    at(1780 + phase, rotation - sway * 0.5, 0.99, -drift * 0.4),
    at(DURATION, rotation, 1),
  ];

  const layer = makeLayer("path", {
    name: `${rank.label} ${index + 1} ${side < 0 ? "left" : "right"}`,
    x: cx,
    y: cy,
    rotation,
    w: width + Math.abs(bend),
    h: length,
    nodes: side < 0 ? nodes : mirrorNodes(nodes),
    closed: true,
    fill,
    stroke: INK,
    strokeWidth: rank.strokeWidth,
    keyframes,
  });
  layer._len = length;   // ordering hint, stripped once the wing is assembled
  return layer;
}

/** One feather shaking loose and tumbling out of frame. */
const LOOSE = [
  { angle: -118, radius: 208, side: -1, fill: ORCHID },
  { angle: -62, radius: 212, side: 1, fill: LILAC },
  { angle: -32, radius: 216, side: -1, fill: PALE },
];

function looseFeather(index) {
  const spot = LOOSE[index];
  const side = spot.side;
  const fill = spot.fill;
  const length = 54 + index * 9;
  const width = length * 0.34;
  // Outside the avatar circle on purpose: art behind the face is never seen
  // once Discord paints the avatar over it.
  const rad = (spot.angle * Math.PI) / 180;
  const startX = CX + Math.sin(rad) * spot.radius * -side;
  const startY = CY - Math.cos(rad) * spot.radius;
  const rotation = side * (30 + index * 14);
  const nodes = featherNodes(length, width, side * 8);

  const key = (t, x, y2, rot, opacity, scale = 1) => ({
    id: uid("k"),
    t,
    x,
    y: y2,
    scale,
    rotation: rot,
    opacity,
    easing: { type: "bezier", p: [0.33, 0, 0.67, 1] },
  });

  return makeLayer("path", {
    name: `Loose feather ${index + 1} ${side < 0 ? "left" : "right"}`,
    x: startX,
    y: startY,
    rotation,
    w: width + 8,
    h: length,
    nodes: side < 0 ? nodes : mirrorNodes(nodes),
    closed: true,
    fill,
    stroke: INK,
    strokeWidth: 2.6,
    keyframes: [
      key(0, startX, startY - 16, rotation, 0, 0.7),
      key(260 + index * 120, startX + side * 14, startY, rotation + side * 24, 0.95, 1),
      key(1500 + index * 90, startX + side * 34, startY + 22, rotation + side * 132, 0.8, 1),
      key(2450 + index * 60, startX + side * 52, startY + 36, rotation + side * 208, 0, 0.9),
      key(DURATION, startX + side * 52, startY + 36, rotation + side * 208, 0, 0.9),
    ],
  });
}

/** The wing's arm: a crescent that follows the avatar circle and comes to a
 *  point at both ends, so the feathers hang off a solid shape instead of
 *  floating in a chain. */
function wingBlade(side, { name, from, to, radius, bulge, width, fill, strokeWidth }) {
  const steps = 9;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = (lerp(from, to, t) * Math.PI) / 180;
    const r = radius + bulge * Math.sin(Math.PI * t);
    const w = 4 + width * (1 - t) ** 0.55;
    const point = (rr) => {
      const x = CX + Math.sin(theta) * rr;
      const yy = CY - Math.cos(theta) * rr;
      return { x: side < 0 ? x : SIZE - x, y: yy };
    };
    outer.push(point(r + w));
    inner.push(point(Math.max(RIM + 3, r - w * 0.45)));
  }

  const nodes = smoothNodes([...outer, ...inner.reverse()]);
  const x = nodes.reduce((sum, n) => sum + n.x, 0) / nodes.length;
  const y = nodes.reduce((sum, n) => sum + n.y, 0) / nodes.length;
  for (const node of nodes) {
    node.x -= x;
    node.y -= y;
  }
  const bounds = nodes.reduce((box, n) => ({
    x0: Math.min(box.x0, n.x), x1: Math.max(box.x1, n.x),
    y0: Math.min(box.y0, n.y), y1: Math.max(box.y1, n.y),
  }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });

  return makeLayer("path", {
    name,
    x,
    y,
    w: bounds.x1 - bounds.x0,
    h: bounds.y1 - bounds.y0,
    nodes,
    closed: true,
    fill,
    stroke: INK,
    strokeWidth,
    keyframes: [],
  });
}

/** A cold ember drifting up off the wing. */
function ember(index, x, y, fill, size) {
  const key = (t, yy, opacity, scale) => ({
    id: uid("k"),
    t,
    x: x + size * 0.6 * index,
    y: yy,
    scale,
    rotation: 0,
    opacity,
    easing: { type: "bezier", p: [0.42, 0, 0.58, 1] },
  });
  return makeLayer("sparkle", {
    name: `Ember ${index + 1}`,
    x,
    y,
    w: size,
    h: size,
    fill,
    strokeWidth: 0,
    keyframes: [
      key(0, y, 0, 0.4),
      key(420 + index * 130, y - 8, 0.95, 1),
      key(1900 + index * 110, y - 46, 0, 0.55),
      key(DURATION, y, 0, 0.4),
    ],
  });
}

export function wingsProject() {
  const layers = [];
  for (const side of [-1, 1]) {
    layers.push(wingBlade(side, {
      name: `Wing shoulder ${side < 0 ? "left" : "right"}`,
      from: -120, to: -22, radius: RIM + 26, bulge: 12, width: 18,
      fill: DEEP, strokeWidth: 3.4,
    }));
  }
  for (const side of [-1, 1]) {
    for (const rank of RANKS) {
      const batch = [];
      for (let i = 0; i < rank.count; i++) {
        const fill = rank.fills[i % rank.fills.length];
        batch.push(featherLayer({ side, rank, index: i, fill }));
      }
      // Long feathers paint first so the short ones sit on top of them: that is
      // what stops the wing looking like a pile of crossed leaves.
      batch.sort((a, b) => b._len - a._len);
      for (const layer of batch) {
        delete layer._len;
        layers.push(layer);
      }
    }
  }

  // Two long trailing feathers hang past the rest and give the wing its point.
  for (const side of [-1, 1]) {
    layers.push(featherLayer({
      side,
      index: 1,
      fill: PLUM,
      rank: {
        label: "Trailing",
        count: 2,
        radius: RIM + 20,
        roots: [-114, -88],
        angles: [-174, -164],
        strokeWidth: 3,
        lengthScale: 0.94,
        widest: 34,
        taper: [150, 190],
        sway: 2.6,
      },
    }));
  }

  // A pair of lit feathers along the inner edge so the purple catches light.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      layers.push(featherLayer({
        side,
        index: 2 + i * 2,
        fill: i === 0 ? PALE : LILAC,
        rank: {
          label: "Light",
          count: 9,
          radius: RIM + 30,
          roots: [-118, -22],
          angles: [-168, -112],
          strokeWidth: i === 0 ? 0 : 1.8,
          lengthScale: 0.92,
          widest: 16,
          taper: [150, 96],
          sway: 6,
        },
      }));
    }
  }

  layers.push(looseFeather(0));
  layers.push(looseFeather(1));
  layers.push(looseFeather(2));

  layers.push(ember(0, 70, 282, LILAC, 15));
  layers.push(ember(1, 438, 238, PALE, 12));
  layers.push(ember(2, 94, 362, EMBER, 10));
  layers.push(ember(3, 402, 372, LILAC, 11));

  return {
    version: 1,
    name: "fallen wings",
    size: SIZE,
    duration: DURATION,
    fps: 24,
    loop: true,
    layers,
  };
}
