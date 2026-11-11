// Builds the OMC Advocates static website into website/public_html.
// Usage: node website/build.mjs   (or: npm run build:website)
// Upload the *contents* of website/public_html to the public_html folder on the hosting account.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, 'src');
const OUT = process.env.WEBSITE_OUT || join(HERE, 'public_html');
// PREVIEW=1 builds a shareable copy for static hosts (Cloudflare Pages, Netlify): hidden from search
// engines, no PHP or .htaccess, and the contact form explains that it is a preview.
const PREVIEW = process.env.PREVIEW === '1';
const cfg = JSON.parse(readFileSync(join(HERE, 'site.config.json'), 'utf8'));
const firm = cfg.firm;
const YEAR = new Date().getFullYear();
// Optional sections that can be switched off in site.config.json ("features") and turned on later.
const SHOW_PEOPLE = cfg.features?.people !== false;

// ---------- helpers ----------
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPlaceholder = (v) => typeof v === 'string' && /\[[^\]]+\]/.test(v);
const filled = (v) => typeof v === 'string' && v.trim() !== '' && !isPlaceholder(v);
const show = (v) => (isPlaceholder(v) ? `<span class="placeholder">${esc(v)}</span>` : esc(v));
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const initials = (name) => (isPlaceholder(name) ? '' : name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''));
const telHref = (p) => 'tel:' + p.replace(/[^\d+]/g, '');
const phoneHtml = (p = firm.phone) => (filled(p) ? `<a href="${telHref(p)}">${esc(p)}</a>` : show(p));
const emailHtml = (e = firm.email) => (filled(e) ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : show(e));
const addressLines = () => [firm.addressLine1, firm.addressLine2, [firm.city, firm.country].filter(Boolean).join(', '), firm.postal].filter((l) => l && l.trim());
const chevron = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const searchIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M15.6 15.6l5.4 5.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const arrowL = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2L4 7l5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
const arrowR = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

const assetHash = createHash('sha1')
  .update(readFileSync(join(SRC, 'assets/css/site.css')))
  .update(readFileSync(join(SRC, 'assets/js/site.js')))
  .digest('hex').slice(0, 8);

const topics = [...new Set(cfg.insights.map((i) => i.topic))];
const practiceByName = new Map(cfg.practiceAreas.map((p) => [p.name, p]));

// ---------- reusable blocks ----------
function insightCard(ins, root, { track = false, withTopic = true } = {}) {
  const href = `${root}insights/${ins.slug}.html`;
  return `<article class="card"${track ? '' : ` data-topic="${esc(ins.topic)}"`}>
  <a class="card-media" href="${href}" tabindex="-1" aria-hidden="true"><img src="${root}assets/img/${esc(ins.image)}" alt="" loading="lazy" width="800" height="500"></a>
  ${withTopic ? `<p class="card-topic">${esc(ins.topic)}</p>` : ''}
  <h3><a href="${href}">${esc(ins.title)}</a></h3>
  <p>${esc(ins.summary)}</p>
  <a class="btn" href="${href}">Find out more<span class="visually-hidden"> about ${esc(ins.title)}</span></a>
</article>`;
}

