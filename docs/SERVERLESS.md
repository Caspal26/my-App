# Scheduled serverless hosting

Founder’s Morning can run on **Cloudflare Workers + D1**, with its phone interface served as Worker static assets. There is no continuously running app server, VM, container or attached disk. Cloudflare starts a short Worker invocation for an incoming request or scheduled tick, and D1 retains the private application data between invocations.

The scheduled Worker checks the saved time and timezone once per minute. It researches before delivery, prepares one immutable edition per local calendar day, and sends through phone push or the optional official WhatsApp API. Default delivery remains **08:00 Africa/Nairobi**; research begins 45 minutes before it. Cron expressions run in UTC, while application decisions use the saved IANA timezone. Changing the delivery time in the app does not require editing a UTC cron expression.

**Deployment status:** the repository contains the serverless implementation and deployment configuration. No Cloudflare account has been connected or remote Worker/D1 database created by this task. The all-zero database ID in `wrangler.jsonc` is a local placeholder, not a live resource. No paid Render service was created; do not retry the previous always-running Render deployment for this workflow.

## Costs and capacity

Cloudflare offers free Workers and D1 quotas. This app does not require a fixed-cost always-running server, but that does not promise a zero-cost service. OpenAI web research and writing use separately billed API calls; WhatsApp may have provider charges. Check the current Cloudflare plan and account limits before enabling a paid upgrade.

Cloudflare’s published limits at preparation time give Workers Free **10 ms CPU per scheduled invocation** and **50 subrequests per invocation**. Waiting on network/database calls does not count as CPU time, but parsing, hashing, authentication and push encryption do. Full source verification can exceed a free CPU budget even for one person. The scheduler limits fresh research to one candidate per run, keeps a researched reserve, and fails safely instead of inventing a replacement. Check real CPU/error metrics after deployment. If live research exceeds Free limits, use a suitable scheduled research service or a paid Workers plan; either option can still avoid a continuously running server. Local build/tests do not establish production free-plan capacity.

Cron changes can take up to 15 minutes to propagate. The cron interval is one minute, not an exact phone-arrival guarantee: provider processing, network availability and Android notification settings can delay receipt.

