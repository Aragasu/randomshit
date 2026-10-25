// Timeline: ruler, keyframe tracks, playhead, and the easing popover.

import {
  state, on, emit, commit, selectLayer, selectKeyframe, addKeyframe, removeKeyframe, keyframeAt,
} from "./state.js";
import { PRESETS, easingLabel, bezierPoints } from "./easing.js";
import { el, clamp, toast } from "./util.js";

let wrap, ruler, tracks, playhead;
let pop = null;

export function initTimeline(stageApi) {
  wrap = document.getElementById("timeline");
  ruler = document.getElementById("ruler");
  tracks = document.getElementById("tracks");

  playhead = el("div", { class: "playhead" }, [el("div", { class: "playhead-head" })]);
  document.querySelector(".track-area").append(playhead);

  tracks.addEventListener("scroll", () => {
    document.getElementById("track-labels").scrollTop = tracks.scrollTop;
  });

  wireTransport(stageApi);
  wireScrub();

  on("project", () => { renderRuler(); renderTracks(); syncPlayhead(); syncTransport(); });
  on("selection", syncTrackSelection);
  on("time", () => { syncPlayhead(); });
  on("play", syncTransport);

  renderRuler();
  renderTracks();
  syncPlayhead();
  syncTransport();
  window.addEventListener("resize", () => { renderRuler(); renderTracks(); syncPlayhead(); });
}

function timeScale() {
  const width = tracks.clientWidth || 600;
  return state.project.duration > 0 ? width / state.project.duration : 0;
}

const xFor = (t) => t * timeScale();
const tFor = (x) => clamp(x / (timeScale() || 1), 0, state.project.duration);

function wireTransport(api) {
  document.getElementById("play").addEventListener("click", () => api.togglePlay());

  const duration = document.getElementById("duration");
  duration.value = state.project.duration;
  duration.addEventListener("change", () => {
    const v = clamp(Number(duration.value) || 2000, 200, 10000);
    commit("duration");
    state.project.duration = v;
    if (state.time > v) state.time = v;
    emit("project");
    emit("time", state.time);
  });

  const fps = document.getElementById("fps");
  fps.value = state.project.fps;
  fps.addEventListener("change", () => {
    state.project.fps = clamp(Number(fps.value) || 24, 6, 60);
    fps.value = state.project.fps;
    emit("project");
  });

  const loop = document.getElementById("loop");
  loop.checked = state.project.loop;
  loop.addEventListener("change", () => {
    state.project.loop = loop.checked;
  });

  document.getElementById("add-keyframe-all").addEventListener("click", () => {
    commit("key all");
    for (const layer of state.project.layers) addKeyframe(layer.id);
    renderTracks();
    toast("Keyframed every layer");
  });
}

function wireScrub() {
  let scrubbing = false;
  const scrubTo = (ev) => {
    const rect = tracks.getBoundingClientRect();
    state.time = tFor(ev.clientX - rect.left);
    emit("time", state.time);
    syncPlayhead();
  };
  for (const node of [ruler, tracks]) {
    node.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest(".kf") || ev.target.closest(".track-label")) return;
      scrubbing = true;
      try { node.setPointerCapture(ev.pointerId); } catch { /* not an active pointer */ }
      scrubTo(ev);
    });
    node.addEventListener("pointermove", (ev) => { if (scrubbing) scrubTo(ev); });
    node.addEventListener("pointerup", (ev) => {
      scrubbing = false;
      try { node.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    });
  }
}

function renderRuler() {
  ruler.innerHTML = "";
  const duration = state.project.duration;
  const width = ruler.clientWidth || 600;
  const stepCandidates = [100, 200, 500, 1000, 2000];
  const step = stepCandidates.find((s) => (width / duration) * s >= 62) || 2000;
  for (let t = 0; t <= duration; t += step) {
    const x = (t / duration) * width;
    ruler.append(el("div", { class: "tick major", style: `left:${x}px` }));
    const label = t % 1000 === 0 ? `${t / 1000}s` : `${(t / 1000).toFixed(1)}s`;
    ruler.append(el("div", { class: "tick-label", style: `left:${x}px`, text: label }));
    const half = step / 2;
    if (t + half <= duration) {
      ruler.append(el("div", { class: "tick", style: `left:${(t + half) / duration * width}px` }));
    }
  }
}