const blocks = {
  insightCarousel: (ctx) => `<div class="card-track" tabindex="0" aria-label="Insights, scroll for more">${cfg.insights.map((i) => insightCard(i, ctx.root, { track: true })).join('\n')}</div>`,
  insightGrid: (ctx) => `<div class="card-grid">${cfg.insights.map((i) => insightCard(i, ctx.root)).join('\n')}</div>`,
  topicChips: () => `<div class="chips" role="group" aria-label="Filter by topic"><button class="chip" type="button" data-filter-topic="all" aria-pressed="true">All topics</button>${topics.map((t) => `<button class="chip" type="button" data-filter-topic="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>`,
  practiceRuled: (ctx) => `<div class="ruled-grid">${cfg.practiceAreas.slice(0, 4).map((p) => `<article class="ruled-item"><h3><a href="${ctx.root}expertise.html#${p.id}">${esc(p.name)}</a></h3><p>${esc(p.summary)}</p></article>`).join('')}</div>`,
  practiceTiles: (ctx) => `<div class="tiles">${cfg.practiceAreas.map((p) => `<div class="tile"><a href="${ctx.root}expertise.html#${p.id}"><h3>${esc(p.name)}</h3><p>${esc(p.summary)}</p></a></div>`).join('')}</div>`,
  practiceSideNav: () => `<nav class="side-nav" aria-label="Practice areas"><h2>Practice areas</h2><ul>${cfg.practiceAreas.map((p) => `<li><a href="#${p.id}">${esc(p.name)}</a></li>`).join('')}<li><a href="#sectors">Sectors</a></li></ul></nav>`,
  practiceSections: (ctx) => cfg.practiceAreas.map((p) => `<section class="practice" id="${p.id}" aria-labelledby="${p.id}-h">
  <h2 id="${p.id}-h">${esc(p.name)}</h2>
  <p>${esc(p.summary)}</p>
  <ul class="service-list">${p.services.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  <a class="link-arrow" href="${ctx.root}contact.html?topic=${encodeURIComponent(p.name)}">Discuss a ${esc(p.name.toLowerCase())} matter</a>
</section>`).join('\n'),
  sectorList: () => `<ul class="sector-list">${cfg.sectors.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
  practiceOptions: () => cfg.practiceAreas.map((p) => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join(''),
  peopleGrid: (ctx) => `<div class="people-grid">${cfg.people.map((p) => {
    const search = [p.name, p.role, ...(p.practices || [])].join(' ');
    const photo = p.photo ? `<img src="${ctx.root}assets/img/people/${esc(p.photo)}" alt="Portrait of ${esc(p.name)}" loading="lazy">` : `<span class="person-initials" aria-hidden="true">${esc(initials(p.name))}</span>`;
    return `<article class="person" data-search="${esc(search)}" data-practices="${esc((p.practices || []).join('|'))}">
  <div class="person-photo">${photo}</div>
  <h2>${show(p.name)}</h2>
  <p class="role">${show(p.role)}</p>
  <p class="practices">${(p.practices || []).map(esc).join(' · ')}</p>
  ${p.bio ? `<p class="bio">${show(p.bio)}</p>` : ''}
  ${filled(p.email) ? `<a href="mailto:${esc(p.email)}">Email ${esc(p.name.split(' ')[0])}</a>` : ''}
</article>`;
  }).join('\n')}</div><p class="empty-state" id="people-empty" hidden>No one matches that search. Try another name or practice area, or <a href="${ctx.root}contact.html">contact the firm</a>.</p>`,
  address: () => addressLines().map(show).join('<br>'),
  phone: () => phoneHtml(),
  email: () => emailHtml(),
  hours: () => show(firm.hours),
  contactTopics: () => ['General enquiry', ...cfg.practiceAreas.map((p) => p.name), 'Careers'].map((t) => `<option>${esc(t)}</option>`).join(''),
  arrowLeft: () => arrowL,
  arrowRight: () => arrowR,
  ctaActions: (ctx) => `<a class="btn" href="${ctx.root}contact.html">Contact us</a>${filled(firm.phone) ? `<a class="btn btn-ghost" href="${telHref(firm.phone)}">Call ${esc(firm.phone)}</a>` : ''}`,
  map: () => (filled(firm.mapEmbedUrl) ? `<iframe class="map" src="${esc(firm.mapEmbedUrl)}" title="Map showing the office location" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>` : ''),
};

function renderTokens(text, ctx) {
  return text.replace(/\{\{\s*([@\w.:-]+)\s*\}\}/g, (m, key) => {
    if (key === 'root') return ctx.root;
    if (key === 'year') return String(YEAR);
    if (key.startsWith('@')) {
      const fn = blocks[key.slice(1)];
      if (!fn) throw new Error(`Unknown block ${key} in ${ctx.path}`);
      return fn(ctx);
    }
    if (key.startsWith('raw:')) return esc(get(cfg, key.slice(4)) ?? '');
    const v = get(cfg, key);
    if (v === undefined) throw new Error(`Unknown token ${key} in ${ctx.path}`);
    return show(v);
  });
}

// ---------- layout ----------
function head(ctx) {
  const title = ctx.path === 'index.html' ? `${firm.name} | ${firm.tagline}` : `${ctx.title} | ${firm.name}`;
  const canonical = firm.url.replace(/\/$/, '') + '/' + (ctx.path === 'index.html' ? '' : ctx.path);
  const og = firm.url.replace(/\/$/, '') + '/assets/img/og-image.png';
  let ld = '';
  if (ctx.path === 'index.html') {
    const data = { '@context': 'https://schema.org', '@type': 'LegalService', name: firm.name, url: firm.url, image: og };
    if (filled(firm.email)) data.email = firm.email;
    if (filled(firm.phone)) data.telephone = firm.phone;
    if ([firm.addressLine2, firm.city].every(filled)) data.address = { '@type': 'PostalAddress', streetAddress: [firm.addressLine1, firm.addressLine2].filter(filled).join(', '), addressLocality: firm.city, addressCountry: 'KE' };
    ld = `\n<script type="application/ld+json">${JSON.stringify(data)}</script>`;
  }
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(ctx.description)}">${PREVIEW ? '\n<meta name="robots" content="noindex, nofollow">' : ''}
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="${ctx.layout === 'article' ? 'article' : 'website'}">
<meta property="og:site_name" content="${esc(firm.name)}">
<meta property="og:title" content="${esc(ctx.title)}">
<meta property="og:description" content="${esc(ctx.description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(og)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#3d0c5d">
<link rel="icon" href="${ctx.root}assets/img/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${ctx.root}assets/img/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&amp;display=swap">
<link rel="stylesheet" href="${ctx.root}assets/css/site.css?v=${assetHash}">${ld}`;
}

