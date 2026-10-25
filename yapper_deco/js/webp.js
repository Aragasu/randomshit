// Animated WebP container.
//
// There is no animated-webp encoder in the browser, but `canvas.toBlob` does
// write a still WebP *with an alpha channel* — and an animation is just a set of
// those bitstreams in a different container. So each frame is encoded by the
// canvas and the ALPH/VP8 chunks are lifted out and dropped into ANMF chunks.
// No re-encoding, no quality loss beyond the still encode itself.

const RIFF = "RIFF";
const WEBP = "WEBP";

const ascii = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function readChunks(buffer) {
  const view = new DataView(buffer);
  const tag = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (tag !== RIFF) throw new Error("that frame isn't a WebP");
  const out = new Map();
  let offset = 12;   // "RIFF" + size + "WEBP"
  while (offset + 8 <= buffer.byteLength) {
    const type = String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > buffer.byteLength) break;
    out.set(type, { type, data: new Uint8Array(buffer, offset + 8, size) });
    offset += 8 + size + (size & 1);
  }
  return out;
}

function chunk(type, body) {
  const head = new Uint8Array(8);
  head.set(ascii(type), 0);
  new DataView(head.buffer).setUint32(4, body.length, true);
  const pad = body.length & 1 ? new Uint8Array(1) : new Uint8Array(0);
  const out = new Uint8Array(8 + body.length + pad.length);
  out.set(head, 0);
  out.set(body, 8);
  return out;
}

const u24 = (value) => new Uint8Array([value & 255, (value >> 8) & 255, (value >> 16) & 255]);

/**
 * Repack still WebP frames into an animated WebP.
 * `stills` are ArrayBuffers in display order; `frameMs` is the per-frame delay.
 */
export async function encodeAnimatedWebP(stills, { width, height, frameMs, loop = true }) {
  if (!stills.length) throw new Error("no frames to encode");

  const frames = stills.map((buffer) => {
    const chunks = readChunks(buffer);
    const alpha = chunks.get("ALPH");
    const image = chunks.get("VP8 ") || chunks.get("VP8L");
    if (!image) throw new Error("a frame came back as something other than WebP");
    // Rebuild rather than copy: source slices lose their padding, and every
    // chunk inside a RIFF container has to stay word aligned.
    return {
      alpha: alpha ? chunk(alpha.type, alpha.data) : null,
      image: chunk(image.type, image.data),
    };
  });

  const hasAlpha = frames.some((frame) => frame.alpha);
  // Round the running total rather than each frame, so 24 fps (41.7 ms) doesn't
  // turn into 42 ms a frame and stretch the loop.
  const delayFor = (i) => {
    const step = Math.round((i + 1) * frameMs) - Math.round(i * frameMs);
    return Math.min(0xffffff, Math.max(10, step));
  };

  const header = new Uint8Array(10);
  header[0] = 0x02 | (hasAlpha ? 0x10 : 0x00);   // animation, maybe alpha
  header.set(u24(width - 1), 4);
  header.set(u24(height - 1), 7);
  const parts = [chunk("VP8X", header)];

  const anim = new Uint8Array(6);                 // background: transparent
  new DataView(anim.buffer).setUint16(4, loop ? 0 : 1, true);
  parts.push(chunk("ANIM", anim));

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const anmf = new Uint8Array(16);
    anmf.set(u24(0), 0);            // x (÷2)
    anmf.set(u24(0), 3);            // y (÷2)
    anmf.set(u24(width - 1), 6);
    anmf.set(u24(height - 1), 9);
    anmf.set(u24(delayFor(i)), 12);
    anmf[15] = 0x02;                // do not blend: each frame replaces the last
    const body = [anmf];
    if (frame.alpha) body.push(frame.alpha);
    body.push(frame.image);
    parts.push(chunk("ANMF", concat(body)));
  }

  const payload = concat(parts);
  const file = new Uint8Array(12 + payload.length);
  file.set(ascii(RIFF), 0);
  new DataView(file.buffer).setUint32(4, 4 + payload.length, true);
  file.set(ascii(WEBP), 8);
  file.set(payload, 12);
  return new Blob([file], { type: "image/webp" });
}

function concat(parts) {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
