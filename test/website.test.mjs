// Builds the OMC Advocates website into a temporary folder and checks it is complete:
// every page has a title and one <h1>, and every internal link, image, script and #anchor resolves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

test('website builds and every internal reference resolves', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'omc-site-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  execFileSync(process.execPath, [join(repo, 'website/build.mjs')], { env: { ...process.env, WEBSITE_OUT: out }, stdio: 'pipe' });

  const files = walk(out).map((f) => relative(out, f).split(sep).join('/'));
  for (const required of ['index.html', 'expertise.html', 'people.html', 'insights.html', 'about.html', 'careers.html', 'contact.html', 'privacy.html', 'legal.html', '404.html', 'contact.php', '.htaccess', 'robots.txt', 'sitemap.xml', 'assets/js/search-index.js', 'assets/img/logo.svg', 'assets/img/og-image.png']) {
    assert.ok(files.includes(required), `missing ${required}`);
  }

  const pages = files.filter((f) => f.endsWith('.html'));
  const ids = new Map(pages.map((p) => [p, new Set([...readFileSync(join(out, p), 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
  const problems = [];
  for (const page of pages) {
    const html = readFileSync(join(out, page), 'utf8');
    assert.match(html, /<title>[^<]+<\/title>/, `${page} has no title`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${page} should have exactly one h1`);
    assert.doesNotMatch(html, /\{\{[^}]*\}\}/, `${page} has an unresolved token`);
    if (page === '404.html') continue; // uses root-absolute paths so it works at any URL
    for (const [, ref] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      if (/^(https?:|mailto:|tel:|data:)/.test(ref)) continue;
      const [pathPart, hash] = ref.split('#');
      const target = pathPart ? posix.normalize(posix.join(posix.dirname(page), pathPart.split('?')[0])) : page;
      if (!existsSync(join(out, target))) { problems.push(`${page}: broken link ${ref}`); continue; }
      if (hash && target.endsWith('.html') && !ids.get(target)?.has(hash)) problems.push(`${page}: missing anchor ${ref}`);
    }
  }
  assert.deepEqual(problems, []);

  const index = readFileSync(join(out, 'assets/js/search-index.js'), 'utf8');
  const entries = JSON.parse(index.replace(/^window\.OMC_SEARCH=/, '').replace(/;\s*$/, ''));
  assert.ok(entries.length > 20, 'search index should cover pages, practice areas and insights');
  for (const e of entries) assert.ok(existsSync(join(out, e.u.split(/[?#]/)[0])), `search entry points nowhere: ${e.u}`);
});

test('single-file preview contains every page and no external image references', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omc-single-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'site.html');
  execFileSync(process.execPath, [join(repo, 'website/tools/make-single-file.mjs'), file], { stdio: 'pipe' });
  const html = readFileSync(file, 'utf8');
  const pages = [...html.matchAll(/<template data-path="([^"]+)"/g)].map((m) => m[1]);
  for (const p of ['index.html', 'expertise.html', 'people.html', 'insights.html', 'contact.html', '404.html', 'insights/succession-planning-kenya.html']) assert.ok(pages.includes(p), `missing page ${p}`);
  assert.doesNotMatch(html, /src="[^"]*assets\/img\//, 'images must be embedded');
  assert.match(html, /data-preview="1"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
});
