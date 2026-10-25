// Clipart search backed by the Iconify API (CORS-open, no key required).
//
// The obvious approach — 48 parallel `<img src=".../icon.svg">` previews — gets
// rate limited: Iconify answers the burst with 429 and the tiles render blank,
// which is why previews used to go missing. Instead we fetch each collection's
// icon bodies once as JSON (a handful of requests for a whole search) and build
// the SVGs locally, which also makes placing and recolouring instant.

import { state, emit, commit, makeLayer, selectLayer } from "./state.js";
import { el, toast } from "./util.js";

const API = "https://api.iconify.design";
const collections = new Map();
const sets = new Map(); // prefix -> { icons: Map, aliases: {}, width, height }

const CHIPS = ["speech", "star", "heart", "sparkle", "music", "cat", "party", "arrow", "sun", "cloud"];

let searchToken = 0;

export function initClipart() {
  const form = document.getElementById("clipart-form");
  const input = document.getElementById("clipart-query");
  const results = document.getElementById("clipart-results");
  const status = document.getElementById("clipart-status");
  const chips = document.getElementById("clipart-chips");

  for (const term of CHIPS) {
    chips.append(el("button", {
      class: "chip", type: "button", text: term,
      onclick: () => { input.value = term; run(term); },
    }));
  }

  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    run(input.value.trim() || "speech");
  });

  async function run(query) {
    const token = ++searchToken;
    status.textContent = `Searching “${query}”…`;
    results.innerHTML = "";
    let icons;
    try {
      const res = await fetch(`${API}/search?query=${encodeURIComponent(query)}&limit=48`);
      if (!res.ok) throw new Error(`Iconify replied ${res.status}`);
      const data = await res.json();
      icons = data.icons || [];
    } catch (err) {
      status.textContent = `Search failed — ${err.message}. Check the connection and try again.`;
      results.append(el("button", { class: "pill", type: "button", text: "Retry", onclick: () => run(query) }));
      return;
    }
    if (token !== searchToken) return;
    if (icons.length === 0) {
      status.textContent = `Nothing for “${query}”. Try a simpler word.`;
      return;
    }

    const groups = new Map();
    for (const icon of icons) {
      const [prefix, name] = icon.split(":");
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix).push(name);
    }
    // Licence metadata travels with the collection, so ask for all of them at once.
    fetchCollections([...groups.keys()]);

    let placed = 0;
    let missing = 0;
    await Promise.all([...groups].map(async ([prefix, names]) => {
      let set;
      try {
        set = await iconsFor(prefix, names);
      } catch {
        missing += names.length;
        if (token === searchToken) {
          results.append(el("p", { class: "hint", text: `Couldn't load the ${prefix} set — try the search again.` }));
        }
        return;
      }
      if (token !== searchToken) return;
      for (const name of names) {
        const found = resolveIcon(set, name);
        if (!found) { missing++; continue; }
        placed++;
        results.append(cellFor(`${prefix}:${name}`, prefix, found, set));
      }
    }));

    if (token !== searchToken) return;
    status.textContent = missing
      ? `${placed} of ${icons.length} for “${query}” — ${missing} aren't on the public API.`
      : `${placed} results for “${query}”. Click one to place it.`;
    if (placed === 0) {
      results.append(el("button", { class: "pill", type: "button", text: "Retry", onclick: () => run(query) }));
    }
  }

  run("speech");
}

function cellFor(icon, prefix, found, set) {
  const info = collections.get(prefix) || { name: prefix };
  const svg = svgFor(found.item.body, boxOf(found.item, set), "#17142f");
  return el("button", {
    class: "clipart-cell",
    type: "button",
    title: `${icon} · ${info.license || "open licence"}`,
    onclick: () => addIcon(icon),
  }, [
    el("img", { src: svgToDataURL(svg), alt: icon.split(":")[1].replace(/-/g, " ") }),
  ]);
}

