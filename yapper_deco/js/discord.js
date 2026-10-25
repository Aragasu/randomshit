// Discord avatar decorations, fetched from the public CDN — no token, no login.
//
// Discord's own API wants a token, so the catalogue comes from two community
// indexes that publish the preset asset hashes. The CDN itself is open: it
// sends `access-control-allow-origin: *`, which is what lets us pull the
// artwork into a canvas and export it. The art belongs to Discord and its
// artists — this is for personal previews, not redistribution.
//
// Every preset is an APNG, so placing one decodes its frames (apng.js) and the
// stage animates it with the playhead.

import { state, emit, commit, makeLayer, selectLayer } from "./state.js";
import { apngTiming, decodeAPNG } from "./apng.js";
import { registerAnimation } from "./animations.js";
import { el, seconds, toast } from "./util.js";

// Two indexes, merged: the larger one is newer, the smaller one has a few
// presets the other is missing.
const SOURCES = [
  {
    url: "https://raw.githubusercontent.com/lucvxc/DiscordDecoFetcher/main/decorations.json",
    parse: (data) => (Array.isArray(data) ? data : []).map((item) => ({
      hash: item.asset || hashFromUrl(item.staticUrl),
      label: item.name || "decoration",
      category: item.category || "Other",
      detail: item.label || "",
    })),
  },
  {
    url: "https://raw.githubusercontent.com/wickstudio/Discord-Avatar-Decoration-Bot/main/effects.json",
    parse: (data) => (Array.isArray(data) ? data : [])
      .filter((item) => item.category === "decorations" && item.url)
      .map((item) => ({
        hash: hashFromUrl(item.url),
        label: item.label || "decoration",
        category: "Uncategorised",
        detail: "",
      })),
  },
];

const CDN = "https://cdn.discordapp.com/avatar-decoration-presets";
const CACHE_KEY = "deco-studio:discord-index";
const CACHE_VERSION = 2;
const CACHE_TTL = 24 * 60 * 60 * 1000;
// Loop lengths are only knowable by reading a preset's bytes, so they are
// remembered per preset hash: every one you place or inspect keeps its timing.
const TIMING_KEY = "deco-studio:discord-timings";

let entries = [];
let filter = "";
let category = "*";
let timings = readTimings();

function hashFromUrl(url) {
  return (url || "").split("/").pop().split("?")[0].replace(/\.png$/, "");
}

export function initDiscord() {
  const form = document.getElementById("discord-form");
  const query = document.getElementById("discord-query");
  const select = document.getElementById("discord-category");
  const status = document.getElementById("discord-status");
  const results = document.getElementById("discord-results");
  const reload = document.getElementById("discord-reload");
  const timingBtn = document.getElementById("discord-timings");

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    filter = query.value.trim().toLowerCase();
    render();
  });
  query.addEventListener("input", () => {
    filter = query.value.trim().toLowerCase();
    render();
  });
  select.addEventListener("change", () => {
    category = select.value;
    render();
  });
  reload.addEventListener("click", () => load(true));
  timingBtn.addEventListener("click", () => loadTimings());

  async function load(force = false) {
    status.textContent = "Loading the decoration index…";
    results.innerHTML = "";
    try {
      const cached = readCache();
      const data = force || !cached ? await fetchIndexes() : cached;
      entries = data;
      if (entries.length === 0) throw new Error("the index came back empty");
      fillCategories();
      const sets = new Set(entries.map((entry) => entry.category)).size;
      status.textContent = `${entries.length} official decorations across ${sets} sets. Click one to wrap it around the avatar.`;
      render();
    } catch (err) {
      status.textContent = `Couldn't load the decoration list (${err.message}). The CDN may be reachable even when the indexes aren't — try reloading, or place your own art from Upload.`;
    }
  }

  function fillCategories() {
    const counts = new Map();
    for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    select.innerHTML = "";
    select.append(el("option", { value: "*", text: `All sets (${entries.length})` }));
    for (const [name, count] of sorted) {
      select.append(el("option", { value: name, text: `${name} (${count})` }));
    }
    select.value = sorted.some(([name]) => name === category) ? category : "*";
    category = select.value;
  }

  function visibleEntries() {
    return entries.filter((entry) => {
      if (category !== "*" && entry.category !== category) return false;
      if (!filter) return true;
      return `${entry.label} ${entry.category} ${entry.detail}`.toLowerCase().includes(filter);
    });
  }

  /** Loop lengths need the preset's bytes, so this is an explicit, cancellable-by-reload
   *  read of everything currently on screen — a handful of tiles, not all 667. */
  async function loadTimings() {
    if (timingBtn.disabled) return;
    const queue = visibleEntries().filter((entry) => !timings[entry.hash]).slice(0, 80);
    if (queue.length === 0) {
      toast("Every preset on screen already shows its loop length");
      return;
    }
    const total = queue.length;
    let done = 0;
    timingBtn.disabled = true;
    timingBtn.textContent = `Reading lengths… 0/${total}`;

    const worker = async () => {
      while (queue.length > 0) {
        const entry = queue.shift();
        try {
          const res = await fetch(`${CDN}/${entry.hash}.png`);
          if (res.ok) {
            const info = apngTiming(await res.arrayBuffer());
            if (info) {
              rememberTiming(entry.hash, info);
              badgeTile(entry.hash, info);
            }
          }
        } catch {
          /* one unreadable preset shouldn't stop the rest */
        }
        done++;
        timingBtn.textContent = `Reading lengths… ${done}/${total}`;
      }
    };

    await Promise.all(Array.from({ length: Math.min(4, total) }, worker));
    timingBtn.disabled = false;
    timingBtn.textContent = "Show loop lengths";
    const remaining = visibleEntries().filter((entry) => !timings[entry.hash]).length;
    toast(remaining > 0
      ? `Read ${done} loop lengths — ${remaining} still on screen; narrow the filter to read them`
      : `Read ${done} loop length${done === 1 ? "" : "s"}`);
  }

  function render() {
    results.innerHTML = "";
    const shown = visibleEntries();
    if (shown.length === 0) {
      results.append(el("p", { class: "hint", text: "Nothing matches that filter." }));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const entry of shown) {
      const timing = timings[entry.hash];
      frag.append(el("button", {
        class: "clipart-cell",
        type: "button",
        title: timing
          ? `${entry.label} · ${entry.category} · ${timing.frames} frames · ${seconds(timing.ms)} loop`
          : `${entry.label} · ${entry.category}`,
        "data-hash": entry.hash,
        onclick: () => addDecoration(entry),
      }, [
        el("img", {
          // passthrough=false asks the CDN to render a still: 13 KB instead of a
          // 1.6 MB APNG per tile. The animation plays on the stage once placed.
          src: `${CDN}/${entry.hash}.png?size=128&passthrough=false`,
          alt: entry.label,
          loading: "lazy",
          decoding: "async",
          referrerpolicy: "no-referrer",
          onerror: (ev) => ev.target.closest(".clipart-cell").classList.add("is-missing"),
        }),
        timing ? el("span", { class: "cell-badge", text: seconds(timing.ms) }) : null,
      ]));
    }
    results.append(frag);
  }

  load();
}

