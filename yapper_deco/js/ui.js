// Add rail, layer list, and inspector.

import {
  CANVAS, PALETTE, SHAPE_TYPES, state, on, emit, commit, makeLayer,
  selectLayer, selectedLayer, addKeyframe, keyframeAt, writeTransform, uid,
} from "./state.js";
import { SHAPES, drawLayer } from "./shapes.js";
import { sampleLayer } from "./anim.js";
import { el, round, seconds, toast } from "./util.js";
import { recolorIcon } from "./clipart.js";
import { animationInfo } from "./animations.js";
import { setTool } from "./tools.js";

let defaultFill = "#ff5f45";

export function initUI() {
  buildShapeGrid();
  buildPalette();
  wireDrawTools();
  on("project", () => { renderLayers(); syncInspector(); });
  on("selection", () => { renderLayers(); renderInspector(); });
  on("time", () => syncInspector());
  on("transform", () => syncInspector());
  on("tool", syncToolUI);
  document.addEventListener("deco:animation", () => { renderLayers(); renderInspector(); });
  renderLayers();
  renderInspector();
  wireAddRail();
  syncToolUI();
}

export function newShapeLayer(type) {
  const layer = makeLayer(type, { fill: defaultFill });
  const palette = ["#ff5f45", "#ffc63d", "#26d3a3", "#a898ff", "#5cc8ff", "#ff9ec4"];
  if (type === "text") layer.fill = "#17142f";
  else if (layer.fill === "#17142f") layer.fill = palette[Math.floor(Math.random() * palette.length)];
  commit("add shape");
  state.project.layers.push(layer);
  selectLayer(layer.id);
  emit("project");
  return layer;
}

// ---------- add rail ----------

function buildShapeGrid() {
  const grid = document.getElementById("shape-grid");
  for (const type of SHAPE_TYPES) {
    const thumb = document.createElement("canvas");
    thumb.width = 96;
    thumb.height = 96;
    const ctx = thumb.getContext("2d");
    const probe = makeLayer(type, { x: 0, y: 0, fill: type === "text" ? "#17142f" : "#ff5f45" });
    const scale = Math.min(64 / (probe.w || 64), 64 / ((probe.h || 64) * 1.15));
    ctx.save();
    ctx.translate(48, 46);
    ctx.scale(scale, scale);
    drawLayer(ctx, probe);
    ctx.restore();

    const btn = el("button", {
      class: "shape-btn",
      type: "button",
      title: SHAPES[type].label,
      "aria-label": SHAPES[type].label,
      onclick: () => newShapeLayer(type),
    }, [thumb]);
    grid.append(btn);
  }
}

function buildPalette() {
  const row = document.getElementById("swatch-row");
  for (const { name, value } of PALETTE) {
    row.append(el("button", {
      class: "swatch",
      type: "button",
      title: name,
      "aria-label": name,
      style: `background:${value}`,
      onclick: () => applyColour(value),
    }));
  }
}

function applyColour(value) {
  defaultFill = value;
  state.brush.colour = value;
  state.brush.fill = value;
  const layer = selectedLayer();
  const toSelection = document.getElementById("apply-to-selection")?.checked;
  if (!layer || !toSelection) return;
  commit("colour");
  if (layer.type === "path") {
    layer.stroke = value;
    if (layer.closed) layer.fill = value;
  } else {
    layer.fill = value;
  }
  emit("project");
}

const TOOL_HINTS = {
  select: "Click to drop onto the canvas. Drag on the stage to move.",
  pen: "Click to place points, drag while placing to curve the corner. Click the first point to close, Enter or double-click to finish.",
  brush: "Draw freehand on the stage. Each stroke lands as a path layer you can restyle.",
};

