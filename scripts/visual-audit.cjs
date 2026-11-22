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
  console.log('📸 GARAM: ZERO HOUR — COMPREHENSIVE 20-STAGE VISUAL AUDIT');
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
    await sleep(400);
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    const targetPath = path.join(outDir, fileName);
    fs.writeFileSync(targetPath, Buffer.from(ss.data, 'base64'));
    console.log(`✓ [Screenshot] ${label} -> ${fileName}`);
  }

  // Stage 1: Lobby Screen with Panoramic Overlook
  console.log('\n[Capture 1] Inspecting Lobby Modal & Panoramic Overlook Camera...');
  await capture('audit_01_lobby.png', 'Stage 1: Lobby Panoramic Overlook');

  // Deploy Operator into Arena
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

  // Stage 2: Garam-47 (AK) Idle Viewmodel Framing
  console.log('\n[Capture 2] Inspecting Garam-47 (AK) Idle Viewmodel Framing...');
  await capture('audit_02_garam47_idle.png', 'Stage 2: Garam-47 Viewmodel Idle');

  // Stage 3: Garam-47 Firing Recoil Kick & Casing
  console.log('\n[Capture 3] Simulating Garam-47 Primary Fire Recoil Kick...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('game-canvas');
      if (canvas) canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    })()`,
  });
  await sleep(120);
  await capture('audit_03_garam47_fire.png', 'Stage 3: Garam-47 Firing Recoil');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('game-canvas');
      if (canvas) canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
    })()`,
  });
  await sleep(300);

  // Stage 4: Garam-47 Reload
  console.log('\n[Capture 4] Simulating Garam-47 Reload Sequence...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true }))`,
  });
  await sleep(400);
  await capture('audit_04_garam47_reload.png', 'Stage 4: Garam-47 Reloading');
  await sleep(1000);

  // Stage 5: Desert Eagle Idle
  console.log('\n[Capture 5] Switching to Desert Eagle (.50 AE)...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true }))`,
  });
  await sleep(700);
  await capture('audit_05_deagle_idle.png', 'Stage 5: Desert Eagle Idle');

  // Stage 6: Desert Eagle Firing Blowback
  console.log('\n[Capture 6] Simulating Desert Eagle Slide Blowback...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        setTimeout(() => canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })), 50);
      }
    })()`,
  });
  await sleep(80);
  await capture('audit_06_deagle_fire.png', 'Stage 6: Desert Eagle Slide Blowback');
  await sleep(400);

  // Stage 7: Karambit Reverse-Grip Idle
  console.log('\n[Capture 7] Switching to Tactical Knife (Karambit Reverse-Grip)...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }))`,
  });
  await sleep(700);
  await capture('audit_07_karambit_idle.png', 'Stage 7: Karambit Reverse-Grip Idle');

  // Stage 8: Karambit Ring Twirl Inspect (F key)
  console.log('\n[Capture 8] Triggering Karambit Index-Finger Twirl Inspect...');
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }))`,
  });
  await sleep(350);
  await capture('audit_08_karambit_inspect.png', 'Stage 8: Karambit Ring Inspect');
  await sleep(500);

  // Stage 9: Vanguard M4A1-S Idle
  console.log('\n[Capture 9] Purchasing & Inspecting Vanguard M4A1-S...');
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
  await capture('audit_09_m4a1s_idle.png', 'Stage 9: Vanguard M4A1-S Idle');

  // Stage 10: Vanguard M4A1-S Firing
  console.log('\n[Capture 10] Firing Suppressed Vanguard M4A1-S...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        setTimeout(() => canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })), 50);
      }
    })()`,
  });
  await sleep(80);
  await capture('audit_10_m4a1s_fire.png', 'Stage 10: M4A1-S Firing');
  await sleep(400);

  // Stage 11: Sovereign AWP Idle
  console.log('\n[Capture 11] Purchasing & Inspecting Sovereign AWP...');
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
  await capture('audit_11_awp_idle.png', 'Stage 11: Sovereign AWP Idle');

  // Stage 12: Sovereign AWP Firing Recoil
  console.log('\n[Capture 12] Firing Sovereign AWP...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('game-canvas');
      if (canvas) {
        canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
        setTimeout(() => canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true })), 50);
      }
    })()`,
  });
  await sleep(80);
  await capture('audit_12_awp_fire.png', 'Stage 12: AWP Firing Recoil');
  await sleep(400);

  // Stage 13: Underpass Portal & Doorway Bounce GI
  console.log('\n[Capture 13] Inspecting Underpass Portal & Doorway Radiosity...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 0, bubbles: true }));
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: -700, movementY: 60, bubbles: true }));
    })()`,
  });
  await sleep(600);
  await capture('audit_13_underpass_portal.png', 'Stage 13: Underpass Portal Bounce GI');

  // Stage 14: Mid Watchtower Silhouette
  console.log('\n[Capture 14] Inspecting Mid Watchtower, Terracotta Roof & Sloped Cheek-Walls...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 700, movementY: -160, bubbles: true }));
    })()`,
  });
  await sleep(600);
  await capture('audit_14_mid_watchtower.png', 'Stage 14: Mid Watchtower Architecture');

  // Stage 15: Extruded Roman Stone Archways & Shuttered Windows
  console.log('\n[Capture 15] Inspecting Roman Stone Archways, Keystones & Mediterranean Windows...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: -1400, movementY: 100, bubbles: true }));
    })()`,
  });
  await sleep(600);
  await capture('audit_15_archways_and_windows.png', 'Stage 15: Roman Arches & Windows');

  // Stage 16: PBR Cobblestone Deck & Weathered Plaster Close-Up
  console.log('\n[Capture 16] Inspecting Photographic Cobblestone 04 PBR Deck & Weathered Plaster...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 0, movementY: 360, bubbles: true }));
    })()`,
  });
  await sleep(600);
  await capture('audit_16_pbr_cobblestone_deck.png', 'Stage 16: Photographic PBR Cobblestone Deck');

  // Stage 17: Active 3D Volumetric Smoke Cloud (Deploys right on deck 3m in front of camera)
  console.log('\n[Capture 17] Deploying & Capturing 3D Volumetric Smoke Grenade Cloud...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 1400, movementY: -100, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      const smokeBtn = document.querySelector('[data-buy="smoke-grenade"]');
      if (smokeBtn) smokeBtn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', key: '4', bubbles: true }));
      setTimeout(() => {
        const canvas = document.getElementById('game-canvas');
        if (canvas) {
          canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
          setTimeout(() => canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true })), 60);
        }
      }, 400);
    })()`,
  });
  await sleep(2400);
  await capture('audit_17_combat_smoke_cloud.png', 'Stage 17: Volumetric Smoke Cloud');

  // Stage 18: Multi-Tongue Molotov Fire & Scorched Ground Decal (Deploys on deck in view)
  console.log('\n[Capture 18] Deploying & Capturing Multi-Tongue Molotov Fire...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      const molotovBtn = document.querySelector('[data-buy="molotov"]');
      if (molotovBtn) molotovBtn.click();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit4', key: '4', bubbles: true }));
      setTimeout(() => {
        const canvas = document.getElementById('game-canvas');
        if (canvas) {
          canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
          setTimeout(() => canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true })), 60);
        }
      }, 400);
    })()`,
  });
  await sleep(2200);
  await capture('audit_18_combat_molotov_fire.png', 'Stage 18: Multi-Tongue Molotov Fire');

  // Stage 19: 3rd-Person Tactical Operator Bot & Ground Shadows
  console.log('\n[Capture 19] Inspecting 3rd-Person Operator Bot & CSM Directional Ground Shadows...');
  await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 600, movementY: -100, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
      window.dispatchEvent(new MouseEvent('mousemove', { movementX: 750, movementY: 50, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
    })()`,
  });
  await sleep(600);
  await capture('audit_19_3p_vanguard_bot.png', 'Stage 19: 3P Operator Bot & CSM Shadows');

  // Stage 20: Esports HUD & Rotating Orthographic Radar
  console.log('\n[Capture 20] Inspecting CS2 Tournament HUD & Rotating Orthographic Radar...');
  await capture('audit_20_ortho_radar_hud.png', 'Stage 20: Esports HUD & Radar');

  console.log('\n=====================================================');
  console.log('📊 20-STAGE VISUAL AUDIT RESULTS');
  console.log('=====================================================');
  if (consoleErrors.length === 0) {
    console.log('✅ ZERO CONSOLE ERRORS DETECTED DURING 20-STAGE VISUAL AUDIT!');
  } else {
    console.log('⚠️ Console Diagnostics Detected:');
    console.log(consoleErrors.join('\n'));
  }

  ws.close();
  cleanup();
  console.log('✓ 20-Stage Visual Audit Concluded Successfully!\n');
}

runVisualAudit().catch((err) => {
  console.error('Visual Audit Fatal Error:', err);
  process.exit(1);
});
