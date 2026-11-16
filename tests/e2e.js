// Loads the real extension into Chromium and runs it against a mock instagram.com.
// Usage: node tests/e2e.js
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { DELAY_MS } = require('../extension/src/lock.js');

const MOCK = `<!doctype html><title>mock</title>
<a href="/">Home</a><a href="/explore/">Explore</a><a href="/reels/">Reels</a><a href="/direct/inbox/">Messages</a>
<button id="spa" onclick="history.pushState({}, '', '/reels/')">SPA to reels</button>`;

(async () => {
  // Copy the extension and add an empty background worker, only so the test can learn the extension id.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lockr-'));
  const ext = path.join(tmp, 'ext');
  fs.cpSync(path.join(__dirname, '..', 'extension'), ext, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  manifest.background = { service_worker: 'bg.js' };
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(ext, 'bg.js'), '');

  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  await ctx.route('https://www.instagram.com/**', (r) => r.fulfill({ contentType: 'text/html', body: MOCK }));
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
  const extId = new URL(sw.url()).host;
  const setStore = (v) => sw.evaluate((x) => chrome.storage.local.set(x), v);

  const page = await ctx.newPage();
  const lands = async (from, to) => {
    await page.goto('https://www.instagram.com' + from);
    await page.waitForFunction((p) => location.pathname === p, to, { timeout: 5000 });
    await page.waitForFunction(() => getComputedStyle(document.body).visibility === 'visible');
    console.log(`ok  ${from} -> ${to}`);
  };

  await lands('/', '/direct/inbox/');
  await lands('/explore/', '/direct/inbox/');
  await lands('/direct/t/123/', '/direct/t/123/');
  await lands('/p/Cabc/', '/p/Cabc/');
  await lands('/friend/', '/direct/inbox/');

  assert.strictEqual(await page.locator('a[href="/explore/"]').isVisible(), false);
  assert.strictEqual(await page.locator('a[href="/direct/inbox/"]').isVisible(), true);
  console.log('ok  feed links hidden, messages link visible');

  await page.goto('https://www.instagram.com/direct/t/123/');
  await page.click('#spa');
  await page.waitForFunction(() => location.pathname === '/direct/inbox/', null, { timeout: 5000 });
  console.log('ok  in-page navigation to /reels/ is caught');

  await setStore({ profiles: [{ name: 'friend', addedAt: Date.now() }] });
  await lands('/friend/', '/direct/inbox/');
  await setStore({ profiles: [{ name: 'friend', addedAt: Date.now() - DELAY_MS - 1000 }] });
  await lands('/friend/', '/friend/');

  await setStore({ unlockRequestedAt: Date.now() });
  await lands('/explore/', '/direct/inbox/');
  await setStore({ unlockRequestedAt: Date.now() - DELAY_MS - 1000 });
  await lands('/explore/', '/explore/');
  assert.strictEqual(await page.locator('a[href="/explore/"]').isVisible(), true);
  await setStore({ unlockRequestedAt: null });
  await page.waitForFunction(() => location.pathname === '/direct/inbox/', null, { timeout: 5000 });
  console.log('ok  unlock window opens after the delay, and re-locks live');

  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.waitForSelector('text=Locked: messages only');
  await popup.click('#unlock');
  await popup.waitForSelector('text=/Full access in/');
  await popup.click('#unlock');
  await popup.fill('#name', '@NASA');
  await popup.click('#add button');
  await popup.waitForSelector('text=@nasa');
  await popup.fill('#name', 'explore');
  await popup.click('#add button');
  await popup.waitForSelector('text=That is not a valid username.');
  await popup.screenshot({ path: process.env.SHOT || path.join(tmp, 'popup.png') });
  console.log('ok  popup flow');

  await ctx.close();
  console.log('ALL PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
