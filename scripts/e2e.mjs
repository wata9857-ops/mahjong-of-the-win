// End-to-end test of the real UI in a browser (touch enabled):
// home → seat → 4-second countdown with a partial hand → turn banners →
// draw → instant recommendation → apply → opponent discards → fill in unknown
// tiles and dora later → themes → end of hand → final result.
// Every screen is scanned for (1) visible English and (2) overlapping /
// clipped controls or horizontal overflow at iPad landscape, iPad portrait,
// iPhone and PC sizes.
// Usage: npm run build && npx vite preview & node scripts/e2e.mjs [url]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/';
const executablePath = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
].filter(Boolean).find(p => existsSync(p));
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
const errors = [], problems = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const check = (cond, msg) => { if (!cond) problems.push(`[Flow] ${msg}`); };

const tap = code => page.locator(`.palette [data-code="${code}"]`).first().click();
const text = sel => page.locator(sel).first().textContent();
const waitText = (sel, re, timeout = 8000) =>
  page.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent ?? ''), [sel, re.source], { timeout });
const settle = () => page.waitForFunction(() => !document.querySelector('.rec3.partial'), null, { timeout: 10000 }).catch(() => {});

async function scanEnglish(where) {
  const found = await page.evaluate(() => {
    const out = new Set();
    const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const check = (txt, c) => { if (/[A-Za-z]/.test(txt.replace(/\bAI\b/g, ''))) out.add(`${c}: "${txt.trim().slice(0, 60)}"`); };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode, el = n.parentElement;
      if (!el || el.closest('kbd, script, style') || !n.textContent.trim()) continue;
      if (el.closest('details:not([open])') && !el.closest('summary')) continue;
      if (el.tagName !== 'OPTION' && !visible(el)) continue;
      check(n.textContent, 'text');
    }
    for (const el of document.querySelectorAll('[title], [aria-label], [placeholder]'))
      for (const a of ['title', 'aria-label', 'placeholder']) if (el.getAttribute(a)) check(el.getAttribute(a), a);
    check(document.title, 'document.title');
    return [...out];
  });
  for (const f of found) problems.push(`[English @ ${where}] ${f}`);
}

async function scanLayout(where) {
  const res = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    const els = [...document.querySelectorAll('button, select, input')].filter(el => {
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !(el.closest('details:not([open])') && !el.closest('summary'));
    });
    const modal = document.querySelector('.modal');
    const pool = modal ? els.filter(e => modal.contains(e)) : els;
    const rects = pool.map(e => [e, e.getBoundingClientRect()]);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const [a, ra] = rects[i], [b, rb] = rects[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 3 && oy > 3) out.push(`overlap: "${a.textContent.trim().slice(0, 15) || a.getAttribute('aria-label')}" × "${b.textContent.trim().slice(0, 15) || b.getAttribute('aria-label')}"`);
      if (out.length > 8) return out;
    }
    for (const [e] of rects) if (e.tagName === 'BUTTON' && !e.classList.contains('tile') && e.scrollWidth > e.clientWidth + 2) out.push(`clipped text: "${e.textContent.trim().slice(0, 20)}"`);
    return out;
  });
  for (const r of res) problems.push(`[Layout @ ${where}] ${r}`);
}

async function checkAll(where, { layout = true } = {}) {
  if (layout) for (const [name, vp] of Object.entries(VIEWPORTS)) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(120);
    await scanLayout(`${where} / ${name}`);
  }
  await page.setViewportSize(VIEWPORTS.ipadLandscape);
  await page.waitForTimeout(80);
  await scanEnglish(where);
}

// ---------------------------------------------------------------- home
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.home');
await checkAll('home');
await page.screenshot({ path: 'e2e-shots/01-home.png' });
await page.getByRole('button', { name: '対局開始' }).click();

// ---------------------------------------------------------------- seat
await page.waitForSelector('.seat-grid');
await checkAll('seat select');
await page.screenshot({ path: 'e2e-shots/02-seat.png' });
check(await page.locator('.seat-btn').count() === 3, 'exactly three seats (no North)');
await page.locator('.seat-btn.w1').click(); // I am South → dealer is kamicha

// ---------------------------------------------------------------- countdown (partial hand)
await page.waitForSelector('.countdown');
const t0 = Date.now();
check(/[1-4]/.test(await text('.cd-ring')), 'countdown shows seconds');
for (const c of ['1m', '9m', '2p', '3p', '4p', '7s', '8s', 'E']) await tap(c); // 8 of 13
await scanEnglish('countdown');
await page.screenshot({ path: 'e2e-shots/03-countdown.png' });
await page.waitForSelector('.game', { timeout: 7000 });
const elapsed = Date.now() - t0;
check(elapsed >= 3000 && elapsed < 6500, `countdown lasted ~4s (was ${elapsed}ms)`);

// ---------------------------------------------------------------- game: turn tracking with unknown tiles
await waitText('.banner', /上家の番です/);
check((await page.locator('.hand2 .tile.back').count()) === 5, '5 unknown tiles shown as ？');
await settle();
await checkAll('game: kamicha turn (partial hand, no dora)');
await page.screenshot({ path: 'e2e-shots/04-game-start.png' });
await tap('S'); // kamicha discards South
await waitText('.banner', /あなたの番です/);
check(/ツモった牌を選んでください/.test(await text('.banner')), 'draw prompt appears automatically');
check(await page.locator('.pal-cue').isVisible(), 'palette highlighted for the draw');
await page.screenshot({ path: 'e2e-shots/05-my-draw.png' });
await tap('9p'); // my draw
await waitText('.rec3', /おすすめ/);
const rec1 = await text('.rec-say');
console.log('部分入力でのおすすめ:', rec1.replace(/\s+/g, ''));
check(/参考/.test(await text('.rec3')), 'partial recommendation is marked as 参考');
await checkAll('game: my turn, partial');
await page.screenshot({ path: 'e2e-shots/06-recommend-partial.png' });
await page.locator('.rec-main').click(); // apply
await waitText('.banner', /下家の番です/);
await tap('1p'); // shimocha
await waitText('.banner', /上家の番です/);
await tap('W'); // kamicha
await waitText('.banner', /あなたの番です/);

