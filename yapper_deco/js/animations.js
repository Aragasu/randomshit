// Decoded APNG cache, keyed by the layer's image src.
//
// Decoding is expensive (a 60-frame decoration is ~20 MB of bitmaps), so each
// source is decoded once, shared by every layer that uses it, and the oldest
// entries are dropped when too many are alive at once.

import { decodeAPNG } from "./apng.js";
import { state } from "./state.js";

const MAX_ANIMATED = 4;
const entries = new Map(); // src -> { status, anim }
let notify = () => {};

export function setAnimationReadyHandler(fn) {
  notify = fn;
}

/** Redraw, and let the inspector pick up the new frame count. */
function announce() {
  notify();
  document.dispatchEvent(new CustomEvent("deco:animation"));
}

/** The decoded animation for `src`, or null. Kicks off a decode the first time. */
export function animationFor(src) {
  if (!src) return null;
  const entry = entries.get(src);
  if (entry) return entry.anim || null;
  entries.set(src, { status: "loading", anim: null });
  load(src);
  return null;
}

async function load(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`replied ${res.status}`);
    const anim = await decodeAPNG(await res.arrayBuffer());
    if (!anim) {
      entries.set(src, { status: "static", anim: null });
      return;
    }
    entries.set(src, { status: "ready", anim });
    evict(src);
    announce();
  } catch {
    // Static PNG, a JPEG, an SVG, or something we can't parse: the still image
    // path already handles it, so this is not an error worth surfacing.
    entries.set(src, { status: "static", anim: null });
  }
}

/** Called when the bytes are already in hand, so placing one is instant. */
export function registerAnimation(src, anim) {
  if (!src || !anim) return;
  entries.set(src, { status: "ready", anim });
  evict(src);
  announce();
}

export function animationInfo(src) {
  const entry = entries.get(src);
  if (!entry || entry.status !== "ready") return null;
  return { frames: entry.anim.frames.length, ms: entry.anim.duration };
}

/** Drop the oldest animations, but never one a layer is still drawing from:
 *  closing bitmaps that a canvas is using throws mid-render. */
function evict(keep) {
  const ready = [...entries.entries()].filter(([, e]) => e.status === "ready");
  while (ready.length > MAX_ANIMATED) {
    const inUse = (anim) => state.project?.layers.some((layer) => layer._anim === anim);
    const index = ready.findIndex(([src, entry]) => src !== keep && !inUse(entry.anim));
    if (index === -1) break;
    const [src, entry] = ready.splice(index, 1)[0];
    for (const frame of entry.anim.frames) frame.bitmap.close?.();
    entries.delete(src);
  }
}
