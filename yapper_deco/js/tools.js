// Pen and brush: build a vector path layer from pointer input.

import { state, emit, commit, makeLayer, selectLayer } from "./state.js";

let draft = null;        // { nodes, closed } in project space
let cursor = null;       // live pointer for the rubber band
let activeNode = null;   // pen node whose handle is being dragged
let brush = null;        // collected brush points

export function setTool(tool) {
  cancelDraft();
  state.tool = tool;
  emit("tool");
}

export function cancelDraft() {
  draft = null;
  brush = null;
  activeNode = null;
  cursor = null;
  emit("draw");
}

// ---------- pointer entry points ----------

export function pointerDown(pt) {
  if (state.tool === "brush") {
    brush = [pt];
    cursor = pt;
    return;
  }
  if (state.tool !== "pen") return;

  // clicking the first node closes the shape
  if (draft && draft.nodes.length > 2 && distance(pt, draft.nodes[0]) < 12) {
    finish(true);
    return;
  }
  if (!draft) draft = { nodes: [], closed: false };
  const node = { x: pt.x, y: pt.y, out: { x: 0, y: 0 } };
  draft.nodes.push(node);
  activeNode = node;
  cursor = pt;
  emit("draw");
}

export function pointerMove(pt, isDown) {
  cursor = pt;
  if (state.tool === "brush" && brush) {
    const last = brush[brush.length - 1];
    if (distance(pt, last) > 2) brush.push(pt);
    emit("draw");
    return;
  }
  if (state.tool === "pen" && isDown && activeNode) {
    activeNode.out = { x: pt.x - activeNode.x, y: pt.y - activeNode.y };
    emit("draw");
    return;
  }
  if (state.tool === "pen" && draft) emit("draw");
}

export function pointerUp() {
  if (state.tool === "brush") {
    const points = brush;
    brush = null;
    if (points && points.length > 1) {
      commitPath(fittedNodes(points), false);
    }
    emissive();
    return;
  }
  activeNode = null;
  emissive();
}

function emissive() {
  emit("draw");
}

export function finish(closed = false) {
  if (!draft || draft.nodes.length < 2) {
    cancelDraft();
    return;
  }
  const nodes = closed ? draft.nodes.map(cleanNode) : draft.nodes.map(cleanNode);
  const wasClosed = closed || draft.closed;
  draft = null;
  cursor = null;
  commitPath(nodes, wasClosed);
}

// ---------- geometry ----------

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function cleanNode(node) {
  return { x: node.x, y: node.y, out: { x: node.out.x, y: node.out.y } };
}

/** Ramer-Douglas-Peucker, so a scribble becomes a few meaningful points. */
function simplify(points, epsilon = 1.6) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let best = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpendicular(points[i], points[first], points[last]);
      if (d > best) { best = d; index = i; }
    }
    if (best > epsilon && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function perpendicular(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return distance(p, a);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Catmull-Rom handles so a simplified stroke still reads as a smooth curve. */
function fittedNodes(points, tension = 1 / 6) {
  const pts = simplify(points);
  const nodes = pts.map((p, i) => {
    const prev = pts[i - 1] || p;
    const next = pts[i + 1] || p;
    return {
      x: p.x,
      y: p.y,
      out: { x: (next.x - prev.x) * tension, y: (next.y - prev.y) * tension },
    };
  });
  return nodes;
}

/** Recentre nodes on their bounding box so the layer transform stays meaningful. */
function normalize(nodes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    for (const px of [node.x, node.x + node.out.x]) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    }
    for (const py of [node.y, node.y + node.out.y]) {
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const local = nodes.map((n) => ({
    x: n.x - cx,
    y: n.y - cy,
    out: { x: n.out.x, y: n.out.y },
  }));
  return {
    local,
    x: cx,
    y: cy,
    w: Math.max(8, maxX - minX),
    h: Math.max(8, maxY - minY),
  };
}

function commitPath(nodes, closed) {
  if (!nodes || nodes.length < 2) return;
  const { local, x, y, w, h } = normalize(nodes);
  commit("draw path");
  const layer = makeLayer("path", {
    nodes: local,
    closed,
    x,
    y,
    w,
    h,
    fill: closed ? state.brush.fill : "none",
    stroke: state.brush.colour,
    strokeWidth: state.brush.size,
    name: closed ? "Shape" : "Stroke",
  });
  state.project.layers.push(layer);
  selectLayer(layer.id);
  emit("project");
}

// ---------- draft rendering ----------

export function drawDraft(ctx) {
  const nodes = brush
    ? fittedNodes(brush)
    : draft?.nodes;

  if (nodes && nodes.length > 1) {
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = state.brush.size;
    ctx.strokeStyle = state.brush.colour;
    ctx.beginPath();
    ctx.moveTo(nodes[0].x, nodes[0].y);
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = nodes[i], b = nodes[i + 1];
      ctx.bezierCurveTo(
        a.x + a.out.x, a.y + a.out.y,
        b.x - b.out.x, b.y - b.out.y,
        b.x, b.y,
      );
    }
    if (draft?.closed && draft.nodes.length > 2) ctx.closePath();
    ctx.stroke();

    // rubber band from the last node to the pointer
    if (state.tool === "pen" && cursor && !brush) {
      const last = nodes[nodes.length - 1];
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(255,95,69,.85)";
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(cursor.x, cursor.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  if (state.tool === "pen" && draft) {
    ctx.save();
    for (const node of draft.nodes) {
      const isFirst = node === draft.nodes[0];
      ctx.beginPath();
      ctx.arc(node.x, node.y, isFirst ? 5.5 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = isFirst ? "#ff5f45" : "#fff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#17142f";
      ctx.stroke();
      if (Math.hypot(node.out.x, node.out.y) > 1) {
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(node.x + node.out.x, node.y + node.out.y);
        ctx.strokeStyle = "rgba(23,20,47,.45)";
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

export function hasDraft() {
  return Boolean(brush || draft);
}
