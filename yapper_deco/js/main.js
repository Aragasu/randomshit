// Boot and app-level wiring.

import {
  state, on, emit, commit, undo, redo, canUndo, canRedo, setProject, starterProject,
  selectedLayer, selectLayer, makeLayer, removeKeyframe, uid,
} from "./state.js";
import { initStage } from "./stage.js";
import { initUI } from "./ui.js";
import { initTimeline } from "./timeline.js";
import { initClipart } from "./clipart.js";
import { initDiscord } from "./discord.js";
import { initSplitters } from "./splitters.js";
import { setTool, cancelDraft, finish } from "./tools.js";
import {
  exportPNG, exportAPNG, exportGIF, exportWebP, exportJSON, importJSON, inspectAPNG,
} from "./exporters.js";
import { checkZones } from "./render.js";
import { wingsProject } from "./wings.js";
import { toDataURL, toast, clamp } from "./util.js";

const PROJECT_KEY = "deco-studio:project";
const AVATAR_KEY = "deco-studio:avatar";
const TIME_KEY = "deco-studio:time";
const SETTLE_MS = 1200;

function boot() {
  const saved = loadSaved();
  setProject(saved || starterProject());
  // reopen where the user left off; a fresh document opens on the settled frame
  const savedTime = Number(localStorage.getItem(TIME_KEY));
  state.time = savedTime > 0 ? Math.min(savedTime, state.project.duration) : SETTLE_MS;
  emit("time", state.time);

  const avatar = localStorage.getItem(AVATAR_KEY);
  if (avatar) state.avatar = avatar;

  initSplitters();
  const stage = initStage();
  initUI();
  initTimeline(stage);
  initClipart();
  initDiscord();

  wireTopbar();
  wireExportSheet();
  wireUploads();
  wireSettings();
  wireKeyboard();
  wireAutosave();

  document.getElementById("doc-name").value = state.project.name;
  document.getElementById("export-include-avatar").checked = state.includeAvatar;

  // handy for console experiments and for the app's own smoke test
  window.decoStudio = {
    state, exportPNG, exportAPNG, exportWebP, exportGIF, exportJSON, inspectAPNG, checkZones, undo, redo,
    setTime(time) { state.time = clamp(time, 0, state.project.duration); emit("time", state.time); },
  };
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.layers) || data.layers.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

function wireTopbar() {
  document.getElementById("undo").addEventListener("click", undo);
  document.getElementById("redo").addEventListener("click", redo);

  const syncHistory = () => {
    document.getElementById("undo").disabled = !canUndo();
    document.getElementById("redo").disabled = !canRedo();
  };
  on("history", syncHistory);
  syncHistory();

  const name = document.getElementById("doc-name");
  name.addEventListener("focus", () => commit("rename project"));
  name.addEventListener("input", () => {
    state.project.name = name.value;
    emit("project");
  });
}

