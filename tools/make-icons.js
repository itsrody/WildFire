/* Generate flat PNG icons without any third-party dependencies. */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SIZES = [16, 32, 48, 96, 128];
const SUPERSAMPLE = 4;

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function encodePNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  let position = 0;
  for (let y = 0; y < height; y++) {
    raw[position++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      raw[position++] = pixels[index];
      raw[position++] = pixels[index + 1];
      raw[position++] = pixels[index + 2];
      raw[position++] = pixels[index + 3];
    }
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function sample(nx, ny) {
  const dx = nx - 0.5;
  const body = Math.pow(dx / 0.31, 2) + Math.pow((ny - 0.66) / 0.30, 2) <= 1;
  const tip = ny >= 0.08 && ny <= 0.62 && Math.abs(dx) <= (ny - 0.08) * 0.58;
  if (!body && !tip) return null;

  const core = Math.pow(dx / 0.15, 2) + Math.pow((ny - 0.72) / 0.19, 2) <= 1;
  return core
    ? [255, 214, 87]
    : [242 - Math.round(ny * 30), 104 - Math.round(ny * 50), 32];
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let red = 0, green = 0, blue = 0, coverage = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const nx = (x + (sx + 0.5) / SUPERSAMPLE) / size;
          const ny = (y + (sy + 0.5) / SUPERSAMPLE) / size;
          const color = sample(nx, ny);
          if (!color) continue;
          red += color[0];
          green += color[1];
          blue += color[2];
          coverage++;
        }
      }
      const index = (y * size + x) * 4;
      const count = SUPERSAMPLE * SUPERSAMPLE;
      pixels[index] = coverage ? Math.round(red / coverage) : 0;
      pixels[index + 1] = coverage ? Math.round(green / coverage) : 0;
      pixels[index + 2] = coverage ? Math.round(blue / coverage) : 0;
      pixels[index + 3] = Math.round((coverage / count) * 255);
    }
  }
  return encodePNG(size, size, pixels);
}

const outDir = path.join(ROOT, 'assets');
fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log('wrote', path.relative(ROOT, file));
}
