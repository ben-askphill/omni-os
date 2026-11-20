// PROTOTYPE, throwaway: screenshots the screens at desktop (1440x900) and phone (390x844) width.
//   node apps/web/src/prototype/group-threads/capture.mjs <out dir> [base url] [chrome path]
// The prototype server must be running (npm run prototype). By default Ben's picks and their extra states; ALL=1 adds
// every other variant.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://localhost:4790/prototype-group-threads.html';
const exe = process.argv[4] ?? '/usr/bin/chromium';
mkdirSync(out, { recursive: true });

// Ben's picks (2026-11-20) and the states worth seeing with them. ALL=1 shoots every variant as well.
const PICKS = [
  { s: 1, v: 'A', q: '', tag: '' },
  { s: 1, v: 'A', q: 'tech=1', tag: 'tech' },
  { s: 1, v: 'A', q: 'theme=dark', tag: 'dark' },
  { s: 2, v: 'A', q: '', tag: '' },
  { s: 2, v: 'A', q: 'closed=1', tag: 'picked' },
  { s: 3, v: 'A', q: '', tag: '' },
  { s: 3, v: 'A', q: 'closed=1', tag: 'list-off' },
  { s: 4, v: 'B', q: '', tag: '' },
  { s: 4, v: 'B', q: 'theme=dark', tag: 'dark' },
  { s: 5, v: 'B', q: '', tag: '' },
  { s: 5, v: 'B', q: 'theme=dark', tag: 'dark' },
  { s: 6, v: 'A', q: '', tag: '' },
  { s: 6, v: 'A', q: 'read=1', tag: 'read-on' },
  { s: 7, v: 'B', q: '', tag: '' },
  { s: 7, v: 'B', q: 'local=1', tag: 'local' },
  { s: 7, v: 'B', q: 'tech=1', tag: 'tech' },
];
const SCREENS = { 1: ['A', 'B', 'C'], 2: ['A', 'B'], 3: ['A', 'B', 'C'], 4: ['A', 'B', 'C'], 5: ['A', 'B', 'C', 'D'], 6: ['A', 'B'], 7: ['A', 'B'] };
const only = process.env.ONLY; // e.g. "3" to shoot one screen

const browser = await chromium.launch({ executablePath: exe });
const sizes = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];
const shots = [...PICKS];
if (process.env.ALL) for (const [s, vs] of Object.entries(SCREENS)) for (const v of vs) if (!PICKS.some((p) => p.s === Number(s) && p.v === v && !p.q)) shots.push({ s: Number(s), v, q: '', tag: '' });

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