// ---------------------------------------------------------------- fill in unknown tiles + dora later
await page.locator('.hand2 .tile.back').first().click();
await waitText('.banner', /手牌の追加入力/);
const unknownBefore = await page.locator('.hand2 .tile.back').count();
for (const c of ['5p', '6p', '9s', 'C', 'C']) { if (await page.locator('.hand2 .tile.back').count()) await tap(c); }
const unknownAfter = await page.locator('.hand2 .tile.back').count();
check(unknownAfter < unknownBefore, `fill-in reduced unknown tiles (${unknownBefore}→${unknownAfter})`);
if (unknownAfter === 0) await waitText('.banner', /あなたの番です/);
else await page.locator('.banner-x').click();
await page.locator('.dora-add').click();
await waitText('.banner', /ドラ表示牌/);
await tap('1m');
check((await page.locator('.dora-box .tile').count()) === 1, 'dora indicator added mid-hand');

// ---------------------------------------------------------------- draw → full recommendation → tsumogiri button
await waitText('.banner', /ツモった牌を選んでください/);
await tap('N');
await waitText('.rec3', /おすすめ/);
check(!/鳴かない|見送る/.test(await text('.rec-say')), 'recommendation after my draw is about my discard, not a stale call');
await settle();
const rec2 = (await text('.rec-say')).replace(/\s+/g, '');
console.log('全入力後のおすすめ:', rec2);
check(await page.locator('.ma.tsumogiri').isVisible(), 'ツモ切り button shown for the drawn tile');
check(await page.locator('.drawn-slot .tile').count() === 1, 'drawn tile displayed separately');
await checkAll('game: my turn, full info');
await page.screenshot({ path: 'e2e-shots/07-recommend-full.png' });

// ---------------------------------------------------------------- themes
const waitTheme = t => page.waitForFunction(x => document.documentElement.dataset.theme === x, t, { timeout: 3000 }).then(() => true, () => false);
await page.emulateMedia({ colorScheme: 'dark' });
check(await waitTheme('dark'), 'auto follows OS dark');
await page.emulateMedia({ colorScheme: 'light' });
check(await waitTheme('light'), 'auto follows OS light');
await page.getByTestId('theme').click(); // light
check(await waitTheme('light'), 'light applied');
await page.getByTestId('theme').click(); // dark
check(await waitTheme('dark'), 'dark applied');
await page.reload();
await page.waitForSelector('.game');
check(await waitTheme('dark'), 'dark persisted after reload');
await settle();
await checkAll('game: dark theme');
await page.screenshot({ path: 'e2e-shots/08-dark.png' });
await page.setViewportSize(VIEWPORTS.iphone);
await page.waitForTimeout(200);
await page.screenshot({ path: 'e2e-shots/09-phone-dark.png', fullPage: true });
await page.setViewportSize(VIEWPORTS.ipadPortrait);
await page.waitForTimeout(200);
await page.screenshot({ path: 'e2e-shots/10-ipad-portrait-dark.png' });
await page.setViewportSize(VIEWPORTS.ipadLandscape);
await page.getByTestId('theme').click(); // auto

// ---------------------------------------------------------------- undo / redo / persistence
const evCount = () => page.evaluate(() => JSON.parse(localStorage.getItem('pon-intended-v1')).events.length);
const n0 = await evCount();
await page.getByRole('button', { name: /戻す/ }).first().click();
await page.waitForTimeout(100);
check(await evCount() === n0 - 1, 'undo removes one event');
await page.getByRole('button', { name: /やり直す/ }).click();
await page.waitForTimeout(100);
check(await evCount() === n0, 'redo restores it');

// ---------------------------------------------------------------- end of hand + final result
await page.getByRole('button', { name: '局終了' }).click();
await page.waitForSelector('.modal');
await checkAll('end-of-hand dialog');
await page.getByText('キャンセル').click();
await page.getByRole('button', { name: '設定' }).click();
await checkAll('options dialog');
await page.getByText('点数・局を修正して始め直す').click();
await page.locator('.modal .seg button', { hasText: '3局' }).click();
await page.locator('.modal input[type=number]').nth(0).fill('45000');
await page.locator('.modal input[type=number]').nth(1).fill('30000');
await page.locator('.modal input[type=number]').nth(2).fill('30000');
await page.getByText('この局を開始').click();
await page.waitForSelector('.countdown');
await page.getByRole('button', { name: 'すぐ始める' }).click();
await page.waitForSelector('.game');
await page.getByRole('button', { name: '局終了' }).click();
await page.locator('.modal .seg button', { hasText: '流局（荒牌）' }).click();
await page.getByText('確定').click();
await page.waitForSelector('.final-row');
await checkAll('final result');
console.log('終局:', await text('.dialog h2'));

await browser.close();
if (problems.length) console.error(problems.join('\n'));
if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
if (problems.length || errors.length) process.exit(1);
console.log('E2E OK — 英語表示なし・レイアウト崩れなし・新フロー動作確認');