function renderTracks() {
  tracks.innerHTML = "";
  const labels = document.getElementById("track-labels");
  labels.innerHTML = "";
  const layers = [...state.project.layers].reverse();
  if (layers.length === 0) {
    tracks.append(el("p", { class: "empty", style: "padding:12px", text: "Add a shape to start a track." }));
    return;
  }

  layers.forEach((layer, index) => {
    const row = el("div", {
      class: `track${layer.id === state.selection ? " is-sel" : ""}`,
      "data-id": layer.id,
    });

    labels.append(el("button", {
      class: `track-label${layer.id === state.selection ? " is-sel" : ""}`,
      type: "button",
      "data-id": layer.id,
      title: layer.name,
      html: `<span class="num">${String(layers.length - index).padStart(2, "0")}</span><span>${escapeHtml(layer.name)}</span>`,
      onclick: () => selectLayer(layer.id),
    }));

    if (layer.keyframes.length > 1) {
      const first = layer.keyframes[0].t;
      const last = layer.keyframes.at(-1).t;
      row.append(el("div", {
        class: "kf-seg",
        style: `left:${xFor(first)}px;width:${Math.max(2, xFor(last) - xFor(first))}px`,
      }));
    }

    for (const kf of layer.keyframes) {
      const isSel = state.kf === kf.id;
      const node = el("div", {
        class: `kf${isSel ? " is-sel" : ""}`,
        "data-kfid": kf.id,
        tabindex: "0",
        "aria-label": `Keyframe at ${(kf.t / 1000).toFixed(2)} seconds`,
        title: `${(kf.t / 1000).toFixed(2)}s · ${easingLabel(kf.easing)}`,
        style: `left:${clamp(xFor(kf.t), 8, Math.max(8, tracks.clientWidth - 8))}px`,
        onpointerdown: (ev) => beginKfDrag(ev, layer, kf, node),
        ondblclick: (ev) => openEasing(ev, layer, kf),
        onkeydown: (ev) => {
          if (ev.key === "Delete" || ev.key === "Backspace") {
            ev.preventDefault();
            commit("delete keyframe");
            removeKeyframe(layer.id, kf.id);
          }
          if (ev.key === "Enter") openEasing(ev, layer, kf);
        },
      });
      row.append(node);
    }

    tracks.append(row);
  });
}