function header(ctx) {
  const r = ctx.root;
  const cur = (s) => (ctx.section === s ? ' is-current' : '');
  const curLink = (s) => (ctx.section === s ? ' aria-current="page"' : '');
  const practices = cfg.practiceAreas;
  const half = Math.ceil(practices.length / 2);
  const pLinks = (list) => list.map((p) => `<li><a href="${r}expertise.html#${p.id}">${esc(p.name)}</a></li>`).join('');
  const mega = (id, label, intro, cols, visit) => `<li class="nav-item has-mega${cur(id)}">
  <button class="nav-trigger" type="button" aria-expanded="false" aria-controls="mega-${id}">${label}${chevron}</button>
  <div class="mega" id="mega-${id}">
    <div class="mega-intro"><h2>${label}</h2><p>${intro}</p>${visit ? `<a class="mega-visit" href="${visit}">Visit this section</a>` : ''}</div>
    <div class="mega-cols">${cols}</div>
  </div>
</li>`;
  const col = (title, body, extra = '') => `<div class="mega-col${extra}">${title ? `<h3>${title}</h3>` : '<h3 class="mega-spacer" aria-hidden="true">&nbsp;</h3>'}${body}</div>`;
  return `<a class="skip-link" href="#main">Skip to main content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${r}index.html"><img src="${r}assets/img/logo.svg" alt="${esc(firm.name)}, home" width="199" height="74"></a>
    <a class="header-cta" href="${r}contact.html">Book a consultation</a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="primary-nav"><span class="label">Menu</span><span class="bars" aria-hidden="true"><i></i></span></button>
    <nav class="primary-nav" id="primary-nav" aria-label="Main">
      <ul class="nav-list">
${!SHOW_PEOPLE ? '' : mega('people', 'People', 'Meet the advocates who will work on your matter.',
    col('Find a lawyer', `<form class="mega-search" action="${r}people.html" method="get" role="search"><label class="visually-hidden" for="mega-q">Search people by name</label><input id="mega-q" name="q" type="search" placeholder="Enter a name"><button class="btn" type="submit">Search</button></form><a class="mega-visit" href="${r}people.html">View all people</a>`) +
    col('By practice area', `<ul>${practices.slice(0, 5).map((p) => `<li><a href="${r}people.html?practice=${encodeURIComponent(p.name)}">${esc(p.name)}</a></li>`).join('')}</ul>`) +
    col('Our office', `<p style="font-size:15px;color:var(--muted);margin:0 0 8px">${blocks.address()}</p><a class="mega-visit" href="${r}contact.html">Contact and directions</a>`),
    `${r}people.html`)}
${mega('expertise', 'Expertise', 'Practical legal advice across the life of a business, a property and a family.',
    col('Practice areas', `<ul>${pLinks(practices.slice(0, half))}</ul>`) +
    col('', `<ul>${pLinks(practices.slice(half))}</ul>`, ' mega-col-cont') +
    col('Sectors', `<ul>${cfg.sectors.slice(0, 6).map((s) => `<li><a href="${r}expertise.html#sectors">${esc(s)}</a></li>`).join('')}</ul>`),
    `${r}expertise.html`)}
${mega('insights', 'Insights', 'Briefings and guides on Kenyan law, written for busy decision-makers.',
    col('Latest', `<ul>${cfg.insights.map((i) => `<li><a href="${r}insights/${i.slug}.html">${esc(i.title)}</a></li>`).join('')}</ul>`) +
    col('Topics', `<ul>${topics.map((t) => `<li><a href="${r}insights.html?topic=${encodeURIComponent(t)}">${esc(t)}</a></li>`).join('')}</ul>`),
    `${r}insights.html`)}
${mega('about', 'About us', 'Who we are, how we work and what you can expect from us.',
    col('The firm', `<ul><li><a href="${r}about.html#who-we-are">Who we are</a></li><li><a href="${r}about.html#values">Our values</a></li><li><a href="${r}about.html#approach">How we work</a></li><li><a href="${r}expertise.html#sectors">Sectors we serve</a></li></ul>`) +
    col('Join us', `<ul><li><a href="${r}careers.html">Careers</a></li><li><a href="${r}careers.html#pupillage">Pupillage and attachments</a></li></ul>`) +
    col('Policies', `<ul><li><a href="${r}privacy.html">Privacy notice</a></li><li><a href="${r}legal.html">Legal notices</a></li></ul>`),
    `${r}about.html`)}
        <li><a class="nav-link" href="${r}careers.html"${curLink('careers')}>Careers</a></li>
        <li><a class="nav-link" href="${r}contact.html"${curLink('contact')}>Contact</a></li>
        <li class="search-item"><button class="search-toggle" type="button" data-open-search aria-label="Search the site">${searchIcon}<span class="label" aria-hidden="true">Search</span></button></li>
      </ul>
    </nav>
  </div>
</header>`;
}

