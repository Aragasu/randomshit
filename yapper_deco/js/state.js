// Document model, selection, and undo history.

import { uid } from "./util.js";

export { uid } from "./util.js";

export const CANVAS = { size: 512, cx: 256, cy: 244, r: 168, strip: 425 };

export const PALETTE = [
  { name: "Ink", value: "#17142f" },
  { name: "Coral", value: "#ff5f45" },
  { name: "Sun", value: "#ffc63d" },
  { name: "Mint", value: "#26d3a3" },
  { name: "Lilac", value: "#a898ff" },
  { name: "Sky", value: "#5cc8ff" },
  { name: "Pink", value: "#ff9ec4" },
  { name: "Paper", value: "#ffffff" },
];

export const EASE_DEFAULT = { type: "bezier", p: [0.42, 0, 0.58, 1] };

const subs = new Map();
export function on(event, fn) {
  if (!subs.has(event)) subs.set(event, new Set());
  subs.get(event).add(fn);
  return () => subs.get(event).delete(fn);
}
export function emit(event, detail) {
  for (const fn of subs.get(event) || []) fn(detail);
}

export const state = {
  project: null,
  selection: null,     // layer id
  kf: null,            // { layerId, kfId }
  time: 0,
  playing: false,
  zoom: "fit",
  guides: true,
  tool: "select",              // select | pen | brush
  brush: { size: 6, colour: "#17142f", fill: "#ff5f45" },
  avatar: null,        // data URL shown behind the deco on the stage
  includeAvatar: false // baked into exports when true
};

// ---------- layers ----------

const SHAPE_DEFAULTS = {
  balloon: { name: "Balloon", w: 96, h: 64, tail: 18, dots: 3, fill: "#ff5f45", strokeWidth: 5 },
  pill: { name: "Pill", w: 120, h: 40, radius: 20, fill: "#ffc63d", strokeWidth: 0 },
  circle: { name: "Dot", w: 40, h: 40, fill: "#26d3a3", strokeWidth: 5 },
  sparkle: { name: "Sparkle", w: 44, h: 44, fill: "#ffc63d", strokeWidth: 0 },
  burst: { name: "Burst", w: 96, h: 96, rays: 12, fill: "#26d3a3", strokeWidth: 5 },
  ring: { name: "Ring", w: 120, h: 120, fill: "none", strokeWidth: 6 },
  text: { name: "Text", text: "yap", w: 160, h: 60, fontSize: 52, fontWeight: 800, fill: "#17142f", strokeWidth: 0 },
  path: { name: "Path", w: 100, h: 100, nodes: [], closed: false, fill: "none", stroke: "#17142f", strokeWidth: 6 },
};

export function makeLayer(type, overrides = {}) {
  const base = SHAPE_DEFAULTS[type] || SHAPE_DEFAULTS.pill;
  return {
    id: uid(),
    type,
    name: base.name,
    visible: true,
    locked: false,
    x: CANVAS.cx,
    y: CANVAS.cy,
    scale: 1,
    rotation: 0,
    opacity: 1,
    fill: base.fill,
    stroke: "#17142f",
    strokeWidth: base.strokeWidth ?? 5,
    w: base.w,
    h: base.h,
    radius: base.radius,
    tail: base.tail,
    dots: base.dots,
    rays: base.rays,
    text: base.text,
    fontSize: base.fontSize,
    fontWeight: base.fontWeight,
    src: null,
    icon: null,
    license: null,
    nodes: base.nodes ? base.nodes.slice() : undefined,
    closed: base.closed ?? false,
    keyframes: [],
    ...overrides,
  };
}

export const SHAPE_TYPES = ["balloon", "pill", "circle", "sparkle", "burst", "ring", "text"];