function beginKfDrag(ev, layer, kf, node) {
  ev.stopPropagation();
  if (ev.detail > 1) return; // let the double click open easing
  selectKeyframe(layer.id, kf.id);
  state.time = kf.t;
  emit("time", state.time);
  const startX = ev.clientX;
  const startT = kf.t;
  let moved = false;

  const move = (e) => {
    const dx = e.clientX - startX;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) { moved = true; commit("move keyframe"); }
    kf.t = Math.round(clamp(startT + dx / (timeScale() || 1), 0, state.project.duration));
    node.style.left = `${clamp(xFor(kf.t), 8, tracks.clientWidth - 8)}px`;
    emit("time", state.time);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (moved) {
      layer.keyframes.sort((a, b) => a.t - b.t);
      emit("project");
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Cheap selection sync so the nodes under the pointer survive. */
function syncTrackSelection() {
  for (const row of tracks.querySelectorAll(".track")) {
    row.classList.toggle("is-sel", row.dataset.id === state.selection);
  }
  for (const label of document.querySelectorAll(".track-label")) {
    label.classList.toggle("is-sel", label.dataset.id === state.selection);
  }
  for (const kf of tracks.querySelectorAll(".kf")) {
    kf.classList.toggle("is-sel", kf.dataset.kfid === state.kf);
  }
}

function syncPlayhead() {
  if (!playhead) return;
  const x = xFor(state.time);
  playhead.style.left = `${x}px`;
  document.getElementById("time-label").textContent = `${(state.time / 1000).toFixed(2)}s`;
}

function syncTransport() {
  // The duration can change from the inspector ("fit timeline"), not just here.
  const duration = document.getElementById("duration");
  if (duration && document.activeElement !== duration) duration.value = state.project.duration;
  const fps = document.getElementById("fps");
  if (fps && document.activeElement !== fps) fps.value = state.project.fps;

  const btn = document.getElementById("play");
  const icon = document.getElementById("play-icon");
  btn.setAttribute("aria-label", state.playing ? "Pause" : "Play");
  icon.innerHTML = state.playing
    ? '<rect x="5" y="4" width="4" height="12" fill="currentColor"/><rect x="11" y="4" width="4" height="12" fill="currentColor"/>'
    : '<path d="M6 4.2v11.6L16 10z" fill="currentColor"/>';
}

// ---------- easing popover ----------

function openEasing(ev, layer, kf) {
  closeEasing();
  selectKeyframe(layer.id, kf.id);
  const rect = ev.currentTarget.getBoundingClientRect();
  pop = el("div", { class: "ease-pop" });
  pop.style.left = `${clamp(rect.left - 100, 160, window.innerWidth - 260)}px`;
  pop.style.top = `${clamp(rect.top - 260, 60, window.innerHeight - 300)}px`;

  const head = el("div", { class: "ease-head" }, [
    el("strong", { text: `${(kf.t / 1000).toFixed(2)}s → next` }),
    el("button", { class: "btn ghost tiny", type: "button", text: "✕", onclick: closeEasing }),
  ]);
  const pad = document.createElement("canvas");
  pad.width = 198;
  pad.height = 168;
  pad.style.width = "198px";
  pad.style.height = "168px";
  const label = el("div", { class: "bez mono", text: bezText(kf.easing) });
  const presets = el("div", { class: "presets" });

  for (const preset of PRESETS) {
    presets.append(el("button", {
      class: "pill", type: "button", text: preset.name,
      onclick: () => {
        commit("easing");
        kf.easing = { type: "bezier", p: [...preset.p] };
        label.textContent = bezText(kf.easing);
        drawPad(pad, kf.easing);
        renderTracks();
      },
    }));
  }
  presets.append(el("button", {
    class: "pill", type: "button", text: "Hold",
    title: "Snap to this value, then jump",
    onclick: () => {
      commit("easing");
      kf.easing = { type: "hold" };
      label.textContent = "hold";
      drawPad(pad, kf.easing);
      renderTracks();
    },
  }));

  pop.append(head, pad, label, presets);
  document.body.append(pop);
  drawPad(pad, kf.easing);
  wirePad(pad, kf, label, () => renderTracks());
  setTimeout(() => document.addEventListener("pointerdown", outsideClose, true), 0);
}

function outsideClose(ev) {
  if (pop && !pop.contains(ev.target)) closeEasing();
}

function closeEasing() {
  if (pop) {
    pop.remove();
    pop = null;
    document.removeEventListener("pointerdown", outsideClose, true);
  }
}

const bezText = (easing) => (easing?.type === "hold" ? "hold" : `cubic-bezier(${bezierPoints(easing).map((v) => v.toFixed(2)).join(", ")})`);

const PAD = 22;
const Y_MIN = -0.55;
const Y_MAX = 1.55;

const PAD_W = 198;
const PAD_H = 168;

function padPoint(x, y) {
  const w = PAD_W - PAD * 2;
  const h = PAD_H - PAD * 2;
  return {
    x: PAD + x * w,
    y: PAD + h - ((y - Y_MIN) / (Y_MAX - Y_MIN)) * h,
  };
}

function drawPad(pad, easing) {
  const dpr = window.devicePixelRatio || 1;
  if (pad.width !== Math.round(PAD_W * dpr)) {
    pad.width = Math.round(PAD_W * dpr);
    pad.height = Math.round(PAD_H * dpr);
    pad.style.width = `${PAD_W}px`;
    pad.style.height = `${PAD_H}px`;
  }
  const ctx = pad.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, PAD_W, PAD_H);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PAD_W, PAD_H);

  ctx.strokeStyle = "#e2ded1";
  ctx.lineWidth = 1;
  for (const y of [0, 0.5, 1]) {
    const a = padPoint(0, y);
    const b = padPoint(1, y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const p = bezierPoints(easing);
  const P = (x, y) => padPoint(x, y);
  const p0 = P(0, 0), p1 = P(p[0], p[1]), p2 = P(p[2], p[3]), p3 = P(1, 1);

  ctx.strokeStyle = "#ff5f45";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  ctx.stroke();

  ctx.strokeStyle = "#8d88b3";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();

  for (const [i, pt] of [p1, p2].entries()) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? "#ffc63d" : "#26d3a3";
    ctx.fill();
    ctx.strokeStyle = "#17142f";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function wirePad(pad, kf, label, onChange) {
  let active = -1;
  const pointFor = (ev) => {
    const rect = pad.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * PAD_W;
    const py = ((ev.clientY - rect.top) / rect.height) * PAD_H;
    const w = PAD_W - PAD * 2;
    const h = PAD_H - PAD * 2;
    return {
      x: clamp((px - PAD) / w, 0, 1),
      y: Y_MAX - ((py - PAD) / h) * (Y_MAX - Y_MIN),
    };
  };

  pad.addEventListener("pointerdown", (ev) => {
    const p = bezierPoints(kf.easing);
    const pt = pointFor(ev);
    const d1 = Math.hypot(pt.x - p[0], pt.y - p[1]);
    const d2 = Math.hypot(pt.x - p[2], pt.y - p[3]);
    active = d1 < d2 ? 0 : 1;
    commit("easing");
    kf.easing = { type: "bezier", p: [...p] };
    pad.setPointerCapture(ev.pointerId);
    apply(ev);
  });

  const apply = (ev) => {
    if (active < 0) return;
    const pt = pointFor(ev);
    const p = [...bezierPoints(kf.easing)];
    p[active * 2] = pt.x;
    p[active * 2 + 1] = pt.y;
    kf.easing = { type: "bezier", p };
    drawPad(pad, kf.easing);
    label.textContent = bezText(kf.easing);
    onChange();
  };

  pad.addEventListener("pointermove", (ev) => apply(ev));
  pad.addEventListener("pointerup", () => { active = -1; });
  pad.addEventListener("pointercancel", () => { active = -1; });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

void keyframeAt;
