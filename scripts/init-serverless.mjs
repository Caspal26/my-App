import { existsSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if(existsSync('.dev.vars'))console.log('.dev.vars already exists; preserved.');
else{
  writeFileSync('.dev.vars',`APP_PASSWORD=${randomBytes(24).toString('base64url')}\nAPP_URL=http://localhost:8787\nVAPID_SUBJECT=\nRESEARCH_API_KEY=\nOPENAI_MODEL=gpt-4.1\n`,{mode:0o600,flag:'wx'});
  console.log('Created private .dev.vars with a random development password. Read it locally to sign in. Add a real notification contact and optional research key before testing those services.');
}
