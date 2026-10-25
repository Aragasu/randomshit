// Draggable dividers between the add rail, the stage, the inspector and the
// timeline. Sizes live in CSS custom properties and are remembered between
// sessions; the stage re-fits itself through its ResizeObserver.

const KEY = "deco-studio:layout";

const PANELS = [
  { id: "split-rail", axis: "x", prop: "--rail-w", sign: 1, min: 196, max: 620, fallback: 292 },
  { id: "split-inspect", axis: "x", prop: "--inspect-w", sign: -1, min: 220, max: 560, fallback: 304 },
  { id: "split-timeline", axis: "y", prop: "--timeline-h", sign: -1, min: 132, max: 640, fallback: 272 },
];

export function initSplitters() {
  const sizes = readLayout();
  for (const panel of PANELS) {
    // Only pin a size the user actually chose; otherwise leave the stylesheet in
    // charge so its narrower defaults still apply on small screens.
    if (Number.isFinite(sizes[panel.prop])) setSize(panel, sizes[panel.prop]);
    wire(panel, sizes);
  }

  // A shrunken window could otherwise squeeze the stage to nothing.
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (window.innerWidth <= 940) return;
      for (const panel of PANELS) {
        const [min, max] = limits(panel);
        const value = current(panel);
        if (value > max) setSize(panel, Math.max(min, max));
      }
    });
  });
}

function readLayout() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLayout(panel, value) {
  try {
    const current = readLayout();
    current[panel.prop] = Math.round(value);
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode — sizes just won't persist */
  }
}

function setSize(panel, value) {
  document.documentElement.style.setProperty(panel.prop, `${Math.round(value)}px`);
}

function current(panel) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(panel.prop);
  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed) && raw.includes("px")) return parsed;
  return panel.fallback;
}

function limits(panel) {
  // Keep enough room for the stage: it is the point of the app.
  const workbench = document.querySelector(".workbench");
  if (!workbench) return [panel.min, panel.max];
  if (panel.axis === "y") {
    return [panel.min, Math.max(panel.min, Math.min(panel.max, window.innerHeight - 220))];
  }
  const rail = current(PANELS[0]);
  const inspect = current(PANELS[1]);
  const room = workbench.clientWidth - 340; // stage + its padding stays legible
  const max = Math.min(panel.max, Math.max(panel.min, room - (panel.id === "split-rail" ? inspect : rail)));
  return [panel.min, max];
}

function wire(panel, sizes) {
  const handle = document.getElementById(panel.id);
  if (!handle) return;
  let drag = null;

  handle.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const [min, max] = limits(panel);
    drag = {
      start: panel.axis === "x" ? ev.clientX : ev.clientY,
      value: current(panel),
      min,
      max,
    };
    handle.classList.add("is-dragging");
    document.body.classList.add("is-resizing");
    try { handle.setPointerCapture(ev.pointerId); } catch { /* synthetic or lost pointer */ }
  });

  handle.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const now = panel.axis === "x" ? ev.clientX : ev.clientY;
    const next = Math.min(drag.max, Math.max(drag.min, drag.value + (now - drag.start) * panel.sign));
    setSize(panel, next);
  });

  const end = (ev) => {
    if (!drag) return;
    drag = null;
    handle.classList.remove("is-dragging");
    document.body.classList.remove("is-resizing");
    try { handle.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    saveLayout(panel, current(panel));
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);

  handle.addEventListener("dblclick", () => {
    setSize(panel, panel.fallback);
    saveLayout(panel, panel.fallback);
  });

  handle.addEventListener("keydown", (ev) => {
    const forward = panel.axis === "x" ? "ArrowRight" : "ArrowUp";
    const back = panel.axis === "x" ? "ArrowLeft" : "ArrowDown";
    const step = ev.shiftKey ? 48 : 16;
    let next = null;
    if (ev.key === forward) next = current(panel) + step * panel.sign;
    else if (ev.key === back) next = current(panel) - step * panel.sign;
    else if (ev.key === "Home") next = panel.fallback;
    if (next === null) return;
    ev.preventDefault();
    const [min, max] = limits(panel);
    const value = Math.min(max, Math.max(min, next));
    setSize(panel, value);
    handle.setAttribute("aria-valuenow", String(Math.round(value)));
    saveLayout(panel, value);
  });

  handle.setAttribute("aria-valuenow", String(Math.round(Number.isFinite(sizes[panel.prop]) ? sizes[panel.prop] : panel.fallback)));
}
