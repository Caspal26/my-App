# Serverless validation

Validated locally on 31 October 2026. This records local results, not a remote Cloudflare deployment or a free-plan capacity guarantee.

- `npm ci`, repeated local initialization and D1 migration, and the Worker dry-run build passed. Private `.dev.vars` was preserved; no credential values were printed. The bundle was approximately 73 KiB gzipped.
- `npm test`: **36 passed**, zero failed/skipped. This includes the retained Node/research checks and **20 serverless checks** using real D1/workerd instances.
- `npm run test:browser:serverless`: **4 passed**. The existing phone interface ran against the compiled Worker, including private login, settings, source links, saved reading after a fully offline reload, sign-out clearing device data, encouragement and service-worker notification navigation to an historical edition.
- Three actual scheduled Worker invocations at successive simulated Nairobi mornings published Adii Pienaar, Benjamin Franklin and Brian Gardner with three distinct events and verified philosophy quotes. Retrying the second morning preserved the entire original edition and left total simulated provider sends at three.
- Push ciphertext was generated inside workerd, captured through a mocked provider, and decrypted by the independent Web Push decoding library. Each title and deep link matched its published edition. This discovered and fixed Workers’ unsupported `redirect: 'error'` option; transport now uses manual redirect handling without forwarding credentials.
- Concurrent D1 invocations allocated one edition for the same date, kept different dates’ events/quotes distinct, claimed each send once, cancelled pending sends after opt-out and held ambiguous delivery outcomes for review.
- The actual Wrangler development runtime also served an authenticated sourced reading. Invoking its local scheduled endpoint twice preserved the same ID/content and reserve count.

No Cloudflare Worker or remote D1 database has been created. A scoped Cloudflare deployment token is still needed. Real Android push arrival, live OpenAI research/source access, WhatsApp delivery and production CPU/quota use remain unverified. No paid Render service was created; its always-running deployment plan has been retired.
