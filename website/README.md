# OMC Advocates website

A complete, multi-page website for **OMC Advocates**, modelled on the layout of large international law-firm sites:

- a header with the firm's logo, drop-down menus and site search
- a full-width rotating banner
- a short firm statement
- an Insights carousel
- a "How we help" grid
- a black footer

All text, artwork and code are original. The only brand assets used are the OMC logo and its purple (`#3D0C5D`).

It is a plain static site (HTML, CSS and JavaScript, plus one small PHP file for the contact form), so it can be hosted almost anywhere without a database or Node.js on the server.

## Preview it in one file

`npm run single:website` writes `var/OMC-Advocates-website.html`: the whole site (every page, the logo, artwork and interactions) packed into one file. Open it on a phone or computer to click around, or send it to colleagues. It is marked as a preview: hidden from search engines, and the contact form explains that messages are not sent from it.

`npm run preview:website` writes `var/omc-advocates-preview.zip`, the same preview as normal files, which can be dragged into Cloudflare Pages (Workers & Pages → Create → Pages → Upload assets) for a free shareable link.

## What's included

| Page | File |
| --- | --- |
| Home: banner, statement, insights, practice highlights | `index.html` |
| Expertise: all practice areas and sectors | `expertise.html` |
| People: searchable team directory (hidden for now; see below) | `people.html` |
| Insights: four briefings with a topic filter | `insights.html`, `insights/*.html` |
| About us, Careers, Contact | `about.html`, `careers.html`, `contact.html` |
| Privacy notice (Data Protection Act, 2019), Legal notices, 404 | `privacy.html`, `legal.html`, `404.html` |

It also has a working contact form (`contact.php`), site search, a sitemap, `robots.txt`, social-sharing image, favicon and `.htaccess` (custom 404 page, caching, security headers and an optional HTTPS redirect).

## Before you publish: fill in the real details

Every detail only the firm can supply is in **one file**, `website/site.config.json`. Unfilled values appear on the site **highlighted in yellow** so nothing is missed. `npm run build:website` lists anything still outstanding.

1. **Contact details**: `phone`, `addressLine1`, `addressLine2`, `city`, `postal`, `hours`.
2. **Email**: `email` is where contact-form messages go. `formSender` is the address they are sent from. Create both mailboxes (or forwarders) in cPanel → Email Accounts, or change them.
3. **People** (currently hidden): the team directory is switched off with `"features": { "people": false }`, so the page, its menu and footer links, and its search entries are not published. When you are ready, replace the four placeholder entries with real names, roles, practice areas, short bios and (optionally) emails, then change it to `true` and rebuild. To add a portrait, put a photo in `website/src/assets/img/people/` and add `"photo": "file-name.jpg"` to that person.
4. **Practice areas and sectors**: edit, remove or add entries so they match what the firm actually offers.
5. **Map and social links** (optional): add a Google Maps embed URL to `mapEmbedUrl`, and LinkedIn, X, Facebook or Instagram URLs. Their icons appear in the footer automatically.
6. **Review the wording**: the firm statement, careers text (pupillage and attachments) and the four Insights articles. The articles are general guides to Kenyan law; have an advocate confirm them before publishing. Check all content against the Law Society of Kenya's marketing and advertising rules for advocates.

Then rebuild:

```sh
npm run build:website      # writes website/public_html
npm run package:website    # writes website/omc-advocates-public_html.zip
```

## Hosting

The site works on any static host. The contact form (`contact.php`) needs a host that runs PHP, such as most cPanel shared hosting. On a static-only host (Cloudflare Pages, Netlify, GitHub Pages), the form needs a small replacement handler, for example a form service or a Cloudflare Worker.

### Uploading to a cPanel host

1. Log in to cPanel and open **File Manager** → `public_html`.
2. Delete any placeholder `index.html` the host created.
3. Click **Upload** and choose `website/omc-advocates-public_html.zip`.
4. Back in `public_html`, right-click the zip → **Extract**, then delete the zip.
5. In File Manager, enable **Settings → Show Hidden Files** and confirm `.htaccess` is present.
6. In cPanel → **SSL/TLS Status**, run AutoSSL so the site works on `https://`. Once the certificate is active, uncomment the three HTTPS redirect lines in `.htaccess`.
7. Visit the site, send a test message through the contact form, and confirm it arrives.

## Changing the design or content

| To change | Edit |
| --- | --- |
| Firm details, people, practice areas, insights list | `site.config.json` |
| Page text | `src/pages/*.html` (each page starts with a small JSON block for its title, description and banner) |
| Header, menus, footer, page layout | `build.mjs` |
| Colours, fonts, spacing | `src/assets/css/site.css` (colours are variables at the top) |
| Menus, slideshow, search behaviour | `src/assets/js/site.js` |
| Artwork | `node website/tools/make-art.mjs` regenerates the original SVG artwork. Any image can be swapped for a real photo of the same name. |
| Social image and app icon | `node website/tools/make-images.mjs` (needs Playwright) |

To add an article, add an entry to `insights` in `site.config.json` and create `src/pages/insights/<slug>.html` using an existing article as a template.

To preview locally, run `php -S localhost:8080 -t website/public_html` and open http://localhost:8080. `npm test` includes a check that every internal link, image and anchor resolves.

`brand/omc-logo-original.jpg` is the logo as supplied. The site uses vector versions traced from it (`src/assets/img/logo.svg`, `logo-white.svg` for dark backgrounds, `favicon.svg` for the emblem).
