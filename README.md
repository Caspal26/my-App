# Founder’s Morning

Caspal’s private morning reading: one researched founder episode, one verified philosophy quote, and one manageable invitation. The Android-installable PWA includes today’s reading, archive, favourites, offline reopening and encouragement.

**Live app: [founders-morning.caspal26.workers.dev](https://founders-morning.caspal26.workers.dev).** Sign in with your private app password, then install from Chrome on Android.

**Current hosting: scheduled functions on Cloudflare Workers + D1. No continuously running app server or Render service is required.** Requests and a one-minute Cron Trigger start short invocations; D1 retains editions, the permanent story/quote ledger, settings, subscriptions and delivery attempts between them. Default delivery is 08:00 Africa/Nairobi, with research beginning 45 minutes beforehand. The time and timezone can be changed in the app.

The [offline starter APK](dist/founders-morning-offline.apk) remains available with five bundled readings. Its settings open the hosted PWA once an HTTPS address is connected. [Android installation notes](docs/ANDROID.md) explain the starter’s limits.

## Serverless setup

Follow [the serverless hosting guide](docs/SERVERLESS.md) for Cloudflare account access, D1 creation, secrets, deployment and Android installation. Cloudflare provides HTTPS on the resulting `workers.dev` address. The existing production D1 ID is recorded in `wrangler.jsonc`; preserve it across deployments. Use a different database only for an explicitly separate installation.

```sh
npm ci
npm run init:serverless
# Read your private development password in .dev.vars; add a notification contact if needed.
npm run migrate:local
npm run dev:serverless
```

Local development uses Cloudflare’s workerd runtime and a separate local D1 database. Do not run simulated future dates against production history. The production Worker and D1 database are deployed; local development data remains separate.

Set production secrets using Wrangler’s prompts or the Cloudflare dashboard: `APP_PASSWORD`, `RESEARCH_API_KEY`, `VAPID_SUBJECT` and the actual HTTPS origin as `APP_URL`. Scheduled notifications need the last value when no browser request is present. Credentials and VAPID private keys stay out of browser assets, Git, the APK and chat. The Cloudflare deployment token is separate and must never become an application binding.

## Research and daily publishing

Five researched reserve readings are bundled; [research notes](docs/RESEARCH.md) document the opened sources, exact quotations, dates and limitations. This initial selection is software-heavy and lacks verified Kenyan/healthcare-company founders; live research prioritises those gaps. Without a research key, the finite reserve works until exhausted, then reports unavailability rather than repeating a story.

The live pipeline uses OpenAI Responses web search, opens story and original quote sources, checks exact retained excerpts, and runs a separate source and semantic-repeat audit. Candidates are compared with published history and unused reserves, including earlier quotes and their variants. Event, quote and local-date uniqueness constraints protect publication across concurrent invocations and retries. [Provider details](docs/PROVIDERS.md) explain access and evidence checks. Live paid research remains unverified without credentials.

Each serverless invocation generates at most one candidate. A durable research lease prevents overlapping cron runs from making duplicate requests. Failures preserve the reserve; retries are bounded. D1 retains source links, excerpts, research timestamps and available document hashes. Keep and back up the database across releases—replacing it loses the history needed to avoid repeats.

## Phone delivery and offline use

Open the deployed HTTPS app in Chrome on Android, sign in, and choose **Install app** or **Add to Home screen**. Enable phone notifications in **My ritual**. The scheduled function sends while the app is closed; each notification names and opens its own edition. OS/network delays can affect arrival time.

Opened readings are retained in IndexedDB; favourites stay on that device. Open and save a piece before going offline. Sign-out clears device readings and favourites and attempts to unsubscribe that device. Android storage eviction or uninstalling can remove local content; the published archive stays in D1. The APK starter and PWA have separate local archives.

The outbox is unique per edition/channel/device and is claimed atomically before provider I/O. Confirmed rate-limit rejection can retry at most three times. Ambiguous network failures, 5xx responses or interrupted sends are held as uncertain to avoid duplicates. Inspect provider evidence before manually resending. Opt-out cancels pending sends. Provider APIs do not promise exactly-once external delivery.

Optional WhatsApp uses the official Business Platform, an approved template with two body parameters (title and reading URL), configured Worker credentials and explicit in-app consent. It starts disabled. See [the serverless guide](docs/SERVERLESS.md#optional-whatsapp).

## Verification and costs

```sh
npm test
npm run test:browser:serverless
npm run build:serverless
```

Serverless tests use disposable real D1/workerd instances: three simulated mornings, unchanged retry, concurrent publication and delivery, quote history, encrypted Web Push and opt-out. Browser tests run the same phone interface against the Worker and check offline reload and exact-edition notification handling. Provider transport is mocked; real Android reception, paid AI, WhatsApp and public hosting still need configured accounts and a device.

Workers and D1 offer free quotas; AI and possibly WhatsApp have usage charges. Source verification may exceed Workers Free’s CPU allowance, so zero-cost production operation is not guaranteed. A suitable paid serverless plan or separate scheduled research job can still avoid a continuously running app server. See [capacity details](docs/SERVERLESS.md#costs-and-capacity).

The earlier Node/SQLite implementation remains available for development and regression checks with `npm start`; it is not the selected hosting route. See [Node development reference](docs/NODE-DEVELOPMENT.md). Use the existing isolated checkout; no worktree is required.

## OMC Advocates website

This repository also contains the static website for OMC Advocates (`omcadvocates.co.ke`) in [`website/`](website/README.md). Build it with `npm run build:website` and upload `website/omc-advocates-public_html.zip` to the cPanel `public_html` folder. It is independent of the Founder’s Morning app.