function footer(ctx) {
  const r = ctx.root;
  const icons = {
    linkedin: '<path d="M4.98 3.5a2.5 2.5 0 11-.01 5 2.5 2.5 0 01.01-5zM3 9h4v12H3zM9 9h3.8v1.7h.05c.53-1 1.84-2.05 3.79-2.05 4.05 0 4.8 2.67 4.8 6.13V21h-4v-5.5c0-1.31-.02-3-1.83-3-1.83 0-2.11 1.43-2.11 2.9V21H9z"/>',
    x: '<path d="M17.7 3h3.1l-6.8 7.8L22 21h-6.3l-4.9-6.4L5.2 21H2.1l7.3-8.3L2 3h6.4l4.4 5.9zm-1.1 16.2h1.7L7.5 4.7H5.7z"/>',
    facebook: '<path d="M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.87.25-1.46 1.5-1.46h1.6V4.46A21 21 0 0014.3 4.3c-2.3 0-3.8 1.4-3.8 3.97v2.23H8v3h2.5V21z"/>',
    instagram: '<path d="M12 7.3a4.7 4.7 0 100 9.4 4.7 4.7 0 000-9.4zm0 7.7a3 3 0 110-6 3 3 0 010 6zm6-7.9a1.1 1.1 0 11-2.2 0 1.1 1.1 0 012.2 0zM12 4.6c2.4 0 2.7 0 3.6.05 2.4.1 3.6 1.3 3.7 3.7.05.95.05 1.2.05 3.6s0 2.7-.05 3.6c-.1 2.4-1.3 3.6-3.7 3.7-.95.05-1.2.05-3.6.05s-2.7 0-3.6-.05c-2.4-.1-3.6-1.3-3.7-3.7C4.6 14.7 4.6 14.4 4.6 12s0-2.7.05-3.6c.1-2.4 1.3-3.6 3.7-3.7.9-.05 1.2-.05 3.6-.05zM12 3c-2.4 0-2.7 0-3.7.05C5 3.2 3.2 5 3.05 8.3 3 9.3 3 9.6 3 12s0 2.7.05 3.7C3.2 19 5 20.8 8.3 20.95c1 .05 1.3.05 3.7.05s2.7 0 3.7-.05c3.3-.15 5.1-1.95 5.25-5.25.05-1 .05-1.3.05-3.7s0-2.7-.05-3.7C20.8 5 19 3.2 15.7 3.05 14.7 3 14.4 3 12 3z"/>',
  };
  const social = Object.entries(firm.social || {}).filter(([, url]) => filled(url));
  const socialHtml = social.length
    ? `<ul class="social">${social.map(([k, url]) => `<li><a href="${esc(url)}" rel="noopener" target="_blank" aria-label="${esc(firm.name)} on ${k === 'x' ? 'X' : k[0].toUpperCase() + k.slice(1)}"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[k] || ''}</svg></a></li>`).join('')}</ul>`
    : '';
  return `<footer class="site-footer">
  <div><a class="footer-mark" href="${r}index.html"><img src="${r}assets/img/logo-white.svg" alt="${esc(firm.name)}, home" width="177" height="66" loading="lazy"></a></div>
  <ul>
    <li><a href="${r}expertise.html">Expertise</a></li>
${SHOW_PEOPLE ? `    <li><a href="${r}people.html">People</a></li>\n` : ''}    <li><a href="${r}insights.html">Insights</a></li>
    <li><a href="${r}about.html">About us</a></li>
    <li><a href="${r}careers.html">Careers</a></li>
  </ul>
  <ul>
    <li><a href="${r}contact.html">Contact us</a></li>
    <li><a href="${r}privacy.html">Privacy notice</a></li>
    <li><a href="${r}legal.html">Legal notices</a></li>
    <li><a href="${r}privacy.html#cookies">Cookies</a></li>
  </ul>
  <div class="footer-contact">
    <p class="footer-copy">&copy; ${YEAR} ${esc(firm.name)}</p>
    <p>${addressLines().map(show).join('<br>')}</p>
    <p>${phoneHtml()}<br>${emailHtml()}</p>
    ${socialHtml}
  </div>
  <div class="footer-legal"><p>${esc(firm.name)} is a firm of ${esc(firm.tagline.replace(/^Advocates/, 'advocates'))}. The content of this website is general information only and is not legal advice. Contacting us through this website does not by itself create an advocate–client relationship.</p></div>
</footer>
<div class="search-panel" id="search-panel" role="dialog" aria-modal="true" aria-label="Search the site" hidden>
  <div class="search-box">
    <form id="search-form" role="search"><label class="visually-hidden" for="search-input">Search</label><input id="search-input" type="search" placeholder="Search the site" autocomplete="off"><button class="search-close" type="button" aria-label="Close search">&times;</button></form>
    <p class="search-hint" id="search-hint" aria-live="polite"></p>
    <ul class="search-results" id="search-results"></ul>
  </div>
</div>`;
}