function wireDrawTools() {
  for (const btn of document.querySelectorAll("[data-tool]")) {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  }
  const size = document.getElementById("brush-size");
  size.value = state.brush.size;
  size.addEventListener("input", () => {
    state.brush.size = Number(size.value);
    document.getElementById("brush-size-label").textContent = size.value;
    const layer = selectedLayer();
    if (layer?.type === "path") {
      layer.strokeWidth = Number(size.value);
      emit("project");
    }
  });
}

function syncToolUI() {
  for (const btn of document.querySelectorAll("[data-tool]")) {
    btn.classList.toggle("is-on", btn.dataset.tool === state.tool);
  }
  const hint = document.getElementById("tool-hint");
  if (hint) hint.textContent = TOOL_HINTS[state.tool] || TOOL_HINTS.select;
}

function wireAddRail() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      for (const other of document.querySelectorAll(".tab")) {
        other.classList.toggle("is-on", other === tab);
        other.setAttribute("aria-selected", String(other === tab));
      }
      for (const panel of document.querySelectorAll(".tabpanel")) {
        panel.classList.toggle("is-on", panel.id === `panel-${tab.dataset.tab}`);
      }
    });
  }
}

// ---------- layers ----------

function renderLayers() {
  const list = document.getElementById("layer-list");
  list.innerHTML = "";
  const layers = [...state.project.layers].reverse();
  if (layers.length === 0) {
    list.append(el("li", { class: "empty", style: "padding:10px 8px", text: "Nothing here yet. Add a shape from the left." }));
    return;
  }
  for (const layer of layers) {
    const row = el("li", {
      class: `layer-row${layer.id === state.selection ? " is-sel" : ""}${layer.visible ? "" : " is-hidden"}${layer.locked ? " is-locked" : ""}`,
      "data-id": layer.id,
      tabindex: "0",
      onclick: (ev) => {
        if (ev.target.closest(".mini")) return;
        selectLayer(layer.id);
      },
      onkeydown: (ev) => { if (ev.key === "Enter") selectLayer(layer.id); },
    });

    row.append(el("button", {
      class: "mini vis", type: "button", title: layer.visible ? "Hide" : "Show",
      "aria-label": layer.visible ? "Hide layer" : "Show layer",
      html: layer.visible
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 6.2A10.9 10.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.8M6.4 7.6A17 17 0 0 0 2 12s3.6 6 10 6a10.6 10.6 0 0 0 4.2-.9"/></svg>',
      onclick: (ev) => {
        ev.stopPropagation();
        commit("visibility");
        layer.visible = !layer.visible;
        emit("project");
      },
    }));

    row.append(el("span", { class: "name", text: layer.name }));
    if (layer.keyframes.length) row.append(el("span", { class: "tag", text: `${layer.keyframes.length}k` }));
    const loop = layer.type === "image" ? animationInfo(layer.src)?.ms || layer.loopMs : 0;
    if (loop) row.append(el("span", { class: "tag", text: seconds(loop) }));

    row.append(el("button", {
      class: "mini", type: "button", title: "Move up", "aria-label": "Move layer up",
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 14 6-6 6 6"/></svg>',
      onclick: (ev) => { ev.stopPropagation(); reorder(layer, 1); },
    }));
    row.append(el("button", {
      class: "mini", type: "button", title: "Move down", "aria-label": "Move layer down",
      html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 10 6 6 6-6"/></svg>',
      onclick: (ev) => { ev.stopPropagation(); reorder(layer, -1); },
    }));

    list.append(row);
  }
}

function reorder(layer, delta) {
  const list = state.project.layers;
  const index = list.indexOf(layer);
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  commit("reorder");
  list.splice(index, 1);
  list.splice(next, 0, layer);
  emit("project");
}

// ---------- inspector ----------

