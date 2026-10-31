// Renders tools/cover/cover.html to apps/web/public/cover.png (1200x630) using Microsoft Edge.
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(path.join(here, 'cover.html')).href);
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(here, '../../apps/web/public/cover.png') });
await browser.close();
console.log('cover written');