function pageHero(ctx) {
  if (!ctx.heroTitle) return '';
  const crumbs = ctx.crumbs || [];
  return `<section class="page-hero">
  <img src="${ctx.root}assets/img/${esc(ctx.heroImage || 'hero-lines.svg')}" alt="">
  <div class="inner">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="${ctx.root}index.html">Home</a>${crumbs.map(([label, href]) => `<span aria-hidden="true">/</span>${href ? `<a href="${ctx.root}${href}">${esc(label)}</a>` : `<span aria-current="page">${esc(label)}</span>`}`).join('')}</nav>
    <h1>${esc(ctx.heroTitle)}</h1>
    ${ctx.heroIntro ? `<p>${esc(ctx.heroIntro)}</p>` : ''}
  </div>
</section>`;
}

function articleLayout(ctx, body) {
  const ins = cfg.insights.find((i) => i.slug === ctx.slug);
  if (!ins) throw new Error(`No insight in config for ${ctx.slug}`);
  const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(2, Math.round(words / 220));
  const related = practiceByName.get(ctx.practice);
  const others = cfg.insights.filter((i) => i.slug !== ins.slug).slice(0, 3);
  return `<section class="page-hero">
  <img src="${ctx.root}assets/img/${esc(ins.image)}" alt="">
  <div class="inner">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="${ctx.root}index.html">Home</a><span aria-hidden="true">/</span><a href="${ctx.root}insights.html">Insights</a><span aria-hidden="true">/</span><a href="${ctx.root}insights.html?topic=${encodeURIComponent(ins.topic)}">${esc(ins.topic)}</a></nav>
    <h1>${esc(ins.title)}</h1>
    <p class="article-meta"><span>${esc(ins.topic)}</span><span>${minutes} minute read</span></p>
  </div>
</section>
<div class="article-wrap">
  <article class="prose">
${body}
    <div class="note"><p>This briefing is general information about Kenyan law as we understand it at the date of publication. It is not legal advice and should not be relied on for any specific situation. Please speak to us about your circumstances.</p></div>
  </article>
  <aside class="article-aside">
    <h2>Talk to us</h2>
    <p>Have a question about ${esc(ins.topic.toLowerCase())}? Our team can advise on your specific situation.</p>
    <p><a class="btn" href="${ctx.root}contact.html?topic=${encodeURIComponent(related ? related.name : 'General enquiry')}">Contact us</a></p>
    ${related ? `<p><a class="link-arrow" href="${ctx.root}expertise.html#${related.id}">${esc(related.name)}</a></p>` : ''}
  </aside>
</div>
<section class="section" aria-labelledby="more-h">
  <div class="section-head"><h2 id="more-h">More insights</h2><a class="link-arrow" href="${ctx.root}insights.html">All insights</a></div>
  <div class="card-grid">${others.map((i) => insightCard(i, ctx.root)).join('\n')}</div>
</section>`;
}

