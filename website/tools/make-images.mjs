// Renders the PNG images that cannot be SVG: the social sharing image (og-image.png)
// and the iPhone home-screen icon (apple-touch-icon.png). Needs Playwright + Chromium.
// Run: node website/tools/make-images.mjs   (after make-art.mjs)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const img = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'img');
const cfg = JSON.parse(readFileSync(join(img, '..', '..', '..', 'site.config.json'), 'utf8'));
const logo = 'data:image/svg+xml;base64,' + readFileSync(join(img, 'logo.svg')).toString('base64');
const emblem = 'data:image/svg+xml;base64,' + readFileSync(join(img, 'favicon.svg')).toString('base64');
const font = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap">';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head>${font}<style>
    body{margin:0;width:1200px;height:630px;font-family:Lato,Arial,sans-serif;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative}
    img{width:760px}
    .tag{margin-top:34px;font-size:30px;font-weight:300;color:#3d0c5d;letter-spacing:.02em}
    .bar{position:absolute;left:0;right:0;bottom:0;height:22px;background:#3d0c5d}
  </style></head><body><img src="${logo}" alt=""><div class="tag">${cfg.firm.tagline}</div><div class="bar"></div></body></html>`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(img, 'og-image.png') });

  const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  await icon.setContent(`<!doctype html><html><head><style>
    body{margin:0;width:180px;height:180px;background:#fff;display:grid;place-items:center}
    img{height:140px}
  </style></head><body><img src="${emblem}" alt=""></body></html>`, { waitUntil: 'networkidle' });
  await icon.screenshot({ path: join(img, 'apple-touch-icon.png') });
  console.log('Wrote og-image.png and apple-touch-icon.png to', img);
} finally {
  await browser.close();
}
