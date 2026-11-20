const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getDebuggerUrl(retries = 15) {
  for (let i = 0; i < retries; i++) {
    try {
      const data = await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:9222/json', (res) => {
          let str = '';
          res.on('data', chunk => str += chunk);
          res.on('end', () => resolve(str));
        });
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('timeout')));
      });
      const list = JSON.parse(data);
      const page = list.find(p => p.url.includes('localhost:3000') || p.title.includes('GARAM'));
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) {
      // retry
    }
    await sleep(500);
  }
  throw new Error('Failed to connect to Chrome CDP on port 9222');
}

async function runAutonomousQASuite() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const userDataDir = "C:\\Users\\Eldar\\AppData\\Local\\Temp\\garam_qa_profile";

  console.log('=====================================================');
  console.log('🚀 GARAM: ZERO HOUR — AUTONOMOUS QA PLAYTEST SUITE');
  console.log('=====================================================');

  const chromeProc = spawn(chromePath, [
    '--headless=new',
    '--remote-debugging-port=9222',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-gpu',
    '--window-size=1920,1080',
    'http://localhost:3000'
  ], { stdio: 'ignore', detached: false });

  process.on('exit', () => {
    try { chromeProc.kill(); } catch (e) {}
  });

  console.log('[Phase 1] Connecting to Chrome CDP at ws://127.0.0.1:9222 ...');
  const wsUrl = await getDebuggerUrl(15);
  console.log('✓ Connected to Target Page:', wsUrl);

  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  const consoleErrors = [];
  const consoleLogs = [];

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
      const text = msg.params.args.map(a => a.value || JSON.stringify(a)).join(' ');
      if (msg.params.type === 'error' || msg.params.type === 'warning') {
        consoleErrors.push(`[CONSOLE ${msg.params.type.toUpperCase()}] ${text}`);
      } else {
        consoleLogs.push(`[CONSOLE ${msg.params.type}] ${text}`);
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

  await new Promise(resolve => ws.on('open', resolve));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  // Wait for DOM and WebGL canvas to be ready
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const res = await send('Runtime.evaluate', {
        expression: `document.readyState === 'complete' && !!document.getElementById('game-canvas')`,
        returnByValue: true
      });
      if (res && res.result && res.result.value) {
        break;
      }
    } catch {}
  }
  await sleep(1500);

  // 1. Initial State & Canvas Check
  console.log('\n[Test 1] Verifying Boot, WebGL2 Context & Pre-Match Lobby...');
  const bootCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const canvas = document.getElementById('game-canvas');
      const blocker = document.getElementById('blocker');
      const overlay = document.getElementById('ui-overlay');
      const roundBanner = document.getElementById('round-banner');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const isBannerVisible = roundBanner && getComputedStyle(roundBanner).display !== 'none' && (!overlay || getComputedStyle(overlay).display !== 'none');
      return {
        canvasReady: !!canvas && canvas.width > 0,
        canvasResolution: canvas.width + 'x' + canvas.height,
        webglVersion: gl ? (gl instanceof WebGL2RenderingContext ? 'WebGL 2.0' : 'WebGL 1.0') : 'None',
        glVendor: gl ? gl.getParameter(gl.VENDOR) : 'N/A',
        blockerVisible: blocker && getComputedStyle(blocker).display === 'flex',
        overlayHidden: overlay && getComputedStyle(overlay).display === 'none',
        roundBannerHiddenInLobby: !isBannerVisible,
      };
    })()`,
    returnByValue: true
  });
  console.log('Boot Check Result:', bootCheck.result.value);

  // 2. Faction Selection & Settings Validation
  console.log('\n[Test 2] Testing Lobby Controls & Faction Toggle...');
  const lobbyCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const vanguardBtn = document.querySelector('.vanguard-btn');
      const syndicateBtn = document.querySelector('.syndicate-btn');
      const diffBtns = document.querySelectorAll('#diff-selector .lobby-btn');
      return {
        vanguardActive: vanguardBtn?.classList.contains('active'),
        syndicateActive: syndicateBtn?.classList.contains('active'),
        diffCount: diffBtns.length,
      };
    })()`,
    returnByValue: true
  });
  console.log('Lobby Controls:', lobbyCheck.result.value);

  // 3. Deploy Operator & PointerLock
  console.log('\n[Test 3] Deploying Operator & Entering Match...');
  const deployAction = await send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('spawn-btn');
      if (btn) btn.click();
      return { clicked: !!btn };
    })()`,
    returnByValue: true
  });
  console.log('Spawn Button Clicked:', deployAction.result.value);

  await sleep(1200);

  // 4. Test In-Game HUD Elements
  console.log('\n[Test 4] Verifying In-Game HUD & Round State...');
  const hudCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const roundTimer = document.getElementById('round-timer')?.innerText;
      const scoreCT = document.getElementById('score-ct')?.innerText;
      const scoreT = document.getElementById('score-t')?.innerText;
      const hp = document.getElementById('hud-hp')?.innerText;
      const armor = document.getElementById('hud-armor')?.innerText;
      const speed = document.getElementById('hud-speed')?.innerText;
      const cash = document.getElementById('hud-cash')?.innerText;
      const wp = document.getElementById('hud-weapon-name')?.innerText;
      const ammo = document.getElementById('hud-ammo-cur')?.innerText;
      return { roundTimer, scoreCT, scoreT, hp, armor, speed, cash, wp, ammo };
    })()`,
    returnByValue: true
  });
  console.log('Active HUD State:', hudCheck.result.value);

  // 5. Test [F3] PerfMonitor Telemetry
  console.log('\n[Test 5] Toggling [F3] Performance Telemetry Graph...');
  const f3Check = await send('Runtime.evaluate', {
    expression: `(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', bubbles: true }));
      await new Promise(r => setTimeout(r, 400));
      const perfEl = document.getElementById('garam-perf-monitor');
      const isVisible = perfEl ? getComputedStyle(perfEl).display === 'block' : false;
      const content = perfEl ? perfEl.innerText : '';
      return { isVisible, content: content.split('\\n').filter(Boolean) };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('F3 Perf Monitor:', f3Check.result.value);

  // 6. Test Buy Menu Toggle (Key B)
  console.log('\n[Test 6] Testing Buy Menu (Key B) and Purchase Validation...');
  const buyCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', bubbles: true }));
      const menu = document.getElementById('buy-menu');
      const isVisible = menu ? getComputedStyle(menu).display === 'block' : false;
      const status = document.getElementById('buy-zone-status')?.innerText;

      // Close buy menu with Escape
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
      const isClosed = menu ? getComputedStyle(menu).display === 'none' : false;

      return { opened: isVisible, status, closedWithEsc: isClosed };
    })()`,
    returnByValue: true
  });
  console.log('Buy Menu Check:', buyCheck.result.value);

  // 6b. Test Weapon Switching (1, 2, 3)
  console.log('\n[Test 6b] Testing Fast Weapon Switching...');
  const switchCheck = await send('Runtime.evaluate', {
    expression: `(async () => {
      // Press 2 for Secondary (Pistol)
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit2', key: '2', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const wpAfter2 = document.getElementById('hud-weapon-name')?.innerText;
      const slot2Active = document.getElementById('slot-2')?.classList.contains('active');

      // Press 3 for Knife
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', key: '3', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const wpAfter3 = document.getElementById('hud-weapon-name')?.innerText;
      const slot3Active = document.getElementById('slot-3')?.classList.contains('active');

      // Press 1 for Primary
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }));
      await new Promise(r => setTimeout(r, 150));
      const wpAfter1 = document.getElementById('hud-weapon-name')?.innerText;
      const slot1Active = document.getElementById('slot-1')?.classList.contains('active');

      return {
        after2: { wp: wpAfter2, slot2Active },
        after3: { wp: wpAfter3, slot3Active },
        after1: { wp: wpAfter1, slot1Active },
      };
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  console.log('Weapon Switch Check:', switchCheck.result.value);

  // 6c. Test Tactical Map Callout HUD
  console.log('\n[Test 6c] Verifying Tactical Map Callout HUD...');
  const calloutCheck = await send('Runtime.evaluate', {
    expression: `(() => {
      const calloutEl = document.getElementById('hud-callout');
      return {
        calloutText: calloutEl?.innerText,
        calloutVisible: !!calloutEl && getComputedStyle(calloutEl).display !== 'none'
      };
    })()`,
    returnByValue: true
  });
  console.log('Tactical Callout Check:', calloutCheck.result.value);

  // 7. Capture In-Game Verification Screenshot
  console.log('\n[Test 7] Capturing High-Res Playtest Screenshot...');
  const ss = await send('Page.captureScreenshot', { format: 'png' });
  const ssPath = 'playtest-live-verified.png';
  fs.writeFileSync(ssPath, Buffer.from(ss.data, 'base64'));
  console.log('✓ Saved playtest screenshot to:', ssPath);

  console.log('\n=====================================================');
  console.log('📊 TELEMETRY AUDIT REPORT');
  console.log('=====================================================');
  if (consoleErrors.length === 0) {
    console.log('✅ ZERO CONSOLE ERRORS, WARNINGS, OR UNCAUGHT EXCEPTIONS!');
  } else {
    console.log('⚠️ Console Diagnostics Detected:');
    console.log(consoleErrors.join('\n'));
  }

  ws.close();
  try { chromeProc.kill(); } catch (e) {}
  console.log('\n✅ Autonomous QA Playtest Complete!');
}

runAutonomousQASuite().catch(err => {
  console.error('QA Automation Fatal Error:', err);
  process.exit(1);
});