function layout(ctx, body) {
  const main = ctx.layout === 'article' ? articleLayout(ctx, body) : pageHero(ctx) + body;
  return `<!doctype html>
<html lang="en-KE" data-root="${ctx.root}"${PREVIEW ? ' data-preview="1"' : ''}>
<head>
${head(ctx)}
</head>
<body class="page-${ctx.section || 'page'}">
<div class="site">
${header(ctx)}
<main id="main" tabindex="-1">
${main}
</main>
${footer(ctx)}
</div>
<script src="${ctx.root}assets/js/site.js?v=${assetHash}" defer></script>
</body>
</html>
`;
}

// ---------- build ----------
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(SRC, 'assets'), join(OUT, 'assets'), { recursive: true });
if (PREVIEW) writeFileSync(join(OUT, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n');
else cpSync(join(SRC, '.htaccess'), join(OUT, '.htaccess'));

const searchEntries = [];
const sitemap = [];
for (const file of walk(join(SRC, 'pages')).filter((f) => f.endsWith('.html'))) {
  const path = relative(join(SRC, 'pages'), file).split(sep).join('/');
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(/^<!--meta\s*([\s\S]*?)-->\s*/);
  if (!m) throw new Error(`Missing meta block in ${path}`);
  const meta = JSON.parse(m[1]);
  if (meta.feature === 'people' && !SHOW_PEOPLE) continue; // section switched off in site.config.json
  const depth = path.split('/').length - 1;
  const ctx = { ...meta, path, root: meta.root ?? '../'.repeat(depth) };
  const body = renderTokens(raw.slice(m[0].length), ctx);
  const html = layout(ctx, body);
  const unresolved = html.match(/\{\{[^}]*\}\}/);
  if (unresolved) throw new Error(`Unresolved token ${unresolved[0]} in ${path}`);
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), html);
  if (!meta.noindex) {
    sitemap.push(path === 'index.html' ? '' : path);
    searchEntries.push({ t: meta.title, d: meta.description, u: path, s: meta.searchLabel || 'Page' });
  }
}
for (const p of cfg.practiceAreas) searchEntries.push({ t: p.name, d: p.summary, u: `expertise.html#${p.id}`, s: 'Expertise', k: p.services.join(' ') });
for (const s of cfg.sectors) searchEntries.push({ t: s, d: 'A sector we advise.', u: 'expertise.html#sectors', s: 'Sector' });
for (const i of cfg.insights) {
  const e = searchEntries.find((x) => x.u === `insights/${i.slug}.html`);
  if (e) { e.s = `Insight · ${i.topic}`; e.k = i.summary; }
}
for (const p of (SHOW_PEOPLE ? cfg.people : []).filter((x) => filled(x.name))) searchEntries.push({ t: p.name, d: [p.role, ...(p.practices || [])].join(', '), u: `people.html?q=${encodeURIComponent(p.name)}`, s: 'People' });
writeFileSync(join(OUT, 'assets/js/search-index.js'), `window.OMC_SEARCH=${JSON.stringify(searchEntries)};\n`);

