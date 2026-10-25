// APNG decoder — the browser will animate an animated PNG inside an <img>,
// but a canvas only ever sees frame 0. Discord's decorations are APNGs, so to
// move them on the stage (and into the APNG we export) we have to pull the
// frames out ourselves.
//
// Supports the shapes Discord and other tools produce: colour types 0/2/3/4/6,
// 8-bit (palette at 1/2/4/8), non-interlaced, with per-frame rects, blend and
// dispose ops. Anything outside that returns null so the caller can fall back
// to the still first frame instead of drawing garbage.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function readChunks(bytes) {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const chunks = [];
  let i = 8;
  while (i + 8 <= bytes.length) {
    const length = (bytes[i] << 24 | bytes[i + 1] << 16 | bytes[i + 2] << 8 | bytes[i + 3]) >>> 0;
    if (i + 12 + length > bytes.length) break;
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    chunks.push({ type, data: bytes.subarray(i + 8, i + 8 + length) });
    i += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

async function inflate(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { joined.set(part, offset); offset += part.length; }
  if (typeof DecompressionStream === "undefined") throw new Error("this browser can't unzip the animation");
  const stream = new Blob([joined]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undo the per-scanline filters. `bpp` is bytes per complete pixel for the
 *  left-hand predictor; `strideOverride` is bytes per row, which differs from
 *  `width * bpp` at sub-byte depths (a 4-bit palette row is width/2 bytes). */
function unfilter(raw, width, height, bpp, strideOverride) {
  const stride = strideOverride ?? width * bpp;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const dest = out.subarray(y * stride, (y + 1) * stride);
    const prior = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? dest[x - bpp] : 0;
      const b = prior ? prior[x] : 0;
      const c = prior && x >= bpp ? prior[x - bpp] : 0;
      let value = line[x];
      switch (filter) {
        case 0: break;
        case 1: value += a; break;
        case 2: value += b; break;
        case 3: value += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      dest[x] = value & 0xff;
    }
  }
  return out;
}

/** Turn one unfiltered frame into RGBA bytes laid out at rect size. */
function toRGBA(rows, width, height, { depth, colour, palette, alpha, key }) {
  const out = new Uint8ClampedArray(width * height * 4);
  const channels = CHANNELS[colour];

  if (colour === 3) {
    const mask = (1 << depth) - 1;
    for (let y = 0; y < height; y++) {
      const row = y * Math.ceil((width * depth) / 8);
      for (let x = 0; x < width; x++) {
        const bit = x * depth;
        const byte = rows[row + (bit >> 3)];
        const shift = 8 - depth - (bit & 7);
        const index = (byte >> shift) & mask;
        const o = (y * width + x) * 4;
        out[o] = palette[index * 3] ?? 0;
        out[o + 1] = palette[index * 3 + 1] ?? 0;
        out[o + 2] = palette[index * 3 + 2] ?? 0;
        out[o + 3] = alpha ? (alpha[index] ?? 255) : 255;
      }
    }
    return out;
  }

  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    const o = p * 4;
    if (colour === 0 || colour === 4) {
      const grey = rows[i];
      const transparent = colour === 0 && key && grey === key[0];
      out[o] = grey; out[o + 1] = grey; out[o + 2] = grey;
      out[o + 3] = transparent ? 0 : colour === 4 ? rows[i + 1] : 255;
    } else {
      out[o] = rows[i]; out[o + 1] = rows[i + 1]; out[o + 2] = rows[i + 2];
      out[o + 3] = colour === 6 ? rows[i + 3]
        : key && rows[i] === key[0] && rows[i + 1] === key[1] && rows[i + 2] === key[2] ? 0 : 255;
    }
  }
  return out;
}

function blendInto(canvas, frame, rect, blend, canvasWidth) {
  const { x, y, w, h } = rect;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const src = (row * w + col) * 4;
      const a = frame[src + 3];
      if (blend === 1 && a === 0) continue;
      const dest = ((y + row) * canvasWidth + (x + col)) * 4;
      if (blend === 0 || a === 255) {
        canvas[dest] = frame[src];
        canvas[dest + 1] = frame[src + 1];
        canvas[dest + 2] = frame[src + 2];
        canvas[dest + 3] = a;
        continue;
      }
      const sa = a / 255;
      const da = canvas[dest + 3] / 255;
      const outA = sa + da * (1 - sa);
      canvas[dest] = (frame[src] * sa + canvas[dest] * da * (1 - sa)) / outA;
      canvas[dest + 1] = (frame[src + 1] * sa + canvas[dest + 1] * da * (1 - sa)) / outA;
      canvas[dest + 2] = (frame[src + 2] * sa + canvas[dest + 2] * da * (1 - sa)) / outA;
      canvas[dest + 3] = outA * 255;
    }
  }
}

