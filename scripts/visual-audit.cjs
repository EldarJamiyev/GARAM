const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isServerRunning(port = 3000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function getDebuggerUrl(retries = 25) {
  for (let i = 0; i < retries; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:9222/json', (res) => {
          let str = '';
          res.on('data', (chunk) => (str += chunk));
          res.on('end', () => resolve(str));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('timeout')));
      });
      const list = JSON.parse(data);
      const page = list.find(
        (p) => p.url.includes('localhost:3000') || p.title.includes('GARAM')
      );
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('Failed to connect to Chrome CDP on port 9222');
}

async function runVisualAudit() {
  console.log('=====================================================');
  console.log('📸 GARAM: ZERO HOUR — COMPREHENSIVE 10-STAGE VISUAL AUDIT');
  console.log('=====================================================');

  const outDir = path.resolve(__dirname, '../docs/assets/playtests');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Ensure dev server is running
  let devProc = null;
  const running = await isServerRunning(3000);
  if (!running) {
    console.log('[Server] Starting Vite Dev Server on port 3000...');
    devProc = spawn('npx.cmd', ['vite', '--port', '3000'], {
      cwd: path.resolve(__dirname, '../packages/client'),
      stdio: 'ignore',
      detached: false,
      shell: true,
    });
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      if (await isServerRunning(3000)) {
        console.log('✓ Dev server online at http://localhost:3000');
        break;
      }
    }
  } else {
    console.log('✓ Dev server already active at http://localhost:3000');
  }

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const userDataDir = 'C:\\Users\\Eldar\\AppData\\Local\\Temp\\garam_audit_profile';

  const chromeProc = spawn(
    chromePath,
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--window-size=1440,900',
      'http://localhost:3000',
    ],
    { stdio: 'ignore', detached: false }
  );

  const cleanup = () => {
    try {
      chromeProc.kill();
    } catch {}
    if (devProc) {
      try {
        devProc.kill();
      } catch {}
    }
  };
  process.on('exit', cleanup);

  console.log('[Phase 1] Connecting to Chrome CDP at ws://127.0.0.1:9222 ...');
  const wsUrl = await getDebuggerUrl(25);
  console.log('✓ Connected to Target Page:', wsUrl);

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  const consoleErrors = [];

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map((a) => a.value || JSON.stringify(a)).join(' ');
      if (msg.params.type === 'error') {
        consoleErrors.push(`[CONSOLE ERROR] ${text}`);
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(`[UNCAUGHT EXCEPTION] ${JSON.stringify(msg.params.exceptionDetails)}`);
    } else if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  });

  await new Promise((resolve) => ws.on('open', resolve));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const res = await send('Runtime.evaluate', {
        expression: `document.readyState === 'complete' && !!document.getElementById('game-canvas')`,
        returnByValue: true,
      });
      if (res && res.result && res.result.value) break;
    } catch {}
  }
  await sleep(1500);

  async function capture(fileName, label) {
    await sleep(500);
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const targetPath = path.join(outDir, fileName);
    fs.writeFileSync(targetPath, Buffer.from(ss.data, 'base64'));
    console.log(`✓ [Screenshot] ${label} -> ${fileName}`);
  }

  // Stage 1: Lobby Screen with Panoramic Overlook (Viewmodel hidden, zero lens occlusion)
  console.log('\n[Capture 1] Inspecting Lobby Modal & Panoramic Overlook Camera...');
  await capture('audit_01_lobby.png', 'Stage 1: Lobby Panoramic Overlook');

  // Stage 2: Deploy Operator into Arena
  console.log('\n[Phase 2] Deploying Operator into DE_MERIDIAN...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('spawn-btn');
      if (btn) btn.click();
      Object.defineProperty(document, 'pointerLockElement', {
        get: () => document.getElementById('game-canvas'),
        configurable: true
      });
      document.dispatchEvent(new Event('pointerlockchange'));
    })()`,
  });
  await sleep(1500);

  // Stage 2: Default Primary Garam-47 (AK)
  console.log('\n[Capture 2] Inspecting Garam-47 (AK) Viewmodel Framing...');
  await capture('audit_02_garam47_idle.png', 'Stage 2: Garam-47 Viewmodel');

  // Stage 3: Secondary Desert Eagle (.50 AE)
  console.log('\n[Capture 3] Switching to Secondary (Desert Eagle)...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true }))`,
  });
  await sleep(800);
  await capture('audit_03_deagle_idle.png', 'Stage 3: Desert Eagle Viewmodel');

  // Stage 4: Tactical Knife (Garam Karambit Reverse-Grip)
  console.log('\n[Capture 4] Switching to Knife (CS2 Karambit Reverse-Grip)...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }))`,
  });
  await sleep(800);
  await capture('audit_04_karambit_idle.png', 'Stage 4: Karambit Reverse-Grip Viewmodel');

  // Stage 5: Buy & Inspect Vanguard M4A1-S
  console.log('\n[Capture 5] Purchasing & Inspecting Vanguard M4A1-S...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      const practice = document.getElementById('practice-btn');
      if (practice) practice.click();
      const btn = document.querySelector('[data-buy="vanguard-m4"]');
      if (btn) btn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(800);
  await capture('audit_05_m4a1s_idle.png', 'Stage 5: Vanguard M4A1-S Viewmodel');

  // Stage 6: Buy & Inspect Sovereign AWP
  console.log('\n[Capture 6] Purchasing & Inspecting Sovereign AWP...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      const practice = document.getElementById('practice-btn');
      if (practice) practice.click();
      const btn = document.querySelector('[data-buy="sovereign-awp"]');
      if (btn) btn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(800);
  await capture('audit_06_awp_idle.png', 'Stage 6: Sovereign AWP Viewmodel');

  // Stage 7: Pergola Beams & Stone Wall Corbels with Cast Sunlight Shadows
  console.log('\n[Capture 7] Inspecting Pergola Architecture & Stone Wall Corbels...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }));
      // Pitch camera up to look directly at the overhead wooden pergolas & corbels
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: -160, bubbles: true }));
    })()`,
  });
  await sleep(600);
  await capture('audit_07_architectural_pergola_corbels.png', 'Stage 7: Pergola Architecture & Corbels');

  // Stage 8: 3P Bot Stance & Weapon Alignment
  console.log('\n[Capture 8] Inspecting 3rd-Person Bot Holding Weapon along +Z...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      // Restore pitch, turn slightly right towards Sentinel bot
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: -180, movementY: 160, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(600);
  await capture('audit_08_3p_vanguard_bot.png', 'Stage 8: 3P Bot Alignment');

  // Stage 9: Combat Fire Recoil & Muzzle Flash
  console.log('\n[Capture 9] Simulating Primary Fire Recoil Kick...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      // Re-center aim
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 180, movementY: 0, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
      }
    })()`,
  });
  await sleep(150);
  await capture('audit_09_combat_fire_recoil.png', 'Stage 9: Primary Fire Recoil');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
      }
    })()`,
  });

  // Stage 10: Live Smoke & Molotov on Stone Deck
  console.log('\n[Capture 10] Deploying Tactical Smoke & Molotov on Stone Deck (y=2.1m)...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', key: '4', bubbles: true }));
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        setTimeout(() => {
          canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
        }, 80);
      }
    })()`,
  });
  await sleep(1500);
  await capture('audit_10_live_utility_deck.png', 'Stage 10: Live Tactical Smoke & Molotov on Deck');

  console.log('\n=====================================================');
  console.log('📊 VISUAL AUDIT RESULTS');
  console.log('=====================================================');
  if (consoleErrors.length === 0) {
    console.log('✅ ZERO CONSOLE ERRORS DETECTED DURING VISUAL AUDIT!');
  } else {
    console.log('⚠️ Console Diagnostics Detected:');
    console.log(consoleErrors.join('\n'));
  }

  ws.close();
  cleanup();
  console.log('✓ Visual Audit Successfully Concluded!\n');
}

runVisualAudit().catch((err) => {
  console.error('Visual Audit Fatal Error:', err);
  process.exit(1);
});
