# Node development reference

The selected hosting route is [Cloudflare Workers + D1](SERVERLESS.md). This document only describes the retained Node development backend.

A private Android-installable PWA for Caspal: one researched founder episode, one verified philosophy quote, and one manageable invitation. The home screen goes straight to today’s reading; archive, saved readings, offline reopening, encouragement and notification settings are included.

An [offline starter APK](../dist/founders-morning-offline.apk) is also available. See [Android installation and build notes](ANDROID.md). It bundles five readings; fresh daily research and notifications use the hosted service described below.

## Optional Node development server

Requires **Node.js 24 or newer** (uses built-in SQLite). This task uses the existing checkout; no worktree is required.

```sh
cd /workspace/my-App
npm ci
npm run init
# Open .env privately and use its APP_PASSWORD to sign in.
npm start
```

On a local computer, open port 3000 in the browser. On a phone, use the HTTPS hosting steps below. The server refuses login until APP_PASSWORD is at least 12 characters. No account signup or public bootstrap endpoint exists. Keep the password in your password manager; do not expose `.env` or `var/`.

Default delivery is **08:00 Africa/Nairobi**. In the optional Node development server, a timer checks every 30 seconds, starts research 45 minutes before delivery, and catches up the current day after downtime. An edition is prepared before delivery and published when due. Before the first delivery, the app shows an honest waiting state. This is one private reading room, not a multi-user service.

## Connect fresh research

Set **RESEARCH_API_KEY** on the server (the standard `OPENAI_API_KEY` alias also works) (never in browser JavaScript). `OPENAI_MODEL` defaults to `gpt-4.1`; choose a Responses API model supporting web search and structured output. There is no separate search key: the server uses OpenAI’s web-search tool, reopens each cited page, checks the exact retained excerpts and quote wording, then performs a second source/non-repetition audit. See [provider details](PROVIDERS.md).

Run `npm run research` after connecting the provider to verify one new sourced edition and add it to the unused reserve. This makes a paid API request and changes the reserve, without changing today’s edition.

The initial verified reserve works without an AI key, but it is finite. Configure live research before it runs out. Each research morning replenishes up to three editions toward a five-edition reserve. Source access errors, failed exact-quote checks, uncertain claims or repeat events discard the candidate and preserve the existing reserve. If no verified edition remains, the app reports an unavailable edition rather than inventing or repeating a story. The authenticated status endpoint exposes this condition. AI verification is a useful safeguard, not a guarantee of historical infallibility; the sources remain visible for scrutiny.

Allow outbound HTTPS to `api.openai.com` and the publishers selected for research. The code has a conservative publisher allowlist in `src/research.mjs`; use `RESEARCH_ALLOWED_HOSTS` only for additional trusted public publishers. The host’s network policy must also allow those domains. A practical starting set is `www.gutenberg.org`, `classics.mit.edu`, `www.paulgraham.com`, `www.ycombinator.com`, `www.patagonia.com`, `www.npr.org`, `www.shopify.com`, `www.safaricom.co.ke`, `github.com`, `raw.githubusercontent.com` and the credible African news sources listed in the provider guide. A blocked source is never treated as verified. Keep proxy and CA settings when your host supplies them; startup uses Node’s environment-proxy support.

Stories permanently record founder, company, event, approximate date, geography, industry and philosophical tradition, with exact source excerpts, retrieval dates and available hashes. Candidate generation and a separate semantic audit compare against the full permanent ledger **and unpublished reserve**, so a new article or headline about the same event does not qualify. Canonical event keys and normalized quote uniqueness add deterministic checks. History grows over time and is sent in full: a context-limit error fails safely to reserve; a larger deployment should add a retrieval index with a full-ledger duplicate audit before reaching that limit.

## Android installation and notifications

1. Open your HTTPS app in Chrome on Android and sign in. Use Chrome’s **Add to Home screen → Install** (or the app’s install action when available).
2. In the app’s settings, enable phone notifications. Permission must follow a tap. Phone push is the default delivery channel; WhatsApp starts off. Android/Chrome and your OS notification settings must allow notifications. An installed PWA and HTTPS are required for the intended phone experience.
3. Choose a delivery time; the default timezone is Africa/Nairobi. The server sends while the app is closed. The push contains the story title and the exact edition ID; tapping opens that edition even on a later day. Network/OS power saving can delay arrival; 08:00 is the server send target.
4. Open and save an edition before going offline. Opened editions are retained in IndexedDB and the app shell in the service worker. Saved IDs stay on that device. Storage can be evicted by Android, private browsing or clearing site data; this is offline convenience, not a substitute for a backup. Logout clears private device readings and favourites.

Allow outbound HTTPS to Android’s push endpoint `fcm.googleapis.com` (and `updates.push.services.mozilla.com` or `web.push.apple.com` if using those browsers). VAPID keys are generated once and retained in the database; replacing them invalidates existing subscriptions. Different phones can each subscribe. A lost phone can be revoked by deleting its subscription in the database; rotating the password alone does not revoke active sessions, so also clear `sessions` when revoking access.

## Optional official WhatsApp delivery

Use a Meta WhatsApp Business account and a registered phone number. Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME`, and optionally `WHATSAPP_TEMPLATE_LANGUAGE` and the supported `WHATSAPP_GRAPH_VERSION` (default `v23.0`). Allow outbound `graph.facebook.com`. Obtain an **approved message template with two body parameters in this order: story title, full reading URL**, e.g. “Your Founder’s Morning reading: {{1}}. Read privately: {{2}}”. Approval/category, business verification, recipient testing, access-token lifecycle, current Graph version and Meta fees are your account’s responsibility.

In app settings, enter your international number (e.g. `+254…`) and explicitly opt in. The server will reject activation without consent, a valid number, and configured provider fields. Disable it at any time in settings. A WhatsApp link still requires the private app password; the message contains the title and link, not the full private reading.

## Retry and outage behavior

SQLite enforces one edition per local calendar date and one delivery record per edition/channel/device. Publishing retries preserve the original ID, text, sources and quote. A claimed provider send is recorded before network I/O. Confirmed rate-limit rejections can retry at most three times; expired push subscriptions are removed. Timeout, 5xx or process crashes after claiming are marked **uncertain** and held rather than automatically risking duplicate notifications. This trades a possible missed notification for safety: provider APIs do not guarantee exactly-once delivery. Review provider logs before manually resetting an uncertain delivery to `pending`. Reading access remains available regardless of notification status. Notifications arriving after the fact can replace a same-edition topic on the device.

## Validation

```sh
npm test
npm run simulate
# Uses installed Chromium by default; override CHROMIUM_PATH if needed.
npm run test:browser
```

The simulation uses a temporary database and three successive Nairobi mornings, then retries the second run, keeping real history untouched. Browser tests exercise sign-in, saved/offline reading and a notification-click route. Real Android push reception, Meta delivery, live paid AI calls and public HTTPS hosting require your configured services and device; local mocked transport checks do not establish those integrations work.
