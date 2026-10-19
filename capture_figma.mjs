import puppeteer from 'puppeteer-core';

async function capture() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: false,
    defaultViewport: { width: 1440, height: 960 },
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized']
  });

  const page = await browser.newPage();
  await page.goto('https://www.figma.com/design/71r9xt9jbVbeAu0RFXwY0G/Sin-t%C3%ADtulo?node-id=154-939', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });

  console.log('Waiting 16s for complete canvas render...');
  await new Promise(r => setTimeout(r, 16000));

  // Focus canvas
  await page.mouse.click(700, 500);

  // Pan down-right to reveal `calendario`
  await page.keyboard.down('Space');
  await page.mouse.move(900, 800);
  await page.mouse.down();
  await page.mouse.move(500, 200, { steps: 20 });
  await page.mouse.up();
  await page.keyboard.up('Space');

  await new Promise(r => setTimeout(r, 3000));
  await page.screenshot({ path: 'figma_calendario.png' });
  console.log('Saved figma_calendario.png');

  await browser.close();
}

capture().catch(console.error);
