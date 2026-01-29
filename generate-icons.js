// Generates pixel-art PNG icons for the BrowserCLI extension
// Design: terminal prompt ">_" inside a rounded tab shape, green-on-dark retro terminal aesthetic
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

// --- Minimal PNG encoder ---
function createPNG(width, height, pixels) {
  // pixels is a flat array of [r, g, b, a] per pixel, row by row
  // Build raw image data with filter byte 0 (None) per row
  const raw = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[offset++] = pixels[i];
      raw[offset++] = pixels[i + 1];
      raw[offset++] = pixels[i + 2];
      raw[offset++] = pixels[i + 3];
    }
  }

  const compressed = zlib.deflateSync(raw);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const buf = Buffer.alloc(4 + 4 + data.length + 4);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    const crcData = Buffer.alloc(4 + data.length);
    crcData.write(type, 0, 4, 'ascii');
    data.copy(crcData, 4);
    buf.writeUInt32BE(crc32(crcData) >>> 0, 8 + data.length);
    return buf;
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = compressed instanceof Buffer ? compressed : Buffer.from(compressed);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend),
  ]);
}

// CRC32 lookup table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return crc ^ 0xffffffff;
}

// --- Icon Drawing ---

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  function setPixel(x, y, r, g, b, a = 255) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    // Alpha blend
    const srcA = a / 255;
    const dstA = pixels[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    pixels[i] = Math.round((r * srcA + pixels[i] * dstA * (1 - srcA)) / outA);
    pixels[i + 1] = Math.round((g * srcA + pixels[i + 1] * dstA * (1 - srcA)) / outA);
    pixels[i + 2] = Math.round((b * srcA + pixels[i + 2] * dstA * (1 - srcA)) / outA);
    pixels[i + 3] = Math.round(outA * 255);
  }

  function fillRect(x, y, w, h, r, g, b, a = 255) {
    for (let dy = 0; dy < h; dy++)
      for (let dx = 0; dx < w; dx++) setPixel(x + dx, y + dy, r, g, b, a);
  }

  function fillCircle(cx, cy, radius, r, g, b, a = 255) {
    for (let y = -radius; y <= radius; y++)
      for (let x = -radius; x <= radius; x++)
        if (x * x + y * y <= radius * radius) setPixel(cx + x, cy + y, r, g, b, a);
  }

  function fillRoundRect(x, y, w, h, rad, r, g, b, a = 255) {
    fillRect(x + rad, y, w - 2 * rad, h, r, g, b, a);
    fillRect(x, y + rad, w, h - 2 * rad, r, g, b, a);
    fillCircle(x + rad, y + rad, rad, r, g, b, a);
    fillCircle(x + w - rad - 1, y + rad, rad, r, g, b, a);
    fillCircle(x + rad, y + h - rad - 1, rad, r, g, b, a);
    fillCircle(x + w - rad - 1, y + h - rad - 1, rad, r, g, b, a);
  }

  const s = size;

  // Colors
  const bg = [24, 24, 32];         // dark background
  const tabBg = [35, 38, 52];      // tab body
  const border = [80, 200, 120];   // green accent border
  const green = [0, 255, 120];     // bright terminal green
  const dimGreen = [0, 180, 80];   // dimmer green
  const glow = [0, 255, 120, 40];  // green glow

  // Rounded background
  const r = Math.max(2, Math.floor(s * 0.15));
  fillRoundRect(0, 0, s, s, r, ...bg);

  // Tab shape at top — a small raised tab
  const tabW = Math.floor(s * 0.55);
  const tabH = Math.max(2, Math.floor(s * 0.18));
  const tabX = Math.floor((s - tabW) / 2);
  const tabY = Math.max(1, Math.floor(s * 0.08));
  const tabR = Math.max(1, Math.floor(s * 0.06));
  fillRoundRect(tabX, tabY, tabW, tabH, tabR, ...border);

  // Terminal body below tab
  const bodyMargin = Math.max(1, Math.floor(s * 0.1));
  const bodyTop = tabY + tabH - 1;
  const bodyH = s - bodyTop - bodyMargin;
  const bodyR = Math.max(1, Math.floor(s * 0.08));
  fillRoundRect(bodyMargin, bodyTop, s - 2 * bodyMargin, bodyH, bodyR, ...tabBg);

  // Border on terminal body
  const bw = Math.max(1, Math.floor(s * 0.04));
  for (let i = 0; i < bw; i++) {
    // top
    fillRect(bodyMargin + bodyR, bodyTop + i, s - 2 * bodyMargin - 2 * bodyR, 1, ...border);
    // bottom
    fillRect(bodyMargin + bodyR, bodyTop + bodyH - 1 - i, s - 2 * bodyMargin - 2 * bodyR, 1, ...border);
    // left
    fillRect(bodyMargin + i, bodyTop + bodyR, 1, bodyH - 2 * bodyR, ...border);
    // right
    fillRect(s - bodyMargin - 1 - i, bodyTop + bodyR, 1, bodyH - 2 * bodyR, ...border);
  }

  // Draw ">_" prompt inside the terminal body
  const promptAreaX = bodyMargin + Math.max(2, Math.floor(s * 0.15));
  const promptAreaY = bodyTop + Math.max(2, Math.floor(bodyH * 0.25));

  if (s >= 48) {
    // Larger icons: draw a proper ">_" with pixel font
    const px = Math.max(1, Math.floor(s / 16)); // pixel size

    // ">" chevron
    const cx = promptAreaX;
    const cy = promptAreaY;
    const chevronH = Math.max(3, Math.floor(s * 0.22));
    const mid = Math.floor(chevronH / 2);
    for (let i = 0; i <= mid; i++) {
      fillRect(cx + i * px, cy + i * px, px, px, ...green);
    }
    for (let i = 0; i <= mid; i++) {
      fillRect(cx + (mid - i) * px, cy + (mid + i) * px, px, px, ...green);
    }

    // "_" underscore / cursor
    const ux = cx + (mid + 2) * px;
    const uy = cy + chevronH * px;
    const cursorW = Math.max(2, Math.floor(s * 0.15));
    fillRect(ux, uy, cursorW, px, ...green);

    // Blinking cursor block
    const cursorX = ux + cursorW + px;
    const cursorBlockH = Math.max(2, Math.floor(s * 0.12));
    fillRect(cursorX, uy - cursorBlockH + px, px + 1, cursorBlockH, ...green);

    // Scanline effect (subtle horizontal lines)
    for (let y = bodyTop + 2; y < bodyTop + bodyH - 2; y += 2) {
      fillRect(bodyMargin + bw, y, s - 2 * bodyMargin - 2 * bw, 1, 0, 0, 0, 25);
    }
  } else {
    // Small icons (16px): simplified design
    const px = 1;

    // Simple ">"
    const cx = promptAreaX;
    const cy = promptAreaY;
    setPixel(cx, cy, ...green);
    setPixel(cx + 1, cy + 1, ...green);
    setPixel(cx, cy + 2, ...green);

    // "_" cursor
    setPixel(cx + 3, cy + 2, ...green);
    setPixel(cx + 4, cy + 2, ...green);

    // Cursor block
    setPixel(cx + 6, cy + 1, ...green);
    setPixel(cx + 6, cy + 2, ...green);
  }

  // Green glow at bottom
  const glowY = bodyTop + bodyH - Math.max(2, Math.floor(s * 0.12));
  for (let y = glowY; y < bodyTop + bodyH - bw; y++) {
    const alpha = Math.floor(20 * (1 - (y - glowY) / (bodyTop + bodyH - bw - glowY)));
    fillRect(bodyMargin + bw + 1, y, s - 2 * bodyMargin - 2 * bw - 2, 1, 0, 255, 120, alpha);
  }

  return Buffer.from(pixels);
}

// Generate all three sizes
const sizes = [16, 48, 128];
const outDir = path.join(__dirname, 'extension', 'icons');

for (const size of sizes) {
  const pixels = drawIcon(size);
  const png = createPNG(size, size, pixels);
  const outPath = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`Generated ${outPath} (${png.length} bytes)`);
}