/** One request per collection, retried once — 429s are the failure mode here. */
async function request(url, attempt = 0) {
  const res = await fetch(url);
  if (!res.ok) {
    if (attempt < 1 && (res.status === 429 || res.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      return request(url, attempt + 1);
    }
    throw new Error(`Iconify replied ${res.status}`);
  }
  return res.json();
}

async function iconsFor(prefix, names) {
  const set = sets.get(prefix) || { icons: new Map(), aliases: {}, width: 24, height: 24 };
  const missing = names.filter((name) => !set.icons.has(name) && !set.aliases[name]);
  if (missing.length > 0) {
    const data = await request(`${API}/${prefix}.json?icons=${encodeURIComponent(missing.join(","))}`);
    Object.assign(set.aliases, data.aliases || {});
    for (const [name, item] of Object.entries(data.icons || {})) set.icons.set(name, item);
    set.width = data.width ?? set.width;
    set.height = data.height ?? set.height;
    sets.set(prefix, set);
  }
  return set;
}

function resolveIcon(set, name) {
  let item = set.icons.get(name);
  let depth = 0;
  while (!item && set.aliases[name] && depth < 4) {
    name = set.aliases[name].parent;
    item = set.icons.get(name);
    depth++;
  }
  return item ? { item, name } : null;
}

function boxOf(item, set) {
  return [
    item.left ?? 0,
    item.top ?? 0,
    item.width ?? set.width ?? 24,
    item.height ?? set.height ?? 24,
  ];
}

async function fetchCollections(prefixes) {
  const wanted = prefixes.filter((prefix) => !collections.has(prefix));
  if (wanted.length === 0) return;
  try {
    const data = await request(`${API}/collections?prefixes=${encodeURIComponent(wanted.join(","))}`);
    for (const prefix of wanted) {
      const info = data[prefix] || {};
      collections.set(prefix, {
        name: info.name || prefix,
        author: info.author?.name || "unknown",
        license: info.license?.title || "unknown licence",
        palette: Boolean(info.palette),
      });
    }
  } catch {
    for (const prefix of wanted) {
      if (!collections.has(prefix)) {
        collections.set(prefix, { name: prefix, author: "unknown", license: "unknown licence", palette: false });
      }
    }
  }
}

export async function collectionInfo(prefix) {
  if (!collections.has(prefix)) await fetchCollections([prefix]);
  return collections.get(prefix) || { name: prefix, author: "unknown", license: "unknown licence", palette: false };
}

function svgToDataURL(svg) {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function svgFor(body, box, color) {
  const [left, top, w, h] = box;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left} ${top} ${w} ${h}" width="${w}" height="${h}" style="color:${color}">${body}</svg>`;
}

export async function addIcon(icon) {
  const color = "#17142f";
  const [prefix, name] = icon.split(":");
  try {
    const set = await iconsFor(prefix, [name]);
    const found = resolveIcon(set, name);
    if (!found) throw new Error("it isn't on the public API");
    const box = boxOf(found.item, set);
    const info = await collectionInfo(prefix);
    const layer = makeLayer("image", {
      src: svgToDataURL(svgFor(found.item.body, box, color)),
      w: 96,
      h: 96,
      name: name.replace(/-/g, " "),
      icon,
      iconColor: color,
      iconBody: found.item.body,
      iconBox: box,
      license: { collection: info.name, author: info.author, license: info.license, palette: info.palette },
    });
    commit("add clipart");
    state.project.layers.push(layer);
    selectLayer(layer.id);
    emit("project");
    toast(`Added ${icon} · ${info.license}`);
  } catch (err) {
    toast(`Couldn't add that icon (${err.message})`, "bad");
  }
}

/** Recolour from the body we already stored — no network round trip. */
export function recolorIcon(layer, color) {
  if (!layer.iconBody || !layer.iconBox) return;
  layer.src = svgToDataURL(svgFor(layer.iconBody, layer.iconBox, color));
  layer.iconColor = color;
  if (layer.license?.palette) toast("This set ships its own colours, so tinting won't change it");
  emit("project");
}
