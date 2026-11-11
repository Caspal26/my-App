// Generates the site's original, licence-free artwork as SVG files.
// Run once with `node website/tools/make-art.mjs`; output goes to website/src/assets/img.
// Replace any file with a real photograph (same name, or update the page) whenever you like.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'img');
mkdirSync(out, { recursive: true });

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r1 = (n) => Math.round(n * 10) / 10;
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">${body}</svg>\n`;
const save = (name, content) => writeFileSync(join(out, name), content);

// 1. City skyline at dusk
function skyline() {
  const R = rng(11), W = 1600, H = 900, base = 742;
  let b = `<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#14081f"/><stop offset=".42" stop-color="#3a1a55"/><stop offset=".72" stop-color="#b0705a"/><stop offset=".86" stop-color="#e6ac72"/><stop offset="1" stop-color="#f3d39a"/></linearGradient>
<radialGradient id="sun" cx="1080" cy="700" r="460" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#ffe2a6" stop-opacity=".95"/><stop offset=".25" stop-color="#f7bd6c" stop-opacity=".55"/><stop offset="1" stop-color="#f7bd6c" stop-opacity="0"/></radialGradient>
<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#140c1e"/><stop offset="1" stop-color="#08050c"/></linearGradient>
<filter id="soft" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="14"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/><rect width="${W}" height="${H}" fill="url(#sun)"/>`;
  // faint high clouds
  b += '<g filter="url(#soft)">';
  for (let i = 0; i < 7; i++) {
    const y = 140 + R() * 360, x = R() * W, w = 220 + R() * 420;
    b += `<ellipse cx="${r1(x)}" cy="${r1(y)}" rx="${r1(w)}" ry="${r1(14 + R() * 18)}" fill="#ffffff" opacity="${r1(0.04 + R() * 0.07)}"/>`;
  }
  b += '</g>';
  const layer = (minH, maxH, minW, maxW, fill, opacity, windows, seedShift) => {
    let x = -40, g = `<g fill="${fill}" opacity="${opacity}">`, wins = '';
    while (x < W + 40) {
      const w = minW + R() * (maxW - minW);
      let h = minH + R() * (maxH - minH);
      if (R() < 0.12) h *= 1.45; // occasional tower
      const top = base - h;
      g += `<rect x="${r1(x)}" y="${r1(top)}" width="${r1(w)}" height="${r1(h + 4)}"/>`;
      if (R() < 0.25) g += `<rect x="${r1(x + w * 0.42)}" y="${r1(top - 26 - R() * 30)}" width="2" height="60"/>`;
      if (R() < 0.18) g += `<polygon points="${r1(x)},${r1(top)} ${r1(x + w)},${r1(top)} ${r1(x + w / 2)},${r1(top - 18 - R() * 22)}"/>`;
      if (windows) {
        for (let wy = top + 12; wy < base - 14; wy += 13) {
          for (let wx = x + 6; wx < x + w - 8; wx += 9) {
            if (R() < 0.16) wins += `<rect x="${r1(wx)}" y="${r1(wy)}" width="4" height="6"/>`;
          }
        }
      }
      x += w + (R() < 0.3 ? 4 + R() * 26 : 0);
    }
    g += '</g>';
    if (wins) g += `<g fill="#ffd58a" opacity=".55">${wins}</g>`;
    void seedShift;
    return g;
  };
  b += layer(70, 190, 40, 120, '#5b4670', 0.5, false, 1);
  b += layer(120, 330, 46, 130, '#26173a', 0.92, true, 2);
  b += layer(40, 140, 60, 170, '#110a1a', 1, false, 3);
  b += `<rect y="${base}" width="${W}" height="${H - base}" fill="url(#ground)"/>`;
  // street lights glow line
  for (let x = 20; x < W; x += 46 + R() * 30) b += `<circle cx="${r1(x)}" cy="${base + 22}" r="1.6" fill="#ffcf7d" opacity=".8"/>`;
  return svg(W, H, b);
}

// 2. Folded architectural facade
function facade() {
  const W = 1600, H = 900, s = 90;
  let b = `<defs><linearGradient id="tint" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22343c" stop-opacity=".08"/><stop offset="1" stop-color="#22343c" stop-opacity=".35"/></linearGradient></defs><rect width="${W}" height="${H}" fill="#e9ecee"/>`;
  for (let j = -1; j < H / s + 1; j++) {
    for (let i = -1; i < W / s + 2; i++) {
      const x = i * s + (j % 2 ? s / 2 : 0), y = j * s;
      const v = Math.sin(i * 0.55 + j * 0.3) * 0.5 + Math.cos(j * 0.45 - i * 0.18) * 0.5;
      const l1 = Math.round(205 + v * 32), l2 = Math.round(178 + v * 38);
      b += `<polygon points="${x},${y} ${x + s},${y} ${x + s / 2},${y + s}" fill="rgb(${l1},${l1 + 3},${l1 + 6})"/>`;
      b += `<polygon points="${x + s / 2},${y + s} ${x + s},${y} ${x + s * 1.5},${y + s}" fill="rgb(${l2},${l2 + 4},${l2 + 8})"/>`;
    }
  }
  b += `<g stroke="#ffffff" stroke-opacity=".35" stroke-width="1">`;
  for (let j = 0; j < H / s + 1; j++) b += `<line x1="0" y1="${j * s}" x2="${W}" y2="${j * s}"/>`;
  b += '</g>';
  b += `<rect width="${W}" height="${H}" fill="url(#tint)"/>`;
  return svg(W, H, b);
}

