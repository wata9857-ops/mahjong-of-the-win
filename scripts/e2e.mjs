// End-to-end smoke test: drives the built app in a real browser (iPad-sized,
// touch enabled) through setup, draws, discards, an opponent riichi and a pon.
// Usage: npm run build && node scripts/e2e.mjs [url]   (default http://localhost:4173/)
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const candidates = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].filter(Boolean);
const executablePath = candidates.find(p => existsSync(p));
mkdirSync('e2e-shots', { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1,
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const tap = async code => page.locator(`.palette [aria-label="${code}"]`).click();
const expectText = async (sel, re) => {
  await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent ?? ''), [sel, re.source], { timeout: 8000 });
};

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.getByText('Start hand').click();
await expectText('.prompt', /DORA/);
await tap('W'); // dora indicator West -> North is dora
for (const c of ['1m', '9m', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '2s', '3s']) await tap(c);
await expectText('.prompt', /YOU DREW/);
await tap('N');
await expectText('.rec', /Kita|Discard|Riichi/);
await page.screenshot({ path: 'e2e-shots/1-first-draw.png' });
const recLabel = await page.locator('.best-label').textContent();
console.log('First recommendation:', recLabel);

// Apply the recommendation (one tap)
await page.locator('button.best').click();
await page.waitForTimeout(300);
// If kita was applied we must enter a replacement draw
if (/Kita/.test(recLabel ?? '')) {
  await expectText('.prompt', /REPLACEMENT/);
  await tap('E');
  await expectText('.rec', /Discard|Riichi/);
  await page.locator('button.best').click();
}
// Right player declares riichi and discards 5s, left discards 1s
await expectText('.prompt', /Shimocha/);
await page.locator('section.opp').nth(1).getByText('Riichi').click();
await tap('5s');
await expectText('.prompt', /Kamicha/);
await tap('1s');
await expectText('.prompt', /YOU DREW/);
await tap('S');
await expectText('.rec', /Discard|Riichi|Fold/);
await page.waitForFunction(() => !document.querySelector('.rec.partial'), null, { timeout: 8000 });
await page.evaluate(() => scrollTo(0, 0));
console.log('Page height at iPad landscape:', await page.evaluate(() => document.documentElement.scrollHeight), '(viewport 820)');
await page.screenshot({ path: 'e2e-shots/2-vs-riichi.png' });
console.log('Vs riichi:', await page.locator('.best-label').textContent());

// Undo / redo
await page.getByText('↶ Undo').click();
await expectText('.prompt', /YOU DREW/);
await page.locator('button.act:has-text("↷")').click();

// Portrait iPhone-sized layout render check
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: 'e2e-shots/3-phone.png', fullPage: true });

// Persistence: reload keeps the game
await page.setViewportSize({ width: 1180, height: 820 });
await page.reload();
await expectText('.prompt', /discard|DREW/i);
const handCount = await page.locator('.hand .tile').count();
console.log('Tiles in hand after reload:', handCount);

await browser.close();
if (errors.length) { console.error('Page errors:\n' + errors.join('\n')); process.exit(1); }
console.log('E2E OK');
