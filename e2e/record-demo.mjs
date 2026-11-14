// Records a narrated video of the PWA offline-remotes demo.
//
//   pnpm record
//
// Output: reports/pwa-offline-demo/demo.webm (+ demo.mp4 when ffmpeg is on PATH).
// Set PW_CHROMIUM_PATH to use a specific Chromium binary.
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const HOST = 'http://localhost:5180';
const REMOTE = 'http://localhost:5181';
const OUT_DIR = resolve('reports/pwa-offline-demo');
const SIZE = { width: 1280, height: 800 };

const servers = [];

function startServer(filter, readyUrl) {
  const child = spawn('pnpm', ['--filter', filter, 'run', 'preview'], {
    detached: true,
    stdio: 'ignore',
  });
  servers.push(child);
  return waitFor(readyUrl);
}

async function waitFor(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function stopServers() {
  for (const child of servers.splice(0)) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {}
  }
}

async function probe(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return `HTTP ${res.status}`;
  } catch (error) {
    return error.cause?.code ?? error.message;
  }
}

// ---------------------------------------------------------------------------
// On-page overlay: caption on top, network log + cache contents at the bottom.
// ---------------------------------------------------------------------------
const remoteLog = [];

async function overlay(page, { step, title, body = '', showLog = true }) {
  const caches = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('mf-remote')) continue;
      const keys = await (await caches.open(name)).keys();
      out.push({ name, count: keys.length, sample: keys.map((k) => k.url.split('/').pop()) });
    }
    return out;
  });

  await page.evaluate(
    ({ step, title, body, log, caches, showLog }) => {
      let root = document.getElementById('__demo_overlay');
      if (!root) {
        root = document.createElement('div');
        root.id = '__demo_overlay';
        document.body.appendChild(root);
        const style = document.createElement('style');
        style.textContent = `
          #__demo_overlay{position:fixed;inset:0;pointer-events:none;font:14px/1.45 ui-sans-serif,system-ui,sans-serif;z-index:99999}
          #__demo_overlay .cap{position:absolute;top:16px;right:16px;width:470px;background:#111827;color:#f9fafb;border-radius:12px;padding:14px 18px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
          #__demo_overlay .step{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a5b4fc;font-weight:700}
          #__demo_overlay .title{font-size:19px;font-weight:700;margin:2px 0 6px}
          #__demo_overlay .body{color:#d1d5db;white-space:pre-line}
          #__demo_overlay .panel{position:absolute;left:16px;right:16px;bottom:16px;display:grid;grid-template-columns:1.4fr 1fr;gap:12px}
          #__demo_overlay .box{background:rgba(17,24,39,.94);color:#e5e7eb;border-radius:12px;padding:10px 14px;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;max-height:230px;overflow:hidden}
          #__demo_overlay .box h4{margin:0 0 6px;font:700 12px ui-sans-serif,system-ui;color:#a5b4fc;text-transform:uppercase;letter-spacing:.06em}
          #__demo_overlay .sw{color:#4ade80}#__demo_overlay .net{color:#fbbf24}#__demo_overlay .bad{color:#f87171}#__demo_overlay .warm{color:#60a5fa}#__demo_overlay .box span{white-space:pre}
        `;
        document.head.appendChild(style);
      }
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
      const logHtml = log.length
        ? log
            .slice(-11)
            .map(
              (r) =>
                `<div><span class="${r.status !== 200 ? 'bad' : r.warm ? 'warm' : r.fromSW ? 'sw' : 'net'}">${
                  r.status !== 200
                    ? `✗ ${r.status}`
                    : r.warm
                      ? '↓ warm-up    '
                      : r.fromSW
                        ? '⚙ service worker'
                        : '↯ network   '
                }</span> ${esc(r.file)}</div>`
            )
            .join('')
        : '<div style="opacity:.6">no requests to :5181 yet</div>';
      const cacheHtml = caches.length
        ? caches
            .map(
              (c) =>
                `<div><b>${esc(c.name)}</b> — ${c.count} entries</div><div style="opacity:.7;margin-bottom:6px">${esc(
                  c.sample.slice(0, 6).join(', ')
                )}${c.sample.length > 6 ? ', …' : ''}</div>`
            )
            .join('')
        : '<div style="opacity:.6">empty</div>';
      root.innerHTML = `
        <div class="cap"><div class="step">${esc(step)}</div><div class="title">${esc(title)}</div><div class="body">${esc(body)}</div></div>
        ${
          showLog
            ? `<div class="panel">
                 <div class="box"><h4>Requests to remote (:5181) — served by</h4>${logHtml}</div>
                 <div class="box"><h4>Cache Storage</h4>${cacheHtml}</div>
               </div>`
            : ''
        }`;
    },
    { step, title, body, log: remoteLog, caches, showLog }
  );
}

const pause = (page, ms) => page.waitForTimeout(ms);

