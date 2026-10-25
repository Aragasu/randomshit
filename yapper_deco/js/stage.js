// The stage: canvas sizing, zoom, pointer editing, playback, and safe-zone readout.

import { CANVAS, state, on, emit, commit, selectLayer, selectedLayer, writeTransform } from "./state.js";
import { drawFrame, drawOverlay, checkZones, prepareImages, setImageReadyHandler } from "./render.js";
import { sampleLayer } from "./anim.js";
import { hitTest } from "./shapes.js";
import * as tools from "./tools.js";
import { clamp, debounce } from "./util.js";

const BACKING = 1024;

export function initStage() {
  const stage = document.getElementById("stage");
  const holder = document.getElementById("canvas-holder");
  const canvas = document.getElementById("stage-canvas");
  const ctx = canvas.getContext("2d");
  const zoneEl = document.getElementById("zone-status");
  const zoneText = document.getElementById("zone-text");
  const zoomLabel = document.getElementById("zoom-label");
  const timeLabel = document.getElementById("time-label");

  canvas.width = BACKING;
  canvas.height = BACKING;

  let cssSize = 512;
  let drag = null;
  let drawing = false;
  let rafId = 0;
  let lastTs = 0;

  const api = {
    draw,
    resize,
    togglePlay,
    setZoom(value) {
      state.zoom = value;
      resize();
      applyZoomButtons();
    },
  };

  // ---------- layout ----------

  function computeZoom() {
    if (typeof state.zoom === "number") return state.zoom;
    const pad = 56;
    const w = stage.clientWidth - pad;
    const h = stage.clientHeight - pad;
    return clamp(Math.min(w, h) / 512, 0.32, 1.6);
  }

  function resize() {
    const zoom = computeZoom();
    cssSize = Math.round(512 * zoom);
    holder.style.width = `${cssSize}px`;
    holder.style.height = `${cssSize}px`;
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    draw();
  }

  function applyZoomButtons() {
    for (const btn of document.querySelectorAll("[data-zoom]")) {
      const v = btn.dataset.zoom;
      const on = (v === "fit" && state.zoom === "fit") || (state.zoom === Number(v));
      btn.classList.toggle("is-on", on);
    }
  }

  // ---------- drawing ----------

  function draw() {
    drawFrame(ctx, state.project, state.time, {
      size: BACKING,
      avatar: state.avatar,
      withAvatar: true,
    });
    ctx.setTransform(BACKING / CANVAS.size, 0, 0, BACKING / CANVAS.size, 0, 0);
    drawOverlay(ctx, state.project, {
      guides: state.guides,
      selection: state.selection,
      time: state.time,
      showSelection: state.tool === "select" || tools.hasDraft(),
    });
    if (state.tool !== "select") tools.drawDraft(ctx);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    timeLabel.textContent = `${(state.time / 1000).toFixed(2)}s`;
  }

  const refreshZones = debounce(() => {
    const { insideRim, darkStrip, hasOverlay } = checkZones(state.project, state.time);
    if (insideRim > 0) {
      zoneEl.dataset.state = "bad";
      zoneText.textContent = `${insideRim.toLocaleString()} px inside the rim — the avatar shows through here`;
    } else if (darkStrip > 0) {
      zoneEl.dataset.state = "warn";
      zoneText.textContent = `Something dark sits in the name strip`;
    } else {
      zoneEl.dataset.state = "safe";
      zoneText.textContent = hasOverlay
        ? "Inside the rim is clear · overlay art not counted"
        : "Inside the rim is clear";
    }
    emit("zones", { insideRim, darkStrip });
  }, 90);

  // ---------- playback ----------

  function togglePlay() {
    state.playing = !state.playing;
    emit("play");
    if (state.playing) {
      lastTs = performance.now();
      if (state.time >= state.project.duration - 1) state.time = 0;
      rafId = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafId);
    }
  }

  function tick(ts) {
    if (!state.playing) return;
    const dt = ts - lastTs;
    lastTs = ts;
    state.time += dt;
    if (state.time > state.project.duration) {
      if (state.project.loop) state.time %= state.project.duration;
      else {
        state.time = state.project.duration;
        state.playing = false;
        emit("play");
      }
    }
    emit("time", state.time);
    draw();
    if (state.playing) rafId = requestAnimationFrame(tick);
  }

  function seek(ms) {
    state.time = clamp(ms, 0, state.project.duration);
    emit("time", state.time);
    draw();
    refreshZones();
  }

  // ---------- pointer editing ----------

  function toProject(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * CANVAS.size,
      y: ((ev.clientY - rect.top) / rect.height) * CANVAS.size,
    };
  }

  function topLayerAt(pt) {
    for (let i = state.project.layers.length - 1; i >= 0; i--) {
      const layer = state.project.layers[i];
      if (!layer.visible || layer.locked) continue;
      if (hitTest(layer, sampleLayer(layer, state.time), pt.x, pt.y)) return layer;
    }
    return null;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const pt = toProject(ev);
    if (state.tool !== "select") {
      drawing = true;
      tools.pointerDown(pt);
      try { canvas.setPointerCapture(ev.pointerId); } catch { /* synthetic events */ }
      draw();
      return;
    }
    const hit = topLayerAt(pt);
    if (!hit) {
      selectLayer(null);
      return;
    }
    if (hit.id !== state.selection) selectLayer(hit.id);
    const sampled = sampleLayer(hit, state.time);
    drag = {
      id: hit.id,
      start: pt,
      origin: { x: sampled.x, y: sampled.y },
      moved: false,
      axis: ev.shiftKey ? null : undefined,
    };
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* synthetic events */ }
    canvas.classList.add("is-dragging");
  });

  canvas.addEventListener("pointermove", (ev) => {
    if (state.tool !== "select") {
      tools.pointerMove(toProject(ev), drawing);
      return;
    }
    if (!drag) return;
    const pt = toProject(ev);
    let dx = pt.x - drag.start.x;
    let dy = pt.y - drag.start.y;
    if (!drag.moved && Math.hypot(dx, dy) < 2) return;
    if (!drag.moved) {
      drag.moved = true;
      commit("move");
    }
    if (ev.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0;
    }
    const layer = state.project.layers.find((l) => l.id === drag.id);
    if (!layer) return;
    writeTransform(layer, {
      x: Math.round((drag.origin.x + dx) * 10) / 10,
      y: Math.round((drag.origin.y + dy) * 10) / 10,
    });
    emit("transform");
    draw();
    refreshZones();
  });

  function endDrag(ev) {
    if (state.tool !== "select") {
      drawing = false;
      tools.pointerUp();
      try { canvas.releasePointerCapture?.(ev.pointerId); } catch { /* synthetic events */ }
      return;
    }
    if (!drag) return;
    canvas.classList.remove("is-dragging");
    try { canvas.releasePointerCapture?.(ev.pointerId); } catch { /* synthetic events */ }
    drag = null;
    emit("project");
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  canvas.addEventListener("dblclick", () => {
    if (state.tool === "pen") tools.finish(false);
  });

  // ---------- wiring ----------

  on("project", () => { draw(); refreshZones(); });
  on("selection", draw);
  on("time", draw);
  on("play", draw);
  on("draw", draw);
  on("tool", () => {
    canvas.style.cursor = state.tool === "select" ? "grab" : "crosshair";
    draw();
  });
  setImageReadyHandler(() => { draw(); refreshZones(); });

  for (const btn of document.querySelectorAll("[data-zoom]")) {
    btn.addEventListener("click", () => {
      const v = btn.dataset.zoom;
      api.setZoom(v === "fit" ? "fit" : Number(v));
    });
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);
  applyZoomButtons();
  prepareImages(state.project);
  resize();
  refreshZones();
  draw();

  return api;
}

export function refreshStageZones() {
  emit("project");
  void selectedLayer;
}
