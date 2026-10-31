import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./test',testMatch:'browser.spec.mjs',workers:1,fullyParallel:false,timeout:30000,
  reporter:[['list']],
  use:{baseURL:'http://127.0.0.1:4173',viewport:{width:390,height:844},launchOptions:{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']},trace:'retain-on-failure'},
  webServer:{command:'node test/fixtures-server.mjs',url:'http://127.0.0.1:4173/api/session',reuseExistingServer:false,timeout:30000},
});