// 3. Flowing interchange lines on emerald
function lines() {
  const R = rng(7), W = 1600, H = 900;
  let b = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14051f"/><stop offset=".55" stop-color="#3d0c5d"/><stop offset="1" stop-color="#5e2c84"/></linearGradient>
<radialGradient id="glow" cx="1200" cy="260" r="620" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#d9b8ff" stop-opacity=".22"/><stop offset="1" stop-color="#d9b8ff" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`;
  b += `<g fill="none" stroke="#ffffff" stroke-linecap="round">`;
  for (let i = 0; i < 70; i++) {
    const y0 = 80 + R() * 820, y3 = -60 + R() * 1000;
    const c1y = y0 + (R() - 0.5) * 700, c2y = y3 + (R() - 0.5) * 700;
    b += `<path d="M-50 ${r1(y0)} C ${r1(420 + R() * 200)} ${r1(c1y)}, ${r1(980 + R() * 200)} ${r1(c2y)}, 1650 ${r1(y3)}" stroke-width="${r1(0.6 + R() * 2.2)}" stroke-opacity="${r1(0.05 + R() * 0.22)}"/>`;
  }
  b += '</g>';
  // two "carriageways" with dashed centre lines
  const roads = [
    'M-60 820 C 420 760, 760 420, 1660 300',
    'M-60 600 C 520 640, 980 860, 1660 760',
  ];
  for (const d of roads) {
    b += `<path d="${d}" fill="none" stroke="#1c0730" stroke-width="54" stroke-opacity=".75"/>`;
    b += `<path d="${d}" fill="none" stroke="#efe2ff" stroke-width="56" stroke-opacity=".12"/>`;
    b += `<path d="${d}" fill="none" stroke="#f6e7b0" stroke-width="2" stroke-dasharray="22 18" stroke-opacity=".7"/>`;
  }
  return svg(W, H, b);
}

// 4. Colonnade
function columns() {
  const W = 1600, H = 900;
  let b = `<defs><linearGradient id="stone" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6d604e"/><stop offset=".35" stop-color="#e2d6c1"/><stop offset=".6" stop-color="#cbbca2"/><stop offset="1" stop-color="#5b4f40"/></linearGradient>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3128"/><stop offset="1" stop-color="#1d1813"/></linearGradient>
<linearGradient id="light" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe9c2" stop-opacity=".0"/><stop offset=".6" stop-color="#ffe9c2" stop-opacity=".18"/><stop offset="1" stop-color="#ffe9c2" stop-opacity="0"/></linearGradient></defs>
<rect width="${W}" height="${H}" fill="url(#wall)"/>`;
  b += `<rect x="0" y="60" width="${W}" height="70" fill="#8d7d65"/><rect x="0" y="130" width="${W}" height="16" fill="#5c5040"/>`;
  b += `<rect x="0" y="790" width="${W}" height="30" fill="#7b6c56"/><rect x="0" y="820" width="${W}" height="80" fill="#4b4134"/>`;
  for (let i = 0; i < 9; i++) {
    const x = 40 + i * 190, w = 92;
    b += `<rect x="${x - 14}" y="146" width="${w + 28}" height="22" fill="#a39277"/>`;
    b += `<rect x="${x}" y="168" width="${w}" height="600" fill="url(#stone)"/>`;
    for (let f = 1; f < 6; f++) b += `<line x1="${x + (w / 6) * f}" y1="170" x2="${x + (w / 6) * f}" y2="766" stroke="#3d342a" stroke-opacity=".22" stroke-width="2"/>`;
    b += `<rect x="${x - 14}" y="766" width="${w + 28}" height="24" fill="#a39277"/>`;
  }
  b += `<rect width="${W}" height="${H}" fill="url(#light)"/>`;
  return svg(W, H, b);
}

