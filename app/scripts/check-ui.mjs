import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = 4193;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT_DIR = resolve(process.cwd(), '.ui-check');

function findBrowserExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find(path => existsSync(path));
}

async function waitForServer(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Vite не ответил на ${url} за ${timeoutMs} мс`);
}

async function assertNoOverflow(page, selector, label) {
  const result = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const rect = el.getBoundingClientRect();
    const overflowX = Math.round(el.scrollWidth - el.clientWidth);
    const outOfViewport = rect.right > window.innerWidth + 1 || rect.left < -1;
    return {
      missing: false,
      overflowX,
      scrollWidth: Math.round(el.scrollWidth),
      clientWidth: Math.round(el.clientWidth),
      outOfViewport,
    };
  }, selector);
  if (result.missing) throw new Error(`${label}: элемент ${selector} не найден`);
  if (result.overflowX > 1) {
    throw new Error(`${label}: горизонтальное переполнение +${result.overflowX}px (${result.scrollWidth} > ${result.clientWidth})`);
  }
  if (result.outOfViewport) {
    throw new Error(`${label}: элемент ${selector} выходит за пределы вьюпорта`);
  }
}

async function main() {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error('Не найден Chrome/Edge/Chromium. Укажите путь в переменной CHROME_PATH.');
  }
  mkdirSync(OUT_DIR, { recursive: true });

  const viteBin = resolve(process.cwd(), 'node_modules/vite/bin/vite.js');
  const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });

  const errors = [];
  let browser;
  try {
    await waitForServer(URL);
    browser = await chromium.launch({ executablePath, headless: true });

    const viewports = [
      { name: 'desktop', width: 1280, height: 800 },
      { name: 'mobile', width: 390, height: 844 },
    ];

    for (const vp of viewports) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      page.on('pageerror', err => errors.push(`[${vp.name}] pageerror: ${err.message}`));
      page.on('console', msg => {
        if (msg.type() === 'error') {
          const loc = msg.location()?.url || '';
          if (loc.endsWith('/favicon.ico')) return;
          errors.push(`[${vp.name}] console.error: ${msg.text()}${loc ? ` (${loc})` : ''}`);
        }
      });

      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.profile-trigger', { timeout: 15_000 });

      // 1. Проверка основного экрана + скриншот столов рассадки (обычный и детальный)
      await assertNoOverflow(page, 'html', `${vp.name} · страница`);
      if (vp.name === 'desktop') {
        const tablesGrid = page.locator('.tables-grid').first();
        if (await tablesGrid.count()) {
          await tablesGrid.screenshot({ path: resolve(OUT_DIR, 'tables-grid.png') });
          const toggleBtn = page.locator('button:has-text("Имена и аватарки")');
          if (await toggleBtn.count()) {
            await toggleBtn.click();
            await page.waitForSelector('.tables-grid.detailed');
            await assertNoOverflow(page, 'html', `${vp.name} · столы (детальный)`);
            await page.locator('.tables-grid.detailed').first().screenshot({ path: resolve(OUT_DIR, 'tables-detailed.png') });
          }
        }
      }

      // 2. Выпадающее меню профиля + переключение темы
      await page.click('.profile-trigger');
      await page.waitForSelector('.profile-popover');
      await assertNoOverflow(page, '.profile-popover', `${vp.name} · поповер профиля`);
      await page.click('.profile-popover button:has-text("Светлая")');
      await assertNoOverflow(page, '.profile-popover', `${vp.name} · поповер (светлая)`);

      // 3. Модалка настроек → вкладка «Интерфейс»
      await page.click('.profile-popover button:has-text("Настройки профиля")');
      await page.waitForSelector('.settings-dialog-body');
      await assertNoOverflow(page, '.settings-dialog-body', `${vp.name} · настройки (Интерфейс)`);
      const tallSegmented = await page.evaluate(() => {
        return [...document.querySelectorAll('.settings-dialog .segmented')]
          .map(el => Math.round(el.getBoundingClientRect().height))
          .filter(h => h > 48);
      });
      if (tallSegmented.length) {
        throw new Error(`${vp.name}: .segmented сложился вертикально (высота ${tallSegmented.join(', ')}px)`);
      }
      if (vp.name === 'desktop') {
        await page.screenshot({ path: resolve(OUT_DIR, 'settings-interface.png') });
      }

      // 4. Вкладка «Учётная запись»
      await page.click('.settings-tabs button:has-text("Учётная запись")');
      await page.waitForSelector('.avatar-upload-row');
      await assertNoOverflow(page, '.settings-dialog-body', `${vp.name} · настройки (Учётная запись)`);
      if (vp.name === 'desktop') {
        await page.screenshot({ path: resolve(OUT_DIR, 'settings-account.png') });
      }

      // Закрыть модалку
      await page.keyboard.press('Escape');
      await context.close();
      console.log(`✔ UI check [${vp.name} ${vp.width}×${vp.height}]: переполнений нет`);
    }

    if (errors.length) {
      throw new Error('Ошибки в браузере:\n' + errors.join('\n'));
    }
    console.log(`✔ Все UI-проверки пройдены. Скриншоты: ${OUT_DIR}`);
  } finally {
    if (browser) await browser.close();
    if (server.pid) {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(server.pid), '/f', '/t'], { stdio: 'ignore' });
      } else {
        server.kill('SIGTERM');
      }
    }
  }
  process.exit(0);
}

main().catch(err => {
  console.error('✖ UI check failed:', err.message);
  process.exit(1);
});