/** Ring of balloons matching yapper-deco.png, as an editable starting point. */
export function starterProject() {
  const place = (theta, radius) => ({
    x: CANVAS.cx + Math.sin((theta * Math.PI) / 180) * radius,
    y: CANVAS.cy - Math.cos((theta * Math.PI) / 180) * radius,
    rotation: theta,
  });

  const balloon = (theta, radius, w, h, tail, dots, fill, name, pop = 0) =>
    makeLayer("balloon", {
      ...place(theta, radius),
      name, w, h, tail, dots, fill,
      keyframes: pop
        ? [
            { id: uid("k"), t: 0, ...place(theta, radius), scale: 0.35, opacity: 0, easing: { type: "bezier", p: [0.34, 1.56, 0.64, 1] } },
            { id: uid("k"), t: 620 + pop * 70, ...place(theta, radius), scale: 1, opacity: 1, easing: { type: "bezier", p: [0.42, 0, 0.58, 1] } },
          ]
        : [],
    });

  return {
    version: 1,
    name: "yapper deco",
    size: 512,
    duration: 2400,
    fps: 24,
    loop: true,
    layers: [
      balloon(0, 213, 86, 46, 14, 3, "#ff5f45", "Hero balloon", 0),
      balloon(-33, 228, 78, 64, 18, 2, "#ffc63d", "Gold left", 2),
      balloon(33, 228, 78, 64, 18, 2, "#ffc63d", "Gold right", 1),
      balloon(-67, 222, 66, 56, 16, 2, "#26d3a3", "Mint left", 3),
      balloon(67, 222, 66, 56, 16, 2, "#26d3a3", "Mint right", 2),
      balloon(-100, 217, 58, 50, 14, 2, "#ffcec2", "Pale coral", 4),
      balloon(100, 217, 58, 50, 14, 2, "#bfebdd", "Pale mint", 4),
      makeLayer("sparkle", { ...place(-127, 247), name: "Sparkle left", w: 20, h: 20, fill: "#ffc63d" }),
      makeLayer("sparkle", { ...place(127, 247), name: "Sparkle right", w: 20, h: 20, fill: "#26d3a3" }),
    ],
  };
}

export function setProject(project) {
  state.project = project;
  state.selection = project.layers.at(-1)?.id ?? null;
  state.kf = null;
  state.time = 0;
  emit("project");
  emit("selection");
  emit("time");
  emit("history");
}

// ---------- history ----------

const past = [];
const future = [];
const clone = (value) => JSON.parse(JSON.stringify(value));

export function commit(label = "") {
  past.push({ label, snapshot: clone(state.project) });
  if (past.length > 100) past.shift();
  future.length = 0;
  emit("history");
}

export function undo() {
  const entry = past.pop();
  if (!entry) return;
  future.push({ snapshot: clone(state.project) });
  state.project = entry.snapshot;
  if (!state.project.layers.some((l) => l.id === state.selection)) state.selection = null;
  state.kf = null;
  emit("project");
  emit("selection");
  emit("history");
}

export function redo() {
  const entry = future.pop();
  if (!entry) return;
  past.push({ snapshot: clone(state.project) });
  state.project = entry.snapshot;
  state.kf = null;
  emit("project");
  emit("selection");
  emit("history");
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

// ---------- selection ----------

export function selectedLayer() {
  return state.project?.layers.find((l) => l.id === state.selection) || null;
}

export function selectLayer(id) {
  state.selection = id;
  state.kf = null;
  emit("selection");
}

export function selectKeyframe(layerId, kfId) {
  state.selection = layerId;
  state.kf = kfId;
  emit("selection");
}

export function keyframeAt(layer, time = state.time) {
  return (layer?.keyframes || []).find((k) => Math.abs(k.t - time) < 1) || null;
}

export function addKeyframe(layerId, patch = {}, time = state.time) {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  const existing = keyframeAt(layer, time);
  if (existing) {
    Object.assign(existing, patch);
    emit("project");
    return existing;
  }
  const kf = {
    id: uid("k"),
    t: Math.round(time),
    x: layer.x, y: layer.y, scale: layer.scale,
    rotation: layer.rotation, opacity: layer.opacity,
    easing: clone(EASE_DEFAULT),
    ...patch,
  };
  layer.keyframes.push(kf);
  layer.keyframes.sort((a, b) => a.t - b.t);
  emit("project");
  return kf;
}

/** Writes a transform edit: onto a keyframe when the layer is animated, else the base. */
export function writeTransform(layer, patch, time = state.time) {
  if (layer.keyframes.length > 0) {
    const existing = keyframeAt(layer, time);
    if (existing) Object.assign(existing, patch);
    else addKeyframe(layer.id, patch, time);
  } else {
    Object.assign(layer, patch);
  }
}

export function removeKeyframe(layerId, kfId) {
  const layer = state.project.layers.find((l) => l.id === layerId);
  if (!layer) return;
  layer.keyframes = layer.keyframes.filter((k) => k.id !== kfId);
  if (state.kf === kfId) state.kf = null;
  emit("project");
  emit("selection");
}