Official references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [static assets](https://developers.cloudflare.com/workers/static-assets/). The Workers limits, cron and asset-binding instructions were checked against Cloudflare’s official `cloudflare/cloudflare-docs` source repository; remote deployment has not been verified here.

## Connect an account

You can deploy from your own computer after cloning `Caspal26/my-App`, or let this cloud session deploy once it has Cloudflare access.

- On your computer, install dependencies with `npm ci`, then run `npx wrangler login` and complete Cloudflare’s browser sign-in.
- For an automated cloud deployment, supply **`CLOUDFLARE_API_TOKEN`** securely to this environment, with HTTPS destination **`api.cloudflare.com`**, and **`CLOUDFLARE_ACCOUNT_ID`** as the non-secret account ID. Scope the token to the intended account. It needs Workers script and Cron Trigger editing, D1 editing and account-settings read access. Cloudflare’s **Edit Cloudflare Workers** token template is a starting point; ensure D1 access is included. Optional custom-domain routing needs the appropriate zone permissions too. Do not paste a token into chat or commit it.

The Cloudflare account token is only a deployment credential. It is not an application binding and must not be bundled into the Worker or the Android APK. The Render API key does not grant Cloudflare access.

## Local development

Requires the repository’s Node.js version and installed development dependencies, including Wrangler.

```sh
cd /workspace/my-App
npm ci
npm run init:serverless
# .dev.vars contains a generated private development password.
# Add a real notification contact and optional research key locally; never print or commit values.
npx wrangler d1 migrations apply DB --local
npx wrangler dev --test-scheduled
```

The local origin is normally `http://localhost:8787`, matching `.dev.vars.example`. It is a local development address, not a phone-installation or public preview link. Local D1 data is separate from production D1. Use disposable local databases for simulated dates; do not advance the production ledger to test future mornings.

The existing `npm start` command runs the earlier Node development server; it is not the serverless production runtime. Deploy the Worker entry point in `wrangler.jsonc` for this hosting route.

## Create the persistent D1 database

After authenticating Wrangler:

```sh
npx wrangler d1 create founders-morning
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing the all-zero placeholder. The ID is not a credential. Preserve the `DB` binding and `workers/migrations` path, then apply the schema:

```sh
npx wrangler d1 migrations apply DB --remote
```

Keep this D1 database across code deployments. It stores the permanent event/quote ledger, unused reserve, published readings, settings, sessions, delivery attempts, subscriptions and VAPID keys. Deleting or replacing it loses non-repetition history and device subscriptions. Use D1’s supported export/backup facilities and keep exports private. The local Node SQLite database is separate; a fresh D1 deployment begins with the bundled reserve unless a deliberate migration imports prior history.

## Set application secrets and deploy

Supply these through Wrangler’s supported secret prompts or the Cloudflare dashboard’s Worker secrets editor:

```sh
npx wrangler secret put APP_PASSWORD
npx wrangler secret put RESEARCH_API_KEY
npx wrangler secret put VAPID_SUBJECT
```

- `APP_PASSWORD`: a unique private passphrase of at least 12 characters. Store it in your password manager.
- `RESEARCH_API_KEY`: your OpenAI API key with Responses API/web-search access and billing enabled. If absent, the finite researched reserve works, but automatic new stories cannot replenish it. Do not supply a fake key. `OPENAI_MODEL` can override the default model if needed.
- `VAPID_SUBJECT`: `mailto:` followed by your real contact email, used for web-push identification.

If Wrangler offers to create the named Worker while adding its first secret, that creates the intended deployment target. It does not create an always-running app server. Keep secret values out of command arguments, source files, logs and chat.

Build/upload the Worker and public assets:

```sh
npx wrangler deploy
```

Wrangler reports the actual HTTPS `workers.dev` address. Set that exact origin for scheduled notification links, then deploy the configured application:

```sh
npx wrangler secret put APP_URL
# At the prompt, enter the actual https://...workers.dev origin, without a path.
npx wrangler deploy
```

`APP_URL` is essential to scheduled delivery because a Cron invocation has no incoming browser URL. Do not use a localhost address in production. If you later attach a custom domain, update `APP_URL` to its HTTPS origin. A new code deployment must keep the same D1 binding and secret bindings.

The `assets.run_worker_first` setting invokes the Worker before static asset responses so the application’s security headers apply consistently. All research, password, WhatsApp and VAPID private keys remain server-side; only public push key material reaches the browser.

## Check the live service and install it

1. Open the deployed HTTPS address and sign in. The app should show the published daily reading or an honest pending/unavailable state, depending on local delivery time and reserve availability.
2. In **My ritual**, check the saved timezone/time and research connection. The default is 08:00 Africa/Nairobi.
3. Enable phone notifications in Chrome on Android, then use **Install app** or **Add to Home screen**. The serverless Worker can send while the phone app is closed.
4. After signing in, inspect `/api/status` on the deployed origin to check reserve count, research jobs and delivery outcomes. Also inspect Cloudflare’s invocation/error and CPU metrics. Do not treat a passed local test as proof the account’s AI, source access or push delivery works.
5. Open and save one edition, then verify it still opens in airplane mode. Tap a real received notification and verify its title opens the same edition even on another day.

Publishing and delivery remain distinct: retries preserve the original edition and event/quote ledger. Every channel/device gets a unique delivery row, claimed before provider I/O. Explicit rate-limit rejections can retry within the bounded policy. Ambiguous timeouts or interrupted sends are held as uncertain rather than resent automatically; inspect provider evidence before manually retrying them. Opt-out cancels pending delivery on that channel.

The offline starter APK remains an independent five-reading starter. Its connection setting opens the hosted PWA in the browser; its local archive and the PWA’s storage do not automatically sync.

## Optional WhatsApp

Set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` and, if needed, `WHATSAPP_TEMPLATE_LANGUAGE` / `WHATSAPP_GRAPH_VERSION` as Worker secrets/bindings. Use the official WhatsApp Business Platform with an approved template whose two body parameters are the story title and full reading URL. In the app, enter an international number and explicitly opt in. Disable the channel in settings to withdraw consent. Account setup, approvals, provider fees and a real delivery test remain external prerequisites.
