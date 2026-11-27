const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
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
    await sleep(300);
  }
  throw new Error('Failed to connect to Chrome CDP on port 9222');
}

async function test() {
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  const userDataDir = 'C:\\Users\\Eldar\\AppData\\Local\\Temp\\garam_debug_profile_' + Date.now();

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

  const wsUrl = await getDebuggerUrl(30);
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.on('open', r));

  let id = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');

  await sleep(1500);

  // Deploy player
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

  // Wait for models
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const r = await send('Runtime.evaluate', {
      expression: `!!window.csOfficeGlbLoaded && !!window.garamGame?.ctx?.viewmodel?.armsLoaded`,
      returnByValue: true
    });
    if (r?.result?.value) {
      console.log('Confirmed models loaded!');
      break;
    }
  }

  await sleep(1500);

  // Switch to AK-47
  await send('Runtime.evaluate', {
    expression: `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '1', bubbles: true }))`,
  });
  await sleep(1000);

  const ss = await send('Page.captureScreenshot', { format: 'png' });
  const outPath = path.resolve(__dirname, '../docs/assets/playtests/test_real_cs_office.png');
  fs.writeFileSync(outPath, Buffer.from(ss.data, 'base64'));
  console.log('Saved test screenshot to:', outPath);

  ws.close();
  cleanup();
}

test().catch(console.error);
