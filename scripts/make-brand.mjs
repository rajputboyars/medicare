// Renders every raster brand asset from the master SVGs using a local Chrome (puppeteer-core).
//   npm run brand            (set CHROME_PATH if Chrome is not in a standard location)
// Outputs: public/icons/*.png (app icons, maskable, Apple), public/favicon.ico (16/32/48), public/brand/*.png (logo, OG image).
import puppeteer from "puppeteer-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const CHROME = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && existsSync(p));
if (!CHROME) throw new Error("Chrome not found. Set CHROME_PATH.");

const TEAL = "#0f766e", RIDER = "#0d5f59", AMBER = "#f59e0b";
const PIN = "M32 8.5c-10.7 0-18.8 8.1-18.8 18.5 0 12.7 13.9 25 17.8 28.5a1.5 1.5 0 0 0 2 0c3.9-3.5 17.8-15.8 17.8-28.5C50.8 16.6 42.7 8.5 32 8.5z";
const CROSS = "M28.6 18.2h6.8v6.9h6.9v6.8h-6.9v6.9h-6.8v-6.9h-6.9v-6.8h6.9z";
const PIN_BIG = "M32 7.5c-11 0-19.3 8.3-19.3 19 0 13.1 14.3 25.7 18.3 29.3a1.5 1.5 0 0 0 2 0c4-3.6 18.3-16.2 18.3-29.3 0-10.7-8.3-19-19.3-19z";
const CROSS_BIG = "M28.2 17.4h7.6v7.5h7.5v7.6h-7.5V40h-7.6v-7.5h-7.5v-7.6h7.5z";

/** Mark as an SVG string. scale<1 shrinks the pin inside a full-bleed square (maskable / Apple icons). */
function mark({ bg = TEAL, rx = 14, scale = 1, big = false, badge = false, shadow = true } = {}) {
  const t = scale === 1 ? "" : ` transform="translate(${32 - 32 * scale} ${32 - 32 * scale}) scale(${scale})"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%">
    <rect width="64" height="64" rx="${rx}" fill="${bg}"/>
    <g${t}>${shadow && !big ? `<ellipse cx="32" cy="58.4" rx="8.5" ry="2" fill="${AMBER}"/>` : ""}
    <path d="${big ? PIN_BIG : PIN}" fill="#fff"/><path d="${big ? CROSS_BIG : CROSS}" fill="${bg}"/></g>
    ${badge ? `<circle cx="51" cy="51" r="9" fill="${AMBER}" stroke="${bg}" stroke-width="2.5"/><path d="M47.5 51.2l2.4 2.4 4.4-4.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
  </svg>`;
}

/** White tile with a teal pin: the mark inverted for use on the brand-green OG background. */
const inverseMark = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%"><rect width="64" height="64" rx="14" fill="#fff"/>
  <ellipse cx="32" cy="58.4" rx="8.5" ry="2" fill="${AMBER}"/><path d="${PIN}" fill="${TEAL}"/><path d="${CROSS}" fill="#fff"/></svg>`;

const jobs = [];
const add = (file, w, h, html, transparent = true) => jobs.push({ file, w, h, html, transparent });
const box = (svg, w, h) => `<div style="width:${w}px;height:${h}px">${svg}</div>`;

// App icons
add("public/icons/icon-192.png", 192, 192, box(mark(), 192, 192));
add("public/icons/icon-512.png", 512, 512, box(mark(), 512, 512));
add("public/icons/icon-maskable-512.png", 512, 512, box(mark({ rx: 0, scale: 0.7 }), 512, 512), false);
add("public/icons/apple-touch-icon.png", 180, 180, box(mark({ rx: 0, scale: 0.82 }), 180, 180), false);
add("public/icons/rider-192.png", 192, 192, box(mark({ bg: RIDER, badge: true }), 192, 192));
add("public/icons/rider-512.png", 512, 512, box(mark({ bg: RIDER, badge: true }), 512, 512));
add("public/icons/rider-maskable-512.png", 512, 512, box(mark({ bg: RIDER, rx: 0, scale: 0.7, badge: true }), 512, 512), false);
// Favicon sizes (bolder pin, no shadow: legible at 16px)
for (const s of [16, 32, 48]) add(`.tmp/favicon-${s}.png`, s, s, box(mark({ big: true, rx: Math.round(14) }), s, s));
// Brand files
add("public/brand/logo-mark-512.png", 512, 512, box(mark(), 512, 512));
const lockup = (file, scheme) => readFileSync(file, "utf8").replace("<svg ", `<svg width="960" height="256" `).replace(scheme, scheme);
add("public/brand/logo-lockup.png", 960, 256, lockup("public/brand/logo-lockup.svg", ""));
add("public/brand/logo-lockup-dark.png", 960, 256, `<div style="background:#0e1a1f;width:960px;height:256px;display:grid;place-items:center">${lockup("public/brand/logo-lockup-dark.svg", "")}</div>`, false);
add("public/brand/og.png", 1200, 630, `
  <div style="width:1200px;height:630px;background:linear-gradient(135deg,#0f766e,#0b4a47);color:#fff;font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;display:flex;align-items:center;gap:56px;padding:0 88px;box-sizing:border-box">
    <div style="width:232px;height:232px;flex:none">${inverseMark()}</div>
    <div>
      <div style="font-size:112px;font-weight:800;letter-spacing:-3px;line-height:1">Dawa<span style="color:#5eead4">Dost</span></div>
      <div style="font-size:40px;font-weight:600;margin-top:18px;color:#d5f2ea">Medicines, delivered locally.</div>
      <div style="font-size:28px;margin-top:26px;color:#a9e3d3">Verified nearby pharmacies · prescription checked · delivered to your door</div>
    </div>
  </div>`, false);

mkdirSync(".tmp", { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=1"] });
const page = await browser.newPage();
for (const j of jobs) {
  await page.setViewport({ width: j.w, height: j.h, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${j.html}</body></html>`);
  await page.screenshot({ path: j.file, omitBackground: j.transparent, clip: { x: 0, y: 0, width: j.w, height: j.h } });
}
await browser.close();

// ICO container (PNG-compressed entries): 16, 32, 48
const sizes = [16, 32, 48];
const pngs = sizes.map((s) => readFileSync(`.tmp/favicon-${s}.png`));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = Buffer.concat(sizes.map((s, i) => {
  const e = Buffer.alloc(16); e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length; return e;
}));
writeFileSync("public/favicon.ico", Buffer.concat([head, dir, ...pngs]));
console.log(`brand assets written (${jobs.length} images + favicon.ico)`);
