// Renders hero.html to hero-light.png and hero-dark.png (2400 x 1350, 2x) for the README.
// Run from the repo root: npm i --no-save playwright && node docs/assets/hero/render.cjs
// Then shrink them if pngquant is installed: pngquant --force --ext .png --quality 70-90 docs/assets/hero/*.png
const path = require('path');
const { chromium } = require('playwright');

const dir = __dirname;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
  await page.goto('file://' + path.join(dir, 'hero.html'));
  // Scroll the transcript so the Conductor's delegation card and the report it got back are both in view.
  await page.evaluate(() => { const s = document.querySelector('.tx').parentElement; s.scrollTop += document.querySelector('.tx .dlg').getBoundingClientRect().top - s.getBoundingClientRect().top - 14; });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(t => { document.documentElement.dataset.theme = t; }, theme);
    await page.locator('#hero').screenshot({ path: path.join(dir, `hero-${theme}.png`) });
  }
  await browser.close();
})();
