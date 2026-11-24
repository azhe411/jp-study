// 生成全部图标（纯 Node，无依赖）：山手线黄绿底 + 一条轨道（一）上的一个站（駅）。
//   public/                 PWA 图标与 favicon
//   android/…/res/          安卓启动图标（传统 / 圆形 / 自适应前景）与启动图（工程存在时）
//   scripts/icon-1024.png   Tauri 图标源图（npx tauri icon 用它生成 .ico 等）
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const GO = [0x80, 0xc2, 0x41];
const INK = [0x10, 0x20, 0x06];
const WHITE = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const aa = (d) => Math.max(0, Math.min(1, 0.5 - d)); // 1px 抗锯齿

/**
 * w×h 画布。shape：'square'（满版）| 'rounded'（圆角矩形）| 'circle'（圆形外轮廓）| 'none'（透明底）
 * sun：站点圆环外半径占短边的比例（轨道长度与粗细随之缩放）
 *
 * 图案就是名字本身：「一」是一条轨道，「駅」是轨道上的一个站。
 */
function png(w, h, { shape = 'square', corner = 0.22, sun = 0.27 } = {}) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const m = Math.min(w, h), cx = w / 2, cy = h / 2, rc = corner * m;
  const ringR = sun * m * 0.62, ringW = sun * m * 0.2, barHalfLen = sun * m * 1.55, barHalfH = sun * m * 0.17;
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const px = x + 0.5, py = y + 0.5;
      let a = 1;
      if (shape === 'none') a = 0;
      else if (shape === 'circle') a = aa(Math.hypot(px - cx, py - cy) - m / 2);
      else if (shape === 'rounded') {
        const qx = Math.max(rc - px, px - (w - rc), 0), qy = Math.max(rc - py, py - (h - rc), 0);
        a = aa(Math.hypot(qx, qy) - rc);
      }
      let col = GO;
      // 逐层"盖上去"：轨道 → 站点外圈 → 站点白芯
      const over = (c, t) => {
        if (t <= 0) return;
        const na = t + a * (1 - t);
        col = col.map((v, i) => (v * a * (1 - t) + c[i] * t) / (na || 1));
        a = na;
      };
      const d = Math.hypot(px - cx, py - cy);
      const bx = Math.max(Math.abs(px - cx) - barHalfLen, 0);
      over(INK, aa(Math.hypot(bx, py - cy) - barHalfH));
      over(INK, aa(d - ringR - ringW / 2));
      over(WHITE, aa(d - ringR + ringW / 2));
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(col[0]); raw[o + 1] = Math.round(col[1]); raw[o + 2] = Math.round(col[2]); raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const sizeOf = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

/* ───────────── PWA ───────────── */
const pub = new URL('../public/', import.meta.url);
writeFileSync(new URL('pwa-192.png', pub), png(192, 192, { shape: 'rounded' }));
writeFileSync(new URL('pwa-512.png', pub), png(512, 512, { shape: 'rounded' }));
writeFileSync(new URL('pwa-maskable-512.png', pub), png(512, 512, { sun: 0.22 }));
writeFileSync(new URL('apple-touch-icon.png', pub), png(180, 180, { sun: 0.26 }));
writeFileSync(
  new URL('favicon.svg', pub),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#80c241"/><rect x="6.6" y="29.1" width="50.8" height="5.8" rx="2.9" fill="#102006"/><circle cx="32" cy="32" r="10.7" fill="#fff" stroke="#102006" stroke-width="3.5"/></svg>\n`,
);

/* ───────────── Tauri 源图 ───────────── */
writeFileSync(new URL('./icon-1024.png', import.meta.url), png(1024, 1024, { shape: 'rounded', corner: 0.2 }));

/* ───────────── 安卓 ───────────── */
const res = new URL('../android/app/src/main/res/', import.meta.url);
if (existsSync(res)) {
  const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(LEGACY)) {
    const dir = new URL(`mipmap-${d}/`, res);
    writeFileSync(new URL('ic_launcher.png', dir), png(s, s, { shape: 'rounded' }));
    writeFileSync(new URL('ic_launcher_round.png', dir), png(s, s, { shape: 'circle' }));
    // 自适应图标前景：108dp 画布，系统只保证中央 66dp 可见，图案放在安全区内
    const f = Math.round((s * 108) / 48);
    writeFileSync(new URL('ic_launcher_foreground.png', dir), png(f, f, { shape: 'none', sun: 0.19 }));
  }
  writeFileSync(
    new URL('values/ic_launcher_background.xml', res),
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#80C241</color>\n</resources>\n`,
  );
  // 启动图：保持模板原有尺寸，只换内容
  for (const d of readdirSync(res).filter((n) => n.startsWith('drawable'))) {
    const file = new URL(`${d}/splash.png`, res);
    if (!existsSync(file)) continue;
    const [w, h] = sizeOf(file);
    writeFileSync(file, png(w, h, { sun: 0.09 }));
  }
}
console.log('icons written');
