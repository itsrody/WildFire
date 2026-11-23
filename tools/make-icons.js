/* Generate flat PNG icons without any third-party dependencies. */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SIZES = [16, 32, 48, 96, 128];
const SUPERSAMPLE = 4;

function crc32(buffer) {
  const mixByte = (crc, byte) => Array.from({ length: 8 })
    .reduce(value => (value >>> 1) ^ (0xEDB88320 & -(value & 1)), crc ^ byte);
  return (~buffer.reduce(mixByte, ~0)) >>> 0;
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
  const raw = Buffer.concat(Array.from({ length: height }, (_, y) => {
    const row = Buffer.alloc(stride);
    row[0] = 0; // filter: none
    Array.from({ length: width }, (_, x) => {
      const source = (y * width + x) * 4;
      const target = x * 4 + 1;
      row[target] = pixels[source];
      row[target + 1] = pixels[source + 1];
      row[target + 2] = pixels[source + 2];
      row[target + 3] = pixels[source + 3];
    });
    return row;
  }));

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

function pixelColor(x, y, size) {
  const samples = Array.from({ length: SUPERSAMPLE }, (_, sy) =>
    Array.from({ length: SUPERSAMPLE }, (_, sx) =>
      sample((x + (sx + 0.5) / SUPERSAMPLE) / size, (y + (sy + 0.5) / SUPERSAMPLE) / size)
    )
  ).flat().filter(Boolean);

  if (!samples.length) return [0, 0, 0, 0];

  const sum = samples.reduce(
    (total, color) => [total[0] + color[0], total[1] + color[1], total[2] + color[2]],
    [0, 0, 0]
  );
  return [
    Math.round(sum[0] / samples.length),
    Math.round(sum[1] / samples.length),
    Math.round(sum[2] / samples.length),
    Math.round((samples.length / (SUPERSAMPLE * SUPERSAMPLE)) * 255)
  ];
}

function render(size) {
  const pixels = Buffer.from(
    Array.from({ length: size }, (_, y) =>
      Array.from({ length: size }, (_, x) => pixelColor(x, y, size))
    ).flat(2)
  );
  return encodePNG(size, size, pixels);
}

const outDir = path.join(ROOT, 'assets');
fs.mkdirSync(outDir, { recursive: true });
SIZES.forEach(size => {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log('wrote', path.relative(ROOT, file));
});
