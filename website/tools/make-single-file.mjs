// Packs the whole website (every page, the logo, artwork, styles and scripts) into ONE html file
// that can be opened directly on a phone or computer, without a web server, to click around.
// Usage: node website/tools/make-single-file.mjs [output.html]
// Default output: var/OMC-Advocates-website.html  (it is a preview: hidden from search engines,
// and the contact form explains that messages are not sent from the preview).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const OUTFILE = resolve(process.argv[2] || join(REPO, 'var', 'OMC-Advocates-website.html'));
const tmp = mkdtempSync(join(tmpdir(), 'omc-single-'));

try {
  execFileSync(process.execPath, [join(HERE, '..', 'build.mjs')], { env: { ...process.env, PREVIEW: '1', WEBSITE_OUT: tmp }, stdio: 'pipe' });
  const read = (p) => readFileSync(join(tmp, p), 'utf8');
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  const between = (s, a, b, from = 0) => {
    const i = s.indexOf(a, from); if (i < 0) throw new Error(`marker not found: ${a}`);
    const j = s.indexOf(b, i + a.length); if (j < 0) throw new Error(`marker not found: ${b}`);
    return s.slice(i + a.length, j);
  };
  const imgRefs = (html) => html.replace(/\ssrc="(?:\.\.\/|\/)*assets\/img\/([^"?]+)"/g, ' data-img="$1"');
  const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const safeJson = (v) => JSON.stringify(v).replace(/<\//g, '<\\/');

  const index = read('index.html');
  const headerHtml = imgRefs('<a class="skip-link"' + between(index, '<a class="skip-link"', '</header>') + '</header>');
  const footerHtml = imgRefs(between(index, '</main>\n', '\n</div>\n<script'));
  const fonts = index.match(/<link rel="preconnect"[^>]*>\s*<link rel="preconnect"[^>]*>\s*<link rel="stylesheet" href="https:\/\/fonts[^>]*>/)[0];

  // Every page's <main> content becomes a <template>
  const pages = walk(tmp).map((f) => relative(tmp, f).split(sep).join('/')).filter((p) => p.endsWith('.html')).sort();
  const templates = pages.map((p) => {
    const html = read(p);
    const title = between(html, '<title>', '</title>');
    const section = html.match(/<body class="page-([^"]+)"/)[1];
    const main = imgRefs(between(html, '<main id="main" tabindex="-1">\n', '\n</main>'));
    return `<template data-path="${attr(p)}" data-title="${title}" data-section="${attr(section)}">${main}</template>`;
  }).join('\n');

  // Images stored once, as data URIs
  const imgDir = join(tmp, 'assets', 'img');
  const images = {};
  for (const name of readdirSync(imgDir)) {
    if (!name.endsWith('.svg')) continue;
    images[name] = 'data:image/svg+xml;base64,' + readFileSync(join(imgDir, name)).toString('base64');
  }

  const css = read('assets/css/site.css');
  const siteJs = read('assets/js/site.js');
  const searchJs = read('assets/js/search-index.js').replace(/<\//g, '<\\/');

  const router = `(() => {
  'use strict';
  const main = document.getElementById('main');
  const IMG = window.OMC_IMG || {};
  const pages = {};
  document.querySelectorAll('template[data-path]').forEach((t) => { pages[t.dataset.path] = t; });
  const hydrate = (scope) => scope.querySelectorAll('img[data-img]').forEach((img) => {
    if (IMG[img.dataset.img]) img.src = IMG[img.dataset.img];
    img.removeAttribute('data-img');
  });
  hydrate(document);
  let current = 'index.html', cleanup = null;
  const route = (path, query, anchor) => '#/' + path + (query || '') + (anchor ? '~' + anchor : '');
  const parse = () => {
    let h = location.hash.replace(/^#\\/?/, '');
    let anchor = '', query = '';
    const t = h.indexOf('~'); if (t >= 0) { anchor = decodeURIComponent(h.slice(t + 1)); h = h.slice(0, t); }
    const q = h.indexOf('?'); if (q >= 0) { query = h.slice(q); h = h.slice(0, q); }
    return { path: h || 'index.html', query, anchor };
  };
  // Links inside <main> are relative to the current page; header, footer and search links to the site root.
  const resolveHref = (href, el) => {
    const base = el && el.closest && el.closest('main') ? current : 'index.html';
    const u = new URL(href, 'https://omc.preview/' + base);
    if (u.origin !== 'https://omc.preview') return null;
    let path = decodeURIComponent(u.pathname.slice(1)) || 'index.html';
    if (path.endsWith('/')) path += 'index.html';
    return { path, query: u.search, anchor: u.hash.slice(1) };
  };
  const markNav = (section) => {
    document.querySelectorAll('.nav-item.has-mega').forEach((li) => {
      li.classList.toggle('is-current', li.querySelector('.nav-trigger').getAttribute('aria-controls') === 'mega-' + section);
    });
    document.querySelectorAll('.nav-link').forEach((a) => {
      if (a.getAttribute('href').replace(/\\.html$/, '') === section) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };
  const render = () => {
    const { path, query, anchor } = parse();
    const tpl = pages[path] || pages['404.html'];
    current = pages[path] ? path : '404.html';
    if (cleanup) cleanup();
    const frag = tpl.content.cloneNode(true);
    hydrate(frag);
    main.replaceChildren(frag);
    document.title = tpl.dataset.title;
    document.body.className = 'page-' + tpl.dataset.section;
    markNav(tpl.dataset.section);
    window.OMC.closeMenus();
    window.OMC.closeSearch(false, true);
    cleanup = window.OMC.initPage(main, query);
    const target = anchor && document.getElementById(anchor);
    if (target) target.scrollIntoView({ behavior: 'instant' });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  };
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank') return;
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:|tel:|data:|javascript:)/i.test(href)) return;
    e.preventDefault();
    if (href.charAt(0) === '#') {
      const el = href.length > 1 && document.getElementById(href.slice(1));
      if (el) { el.scrollIntoView({ behavior: 'smooth' }); if (el === main) main.focus(); }
      return;
    }
    const r = resolveHref(href, a);
    if (!r) return;
    const next = route(r.path, r.query, r.anchor);
    if (location.hash === next) go(); else location.hash = next;
  });
  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'contact-form' || f.id === 'search-form' || !f.getAttribute('action')) return;
    e.preventDefault();
    const r = resolveHref(f.getAttribute('action'), f);
    const qs = new URLSearchParams(new FormData(f)).toString();
    if (r) location.hash = route(r.path, qs ? '?' + qs : '', '');
  });
  // Smooth page changes: cross-fade with the View Transitions API where available, else a short fade.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const go = () => {
    if (reduce) return render();
    if (document.startViewTransition) { document.startViewTransition(render); return; }
    if (!main.animate) return render();
    main.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in' }).onfinish = () => {
      render();
      main.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
    };
  };
  window.addEventListener('hashchange', go);
  render();
})();`;

  const html = `<!doctype html>
<html lang="en-KE" data-root="" data-preview="1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OMC Advocates</title>
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#3d0c5d">
<link rel="icon" href="${images['favicon.svg']}">
${fonts}
<style>
${css}
</style>
</head>
<body class="page-home">
<div class="site">
${headerHtml}
<main id="main" tabindex="-1"></main>
${footerHtml}
</div>
${templates}
<noscript><p style="padding:24px;font-family:sans-serif">Please enable JavaScript to browse this preview of the OMC Advocates website.</p></noscript>
<script>window.OMC_SINGLE_FILE = true; window.OMC_IMG = ${safeJson(images)};</script>
<script>${searchJs}</script>
<script>${siteJs}</script>
<script>${router}</script>
</body>
</html>
`;
  mkdirSync(dirname(OUTFILE), { recursive: true });
  writeFileSync(OUTFILE, html);
  console.log(`Wrote ${relative(process.cwd(), OUTFILE) || OUTFILE} (${pages.length} pages, ${Math.round(html.length / 1024)} KB)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