// Card art (800x500)
function cardData() {
  const R = rng(3), W = 800, H = 500;
  let b = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1a0a2b"/><stop offset="1" stop-color="#43206a"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/>`;
  const pts = [];
  for (let y = 30; y < H; y += 38) for (let x = 30; x < W; x += 38) pts.push([x + (R() - 0.5) * 10, y + (R() - 0.5) * 10]);
  b += '<g stroke="#d6b8ff" stroke-opacity=".2" stroke-width="1">';
  for (let k = 0; k < 140; k++) {
    const a = pts[Math.floor(R() * pts.length)], c = pts[Math.floor(R() * pts.length)];
    if (Math.hypot(a[0] - c[0], a[1] - c[1]) < 140) b += `<line x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(c[0])}" y2="${r1(c[1])}"/>`;
  }
  b += '</g>';
  for (const [x, y] of pts) {
    const hot = R() < 0.06;
    b += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${hot ? 4.5 : 1.8}" fill="${hot ? '#f1c27d' : '#e3d2ff'}" opacity="${hot ? 1 : 0.55}"/>`;
  }
  b += `<g transform="translate(560 160)" fill="none" stroke="#e8f6ff" stroke-width="10" stroke-linejoin="round" opacity=".85"><rect x="0" y="70" width="120" height="100" rx="10"/><path d="M22 70 V44 a38 38 0 0 1 76 0 V70"/></g>`;
  return svg(W, H, b);
}
function cardProperty() {
  const W = 800, H = 500;
  const palette = ['#c8754f', '#e2b07a', '#8e9f6b', '#5f7a55', '#d9c7a4', '#a65e3e'];
  let b = `<rect width="${W}" height="${H}" fill="#f1e7d6"/>`;
  const R = rng(5);
  const iso = (x, y, w, d, h, c) => {
    const p = (px, py, pz) => `${r1(400 + (px - py) * 0.866)},${r1(120 + (px + py) * 0.5 - pz)}`;
    const top = [p(x, y, h), p(x + w, y, h), p(x + w, y + d, h), p(x, y + d, h)].join(' ');
    const left = [p(x, y + d, h), p(x + w, y + d, h), p(x + w, y + d, 0), p(x, y + d, 0)].join(' ');
    const right = [p(x + w, y, h), p(x + w, y + d, h), p(x + w, y + d, 0), p(x + w, y, 0)].join(' ');
    return `<polygon points="${left}" fill="${c}"/><polygon points="${left}" fill="#000" opacity=".12"/><polygon points="${right}" fill="${c}"/><polygon points="${right}" fill="#000" opacity=".26"/><polygon points="${top}" fill="${c}"/>`;
  };
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    const h = R() < 0.35 ? 10 + R() * 70 : 4;
    b += iso(i * 62 - 40, j * 62 - 60, 54, 54, h, palette[Math.floor(R() * palette.length)]);
  }
  return svg(W, H, b);
}
function cardEmployment() {
  const W = 800, H = 500, R = rng(9);
  let b = `<rect width="${W}" height="${H}" fill="#2a1d2e"/>`;
  const cols = ['#f0a35e', '#e0665a', '#f4d58d', '#9fd3c7', '#c08ad8'];
  for (let i = 0; i < 18; i++) {
    const x = 60 + R() * 680, y = 60 + R() * 380, r = 40 + R() * 120;
    b += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(r)}" fill="${cols[i % cols.length]}" opacity="${r1(0.18 + R() * 0.3)}" style="mix-blend-mode:screen"/>`;
  }
  b += '<g fill="none" stroke="#fff8ef" stroke-width="7" opacity=".9">';
  for (let k = 0; k < 4; k++) b += `<circle cx="${250 + k * 100}" cy="250" r="78"/>`;
  b += '</g>';
  return svg(W, H, b);
}
function cardSuccession() {
  const W = 800, H = 500, R = rng(4);
  let b = `<rect width="${W}" height="${H}" fill="#f4efe4"/><g stroke="#3d0c5d" stroke-linecap="round" fill="none">`;
  const branch = (x, y, ang, len, w, depth) => {
    if (depth === 0 || len < 6) { b += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r1(2 + R() * 4)}" fill="#c8963e" stroke="none" opacity=".8"/>`; return; }
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    b += `<line x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke-width="${r1(w)}"/>`;
    const n = 2 + (R() < 0.3 ? 1 : 0);
    for (let k = 0; k < n; k++) branch(x2, y2, ang + (k - (n - 1) / 2) * (0.42 + R() * 0.2), len * (0.68 + R() * 0.1), w * 0.68, depth - 1);
  };
  branch(400, 490, -Math.PI / 2, 120, 16, 8);
  b += '</g>';
  return svg(W, H, b);
}

save('hero-skyline.svg', skyline());
save('hero-facade.svg', facade());
save('hero-lines.svg', lines());
save('hero-columns.svg', columns());
save('card-data.svg', cardData());
save('card-property.svg', cardProperty());
save('card-employment.svg', cardEmployment());
save('card-succession.svg', cardSuccession());
console.log('Artwork written to', out);
