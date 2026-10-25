// Exporters: transparent PNG, animated WebP / GIF / PNG, and the project file.

import { drawFrame } from "./render.js";
import { buildPalette, createGIF, histogram, makeMapper, toIndices } from "./gif.js";
import { encodeAnimatedWebP } from "./webp.js";
import { download, readableBytes, seconds, toast } from "./util.js";

const slug = (name) => (name || "deco").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "deco";

function offscreen(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** Frame count and spacing, shared by every animated format. */
function framePlan(project, maxFrames) {
  const duration = project.duration || 2000;
  const fps = project.fps || 24;
  const wanted = Math.max(2, Math.round((duration / 1000) * fps));
  const count = Math.max(2, Math.min(wanted, maxFrames));
  return { size: project.size, duration, fps, wanted, count, step: duration / count, loop: project.loop !== false };
}

const capNote = (plan) => (plan.wanted > plan.count ? ` (capped from ${plan.wanted})` : "");

/** Let the progress label paint before hogging the main thread. */
const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** `save: false` builds the file without handing it to the browser. */
const saveFile = (save, blob, name) => { if (save) download(blob, name); };

export async function exportPNG(project, time, { scale = 1, avatar = null, withAvatar = false, save = true } = {}) {
  const size = project.size * scale;
  const canvas = offscreen(size);
  const ctx = canvas.getContext("2d");
  drawFrame(ctx, project, time, { size, avatar, withAvatar });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  saveFile(save, blob, `${slug(project.name)}${scale > 1 ? `@${scale}x` : ""}.png`);
  toast(`PNG saved · ${size}×${size} · ${readableBytes(blob.size)}`);
  return blob;
}

export async function exportAPNG(project, { avatar = null, withAvatar = false, maxFrames = 72, save = true } = {}) {
  const plan = framePlan(project, maxFrames);
  const { size } = plan;

  const canvas = offscreen(size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const raw = [];
  for (let i = 0; i < plan.count; i++) {
    drawFrame(ctx, project, i * plan.step, { size, avatar, withAvatar });
    raw.push(ctx.getImageData(0, 0, size, size).data);
  }

  const blob = await encodeAPNG(raw, size, plan.step, plan.loop ? 0 : 1);
  saveFile(save, blob, `${slug(project.name)}.png`);
  toast(`Animated PNG saved · ${plan.count} frames${capNote(plan)} · ${readableBytes(blob.size)}`);
  return blob;
}

/** Animated WebP: yapper takes it, and it keeps real alpha at a fraction of GIF's size. */
export async function exportWebP(project, { avatar = null, withAvatar = false, maxFrames = 72, quality = 0.9, save = true } = {}) {
  const plan = framePlan(project, maxFrames);
  const { size } = plan;

  const canvas = offscreen(size);
  const ctx = canvas.getContext("2d");
  const stills = [];
  for (let i = 0; i < plan.count; i++) {
    drawFrame(ctx, project, i * plan.step, { size, avatar, withAvatar });
    const still = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    // Browsers without a WebP encoder silently hand back a PNG.
    if (!still || still.type !== "image/webp") throw new Error("this browser can't encode WebP");
    stills.push(await still.arrayBuffer());
  }

  const blob = await encodeAnimatedWebP(stills, {
    width: size, height: size, frameMs: plan.step, loop: plan.loop,
  });
  saveFile(save, blob, `${slug(project.name)}.webp`);
  toast(`Animated WebP saved · ${plan.count} frames${capNote(plan)} · ${readableBytes(blob.size)}`);
  return blob;
}

/** Animated GIF: flat 255-colour palette, hard-edged transparency. */
export async function exportGIF(project, { avatar = null, withAvatar = false, maxFrames = 72, save = true } = {}) {
  const plan = framePlan(project, maxFrames);
  const { size } = plan;
  await nextPaint();   // the whole encode below is synchronous

  const canvas = offscreen(size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // Pass one reads colours only: a shared palette needs to see the whole loop,
  // not just its first frame, so up to 24 frames are sampled across it.
  const hist = new Uint32Array(32768);
  const stride = Math.max(1, Math.round(plan.count / 24));
  for (let i = 0; i < plan.count; i += stride) {
    drawFrame(ctx, project, i * plan.step, { size, avatar, withAvatar });
    histogram(ctx.getImageData(0, 0, size, size).data, hist);
  }
  if (!hist.some((n) => n > 0)) histogram(ctx.getImageData(0, 0, size, size).data, hist);

  const palette = buildPalette(hist);
  const map = makeMapper(palette);
  const gif = createGIF({ width: size, height: size, palette, loop: plan.loop });
  const indices = new Uint8Array(size * size);
  // GIF delays are whole centiseconds, so a 24 fps step (41.7 ms) can't be a
  // single number. Round cumulatively instead of per frame, or the loop drifts
  // 4% short: 4,4,5,4,4,5 ... ends exactly on the timeline's length.
  let elapsedCs = 0;
  for (let i = 0; i < plan.count; i++) {
    drawFrame(ctx, project, i * plan.step, { size, avatar, withAvatar });
    toIndices(ctx.getImageData(0, 0, size, size).data, indices, map);
    const targetCs = Math.round(((i + 1) * plan.step) / 10);
    const delayCs = Math.max(2, targetCs - elapsedCs);
    elapsedCs += delayCs;
    gif.addFrame(indices, delayCs * 10);
  }
  const total = elapsedCs * 10;

  const blob = gif.finish();
  saveFile(save, blob, `${slug(project.name)}.gif`);
  toast(`Animated GIF saved · ${plan.count} frames${capNote(plan)} · ${seconds(total)} loop · ${readableBytes(blob.size)}`);
  return blob;
}

export function exportJSON(project) {
  const clone = JSON.parse(JSON.stringify(project, (key, value) => (key === "_img" ? undefined : value)));
  const blob = new Blob([JSON.stringify(clone, null, 2)], { type: "application/json" });
  download(blob, `${slug(project.name)}.json`);
  toast("Project file saved");
}

export async function importJSON(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!Array.isArray(data.layers)) throw new Error("that file has no layers");
  return data;
}

// ---------- APNG encoder ----------

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value) {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

async function deflateZlib(bytes) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("this browser can't compress the animation");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function scanlines(rgba, size) {
  const stride = size * 4;
  const out = new Uint8Array((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    out[y * (stride + 1)] = 0; // filter: none
    out.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return out;
}

async function encodeAPNG(frames, size, delayMs, plays) {
  const parts = [];
  parts.push(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

  const ihdr = new Uint8Array(13);
  ihdr.set(u32(size), 0);
  ihdr.set(u32(size), 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  parts.push(chunk("IHDR", ihdr));

  const actl = new Uint8Array(8);
  actl.set(u32(frames.length), 0);
  actl.set(u32(plays), 4);
  parts.push(chunk("acTL", actl));

  const delayNum = Math.max(1, Math.round(delayMs));
  let sequence = 0;

  for (let i = 0; i < frames.length; i++) {
    const fctl = new Uint8Array(26);
    fctl.set(u32(sequence++), 0);
    fctl.set(u32(size), 4);
    fctl.set(u32(size), 8);
    fctl.set(u32(0), 12);
    fctl.set(u32(0), 16);
    fctl.set(u16(delayNum), 20);
    fctl.set(u16(1000), 22);
    fctl[24] = 0; // dispose: none
    fctl[25] = 0; // blend: source
    parts.push(chunk("fcTL", fctl));

    const compressed = await deflateZlib(scanlines(frames[i], size));
    if (i === 0) {
      parts.push(chunk("IDAT", compressed));
    } else {
      const fdat = new Uint8Array(4 + compressed.length);
      fdat.set(u32(sequence++), 0);
      fdat.set(compressed, 4);
      parts.push(chunk("fdAT", fdat));
    }
  }

  parts.push(chunk("IEND", new Uint8Array(0)));
  return new Blob(parts, { type: "image/apng" });
}

function u16(value) {
  return new Uint8Array([(value >>> 8) & 255, value & 255]);
}

/** Used by the self-test: decode the blob we just built. */
export async function inspectAPNG(blob) {
  if (typeof ImageDecoder === "undefined") return { supported: false };
  const decoder = new ImageDecoder({ data: blob.stream(), type: "image/png" });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  return { supported: true, frames: track.frameCount, animated: track.animated };
}
