// End-to-end test: drives the built app in a real browser (touch enabled) through
// setup, draws, discards, kita, an opponent riichi, undo/redo, reload, the
// end-of-hand dialog and the final result. On every screen it verifies that
//   1) no English (Latin letters) is visible to the user, and
//   2) no buttons overlap and nothing overflows horizontally,
// at iPad landscape / iPad portrait / iPhone / PC sizes.
// Usage: npm run build && npx vite preview & node scripts/e2e.mjs [url]
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

const VIEWPORTS = {
  ipadLandscape: { width: 1180, height: 820 },
  ipadPortrait: { width: 820, height: 1180 },
  iphone: { width: 390, height: 844 },
  pc: { width: 1366, height: 768 },
};

const browser = await chromium.launch({ executablePath, headless: true });
const ctx = await browser.newContext({
  viewport: VIEWPORTS.ipadLandscape, hasTouch: true, locale: 'ja-JP',
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
const errors = [];
const problems = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const tap = async code => page.locator(`.palette [data-code="${code}"]`).click();
const expectText = async (sel, re) => {
  await page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent ?? ''), [sel, re.source], { timeout: 8000 });
};
const settle = () => page.waitForFunction(() => !document.querySelector('.rec.partial'), null, { timeout: 10000 }).catch(() => {});

/** Visible Latin text anywhere in the UI (key names inside <kbd> and the word "AI" are allowed). */
async function scanEnglish(where) {
  const found = await page.evaluate(() => {
    const out = new Set();
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const check = (txt, ctx) => { const t = txt.replace(/\bAI\b/g, ''); if (/[A-Za-z]/.test(t)) out.add(`${ctx}: "${txt.trim().slice(0, 60)}"`); };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode, el = n.parentElement;
      if (!el || el.closest('kbd, script, style') || !n.textContent.trim()) continue;
      if (el.tagName !== 'OPTION' && !visible(el)) continue;
      check(n.textContent, 'text');
    }
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]')) {
      for (const a of ['title', 'aria-label', 'placeholder']) if (el.getAttribute(a)) check(el.getAttribute(a), a);
    }
    check(document.title, 'document.title');
    return [...out];
  });
  for (const f of found) problems.push(`[English @ ${where}] ${f}`);
}

/** Overlapping interactive elements or horizontal overflow. */
async function scanLayout(where) {
  const res = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    const els = [...document.querySelectorAll('button, select, input')].filter(el => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('.tile.rot') && !el.classList.contains('rot');
    });
    // Elements inside an open modal are compared only with each other.
    const modal = document.querySelector('.modal');
    const pool = modal ? els.filter(e => modal.contains(e)) : els;
    const rects = pool.map(e => [e, e.getBoundingClientRect()]);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i], [b, rb] = rects[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 3 && oy > 3) out.push(`overlap: "${a.textContent.trim().slice(0, 15)}" × "${b.textContent.trim().slice(0, 15)}"`);
      if (out.length > 8) return out;
    }
    // Text clipped inside buttons
    for (const [e] of rects) if (e.scrollWidth > e.clientWidth + 2 && e.tagName === 'BUTTON' && !e.classList.contains('tile')) out.push(`clipped text: "${e.textContent.trim().slice(0, 20)}"`);
    return out;
  });
  for (const r of res) problems.push(`[Layout @ ${where}] ${r}`);
}

async function checkAll(where) {
  for (const [name, vp] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(120);
    await scanLayout(`${where} / ${name}`);
  }
  await page.setViewportSize(VIEWPORTS.ipadLandscape);
  await page.waitForTimeout(80);
  await scanEnglish(where);
}

await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await checkAll('setup dialog');
await page.getByText('この局を開始').click();
await expectText('.prompt', /ドラ表示牌/);
await checkAll('dora prompt');
await tap('W'); // dora indicator West -> North is dora
for (const c of ['1m', '9m', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '2s', '3s']) await tap(c);
await expectText('.prompt', /ツモ牌/);
await tap('N');
await expectText('.rec', /北抜き|切り|リーチ/);
await settle();
await checkAll('first recommendation');
await page.screenshot({ path: 'e2e-shots/1-first-draw.png' });
const recLabel = await page.locator('.best-label').textContent();
console.log('最初の推奨:', recLabel);

