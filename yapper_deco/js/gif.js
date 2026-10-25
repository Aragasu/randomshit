// GIF89a writer for the animated exports.
//
// GIF has no alpha channel and 256 colours at most, so a frame is quantised to
// a palette shared by the whole animation and one index is reserved for "see
// through": pixels under 50% opacity are dropped, the rest become solid. That
// is the price of the format — use animated WebP when the edges matter.

const TRANSPARENT = 255;
const MAX_COLORS = 255;   // one slot left over for transparency

// ---------- palette ----------

/** Sample a frame into a 15-bit colour histogram (r5 << 10 | g5 << 5 | b5). */
export function histogram(data, hist) {
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] < 128) continue;
    hist[((data[p] >> 3) << 10) | ((data[p + 1] >> 3) << 5) | (data[p + 2] >> 3)]++;
  }
  return hist;
}

const expand = (v) => (v << 3) | (v >> 2);

function boxStats(points) {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, weight = 0;
  for (const p of points) {
    if (p.r < rMin) rMin = p.r;
    if (p.r > rMax) rMax = p.r;
    if (p.g < gMin) gMin = p.g;
    if (p.g > gMax) gMax = p.g;
    if (p.b < bMin) bMin = p.b;
    if (p.b > bMax) bMax = p.b;
    weight += p.w;
  }
  return { points, weight, spans: [rMax - rMin, gMax - gMin, bMax - bMin] };
}

function average(points) {
  let r = 0, g = 0, b = 0, w = 0;
  for (const p of points) {
    r += p.r * p.w;
    g += p.g * p.w;
    b += p.b * p.w;
    w += p.w;
  }
  if (!w) return [0, 0, 0];
  return [Math.round(r / w), Math.round(g / w), Math.round(b / w)];
}

/** Median cut: split the widest, heaviest box until the palette is full. */
export function buildPalette(hist, maxColors = MAX_COLORS) {
  const points = [];
  for (let key = 0; key < 32768; key++) {
    const count = hist[key];
    if (!count) continue;
    points.push({
      r: expand((key >> 10) & 31),
      g: expand((key >> 5) & 31),
      b: expand(key & 31),
      w: count,
    });
  }
  if (!points.length) return [[0, 0, 0]];

  let boxes = [boxStats(points)];
  while (boxes.length < maxColors) {
    let pick = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const longest = Math.max(...box.spans);
      if (box.points.length < 2 || longest < 4) continue;
      const score = box.weight * longest;
      if (score > best) { best = score; pick = i; }
    }
    if (pick < 0) break;

    const box = boxes[pick];
    const channel = ["r", "g", "b"][box.spans.indexOf(Math.max(...box.spans))];
    const sorted = box.points.slice().sort((a, b) => a[channel] - b[channel]);
    const half = box.weight / 2;
    let running = 0;
    let cut = sorted.length - 1;   // never leave one side empty
    for (let i = 0; i < sorted.length - 1; i++) {
      running += sorted[i].w;
      if (running >= half) { cut = i + 1; break; }
    }
    boxes.splice(pick, 1, boxStats(sorted.slice(0, cut)), boxStats(sorted.slice(cut)));
  }
  return boxes.map((box) => average(box.points));
}

/** 15-bit colour → palette index, computed once per distinct colour. */
export function makeMapper(palette) {
  const cache = new Int16Array(32768).fill(-1);
  return (key, r, g, b) => {
    let index = cache[key];
    if (index >= 0) return index;
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const dr = c[0] - r;
      const dg = c[1] - g;
      const db = c[2] - b;
      const distance = dr * dr + dg * dg + db * db;   // plain RGB is close enough here
      if (distance < bestDistance) { bestDistance = distance; best = i; if (!distance) break; }
    }
    cache[key] = best;
    return best;
  };
}

/** RGBA → palette indices, 255 where the pixel is (mostly) clear. */
export function toIndices(data, indices, map) {
  for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
    if (data[p + 3] < 128) { indices[i] = TRANSPARENT; continue; }
    const r = data[p], g = data[p + 1], b = data[p + 2];
    indices[i] = map(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), r, g, b);
  }
  return indices;
}

