import puppeteer from 'puppeteer-core';

async function inspectLayers() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false,
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized']
  });

  const page = await browser.newPage();
  await page.goto('https://www.figma.com/design/71r9xt9jbVbeAu0RFXwY0G/Sin-t%C3%ADtulo?node-id=154-939', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });

  await new Promise(r => setTimeout(r, 12000));

  // Press Alt + 1 to open Layers Panel (standard Figma shortcut)
  console.log('Opening layers panel with Alt+1...');
  await page.keyboard.down('Alt');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 2000));

  // Also press Ctrl+Shift+\ to open sidebar if needed
  await page.screenshot({ path: 'figma_layers.png' });
  console.log('Saved figma_layers.png');

  // Let's inspect any text nodes in the DOM
  const layerTexts = await page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll('*'));
    return elements
      .filter(el => el.textContent && (el.textContent.includes('Inicio') || el.textContent.includes('user') || el.textContent.includes('detalle')))
      .map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.slice(0, 50) }))
      .slice(0, 20);
  });
  console.log('Layer elements:', layerTexts);

  await browser.close();
}

inspectLayers().catch(console.error);

