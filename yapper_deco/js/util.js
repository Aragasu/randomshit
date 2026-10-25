// Small shared helpers.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

let counter = 0;
export const uid = (prefix = "l") => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(timer); fn(...args); };
  return wrapped;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function toDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/** Milliseconds to a short, honest loop length: 4.98s, 12.4s. */
export function seconds(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

export function readableBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function toast(message, kind = "") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const node = el("div", { class: `toast ${kind}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.style.transition = "opacity .25s ease";
    node.style.opacity = "0";
    setTimeout(() => node.remove(), 260);
  }, kind === "bad" ? 4200 : 2200);
}