function renderInspector() {
  const body = document.getElementById("inspector-body");
  body.innerHTML = "";
  const layer = selectedLayer();
  if (!layer) {
    body.append(el("p", { class: "empty", text: "Select a shape on the stage or in the layer list to edit it. Drag shapes to move them; shift-drag locks to one axis." }));
    return;
  }

  const sampled = sampleLayer(layer, state.time);
  const animated = layer.keyframes.length > 0;

  // name
  const nameField = el("label", { class: "field" }, [
    el("span", { text: "Name" }),
    el("input", { value: layer.name, "data-bind": "name" }),
  ]);

  const transform = el("div", { class: "fieldset" }, [
    el("h3", { text: animated ? "Transform · writes keyframes" : "Transform" }),
    el("div", { class: "grid2" }, [
      numberField("X", round(sampled.x, 1), { step: 1 }, (v) => patchLayer(layer, { x: v })),
      numberField("Y", round(sampled.y, 1), { step: 1 }, (v) => patchLayer(layer, { y: v })),
      numberField("Scale", round(sampled.scale, 2), { step: 0.05, min: 0.05, max: 6 }, (v) => patchLayer(layer, { scale: v })),
      numberField("Rotation", round(sampled.rotation, 1), { step: 1 }, (v) => patchLayer(layer, { rotation: v })),
    ]),
    numberField("Opacity", Math.round(sampled.opacity * 100), { step: 5, min: 0, max: 100, suffix: "%" }, (v) =>
      patchLayer(layer, { opacity: Math.min(1, Math.max(0, v / 100)) })),
  ]);

  const style = el("div", { class: "fieldset" }, [el("h3", { text: "Style" })]);
  style.append(shapeFields(layer));
  style.append(colorField("Fill", layer.fill, (v) => patchStyle(layer, { fill: v }), true));
  style.append(colorField("Outline", layer.stroke, (v) => patchStyle(layer, { stroke: v })));
  if (layer.type !== "image") {
    style.append(numberField("Outline width", layer.strokeWidth ?? 0, { step: 1, min: 0, max: 24 }, (v) => patchStyle(layer, { strokeWidth: v })));
  }
  if (layer.iconBody) {
    style.append(colorField("Icon colour", layer.iconColor || "#17142f", (v) => {
      commit("icon colour");
      recolorIcon(layer, v);
    }));
  }

  if (layer.license) {
    style.append(el("p", { class: "license", text: `${layer.license.collection} · ${layer.license.license} · ${layer.license.author}` }));
  }
  if (layer.type === "image") {
    const info = animationInfo(layer.src)
      || (layer.frames && layer.loopMs ? { frames: layer.frames, ms: layer.loopMs } : null);
    if (info) {
      style.append(el("p", {
        class: "hint",
        text: `Original animation · ${info.frames} frames · ${seconds(info.ms)} loop. The playhead picks the frame, so it moves with your timeline.`,
      }));
      const gap = state.project.duration - info.ms;
      if (Math.abs(gap) > 10) {
        style.append(el("div", { class: "pill-row" }, [
          el("button", {
            class: "pill",
            type: "button",
            text: `Fit timeline to ${seconds(fitValue(info.ms))}`,
            title: "Set the timeline to the decoration's own loop length",
            onclick: () => fitTimeline(info.ms),
          }),
        ]));
        style.append(el("p", {
          class: "hint",
          text: gap > 0
            ? `Your timeline is ${seconds(state.project.duration)}, so this loop plays once and a bit before it starts over.`
            : `Your timeline is ${seconds(state.project.duration)}, shorter than the loop — the end of it never shows.`,
        }));
      }
    }
  }
  if (layer.overlay) {
    style.append(el("p", { class: "hint", text: "Overlay art — drawn over the avatar on purpose, so it's left out of the rim check." }));
  }

  const animRow = el("div", { class: "fieldset" }, [
    el("h3", { text: "Animation" }),
    animated
      ? el("p", { class: "hint", text: `${layer.keyframes.length} keyframes. Edits land on a keyframe at the playhead.` })
      : el("p", { class: "hint", text: "No keyframes yet — this shape holds still." }),
    el("div", { class: "pill-row" }, [
      el("button", {
        class: "pill", type: "button",
        text: animated ? "Key at playhead" : "Add first keyframe",
        onclick: () => { commit("keyframe"); addKeyframe(layer.id); emit("selection"); toast("Keyframe added"); },
      }),
      animated && el("button", {
        class: "pill", type: "button", text: "Clear keys",
        onclick: () => {
          commit("clear keys");
          layer.keyframes = [];
          emit("project");
          emit("selection");
        },
      }),
    ]),
  ]);

  const arrange = el("div", { class: "fieldset" }, [
    el("h3", { text: "Arrange" }),
    el("div", { class: "pill-row" }, [
      el("button", { class: "pill", type: "button", text: "Forward", onclick: () => reorder(layer, 1) }),
      el("button", { class: "pill", type: "button", text: "Backward", onclick: () => reorder(layer, -1) }),
      el("button", {
        class: "pill", type: "button", text: "Duplicate",
        onclick: () => duplicate(layer),
      }),
      el("button", {
        class: "pill", type: "button", text: "Delete",
        onclick: () => {
          commit("delete");
          state.project.layers = state.project.layers.filter((l) => l.id !== layer.id);
          selectLayer(null);
          emit("project");
        },
      }),
    ]),
  ]);

  body.append(nameField, transform, style, animRow, arrange);

  nameField.querySelector("input").addEventListener("focus", () => once(layer, "name"));
  nameField.querySelector("input").addEventListener("input", (ev) => {
    layer.name = ev.target.value;
    emit("project");
  });
}