function readTimings() {
  try {
    return JSON.parse(localStorage.getItem(TIMING_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function rememberTiming(hash, info) {
  timings[hash] = info;
  try {
    localStorage.setItem(TIMING_KEY, JSON.stringify(timings));
  } catch {
    /* storage full — the badge just won't survive a reload */
  }
}

/** Stamp the length onto a tile without rebuilding the grid. */
function badgeTile(hash, info) {
  const tile = document.querySelector(`#discord-results [data-hash="${hash}"]`);
  if (!tile) return;
  const label = tile.getAttribute("title") || "";
  if (!label.includes("loop")) {
    tile.setAttribute("title", `${label} · ${info.frames} frames · ${seconds(info.ms)} loop`);
  }
  if (tile.querySelector(".cell-badge")) return;
  tile.append(el("span", { class: "cell-badge", text: seconds(info.ms) }));
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.version !== CACHE_VERSION || Date.now() - cached.at > CACHE_TTL) return null;
    return cached.entries;
  } catch {
    return null;
  }
}

async function fetchIndexes() {
  const results = await Promise.allSettled(SOURCES.map(async (source) => {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`index replied ${res.status}`);
    return source.parse(await res.json());
  }));

  const merged = new Map();
  let failures = 0;
  for (const result of results) {
    if (result.status !== "fulfilled") { failures++; continue; }
    for (const entry of result.value) {
      if (!entry.hash || merged.has(entry.hash)) continue;
      merged.set(entry.hash, entry);
    }
  }
  const decorations = [...merged.values()];
  if (decorations.length === 0) {
    throw new Error(failures === SOURCES.length ? "both indexes are unreachable" : "the indexes listed no decorations");
  }

  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, at: Date.now(), entries: decorations }));
  } catch {
    /* storage full — the list just reloads next time */
  }
  return decorations;
}

async function addDecoration(entry) {
  const src = `${CDN}/${entry.hash}.png?size=512`;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`CDN replied ${res.status}`);
    const bytes = await res.arrayBuffer();
    const anim = await decodeAPNG(bytes).catch(() => null);

    commit("add decoration");
    // decorations are drawn for a 288px avatar; our rim is 336, so match it
    const layer = makeLayer("image", {
      src,
      w: 336,
      h: 336,
      x: 256,
      y: 244,
      name: entry.label,
      overlay: true,
      animated: Boolean(anim),
      frames: anim ? anim.frames.length : 0,
      loopMs: anim ? anim.duration : 0,
      license: {
        collection: "Discord",
        author: "Discord",
        license: "Discord artwork — personal preview only",
      },
    });
    if (anim) registerAnimation(src, anim);
    state.project.layers.push(layer);
    selectLayer(layer.id);
    emit("project");
    if (anim) {
      const timing = { frames: anim.frames.length, ms: anim.duration };
      rememberTiming(entry.hash, timing);
      badgeTile(entry.hash, timing);
    }
    toast(anim
      ? `Added ${entry.label} · ${anim.frames.length} frames · ${seconds(anim.duration)} loop`
      : `Added ${entry.label} · still frame`);
    // Show the motion straight away instead of leaving a still frame on screen.
    if (anim && !state.playing) document.getElementById("play")?.click();
  } catch (err) {
    toast(`Couldn't fetch that decoration (${err.message})`, "bad");
  }
}
