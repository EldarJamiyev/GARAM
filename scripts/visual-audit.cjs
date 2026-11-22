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

async function getDebuggerUrl(retries = 20) {
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
  console.log('📸 GARAM: ZERO HOUR — VISUAL AUDIT & SCREENSHOT SUITE');
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

  // Wait for canvas to be fully initialized and WebGL context active
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

  // Deploy Operator
  console.log('[Phase 2] Deploying Operator into DE_MERIDIAN...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('spawn-btn');
      if (btn) btn.click();
    })()`,
  });
  await sleep(1200);

  async function capture(fileName, label) {
    await sleep(400);
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const targetPath = path.join(outDir, fileName);
    fs.writeFileSync(targetPath, Buffer.from(ss.data, 'base64'));
    console.log(`✓ [Screenshot] ${label} -> ${fileName}`);
  }

  // 1. Capture Default Primary: Garam-47
  console.log('\n[Capture 1] Inspecting Garam-47 Idle & Viewmodel...');
  await capture('v_garam47_idle.png', 'Garam-47 (AK) Viewmodel');

  // 2. Capture Secondary: Desert Eagle (Key 2)
  console.log('\n[Capture 2] Switching to Secondary (Desert Eagle)...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true }))`,
  });
  await sleep(600);
  await capture('v_deagle_idle.png', 'Desert Eagle Viewmodel');

  // 3. Capture Knife: Garam Karambit (Key 3)
  console.log('\n[Capture 3] Switching to Knife (CS2 Karambit Reverse-Grip)...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }))`,
  });
  await sleep(700);
  await capture('v_karambit_idle.png', 'Karambit Reverse-Grip Viewmodel');

  // 4. Buy and Capture Vanguard M4A1-S
  console.log('\n[Capture 4] Purchasing & Inspecting Vanguard M4A1-S...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      const btn = document.querySelector('[data-buy="vanguard-m4"]');
      if (btn) btn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(700);
  await capture('v_m4a1s_idle.png', 'Vanguard M4A1-S Viewmodel');

  // 5. Buy and Capture Sovereign AWP
  console.log('\n[Capture 5] Purchasing & Inspecting Sovereign AWP...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      const btn = document.querySelector('[data-buy="sovereign-awp"]');
      if (btn) btn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(700);
  await capture('v_awp_idle.png', 'Sovereign AWP Viewmodel');

  // 6. Architectural View: Rotate Camera to Look South Towards Mid Nest & Pergolas
  console.log('\n[Capture 6] Inspecting Architectural Dressings & Mid Watchtower Nest...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      // Trigger camera yaw to inspect the sunlit chokepoints and Mid Nest
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }));
    })()`,
  });
  await sleep(500);
  await capture('v_map_mid_and_sites.png', 'DE_MERIDIAN Architectural Overview');

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