/** The timeline's own limits are 200 ms – 10 s, so a longer loop is fitted to the cap. */
function fitValue(ms) {
  return Math.min(10000, Math.max(200, Math.round(ms / 10) * 10));
}

function fitTimeline(ms) {
  const value = fitValue(ms);
  commit("fit duration");
  state.project.duration = value;
  if (state.time > value) state.time = value;
  emit("project");
  emit("time", state.time);
  toast(`Timeline set to ${seconds(value)}`);
}

function duplicate(layer) {
  commit("duplicate");
  const copy = JSON.parse(JSON.stringify(layer));
  copy.id = uid();
  copy.name = `${layer.name} copy`;
  copy.x += 18;
  copy.y += 18;
  copy.keyframes = copy.keyframes.map((k) => ({
    ...k,
    id: uid("k"),
    x: k.x + 18,
    y: k.y + 18,
  }));
  state.project.layers.push(copy);
  selectLayer(copy.id);
  emit("project");
}

let focusing = null;
function once(layer, kind) {
  if (focusing?.layer === layer.id && focusing.kind === kind) return;
  focusing = { layer: layer.id, kind };
  commit(kind);
}
on("selection", () => { focusing = null; });

function patchLayer(layer, patch) {
  writeTransform(layer, patch);
  emit("project");
}

function patchStyle(layer, patch) {
  Object.assign(layer, patch);
  emit("project");
}