const base = firm.url.replace(/\/$/, '');
writeFileSync(join(OUT, 'robots.txt'), PREVIEW ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
writeFileSync(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.sort().map((p) => `  <url><loc>${esc(base + '/' + p)}</loc></url>`).join('\n')}\n</urlset>\n`);

// contact.php: inject configuration as PHP string literals
const phpStr = (v) => `'${String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const php = readFileSync(join(SRC, 'contact.php'), 'utf8').replace(/\{\{php:([\w.]+)\}\}/g, (_, k) => phpStr(get(cfg, k)));
if (!PREVIEW) writeFileSync(join(OUT, 'contact.php'), php);

// Report what still needs real details
const todo = [];
const scan = (obj, path) => {
  if (typeof obj === 'string') { if (isPlaceholder(obj)) todo.push(`${path}: ${obj}`); return; }
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) scan(v, path ? `${path}.${k}` : k);
};
scan(SHOW_PEOPLE ? cfg : { ...cfg, people: [] }, '');
if (!SHOW_PEOPLE) todo.push('(People page is hidden: set "features": { "people": true } to publish it once names and bios are filled in)');
if (!existsSync(join(OUT, 'assets/img/og-image.png'))) todo.push('assets/img/og-image.png missing: run node website/tools/make-images.mjs');
console.log(`Built ${sitemap.length} pages${PREVIEW ? ' (preview copy)' : ''} into ${relative(process.cwd(), OUT) || OUT}`);
if (todo.length) {
  console.log(`\n${todo.length} placeholder value(s) still to replace in website/site.config.json:`);
  for (const t of todo) console.log('  - ' + t);
}