function wireExportSheet() {
  const sheet = document.getElementById("export-sheet");
  const timing = () => `${state.project.fps} fps over ${(state.project.duration / 1000).toFixed(1)}s`;
  const setDetails = () => {
    document.getElementById("webp-detail").textContent = `Full colour and alpha · ${timing()}`;
    document.getElementById("gif-detail").textContent = `256 colours, hard edges · ${timing()}`;
    document.getElementById("apng-detail").textContent = `Discord's deco format · ${timing()}`;
  };
  const open = () => { sheet.hidden = false; setDetails(); };
  document.getElementById("export-open").addEventListener("click", open);
  document.getElementById("export-close").addEventListener("click", () => { sheet.hidden = true; });
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) sheet.hidden = true; });

  const includeAvatar = document.getElementById("export-include-avatar");
  includeAvatar.addEventListener("change", () => { state.includeAvatar = includeAvatar.checked; });

  const opts = () => ({ avatar: state.avatar, withAvatar: includeAvatar.checked });

  document.getElementById("export-png").addEventListener("click", async () => {
    await exportPNG(state.project, state.time, { scale: 1, ...opts() });
  });

  document.getElementById("export-png2x").addEventListener("click", async () => {
    await exportPNG(state.project, state.time, { scale: 2, ...opts() });
  });

  // Each animated format runs the same way: lock the card, report progress in
  // its own subtitle, and put the subtitle back afterwards.
  const animate = (id, label, task) => {
    const button = document.getElementById(id);
    const detail = document.getElementById(`${id.split("-")[1]}-detail`);
    button.addEventListener("click", async () => {
      button.disabled = true;
      detail.textContent = label;
      try {
        await task();
      } catch (err) {
        toast(`Animation export failed: ${err.message}`, "bad");
      } finally {
        button.disabled = false;
        setDetails();
      }
    });
  };

  animate("export-webp", "Encoding frames…", () => exportWebP(state.project, opts()));
  animate("export-gif", "Matching colours…", () => exportGIF(state.project, opts()));
  animate("export-apng", "Encoding frames…", () => exportAPNG(state.project, opts()));

  document.getElementById("export-json").addEventListener("click", () => {
    exportJSON(state.project);
  });

  document.getElementById("open-project").addEventListener("click", () => {
    document.getElementById("project-input").click();
  });

  document.getElementById("project-input").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const project = await importJSON(file);
      project.size = 512;
      setProject(project);
      document.getElementById("doc-name").value = project.name || "untitled";
      sheet.hidden = true;
      toast(`Opened ${file.name}`);
    } catch (err) {
      toast(`Couldn't open that file: ${err.message}`, "bad");
    } finally {
      ev.target.value = "";
    }
  });
}

function wireUploads() {
  const fileInput = document.getElementById("file-input");
  document.getElementById("pick-file").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (file) await addImageFile(file);
    ev.target.value = "";
  });

  const drop = document.getElementById("drop");
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (ev) => { ev.preventDefault(); drop.classList.add("is-hot"); });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, () => drop.classList.remove("is-hot"));
  }
  drop.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    const file = ev.dataTransfer?.files?.[0];
    if (file) await addImageFile(file);
  });

  const avatarInput = document.getElementById("avatar-input");
  document.getElementById("pick-avatar").addEventListener("click", () => avatarInput.click());
  avatarInput.addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    state.avatar = await toDataURL(file);
    localStorage.setItem(AVATAR_KEY, state.avatar);
    emit("project");
    toast("Avatar preview updated");
    ev.target.value = "";
  });

  document.getElementById("clear-avatar").addEventListener("click", () => {
    state.avatar = null;
    localStorage.removeItem(AVATAR_KEY);
    emit("project");
  });
}

async function addImageFile(file) {
  if (!file.type.startsWith("image/")) {
    toast("That's not an image file", "bad");
    return;
  }
  const src = await toDataURL(file);
  const img = new Image();
  await new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; img.src = src; });
  const ratio = img.naturalWidth / img.naturalHeight || 1;
  const w = ratio >= 1 ? 120 : 120 * ratio;
  const h = ratio >= 1 ? 120 / ratio : 120;
  commit("add art");
  const layer = makeLayer("image", { src, w, h, name: file.name.replace(/\.[a-z0-9]+$/i, "") });
  state.project.layers.push(layer);
  selectLayer(layer.id);
  emit("project");
}

function wireSettings() {
  const guides = document.getElementById("show-guides");
  guides.checked = state.guides;
  guides.addEventListener("change", () => {
    state.guides = guides.checked;
    emit("project");
  });

  document.getElementById("reset-starter").addEventListener("click", () => {
    commit("starter");
    setProject(starterProject());
    state.time = SETTLE_MS;
    emit("time", state.time);
    document.getElementById("doc-name").value = state.project.name;
    toast("Loaded the yapper starter deco");
  });

  document.getElementById("load-wings").addEventListener("click", () => {
    commit("fallen wings");
    setProject(wingsProject());
    state.time = 1200;
    emit("time", state.time);
    document.getElementById("doc-name").value = state.project.name;
    toast("Loaded fallen wings — 24 feathered layers, 3 s loop");
  });
}