function shapeFields(layer) {
  const wrap = el("div", { class: "grid2" });
  const add = (label, key, opts) => wrap.append(numberField(
    label,
    round(layer[key] ?? 0, 1),
    opts,
    (v) => { layer[key] = v; emit("project"); },
  ));

  if (layer.type === "text") {
    const textInput = el("label", { class: "field", style: "grid-column:1/-1" }, [
      el("span", { text: "Text" }),
      el("input", { value: layer.text || "", "data-bind": "text" }),
    ]);
    textInput.querySelector("input").addEventListener("input", (ev) => {
      layer.text = ev.target.value;
      emit("project");
    });
    wrap.append(textInput);
    add("Size", "fontSize", { step: 2, min: 8, max: 240 });
  } else {
    add("Width", "w", { step: 1, min: 4, max: 600 });
    add("Height", "h", { step: 1, min: 4, max: 600 });
  }

  if (layer.type === "balloon") {
    add("Tail", "tail", { step: 1, min: 0, max: 80 });
    add("Dots", "dots", { step: 1, min: 0, max: 5 });
  }
  if (layer.type === "pill") add("Corner", "radius", { step: 1, min: 0, max: 200 });
  if (layer.type === "burst") add("Rays", "rays", { step: 1, min: 5, max: 24 });
  if (layer.type === "path") {
    wrap.append(el("p", {
      class: "hint",
      style: "grid-column:1/-1",
      text: `${layer.nodes?.length || 0} points · ${layer.closed ? "closed shape" : "open stroke"}`,
    }));
    const closedRow = el("label", { class: "check", style: "grid-column:1/-1" }, [
      el("input", { type: "checkbox", checked: Boolean(layer.closed) }),
      el("span", { text: "Closed shape" }),
    ]);
    closedRow.querySelector("input").addEventListener("change", (ev) => {
      commit("close path");
      layer.closed = ev.target.checked;
      if (layer.closed && layer.fill === "none") layer.fill = layer.stroke || "#ff5f45";
      emit("project");
    });
    wrap.append(closedRow);
  }
  return wrap;
}

function numberField(label, value, opts, apply) {
  const input = el("input", {
    type: "number",
    value,
    step: opts.step ?? 1,
    min: opts.min,
    max: opts.max,
    class: "mono",
  });
  const field = el("label", { class: "field" }, [el("span", { text: label }), input]);
  input.addEventListener("focus", () => { input.dataset.dirty = ""; });
  input.addEventListener("input", () => {
    const v = Number(input.value);
    if (Number.isNaN(v)) return;
    if (input.dataset.dirty !== "1") {
      input.dataset.dirty = "1";
      commit(label);
    }
    apply(v);
  });
  field._input = input;
  field._label = label;
  return field;
}

function colorField(label, value, apply, allowNone = false) {
  const input = el("input", { type: "color", value: value === "none" ? "#ffffff" : value });
  const field = el("label", { class: "field" }, [
    el("span", { text: label }),
    el("div", { class: "inline-color" }, [input]),
  ]);
  field._input = input;
  field._label = label;
  input.addEventListener("input", () => {
    if (input.dataset.dirty !== "1") {
      input.dataset.dirty = "1";
      commit(label);
    }
    apply(input.value);
  });
  input.addEventListener("blur", () => { input.dataset.dirty = ""; });

  if (allowNone) {
    const noneBtn = el("button", {
      class: "pill", type: "button", text: "none",
      onclick: () => { commit(label); apply("none"); },
    });
    field.querySelector(".inline-color").append(noneBtn);
  }
  return field;
}

/** Refresh values in place so typing isn't interrupted. */
function syncInspector() {
  const layer = selectedLayer();
  if (!layer) return;
  const body = document.getElementById("inspector-body");
  const sampled = sampleLayer(layer, state.time);
  const values = {
    X: round(sampled.x, 1),
    Y: round(sampled.y, 1),
    Scale: round(sampled.scale, 2),
    Rotation: round(sampled.rotation, 1),
    Opacity: Math.round(sampled.opacity * 100),
    Width: round(layer.w, 1),
    Height: round(layer.h, 1),
    Tail: round(layer.tail, 1),
    Dots: layer.dots,
    Corner: round(layer.radius, 1),
    Rays: layer.rays,
    Size: round(layer.fontSize, 1),
    "Outline width": round(layer.strokeWidth, 1),
  };
  for (const field of body.querySelectorAll(".field")) {
    const input = field.querySelector("input");
    if (!input || input === document.activeElement) continue;
    const label = field.querySelector("span")?.textContent;
    if (label && label in values && input.type === "number") {
      const raw = values[label];
      if (raw == null || Number.isNaN(raw)) continue;
      const next = String(raw);
      if (input.value !== next) input.value = next;
    }
  }
  void CANVAS;
  void keyframeAt;
}