// ---- Theme: auto follows the OS, toggle cycles, preference persists
const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme);
const fail = msg => problems.push(`[Theme] ${msg}`);
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(100);
if (await themeOf() !== 'dark') fail('auto did not follow OS dark');
await page.emulateMedia({ colorScheme: 'light' });
await page.waitForTimeout(100);
if (await themeOf() !== 'light') fail('auto did not follow OS light');
await page.getByTestId('theme').click(); // -> light
if (await themeOf() !== 'light') fail('light not applied');
await page.getByTestId('theme').click(); // -> dark
if (await themeOf() !== 'dark') fail('dark not applied');
await page.reload();
await page.waitForSelector('.palette');
if (await themeOf() !== 'dark') fail('dark preference not persisted after reload');
await settle();
await checkAll('first recommendation (dark)');
await page.screenshot({ path: 'e2e-shots/1b-first-draw-dark.png' });
await page.getByTestId('theme').click(); // -> auto (OS is light)
if (await themeOf() !== 'light') fail('auto did not return to OS theme');

await page.locator('button.best').click();
await page.waitForTimeout(300);
if (/北抜き/.test(recLabel ?? '')) {
  await expectText('.prompt', /嶺上牌/);
  await tap('E');
  await expectText('.rec', /切り|リーチ/);
  await page.locator('button.best').click();
}
await expectText('.prompt', /下家/);
await page.locator('section.opp').nth(1).getByText('リーチ').click();
await tap('5s');
await expectText('.prompt', /上家/);
// trigger a toast with an illegal tap (5th copy) to check notification text
await tap('1s');
await expectText('.prompt', /ツモ牌/);
await tap('S');
await expectText('.rec', /切り|リーチ|ベタオリ/);
await settle();
await checkAll('vs riichi');
await page.evaluate(() => scrollTo(0, 0));
await page.screenshot({ path: 'e2e-shots/2-vs-riichi.png' });
console.log('リーチ者がいる局面:', await page.locator('.best-label').textContent());
console.log('iPad横向きのページ高さ:', await page.evaluate(() => document.documentElement.scrollHeight), '(表示領域 820)');

// Undo / redo
await page.getByRole('button', { name: /戻す/ }).first().click();
await expectText('.prompt', /ツモ牌/);
await page.getByRole('button', { name: /やり直す/ }).click();

// Phone screenshot
await page.setViewportSize(VIEWPORTS.iphone);
await page.waitForTimeout(250);
await page.screenshot({ path: 'e2e-shots/3-phone.png', fullPage: true });
await page.setViewportSize(VIEWPORTS.ipadPortrait);
await page.waitForTimeout(250);
await page.screenshot({ path: 'e2e-shots/4-ipad-portrait.png' });
await page.setViewportSize(VIEWPORTS.ipadLandscape);

// Persistence
await page.reload();
await expectText('.prompt', /打牌|ツモ牌/);
console.log('再読み込み後の手牌枚数:', await page.locator('.hand .tile').count());

// End-of-hand dialog
await page.getByText('局終了').click();
await page.waitForSelector('.modal');
await checkAll('end-of-hand dialog');
await page.screenshot({ path: 'e2e-shots/5-end-dialog.png' });
await page.getByText('キャンセル').click();

// Final result: start East 3 with a clear leader, dealer noten draw -> match ends
await page.getByRole('button', { name: '設定' }).click();
await page.locator('.modal .seg button', { hasText: '3局' }).click();
await page.locator('.modal input[type=number]').first().fill('45000');
await page.locator('.modal input[type=number]').nth(1).fill('30000');
await page.locator('.modal input[type=number]').nth(2).fill('30000');
await page.getByText('この局を開始').click();
await tap('W');
for (const c of ['1m', '9m', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '2s', '3s']) await tap(c);
await page.getByText('局終了').click();
await page.locator('.modal .seg button', { hasText: '流局（荒牌）' }).click();
await page.locator('.modal .row .seg button', { hasText: '自分' }).last().click().catch(() => {});
await page.getByText('確定').click();
await page.waitForSelector('.final-row');
await checkAll('final result');
await page.screenshot({ path: 'e2e-shots/6-final.png' });
console.log('終局ダイアログ:', (await page.locator('.dialog h2').textContent()));

await browser.close();
if (problems.length) console.error(problems.join('\n'));
if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
if (problems.length || errors.length) process.exit(1);
console.log('E2E OK — 英語表示なし・レイアウト崩れなし');
