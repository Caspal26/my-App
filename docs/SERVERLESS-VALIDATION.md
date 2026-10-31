# Serverless validation

Validated locally on 31 October 2026. This records local results, the pre-deployment results. The live deployment checks below were added on 1 November 2026 (Africa/Nairobi); they do not guarantee free-plan capacity for live AI research.

- `npm ci`, repeated local initialization and D1 migration, and the Worker dry-run build passed. Private `.dev.vars` was preserved; no credential values were printed. The bundle was approximately 73 KiB gzipped.
- `npm test`: **36 passed**, zero failed/skipped. This includes the retained Node/research checks and **20 serverless checks** using real D1/workerd instances.
- `npm run test:browser:serverless`: **5 passed**. The phone interface ran against the compiled Worker, including a regression test for navigating during initial loading, including private login, settings, source links, saved reading after a fully offline reload, sign-out clearing device data, encouragement and service-worker notification navigation to an historical edition.
- Three actual scheduled Worker invocations at successive simulated Nairobi mornings published Adii Pienaar, Benjamin Franklin and Brian Gardner with three distinct events and verified philosophy quotes. Retrying the second morning preserved the entire original edition and left total simulated provider sends at three.
- Push ciphertext was generated inside workerd, captured through a mocked provider, and decrypted by the independent Web Push decoding library. Each title and deep link matched its published edition. This discovered and fixed Workers’ unsupported `redirect: 'error'` option; transport now uses manual redirect handling without forwarding credentials.
- Concurrent D1 invocations allocated one edition for the same date, kept different dates’ events/quotes distinct, claimed each send once, cancelled pending sends after opt-out and held ambiguous delivery outcomes for review.
- The actual Wrangler development runtime also served an authenticated sourced reading. Invoking its local scheduled endpoint twice preserved the same ID/content and reserve count.

## Live deployment checks

- Worker and managed HTTPS deployed at https://founders-morning.caspal26.workers.dev with production D1 and an active one-minute Cron Trigger. No paid plan was enabled.
- Live unauthenticated API access returns 401. Sign-in succeeds with Secure/HttpOnly/SameSite cookies; protected settings show 08:00 Africa/Nairobi. Only the public push key is exposed.
- With zero subscribed devices, a controlled current-day schedule test published the first sourced edition through a real Cloudflare Cron invocation. Delivery time was restored to 08:00. No notification was sent. The title/ID persisted across deployment.
- Live Chrome at phone dimensions signed in, saved the reading, fully reloaded offline and reopened the same saved piece. It reported no page errors. This exposed a redirected-HTML cache issue on Cloudflare; the service worker now caches the canonical root and returns a fresh non-redirected response offline.
- The Android starter was rebuilt and signature-verified with the live connection URL prefilled, retaining its original signing certificate. Physical-device installation and push receipt have not been tested here.

The research API key is still absent, so the initial five editions are finite (four remain unused). Live OpenAI research/source access, physical Android push arrival, WhatsApp delivery and research CPU/quota use remain unverified. No Render service was created.
