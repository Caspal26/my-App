# Give Founder’s Morning an HTTPS address

The simplest option is a managed **Render web service**. Render runs the server and supplies an address such as `https://your-service.onrender.com` with an HTTPS certificate. You do not need to configure Linux, Nginx or Certbot. Keep the app password private: an HTTPS address makes the server reachable, while the app's sign-in protects the readings and settings.

This repository includes [render.yaml](../render.yaml), a deployment Blueprint. It has not been deployed or validated by a live Render account in this task. Render's official documentation site was blocked by this development environment's network policy, so review the Blueprint in Render before creating its paid resources.

## 1. Put the code in your GitHub repository

Your selected repository is `Caspal26/my-App`. The code built in this workspace must be committed and pushed before Render can read it. No push has been performed by this task.

If you have the project on your computer, GitHub Desktop can publish the changes to that repository. With Git from the project directory, the equivalent is:

```sh
git status
git add .
git diff --cached --stat
git commit -m "Build Founder's Morning"
git branch -M main
git push -u origin main
```

Before committing, inspect the staged files. **Never commit `.env`, `var/`, API keys, passwords or Android signing keys.** The app's `.gitignore` excludes its local environment file, database and dependencies. Keep any APK signing keystore outside the repository. Use your existing GitHub authentication; do not paste an access token into a command or chat. If you use this cloud workspace rather than your computer, the push still needs to be performed through its authorized Git workflow.

## 2. Create the service

1. Sign in at [Render](https://render.com/) and connect your GitHub account.
2. Choose **New → Blueprint**, select `Caspal26/my-App`, and use branch `main`. Render should find `render.yaml` in the repository root.
3. Review the resources: one **Starter web service** and a **1 GB persistent disk** at `/var/data`. These are paid resources; check the current price in Render before confirming. Keep the app at one instance.
4. Enter the private environment values requested below and create the Blueprint.

The server must stay running to research and send at the scheduled time. A free service that sleeps, an ephemeral filesystem, or a static-site deployment will not support this workflow.

If you prefer **New → Web Service**, choose the same repository and enter these settings manually:

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check path | `/api/session` |
| Plan | An always-running plan supporting persistent disks |
| Instances | `1` |
| Persistent disk | Mount at `/var/data`, size 1 GB |

## 3. Set the environment values securely

Enter these in **Render's environment settings**, not in source code or chat:

| Name | What to enter |
| --- | --- |
| `APP_PASSWORD` | A unique private passphrase of at least 12 characters. Save it in your password manager; it is the app's sign-in password. |
| `RESEARCH_API_KEY` | Your OpenAI API key with Responses API/web-search access and API billing enabled. This powers new researched editions. |
| `VAPID_SUBJECT` | `mailto:` followed by your real email address, for example `mailto:your-address@example.com`. |
| `NODE_VERSION` | `24` |
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/data` |

The Blueprint supplies the last three values. The app uses Render's automatic `RENDER_EXTERNAL_URL` as its public address, so `APP_URL` can remain unset. If you add a custom domain later, set `APP_URL=https://your-domain` and redeploy. Do not set `APP_URL` to `localhost`. Render supplies `PORT`; leave it alone.

If you do not have a research key yet, you can deploy with that value omitted through the manual Web Service route and read the finite researched reserve. Automatic fresh stories will remain unavailable until the key is added. Do not use a made-up key. The app's settings and authenticated `/api/status` show whether research is configured and how many reserve editions remain.

## 4. Open it on your Android phone

1. Wait for a successful deployment, then copy the service's **HTTPS address** from Render.
2. Open it in Chrome on Android and sign in using `APP_PASSWORD`.
3. Choose Chrome's **⋮ → Install app** or **Add to Home screen**. The PWA installation works directly; an APK is not required for this route.
4. Open **My ritual → Enable phone notifications** and allow the permission. Check the phone's Android/Chrome notification settings too.
5. Leave the delivery time at **08:00 Africa/Nairobi**, or choose a time that fits your day. Open and save a reading, then try opening it again with airplane mode enabled.

If using the separate offline starter APK, its bundled readings work independently. Use its connection setting to open this hosted HTTPS service for fresh research and browser push; the starter APK does not itself provide the server's daily research service.

## 5. Check the first live morning

Before relying on unattended delivery:

- In Render's Shell, run `npm run research` once. It makes a paid API request and should add one newly verified edition to the reserve. If the service does not offer a shell, use its authenticated status page and inspect the next scheduled research job in the logs.
- After signing in, open `/api/status` on the same service. Check the reserve count and recent research/delivery outcomes. The JSON response is an operational check, not the normal reading interface.
- For a quick delivery check, temporarily choose a delivery time a few minutes ahead, keep a valid phone subscription enabled, and close the app. If today's edition has already been delivered to that subscription, the duplicate-safe ledger will correctly prevent sending it again. Use the next actual local day or a separate test environment for a fresh delivery attempt.
- Tap the received notification and confirm it opens its titled edition. Restore your preferred delivery time afterward.

Live AI research, actual Android push arrival and WhatsApp account delivery require your configured accounts and device; the repository's local tests do not establish those external integrations are working.

## Keep your history safe

Keep `/var/data` attached during redeploys. It stores the permanent event/quote ledger, published readings, reserve, subscriptions, sessions and VAPID private keys. Removing that disk loses the history that prevents repeats. Use SQLite's backup API or stop the server before copying its database and WAL state; do not copy only a live database file blindly. Keep backups private. A single instance and persistent disk are required by the current scheduler/SQLite design.

Optional WhatsApp delivery needs an official Meta WhatsApp Business account, approved template and explicit in-app consent. Follow the [main README](../README.md#optional-official-whatsapp-delivery) after the HTTPS app is working.

Official references: [Render Node services](https://render.com/docs/deploy-node-express-app), [Blueprint specification](https://render.com/docs/blueprint-spec), [persistent disks](https://render.com/docs/disks), [environment variables](https://render.com/docs/configure-environment-variables), and [custom domains and HTTPS](https://render.com/docs/custom-domains).
