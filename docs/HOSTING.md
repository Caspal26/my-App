# HTTPS hosting

The selected architecture is **Cloudflare Workers + D1**, with scheduled functions and managed HTTPS. It does not require a continuously running app server.

Follow [the serverless deployment guide](SERVERLESS.md) for account access, database creation, private credentials, HTTPS deployment and Android installation.

The earlier always-running Render plan was cancelled after the hosting preference changed. Render rejected creation because payment information was missing; no Render service was created. The old Render Blueprint has been removed to prevent using that plan accidentally. The Render API credential is not needed for the selected Cloudflare deployment.
