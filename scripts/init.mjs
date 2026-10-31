import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env')) { console.log('.env already exists; preserved.'); }
else {
  writeFileSync('.env', `PORT=3000\nAPP_URL=http://localhost:3000\nAPP_PASSWORD=${randomBytes(24).toString('base64url')}\nDATA_DIR=./var\nVAPID_SUBJECT=mailto:you@example.com\n`, {mode:0o600,flag:'wx'});
  console.log('Created private .env with a random app password. Read it locally to sign in; do not commit it. Set APP_URL and VAPID_SUBJECT before hosting.');
}