function wireKeyboard() {
  window.addEventListener("keydown", (ev) => {
    const typing = ev.target instanceof HTMLElement
      && (ev.target.tagName === "INPUT" || ev.target.tagName === "TEXTAREA" || ev.target.isContentEditable);
    const mod = ev.metaKey || ev.ctrlKey;

    if (mod && ev.key.toLowerCase() === "z") {
      if (typing) return;
      ev.preventDefault();
      if (ev.shiftKey) redo(); else undo();
      return;
    }
    if (mod && ev.key.toLowerCase() === "y") {
      if (typing) return;
      ev.preventDefault();
      redo();
      return;
    }
    if (mod && ev.key.toLowerCase() === "d") {
      if (typing) return;
      ev.preventDefault();
      const layer = selectedLayer();
      if (layer) {
        commit("duplicate");
        const copy = JSON.parse(JSON.stringify(layer));
        copy.id = uid();
        copy.name = `${layer.name} copy`;
        copy.x += 16;
        copy.y += 16;
        copy.keyframes = copy.keyframes.map((k) => ({ ...k, id: uid("k"), x: k.x + 16, y: k.y + 16 }));
        state.project.layers.push(copy);
        selectLayer(copy.id);
        emit("project");
      }
      return;
    }
    if (typing) return;

    if (!mod) {
      const key = ev.key.toLowerCase();
      if (key === "v") { setTool("select"); return; }
      if (key === "p") { setTool("pen"); return; }
      if (key === "b") { setTool("brush"); return; }
      if (ev.key === "Enter" && state.tool === "pen") {
        ev.preventDefault();
        finish(false);
        return;
      }
    }

    if (ev.code === "Space") {
      ev.preventDefault();
      document.getElementById("play").click();
      return;
    }
    if (ev.key === "Escape") {
      document.getElementById("export-sheet").hidden = true;
      if (state.tool !== "select") {
        cancelDraft();
        setTool("select");
        return;
      }
      selectLayer(null);
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (state.kf) {
        ev.preventDefault();
        commit("delete keyframe");
        removeKeyframe(state.selection, state.kf);
        return;
      }
      const layer = selectedLayer();
      if (layer) {
        ev.preventDefault();
        commit("delete layer");
        state.project.layers = state.project.layers.filter((l) => l.id !== layer.id);
        selectLayer(null);
        emit("project");
      }
      return;
    }

    const step = ev.shiftKey ? 10 : 1;
    const nudges = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (nudges[ev.key]) {
      const layer = selectedLayer();
      if (!layer) return;
      ev.preventDefault();
      if (!nudgeDirty) { commit("nudge"); nudgeDirty = true; }
      const [dx, dy] = nudges[ev.key];
      if (layer.keyframes.length) {
        const kf = layer.keyframes.find((k) => Math.abs(k.t - state.time) < 1);
        if (kf) { kf.x += dx; kf.y += dy; }
        else {
          layer.keyframes.push({
            id: uid("k"), t: Math.round(state.time),
            x: layer.x + dx, y: layer.y + dy, scale: layer.scale,
            rotation: layer.rotation, opacity: layer.opacity,
            easing: { type: "bezier", p: [0.42, 0, 0.58, 1] },
          });
        }
      } else {
        layer.x += dx;
        layer.y += dy;
      }
      emit("project");
    }
  });

  window.addEventListener("keyup", (ev) => {
    if (ev.key.startsWith("Arrow")) nudgeDirty = false;
  });
}

let nudgeDirty = false;

function wireAutosave() {
  let timer = 0;
  let warned = false;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const json = JSON.stringify(state.project, (key, value) => (
          key === "_img" || key === "_anim" ? undefined : value
        ));
        localStorage.setItem(PROJECT_KEY, json);
        localStorage.setItem(TIME_KEY, String(Math.round(state.time)));
      } catch (err) {
        // Uploaded art is embedded as data URLs, so a big document can outgrow
        // the local storage quota. Say so once instead of losing work silently.
        if (!warned) {
          warned = true;
          toast("Autosave is off — this project is too big for browser storage. Export the project file to keep it.", "bad");
        }
        void err;
      }
    }, 500);
  };
  on("project", save);
  on("history", save);
  window.addEventListener("beforeunload", () => {
    try {
      localStorage.setItem(PROJECT_KEY, JSON.stringify(state.project, (k, v) => (k === "_img" ? undefined : v)));
      localStorage.setItem(TIME_KEY, String(Math.round(state.time)));
    } catch { /* ignore */ }
  });
}

boot();
