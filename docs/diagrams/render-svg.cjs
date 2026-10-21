// SVG -> PNG (масштаб 2x) через headless Chromium. Требуется пакет playwright.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const [dir, ...names] = process.argv.slice(2);
  const browser = await chromium.launch();
  for (const n of names) {
    const svg = fs.readFileSync(path.join(dir, `${n}.svg`), 'utf8');
    const m = svg.match(/width="(\d+)" height="(\d+)"/);
    const [w, h] = [Number(m[1]), Number(m[2])];
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: path.join(dir, `${n}.png`), clip: { x: 0, y: 0, width: w, height: h } });
    await page.close();
    console.log('png', n);
  }
  await browser.close();
})();