// ---------- writing ----------

class Bytes {
  constructor(size = 8192) {
    this.buf = new Uint8Array(size);
    this.len = 0;
  }
  reserve(n) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length || 1;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  byte(v) { this.reserve(1); this.buf[this.len++] = v; }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  write(bytes) { this.reserve(bytes.length); this.buf.set(bytes, this.len); this.len += bytes.length; }
  view() { return this.buf.subarray(0, this.len); }
}

const ascii = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

// Reused across frames: a fresh 4 MB dictionary per frame is pointless churn.
const dict = new Int32Array(4096 * 256);

/** LZW-compress one frame straight into the byte sink, in 255-byte blocks.
 *
 * The code width has to grow one code *after* the table passes the limit: the
 * decoder only learns about a new entry once it has read the following code,
 * so widening early desynchronises it. Same for the reset after a clear code.
 */
function writeLZW(indices, out) {
  const minSize = 8;
  const clear = 1 << minSize;
  const end = clear + 1;
  const maxBits = 12;

  dict.fill(-1);
  let next = end + 1;
  let size = minSize + 1;
  let maxCode = (1 << size) - 1;
  let clearing = false;
  let bits = 0;
  let bitBuffer = 0;
  const block = new Uint8Array(255);
  let blockLength = 0;

  const flush = () => {
    if (!blockLength) return;
    out.byte(blockLength);
    out.write(block.subarray(0, blockLength));
    blockLength = 0;
  };
  const push = (b) => {
    block[blockLength++] = b;
    if (blockLength === 255) flush();
  };
  const emit = (code) => {
    bitBuffer |= code << bits;
    bits += size;
    while (bits >= 8) {
      push(bitBuffer & 255);
      bitBuffer >>>= 8;
      bits -= 8;
    }
    if (clearing) {
      clearing = false;
      size = minSize + 1;
      maxCode = (1 << size) - 1;
    } else if (next > maxCode) {
      size++;
      maxCode = size === maxBits ? 1 << maxBits : (1 << size) - 1;
    }
  };

  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const code = dict[key];
    if (code >= 0) { prefix = code; continue; }
    emit(prefix);
    if (next < 1 << maxBits) {
      dict[key] = next++;
    } else {
      dict.fill(-1);
      next = end + 1;
      clearing = true;
      emit(clear);
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bits > 0) push(bitBuffer & 255);
  flush();
}

/**
 * Incremental GIF writer: header and palette now, one compressed frame per
 * `addFrame`, container closed by `finish`.
 */
export function createGIF({ width, height, palette, loop = true }) {
  const out = new Bytes(width * height);
  out.write(ascii("GIF89a"));
  out.u16(width);
  out.u16(height);
  out.byte(0xf7);          // global table, 8-bit codes, 256 entries
  out.byte(TRANSPARENT);   // background index
  out.byte(0);             // pixel aspect ratio
  for (let i = 0; i < 256; i++) {
    const colour = palette[i] || [0, 0, 0];
    out.byte(colour[0]);
    out.byte(colour[1]);
    out.byte(colour[2]);
  }
  if (loop) {
    out.write(ascii("!\xff\x0bNETSCAPE2.0\x03\x01"));
    out.u16(0);            // 0 = forever
    out.byte(0);
  }

  return {
    addFrame(indices, delayMs) {
      const delay = Math.max(2, Math.round(delayMs / 10));   // centiseconds
      out.write(ascii("!\xf9\x04"));
      out.byte(0x09);        // dispose to background + transparent index given
      out.u16(delay);
      out.byte(TRANSPARENT);
      out.byte(0);
      out.write(ascii(",\x00\x00\x00\x00"));
      out.u16(width);
      out.u16(height);
      out.byte(0);           // no local table, not interlaced
      out.byte(8);           // LZW minimum code size
      writeLZW(indices, out);
      out.byte(0);           // block terminator
      return delay;
    },
    finish() {
      out.byte(0x3b);
      return new Blob([out.view()], { type: "image/gif" });
    },
  };
}

export const TRANSPARENT_INDEX = TRANSPARENT;