export async function decodeAPNG(bytes) {
  const chunks = readChunks(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!chunks) throw new Error("not a PNG");

  let width = 0, height = 0, depth = 8, colour = 6, interlace = 0;
  let palette = null, alpha = null, key = null;
  let frameCount = 0;
  const frames = [];
  let current = null;

  for (const { type, data } of chunks) {
    if (type === "IHDR") {
      width = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0;
      height = (data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]) >>> 0;
      depth = data[8];
      colour = data[9];
      interlace = data[12];
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      if (colour === 3) alpha = data;
      else if (colour === 0) key = [data[1]];
      else if (colour === 2) key = [data[1], data[3], data[5]];
    } else if (type === "acTL") {
      frameCount = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0;
    } else if (type === "fcTL") {
      const num = (data[20] << 8 | data[21]);
      const den = (data[22] << 8 | data[23]) || 100;
      current = {
        x: (data[12] << 24 | data[13] << 16 | data[14] << 8 | data[15]) >>> 0,
        y: (data[16] << 24 | data[17] << 16 | data[18] << 8 | data[19]) >>> 0,
        w: (data[4] << 24 | data[5] << 16 | data[6] << 8 | data[7]) >>> 0,
        h: (data[8] << 24 | data[9] << 16 | data[10] << 8 | data[11]) >>> 0,
        delay: Math.max(10, Math.round((num / den) * 1000)),
        dispose: data[24],
        blend: data[25],
        parts: [],
      };
      frames.push(current);
    } else if (type === "IDAT" || type === "fdAT") {
      const body = type === "fdAT" ? data.subarray(4) : data;
      if (!current) {
        current = { x: 0, y: 0, w: width, h: height, delay: 100, dispose: 0, blend: 0, parts: [] };
        frames.push(current);
      }
      current.parts.push(body);
    }
  }

  if (frameCount === 0 || frames.length < 2) return null;
  if (interlace !== 0) throw new Error("interlaced PNG");
  if (depth === 16) throw new Error("16-bit PNG");
  if (!CHANNELS[colour]) throw new Error(`colour type ${colour}`);

  const bpp = Math.max(1, Math.ceil((CHANNELS[colour] * depth) / 8));
  const canvas = new Uint8ClampedArray(width * height * 4);
  const out = [];
  let duration = 0;

  for (const frame of frames) {
    if (frame.parts.length === 0) continue;
    const raw = await inflate(frame.parts);
    // Rows are `frame.w` wide, which for sub-byte palette depths isn't `frame.w` bytes.
    const rowBytes = Math.ceil((frame.w * CHANNELS[colour] * depth) / 8);
    const rows = unfilter(raw, frame.w, frame.h, bpp, rowBytes);
    const rgba = toRGBA(rows, frame.w, frame.h, { depth, colour, palette, alpha, key });
    const rect = { x: frame.x, y: frame.y, w: frame.w, h: frame.h };
    // dispose=2 restores what was under this frame afterwards, so keep a copy
    const before = frame.dispose === 2 ? capture(canvas, rect, width) : null;

    blendInto(canvas, rgba, rect, frame.blend, width);

    const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(canvas), width, height));
    out.push({ bitmap, delay: frame.delay });
    duration += frame.delay;

    if (frame.dispose === 1) clear(canvas, rect, width);
    else if (frame.dispose === 2 && before) restore(canvas, before, rect, width);
  }

  if (out.length === 0) return null;
  return { width, height, frames: out, duration };
}

function capture(canvas, { x, y, w, h }, canvasWidth) {
  const copy = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * canvasWidth + x) * 4;
    copy.set(canvas.subarray(from, from + w * 4), row * w * 4);
  }
  return copy;
}

function restore(canvas, copy, { x, y, w, h }, canvasWidth) {
  for (let row = 0; row < h; row++) {
    canvas.set(copy.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * canvasWidth + x) * 4);
  }
}

function clear(canvas, { x, y, w, h }, canvasWidth) {
  for (let row = 0; row < h; row++) {
    canvas.fill(0, ((y + row) * canvasWidth + x) * 4, ((y + row) * canvasWidth + x + w) * 4);
  }
}

/** Loop length without decoding: frame count plus the summed frame delays.
 *  Used to label presets in the browser without paying for a full decode. */
export function apngTiming(bytes) {
  const chunks = readChunks(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (!chunks) return null;
  let frames = 0;
  let total = 0;
  for (const { type, data } of chunks) {
    if (type === "acTL") {
      frames = (data[0] << 24 | data[1] << 16 | data[2] << 8 | data[3]) >>> 0;
    } else if (type === "fcTL") {
      const num = data[20] << 8 | data[21];
      const den = (data[22] << 8 | data[23]) || 100;
      total += Math.max(10, Math.round((num / den) * 1000));
    }
  }
  return frames > 1 && total > 0 ? { frames, ms: total } : null;
}

/** Which frame is showing at `time` ms into the loop. */
export function frameAt(anim, time) {
  if (!anim || anim.frames.length === 0) return null;
  if (anim.frames.length === 1) return anim.frames[0].bitmap;
  const looped = ((time % anim.duration) + anim.duration) % anim.duration;
  let elapsed = 0;
  for (const frame of anim.frames) {
    elapsed += frame.delay;
    if (looped < elapsed) return frame.bitmap;
  }
  return anim.frames[anim.frames.length - 1].bitmap;
}
