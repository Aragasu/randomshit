// Every shape draws centred on the origin in the layer's local space.

import { frameAt } from "./apng.js";

const TAU = Math.PI * 2;

function paint(ctx, layer, path) {
  path();
  if (layer.fill && layer.fill !== "none") {
    ctx.fillStyle = layer.fill;
    ctx.fill();
  }
  if (layer.strokeWidth > 0 && layer.stroke && layer.stroke !== "none") {
    ctx.lineWidth = layer.strokeWidth;
    ctx.strokeStyle = layer.stroke;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

function balloonPath(ctx, w, h, tail, tailX) {
  const r = Math.min(w, h) * 0.3;
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
  const base = x0 + w * 0.4;
  const tw = w * 0.3;
  const tipX = base + (tailX ?? -tw * 0.2);
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.lineTo(x1 - r, y0);
  ctx.quadraticCurveTo(x1, y0, x1, y0 + r);
  ctx.lineTo(x1, y1 - r);
  ctx.quadraticCurveTo(x1, y1, x1 - r, y1);
  ctx.lineTo(base + tw / 2, y1);
  ctx.lineTo(tipX, y1 + tail);
  ctx.lineTo(base - tw / 2, y1);
  ctx.lineTo(x0 + r, y1);
  ctx.quadraticCurveTo(x0, y1, x0, y1 - r);
  ctx.lineTo(x0, y0 + r);
  ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
  ctx.closePath();
}

function starPath(ctx, w, h, points, inner = 0.3) {
  const rx = w / 2, ry = h / 2;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i / (points * 2)) * TAU - Math.PI / 2;
    const scale = i % 2 === 0 ? 1 : inner;
    const px = Math.cos(angle) * rx * scale;
    const py = Math.sin(angle) * ry * scale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function sparklePath(ctx, w, h) {
  const rx = w / 2, ry = h / 2;
  const inner = 0.24;
  ctx.beginPath();
  const corner = Math.min(w, h) * 0.16;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU - Math.PI / 2;
    const b = a + TAU / 8;
    const tipX = Math.cos(a) * rx, tipY = Math.sin(a) * ry;
    const midX = Math.cos(b) * rx * inner, midY = Math.sin(b) * ry * inner;
    if (i === 0) ctx.moveTo(tipX, tipY);
    else ctx.lineTo(tipX, tipY);
    ctx.quadraticCurveTo(midX + (tipX - midX) * 0.1, midY + (tipY - midY) * 0.1, midX, midY);
    void corner;
  }
  ctx.closePath();
}

function burstPath(ctx, w, h, rays) {
  const rx = w / 2, ry = h / 2;
  ctx.beginPath();
  for (let i = 0; i < rays * 2; i++) {
    const angle = (i / (rays * 2)) * TAU - Math.PI / 2;
    const scale = i % 2 === 0 ? 1 : 0.78;
    const px = Math.cos(angle) * rx * scale;
    const py = Math.sin(angle) * ry * scale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export const SHAPES = {
  balloon: {
    label: "Speech balloon",
    bounds: (l) => ({ hw: l.w / 2, hh: l.h / 2 + l.tail * 0.6 }),
    draw(ctx, l) {
      paint(ctx, l, () => balloonPath(ctx, l.w, l.h, l.tail ?? 18));
      const dots = l.dots ?? 0;
      if (dots > 0) {
        const dr = Math.max(3.6, Math.min(6.2, Math.min(l.w, l.h) * 0.1));
        const gap = dr * 2.7;
        const total = gap * (dots - 1);
        ctx.fillStyle = l.stroke && l.stroke !== "none" ? l.stroke : "#17142f";
        for (let i = 0; i < dots; i++) {
          const cx = -total / 2 + i * gap;
          ctx.beginPath();
          ctx.arc(cx, 0, dr, 0, TAU);
          ctx.fill();
        }
      }
    },
  },

  pill: {
    label: "Pill",
    bounds: (l) => ({ hw: l.w / 2, hh: l.h / 2 }),
    draw(ctx, l) {
      paint(ctx, l, () => {
        ctx.beginPath();
        ctx.roundRect(-l.w / 2, -l.h / 2, l.w, l.h, Math.min(l.radius ?? 20, Math.min(l.w, l.h) / 2));
      });
    },
  },

  circle: {
    label: "Dot",
    bounds: (l) => ({ hw: l.w / 2, hh: l.h / 2 }),
    draw(ctx, l) {
      paint(ctx, l, () => {
        ctx.beginPath();
        ctx.ellipse(0, 0, l.w / 2, l.h / 2, 0, 0, TAU);
      });
    },
  },

  sparkle: {
    label: "Sparkle",
    bounds: (l) => ({ hw: l.w / 2, hh: l.h / 2 }),
    draw(ctx, l) {
      paint(ctx, l, () => sparklePath(ctx, l.w, l.h));
    },
  },

  burst: {
    label: "Burst",
    bounds: (l) => ({ hw: l.w / 2, hh: l.h / 2 }),
    draw(ctx, l) {
      paint(ctx, l, () => burstPath(ctx, l.w, l.h, l.rays ?? 12));
    },
  },

  ring: {
    label: "Ring",
    bounds: (l) => ({ hw: l.w / 2, hh: l.h / 2 }),
    draw(ctx, l) {
      paint(ctx, { ...l, fill: "none" }, () => {
        ctx.beginPath();
        ctx.ellipse(0, 0, l.w / 2 - l.strokeWidth / 2, l.h / 2 - l.strokeWidth / 2, 0, 0, TAU);
      });
    },
  },

  text: {
    label: "Text",
    bounds: (l) => ({ hw: l.w / 2, hh: l.fontSize * 0.7 }),
    draw(ctx, l) {
      ctx.font = `${l.fontWeight ?? 800} ${l.fontSize ?? 52}px "Bricolage Grotesque", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (l.strokeWidth > 0) {
        ctx.lineWidth = l.strokeWidth;
        ctx.strokeStyle = l.stroke;
        ctx.lineJoin = "round";
        ctx.strokeText(l.text || "", 0, 0);
      }
      ctx.fillStyle = l.fill;
      ctx.fillText(l.text || "", 0, 0);
    },
  },

  path: {
    label: "Drawn path",
    bounds: (l) => ({
      hw: Math.max(4, (l.w || 8) / 2),
      hh: Math.max(4, (l.h || 8) / 2),
    }),
    draw(ctx, l) {
      const nodes = l.nodes;
      if (!nodes || nodes.length < 2) return;
      paint(ctx, l, () => {
        ctx.beginPath();
        ctx.moveTo(nodes[0].x, nodes[0].y);
        const segment = (a, b) => {
          ctx.bezierCurveTo(
            a.x + (a.out?.x || 0), a.y + (a.out?.y || 0),
            b.x - (b.out?.x || 0), b.y - (b.out?.y || 0),
            b.x, b.y,
          );
        };
        for (let i = 0; i < nodes.length - 1; i++) segment(nodes[i], nodes[i + 1]);
        if (l.closed) {
          segment(nodes[nodes.length - 1], nodes[0]);
          ctx.closePath();
        }
      });
    },
  },

  image: {
    label: "Art",
    bounds: (l) => ({ hw: l.w / 2, hh: l.h / 2 }),
    draw(ctx, l, time = 0) {
      // Animated art (Discord decorations are APNGs) picks its frame from the
      // playhead, so the stage and the APNG export show the same motion.
      const frame = l._anim ? frameAt(l._anim, time) : null;
      const img = frame || l._img;
      if (!img || (!frame && (!img.complete || !img.naturalWidth))) {
        ctx.strokeStyle = "rgba(23,20,47,.25)";
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.strokeRect(-l.w / 2, -l.h / 2, l.w, l.h);
        ctx.setLineDash([]);
        return;
      }
      const ratio = (img.naturalWidth || img.width) / (img.naturalHeight || img.height);
      let w = l.w, h = l.h;
      if (ratio > 1) h = w / ratio; else w = h * ratio;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    },
  },
};

export function drawLayer(ctx, layer, time = 0) {
  const shape = SHAPES[layer.type] || SHAPES.pill;
  shape.draw(ctx, layer, time);
}

export function layerBounds(layer) {
  const shape = SHAPES[layer.type] || SHAPES.pill;
  return shape.bounds(layer);
}

/** Local (unrotated) rect -> canvas space corners. */
export function layerCorners(layer, sampled) {
  const { hw, hh } = layerBounds(layer);
  const x = sampled?.x ?? layer.x;
  const y = sampled?.y ?? layer.y;
  const s = sampled?.scale ?? layer.scale;
  const rot = ((sampled?.rotation ?? layer.rotation) * Math.PI) / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => {
    const sx = px * s, sy = py * s;
    return { x: x + sx * cos - sy * sin, y: y + sx * sin + sy * cos };
  });
}

export function hitTest(layer, sampled, px, py) {
  const { hw, hh } = layerBounds(layer);
  const x = sampled?.x ?? layer.x;
  const y = sampled?.y ?? layer.y;
  const s = sampled?.scale ?? layer.scale;
  const rot = -(((sampled?.rotation ?? layer.rotation) * Math.PI) / 180);
  const dx = px - x, dy = py - y;
  const lx = (dx * Math.cos(rot) - dy * Math.sin(rot)) / s;
  const ly = (dx * Math.sin(rot) + dy * Math.cos(rot)) / s;
  return Math.abs(lx) <= hw + 4 && Math.abs(ly) <= hh + 4;
}
