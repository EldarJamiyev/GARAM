const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getDebuggerUrl(retries = 30) {
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
      const page = list.find((p) => p.url.includes('localhost:3000') || p.title.includes('GARAM'));
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error('Failed to connect to Chrome CDP on port 9222');
}

async function main() {
  const outDir = path.resolve(__dirname, '../docs/assets/playtests');
  fs.mkdirSync(outDir, { recursive: true });

  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const userDataDir = 'C:\\Users\\Eldar\\AppData\\Local\\Temp\\garam_spec_profile_' + Date.now();

  console.log('[Chrome] Launching Chrome headless on port 9222...');
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
      'http://localhost:3000/?autostart=1',
    ],
    { stdio: 'ignore', detached: false }
  );

  const cleanup = () => {
    try {
      chromeProc.kill();
    } catch {}
  };
  process.on('exit', cleanup);

  console.log('[CDP] Connecting to debugger...');
  const wsUrl = await getDebuggerUrl(30);
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

  console.log('[Page] Waiting for complete state and canvas...');
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
  await sleep(1000);

  async function capture(fileName, label) {
    await sleep(400);
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const targetPath = path.join(outDir, fileName);
    fs.writeFileSync(targetPath, Buffer.from(ss.data, 'base64'));
    console.log(`✓ [Screenshot] ${label} -> ${targetPath} (${((ss.data.length * 0.75) / 1024).toFixed(1)} KB)`);
  }

  // Deploy into game
  console.log('[Setup] Deploying operator into CS_OFFICE arena...');
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

  console.log('[Setup] Waiting for 3D CS_OFFICE GLB arena and viewmodels to mount...');
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try {
      const res = await send('Runtime.evaluate', {
        expression: `!!window.csOfficeGlbLoaded && !!window.garamGame?.ctx?.viewmodel?.armsLoaded`,
        returnByValue: true,
      });
      if (res && res.result && res.result.value) {
        console.log('[Setup] cs_office.glb and viewmodels confirmed mounted!');
        break;
      }
    } catch {}
  }
  await sleep(1500);

  // 1. Courtyard view (verify_01_office_courtyard.png)
  console.log('[Capture 1] verify_01_office_courtyard.png — Real CS_OFFICE snowy courtyard/exterior...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const game = window.garamGame;
      if (game?.ctx?.player) {
        game.ctx.player.state.x = 0;
        game.ctx.player.state.y = 0;
        game.ctx.player.state.z = -22;
        game.ctx.player.state.yaw = 0;
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }));
    })()`,
  });
  await sleep(800);
  await capture('verify_01_office_courtyard.png', 'CS_OFFICE Snowy Exterior & Courtyard');

  // 2. Interior view (verify_02_office_interiors.png)
  console.log('[Capture 2] verify_02_office_interiors.png — Real CS_OFFICE indoor hallways & office rooms...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const game = window.garamGame;
      if (game?.ctx?.player) {
        game.ctx.player.state.x = 2;
        game.ctx.player.state.y = 1.4;
        game.ctx.player.state.z = 8;
        game.ctx.player.state.yaw = -Math.PI / 2;
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(800);
  await capture('verify_02_office_interiors.png', 'CS_OFFICE Indoor Hallways & Office Rooms');

  // 3. Primary Weapons Grid (verify_03_weapons_grid_1.png)
  console.log('[Capture 3] verify_03_weapons_grid_1.png — Primary weapons in hand (garam-47)...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(1000);
  await capture('verify_03_weapons_grid_1.png', 'Primary Weapons Viewmodel Framing');

  // 4. Secondary & SMG Weapons + 4-column Buy Menu (verify_04_weapons_grid_2.png)
  console.log('[Capture 4] verify_04_weapons_grid_2.png — 4-column Buy Menu & newly added weapons...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
    })()`,
  });
  await sleep(800);
  await capture('verify_04_weapons_grid_2.png', '4-Column Buy Menu UI');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    })()`,
  });
  await sleep(400);

  // 5. 3P Bots Close-up (verify_05_3p_bots_closeup.png)
  console.log('[Capture 5] verify_05_3p_bots_closeup.png — Close-up of 3rd person bots holding weapons in both hands...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const game = window.garamGame;
      const ctx = game?.ctx;
      if (ctx?.player && ctx.bots && ctx.bots.length > 0) {
        const bot = ctx.bots[0];
        ctx.player.state.x = bot.mesh.position.x;
        ctx.player.state.y = bot.mesh.position.y;
        ctx.player.state.z = bot.mesh.position.z + 1.8;
        ctx.player.state.yaw = Math.PI;
      }
    })()`,
  });
  await sleep(1000);
  await capture('verify_05_3p_bots_closeup.png', '3P Operator Bots Close-Up');

  // 6. Live Combat Perf with F3 PerfMonitor (verify_06_live_combat_perf.png)
  console.log('[Capture 6] verify_06_live_combat_perf.png — Live firefight with F3 PerfMonitor open...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      // Toggle F3 PerfMonitor
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', key: 'F3', bubbles: true }));
      // Fire weapon
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        setTimeout(() => canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })), 100);
      }
    })()`,
  });
  await sleep(800);
  await capture('verify_06_live_combat_perf.png', 'Live Combat & F3 PerfMonitor Metrics');

  console.log('\n=====================================================');
  console.log('Console errors during session:');
  if (consoleErrors.length === 0) {
    console.log('✅ ZERO CONSOLE ERRORS DETECTED!');
  } else {
    console.log(consoleErrors.join('\n'));
  }
  console.log('=====================================================');

  ws.close();
  cleanup();
  console.log('Done capturing verification screenshots!');
}

main().catch((e) => {
  console.error('Fatal screenshot error:', e);
  process.exit(1);
});
