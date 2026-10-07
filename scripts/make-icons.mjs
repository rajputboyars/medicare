// Generates PNG app icons (brand green + white medical cross) without any image dependency.
// Outputs: icon-192, icon-512 (rounded "any"), icon-maskable-512 (full-bleed, safe-zone padded), apple-touch-icon (180), rider-192/512.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

function crc32(buf) {
  let c, crc = ~0;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** opts: rounded (transparent corners), crossScale (maskable icons keep the cross inside the 80% safe zone), bg, badge (small bike dot for rider) */
function png(size, { rounded = true, crossScale = 1, bg = [15, 118, 110], badge = false } = {}) {
  const rows = [];
  const r = size * 0.22, arm = size * 0.11 * crossScale, len = size * 0.3 * crossScale, c = size / 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const dx = Math.max(Math.abs(x - c) - (c - r), 0), dy = Math.max(Math.abs(y - c) - (c - r), 0);
      const inside = !rounded || dx * dx + dy * dy <= r * r;
      const cross = (Math.abs(x - c) <= arm && Math.abs(y - c) <= len) || (Math.abs(y - c) <= arm && Math.abs(x - c) <= len);
      const dot = badge && (x - size * 0.76) ** 2 + (y - size * 0.76) ** 2 <= (size * 0.13) ** 2;
      const o = 1 + x * 4;
      if (!inside) { row[o + 3] = 0; continue; }
      const [R, G, B] = dot ? [250, 204, 21] : cross ? [255, 255, 255] : bg;
      row[o] = R; row[o + 1] = G; row[o + 2] = B; row[o + 3] = 255;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
const out = {
  "icon-192.png": png(192),
  "icon-512.png": png(512),
  "icon-maskable-512.png": png(512, { rounded: false, crossScale: 0.78 }),
  "apple-touch-icon.png": png(180, { rounded: false, crossScale: 0.9 }), // iOS rounds the corners itself
  "rider-192.png": png(192, { badge: true, bg: [13, 95, 89] }),
  "rider-512.png": png(512, { badge: true, bg: [13, 95, 89] }),
  "rider-maskable-512.png": png(512, { rounded: false, crossScale: 0.78, badge: true, bg: [13, 95, 89] }),
};
for (const [name, buf] of Object.entries(out)) writeFileSync(`public/icons/${name}`, buf);
console.log("icons written:", Object.keys(out).join(", "));
