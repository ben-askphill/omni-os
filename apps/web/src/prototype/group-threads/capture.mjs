// PROTOTYPE, throwaway: screenshots every screen and variant at desktop (1440x900) and phone (390x844) width.
//   node apps/web/src/prototype/group-threads/capture.mjs <out dir> [base url] [chrome path]
// The prototype server must be running (npm run prototype). Extra shots: tech on, dark, worktree read on.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://localhost:4790/prototype-group-threads.html';
const exe = process.argv[4] ?? '/usr/bin/chromium';
mkdirSync(out, { recursive: true });

const SCREENS = {
  1: ['A', 'B', 'C'],
  2: ['A', 'B'],
  3: ['A', 'B', 'C'],
  4: ['A', 'B', 'C'],
  5: ['A', 'B', 'C'],
  6: ['A', 'B'],
  7: ['A', 'B'],
};
const EXTRA = [
  { s: 2, v: 'A', q: 'closed=1', tag: 'sent' },
  { s: 2, v: 'B', q: 'closed=1', tag: 'sent' },
  { s: 7, v: 'A', q: 'local=1', tag: 'local' },
  { s: 7, v: 'B', q: 'local=1', tag: 'local' },
  { s: 1, v: 'B', q: 'tech=1', tag: 'tech' },
  { s: 1, v: 'A', q: 'tech=1', tag: 'tech' },
  { s: 1, v: 'B', q: 'theme=dark', tag: 'dark' },
  { s: 4, v: 'A', q: 'theme=dark', tag: 'dark' },
  { s: 5, v: 'C', q: 'theme=dark', tag: 'dark' },
  { s: 6, v: 'A', q: 'read=1', tag: 'read-on' },
  { s: 6, v: 'B', q: 'read=1', tag: 'read-on' },
  { s: 7, v: 'A', q: 'tech=1', tag: 'tech' },
];
const only = process.env.ONLY; // e.g. "3" to shoot one screen

const browser = await chromium.launch({ executablePath: exe });
const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];
const shots = [];
for (const [s, vs] of Object.entries(SCREENS)) for (const v of vs) shots.push({ s: Number(s), v, q: '', tag: '' });
shots.push(...EXTRA);

for (const size of sizes) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: size.isMobile, hasTouch: size.hasTouch, deviceScaleFactor: size.deviceScaleFactor ?? 1, colorScheme: 'light' });
  const page = await ctx.newPage();
  for (const sh of shots) {
    if (only && String(sh.s) !== only) continue;
    const url = `${base}?s=${sh.s}&v=${sh.v}${sh.q ? `&${sh.q}` : ''}&bar=0`;
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const file = `${out}/s${sh.s}${sh.v}${sh.tag ? `-${sh.tag}` : ''}-${size.name}.png`;
    await page.screenshot({ path: file, animations: 'disabled' });
    console.log(file);
  }
  await ctx.close();
}
await browser.close();
