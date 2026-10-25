// Frame rendering shared by the stage and the exporters.

import { CANVAS, state } from "./state.js";
import { sampleLayer } from "./anim.js";
import { drawLayer, layerCorners } from "./shapes.js";
import { animationFor, setAnimationReadyHandler } from "./animations.js";
import { clamp } from "./util.js";

const images = new Map();
let onImageReady = () => {};

export function setImageReadyHandler(fn) {
  onImageReady = fn;
}

export function imageFor(src) {
  if (!src) return null;
  if (images.has(src)) return images.get(src);
  const img = new Image();
  img.decoding = "async";
  // Remote art is fetched with CORS so an exported canvas isn't tainted.
  if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
  img.onload = () => onImageReady();
  img.src = src;
  images.set(src, img);
  return img;
}

setAnimationReadyHandler(() => onImageReady());

export function prepareImages(project) {
  for (const layer of project.layers) {
    if (!layer.src) continue;
    layer._img = imageFor(layer.src);
    layer._anim = animationFor(layer.src);
  }
}

function drawAvatar(ctx, src, size) {
  const img = imageFor(src);
  if (!img || !img.complete || !img.naturalWidth) return;
  const k = size / CANVAS.size;
  ctx.save();
  ctx.beginPath();
  ctx.arc(CANVAS.cx * k, CANVAS.cy * k, CANVAS.r * k, 0, Math.PI * 2);
  ctx.clip();
  const side = CANVAS.r * 2 * k;
  const box = { x: (CANVAS.cx - CANVAS.r) * k, y: (CANVAS.cy - CANVAS.r) * k, w: side, h: side };
  const ratio = img.naturalWidth / img.naturalHeight;
  let w = box.w, h = box.h;
  if (ratio > 1) w = box.h * ratio; else h = box.w / ratio;
  ctx.drawImage(img, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  ctx.restore();
}

/** Draw the deco itself. `size` is the pixel size of the output square. */
export function drawFrame(ctx, project, time, { size = CANVAS.size, avatar = null, withAvatar = false } = {}) {
  const k = size / CANVAS.size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (withAvatar && avatar) drawAvatar(ctx, avatar, size);
  prepareImages(project);

  for (const layer of project.layers) {
    if (!layer.visible) continue;
    const s = sampleLayer(layer, time);
    ctx.save();
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.globalAlpha = clamp(s.opacity, 0, 1);
    ctx.translate(s.x, s.y);
    ctx.rotate((s.rotation * Math.PI) / 180);
    ctx.scale(s.scale, s.scale);
    drawLayer(ctx, layer, time);
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** Editor-only furniture: rim, name strip, selection box. */
export function drawOverlay(ctx, project, { guides, selection, time, showSelection = true }) {
  const sel = project.layers.find((l) => l.id === selection);

  if (guides) {
    ctx.save();
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(120, 92, 255, .55)";
    ctx.beginPath();
    ctx.arc(CANVAS.cx, CANVAS.cy, CANVAS.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255, 120, 150, .07)";
    ctx.fillRect(0, CANVAS.strip, CANVAS.size, CANVAS.size - CANVAS.strip);
    ctx.strokeStyle = "rgba(255, 120, 150, .35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, CANVAS.strip);
    ctx.lineTo(CANVAS.size, CANVAS.strip);
    ctx.stroke();

    ctx.fillStyle = "rgba(23, 20, 47, .38)";
    ctx.font = '600 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillText("name strip", 10, CANVAS.strip + 15);
    ctx.restore();
  }

  if (showSelection && sel && !sel.locked) {
    const s = sampleLayer(sel, time);
    const pts = layerCorners(sel, s);
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#ff5f45";
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#ff5f45";
      ctx.stroke();
    }
    ctx.restore();
  }

  void state;
}

/** Safe-zone check on real pixels, mirroring the export constraints.
 *  Layers marked `overlay` (Discord-style art meant to sit on the avatar) are
 *  left out of the rim test — they are supposed to cover part of it. */
export function checkZones(project, time) {
  const size = CANVAS.size;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const tested = project.layers.some((layer) => layer.overlay)
    ? { ...project, layers: project.layers.filter((layer) => !layer.overlay) }
    : project;
  drawFrame(ctx, tested, time, { size });
  const hasOverlay = tested !== project;
  const { data } = ctx.getImageData(0, 0, size, size);

  let insideRim = 0;
  let darkStrip = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = data[i + 3];
      if (a <= 8) continue;
      const dx = x + 0.5 - CANVAS.cx;
      const dy = y + 0.5 - CANVAS.cy;
      if (dx * dx + dy * dy <= CANVAS.r * CANVAS.r) insideRim++;
      if (y >= CANVAS.strip) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (luma < 190) darkStrip++;
      }
    }
  }
  return { insideRim, darkStrip, hasOverlay };
}