// ---------------------------------------------------------------------------
// Visible mouse cursor. Headless recordings don't draw a pointer, so the page
// draws one that follows real mousemove/mousedown events from page.mouse.
// The position survives reloads via sessionStorage.
// ---------------------------------------------------------------------------
function installCursor() {
  const KEY = '__demo_cursor';
  const mount = () => {
    if (document.getElementById(KEY)) return;
    const style = document.createElement('style');
    style.textContent = `
      #${KEY}{position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .08s}
      #${KEY}.down{transform:translate(-3px,-2px) scale(.85)}
      .${KEY}-ripple{position:fixed;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:3px solid #6366f1;z-index:2147483646;pointer-events:none;animation:${KEY}-r .55s ease-out forwards}
      @keyframes ${KEY}-r{to{width:56px;height:56px;margin:-28px 0 0 -28px;opacity:0}}
      #${KEY}-key{position:fixed;left:50%;top:42%;transform:translate(-50%,-50%);z-index:2147483647;pointer-events:none;background:rgba(17,24,39,.92);color:#fff;font:600 30px ui-sans-serif,system-ui;padding:14px 26px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
      #${KEY}-key kbd{display:inline-block;min-width:34px;text-align:center;border:1px solid #6b7280;border-bottom-width:3px;border-radius:8px;padding:2px 10px;margin:0 3px;background:#1f2937;font:inherit}
    `;
    document.head.appendChild(style);
    const el = document.createElement('div');
    el.id = KEY;
    el.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2.5v17.2l4.6-4.3 3 6.6 2.9-1.3-3-6.5h6.3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved) Object.assign(el.style, { left: saved.x + 'px', top: saved.y + 'px' });
    document.documentElement.appendChild(el);
  };
  const move = (e) => {
    const el = document.getElementById(KEY);
    if (!el) return;
    el.style.left = e.clientX + 'px';
    el.style.top = e.clientY + 'px';
    sessionStorage.setItem(KEY, JSON.stringify({ x: e.clientX, y: e.clientY }));
  };
  window.addEventListener('mousemove', move, true);
  window.addEventListener('mousedown', (e) => {
    document.getElementById(KEY)?.classList.add('down');
    const r = document.createElement('div');
    r.className = KEY + '-ripple';
    Object.assign(r.style, { left: e.clientX + 'px', top: e.clientY + 'px' });
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }, true);
  window.addEventListener('mouseup', () => document.getElementById(KEY)?.classList.remove('down'), true);
  window.__demoKeyHint = (html) => {
    document.getElementById(KEY + '-key')?.remove();
    if (!html) return;
    const k = document.createElement('div');
    k.id = KEY + '-key';
    k.innerHTML = html;
    document.documentElement.appendChild(k);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}

let mousePos = { x: 640, y: 420 };

async function moveTo(page, target, { steps = 28, offset = { x: 0.5, y: 0.5 } } = {}) {
  let x, y;
  if (typeof target === 'string' || target?.boundingBox) {
    const box = await (typeof target === 'string' ? page.locator(target) : target).boundingBox();
    x = box.x + box.width * offset.x;
    y = box.y + box.height * offset.y;
  } else {
    ({ x, y } = target);
  }
  // Ease-in-out path instead of Playwright's linear interpolation.
  const from = mousePos;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await page.waitForTimeout(12);
  }
  mousePos = { x, y };
}

async function clickOn(page, locator) {
  await moveTo(page, locator);
  await pause(page, 180);
  await page.mouse.down();
  await pause(page, 90);
  await page.mouse.up();
  await pause(page, 250);
}

async function keyHint(page, html, ms = 1100) {
  await page.evaluate((h) => window.__demoKeyHint?.(h), html);
  await pause(page, ms);
  await page.evaluate(() => window.__demoKeyHint?.(null)).catch(() => {});
}

async function pressReload(page) {
  await keyHint(page, '<kbd>⌘</kbd>+<kbd>R</kbd>&nbsp; reload');
  await page.reload();
  // Re-sync the drawn cursor with Playwright's mouse after navigation.
  await page.mouse.move(mousePos.x + 1, mousePos.y);
  await page.mouse.move(mousePos.x, mousePos.y);
}

