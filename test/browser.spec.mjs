import { test,expect } from '@playwright/test';
async function signIn(page){await page.goto('/');await page.getByLabel('Your private passphrase').fill('browser-test-passphrase-only');await page.getByRole('button',{name:/Open my morning/}).click();await expect(page.locator('.reading-top h2')).toBeVisible();}

test('private login, three sourced readings, mobile/desktop layout and delivery settings',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Welcome back, Caspal.'})).toBeVisible();
  const unauthorized=await page.request.get('/api/today');expect(unauthorized.status()).toBe(401);
  await page.getByLabel('Your private passphrase').fill('browser-test-passphrase-only');await page.getByRole('button',{name:/Open my morning/}).click();await expect(page.locator('.reading-top h2')).toBeVisible();
  await expect(page.locator('.edition-label')).toContainText('TODAY’S READING');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'var/screenshots/mobile.png',fullPage:true});
  await page.locator('#sources-toggle').click();expect(await page.locator('#edition-sources a').count()).toBeGreaterThanOrEqual(2);
  await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(page.locator('.edition-list-item')).toHaveCount(3);
  const response=await page.request.get('/api/editions');const {editions}=await response.json();
  expect(new Set(editions.map(e=>e.eventKey)).size).toBe(3);expect(new Set(editions.map(e=>e.quote.text)).size).toBe(3);
  for(const edition of editions){expect(edition.sources.some(s=>s.kind==='story')).toBe(true);expect(edition.sources.some(s=>s.kind==='quote')).toBe(true);}
  await page.click('#settings-toggle');await expect(page.locator('#delivery-time')).toHaveValue('08:00');await expect(page.locator('#timezone')).toHaveValue('Africa/Nairobi');
  await page.locator('#delivery-time').fill('07:45');await page.getByRole('button',{name:/Save my ritual/}).click();await expect(page.locator('#toast')).toHaveText('Your morning ritual is saved.');
  await page.click('#settings-toggle');await expect(page.locator('#delivery-time')).toHaveValue('07:45');
  await page.setViewportSize({width:1440,height:1080});await page.getByRole('button',{name:'Today',exact:true}).click();await expect(page.locator('.reading-top h2')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'var/screenshots/desktop.png',fullPage:true});expect(errors).toEqual([]);
});

test('saved reading survives a completely offline page reload and session logout clears it',async({page,context})=>{
 await signIn(page);const title=await page.locator('.reading-top h2').textContent();
 await page.click('#save-reading');await expect(page.locator('#save-reading')).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.edition-list-item')).toHaveCount(1);await page.locator('.edition-list-item').click();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await context.setOffline(true);await page.reload();await expect(page.locator('.reading-top h2')).toHaveText(title);await expect(page.locator('#offline-banner')).toBeVisible();await expect(page.locator('#save-reading')).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Saved',exact:true}).click();await expect(page.locator('.edition-list-item')).toHaveCount(1);
 await context.setOffline(false);await page.click('#settings-toggle');await page.click('#logout');await expect(page.locator('#auth')).toBeVisible();
 expect(await page.evaluate(()=>localStorage.getItem('fm:saved'))).toBe(null);
 expect(await page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('founders-morning',1);request.onsuccess=()=>{const tx=request.result.transaction('editions','readonly');const count=tx.objectStore('editions').count();count.onsuccess=()=>resolve(count.result);count.onerror=()=>reject(count.error);};}))).toBe(0);
});

test('service worker notification tap navigates to the exact historical edition',async({page,context})=>{
 await signIn(page);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const {editions}=await (await page.request.get('/api/editions')).json();const expected=editions.at(-1);const today=editions[0];expect(expected.id).not.toBe(today.id);
 const workers=context.serviceWorkers();expect(workers.length).toBeGreaterThan(0);const worker=workers[0];
 // Exercise the installed push and notificationclick listeners with platform event stand-ins.
 // Network push transport is mocked; notification display and clients.navigate/API retrieval are real.
 await context.grantPermissions(['notifications']);
 const notification=await worker.evaluate(async({id,title})=>{let pending;const event=new Event('push');Object.defineProperties(event,{data:{value:{json:()=>({title,body:'Your morning reading is ready.',editionId:id,url:`/?edition=${id}`})}},waitUntil:{value:p=>{pending=p;}}});self.dispatchEvent(event);if(pending)await pending;const notifications=await self.registration.getNotifications();return {title:notifications[0].title,url:notifications[0].data.url};},{id:expected.id,title:expected.title});
 expect(notification.title).toBe(expected.title);expect(notification.url).toBe(`/?edition=${expected.id}`);
 await worker.evaluate(async({id})=>{let pending;const notification=(await self.registration.getNotifications()).find(n=>n.data.url===`/?edition=${id}`);const event=new Event('notificationclick');Object.defineProperties(event,{notification:{value:notification},waitUntil:{value:p=>{pending=p;}}});self.dispatchEvent(event);if(pending)await pending;},{id:expected.id});
 await expect(page).toHaveURL(new RegExp(`edition=${expected.id}`));await expect(page.locator('.reading-top h2')).toHaveText(expected.title);await expect(page.locator('.quote blockquote')).toHaveText(expected.quote.text);
});

test('encouragement leaves the daily edition and permanent history intact',async({page})=>{
 await signIn(page);const before=await(await page.request.get('/api/editions')).json();const title=await page.locator('.reading-top h2').textContent();
 await page.click('#encouragement-button');await expect(page.locator('#reflection-dialog')).toBeVisible();await expect(page.locator('#reflection-content')).toContainText(/Caspal|talQen|colleague/);
 await page.getByRole('button',{name:'Close reflection'}).click();await expect(page.locator('.reading-top h2')).toHaveText(title);expect(await(await page.request.get('/api/editions')).json()).toEqual(before);
});

test('opening settings during initial loading keeps settings visible after the older reading response',async({page})=>{
 let release;
 const delayed=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/today',async route=>{const response=await route.fetch();await delayed;await route.fulfill({response});});
 await page.goto('/');await page.getByLabel('Your private passphrase').fill('browser-test-passphrase-only');
 await page.getByRole('button',{name:/Open my morning/}).click();await expect(page.locator('#app')).toBeVisible();
 await page.click('#settings-toggle');await expect(page.locator('#delivery-time')).toBeVisible();
 const response=page.waitForResponse(r=>r.url().endsWith('/api/today'));release();await(await response).finished();
 await page.waitForLoadState('networkidle');
 await expect(page.locator('#delivery-time')).toBeVisible();await expect(page.locator('#main-content')).toContainText('Make room for your morning.');
});
