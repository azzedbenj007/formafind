import { chromium } from 'playwright';
const [,, outDir, ...views] = process.argv;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 853 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
for (const v of views) {
  const i = v.indexOf(':'); const name = v.slice(0, i); const query = v.slice(i + 1);
  await page.goto(`file://${process.cwd()}/index.html?${query ?? ''}`);
  await page.waitForFunction(() => (window).__ready === true, null, { timeout: 60000 });
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(name, JSON.stringify(await page.evaluate(() => (window).__stats)));
}
await browser.close();