// ---------------------------------------------------------------------------
async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('Building + starting remote (:5181) and host (:5180)…');
  await Promise.all([
    startServer('pwa-remote', `${REMOTE}/mf-manifest.json`),
    startServer('pwa-host', HOST),
  ]);

  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: SIZE,
    recordVideo: { dir: OUT_DIR, size: SIZE },
    serviceWorkers: 'allow',
  });
  await context.addInitScript(installCursor);
  const page = await context.newPage();
  // One row per file, from its first request in the current phase. Warm-up
  // fetches (cache.add from the runtime plugin) are labelled separately so they
  // don't hide how the page itself loaded the file.
  page.on('response', (res) => {
    if (!res.url().startsWith(REMOTE)) return;
    const file = res.url().replace(REMOTE, '');
    if (remoteLog.some((r) => r.file === file)) return;
    remoteLog.push({
      file,
      fromSW: res.fromServiceWorker(),
      status: res.status(),
      warm: res.request().resourceType() === 'fetch' && !file.includes('mf-manifest'),
    });
  });

  // 1. First visit online -------------------------------------------------
  await page.goto(HOST);
  await page.mouse.move(mousePos.x, mousePos.y);
  await page.getByTestId('remote-widget').waitFor();
  await overlay(page, {
    step: 'Step 1 · online',
    title: 'First visit: host loads the remote over the network',
    body: 'Host on :5180 fetches mf-manifest.json + remoteEntry from :5181.\nThe service worker is not in control yet, so these hit the network.',
  });
  await moveTo(page, page.getByText('Remote widget (served from :5181)'), { offset: { x: 0.85, y: 0.5 } });
  await pause(page, 1200);
  await moveTo(page, '#__demo_overlay .panel .box >> nth=0', { offset: { x: 0.3, y: 0.35 } });
  await pause(page, 1800);

  await page.getByTestId('warm-status').waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await overlay(page, {
    step: 'Step 1 · online',
    title: 'Warm-up plugin fills the cache',
    body: 'The MF runtime plugin copies into Cache Storage: the manifest, every asset it lists, and every remote chunk already loaded.\nDetails-*.js (lazy, never opened) is fetched by the warm-up only.',
  });
  await moveTo(page, page.getByTestId('warm-status'), { offset: { x: 0.6, y: 0.5 } });
  await pause(page, 1300);
  await moveTo(page, '#__demo_overlay .panel .box >> nth=1', { offset: { x: 0.35, y: 0.4 } });
  await pause(page, 2000);

  for (let i = 0; i < 3; i++) await clickOn(page, page.getByTestId('remote-counter'));
  await pause(page, 600);

  // 2. Lose internet ------------------------------------------------------
  stopServers();
  await context.setOffline(true);
  await new Promise((r) => setTimeout(r, 800));
  const [hostProbe, remoteProbe] = await Promise.all([probe(HOST), probe(`${REMOTE}/mf-manifest.json`)]);
  await overlay(page, {
    step: 'Step 2 · internet gone',
    title: 'Both servers killed + browser set offline',
    body: `curl ${HOST}  →  ${hostProbe}\ncurl ${REMOTE}/mf-manifest.json  →  ${remoteProbe}\n\nNow reload the page…`,
  });
  await moveTo(page, page.getByTestId('network-status'), { offset: { x: 0.12, y: 0.5 } });
  await pause(page, 1500);
  await moveTo(page, '#__demo_overlay .cap', { offset: { x: 0.55, y: 0.55 } });
  await pause(page, 2200);

  // 3. Reload offline -----------------------------------------------------
  remoteLog.length = 0;
  await pressReload(page);
  await page.getByTestId('remote-widget').waitFor();
  await overlay(page, {
    step: 'Step 3 · offline reload',
    title: 'Host and remote still render',
    body: 'Host shell comes from the precache.\nmf-manifest.json (NetworkFirst → cache fallback) and the hashed remote chunks (CacheFirst) come from the service worker.',
  });
  await moveTo(page, page.getByTestId('network-status'), { offset: { x: 0.12, y: 0.5 } });
  await pause(page, 1000);
  await moveTo(page, '#__demo_overlay .panel .box >> nth=0', { offset: { x: 0.25, y: 0.3 } });
  await pause(page, 2600);

  await overlay(page, {
    step: 'Step 3 · offline reload',
    title: 'The remote is fully interactive',
    body: 'React is shared from the host; the remote widget state works as usual.',
  });
  await clickOn(page, page.getByTestId('remote-counter'));
  await clickOn(page, page.getByTestId('remote-counter'));
  await pause(page, 900);

  await clickOn(page, page.getByTestId('remote-details-toggle'));
  await page.getByTestId('remote-details').waitFor();
  await overlay(page, {
    step: 'Step 3 · offline reload',
    title: 'Lazy remote chunk loads offline too',
    body: 'Details-*.js was never requested while online — it is only available because the warm-up read it from mf-manifest.json (exposes[].assets.js.async).',
  });
  await moveTo(page, page.getByTestId('remote-details'), { offset: { x: 0.9, y: 0.5 } });
  await pause(page, 1200);
  await moveTo(page, '#__demo_overlay .panel .box >> nth=0', { offset: { x: 0.3, y: 0.92 } });
  await pause(page, 3500);

  const video = page.video();
  await context.close();
  await browser.close();

  const webm = resolve(OUT_DIR, 'demo.webm');
  renameSync(await video.path(), webm);
  console.log(`Video: ${webm}`);

  try {
    const mp4 = resolve(OUT_DIR, 'demo.mp4');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
    console.log(`Video: ${mp4}`);
  } catch {
    console.log('ffmpeg not available, skipping mp4 conversion');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(stopServers);
