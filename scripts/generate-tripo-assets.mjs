import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Read .env from project root
function loadEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      env[key] = val;
    }
  }
  return env;
}

const env = loadEnv();
const TRIPO_API_KEY = process.env.TRIPO_API_KEY || env.TRIPO_API_KEY;

if (!TRIPO_API_KEY) {
  console.error('[Tripo3D Generator] Error: TRIPO_API_KEY is not defined in .env or environment.');
  process.exit(1);
}

const MODELS_DIR = path.join(rootDir, 'packages', 'client', 'public', 'models');
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

const ASSET_TASKS = [
  {
    filename: 'garam47.glb',
    prompt: 'Modern tactical assault rifle, matte black carbon fiber body with crimson red and brushed gold metallic accents, isolated game weapon asset, clean topology',
  },
  {
    filename: 'karambit.glb',
    prompt: 'Tactical curved karambit combat knife, blackened Damascus steel blade with crimson crimson-gold ring handle, isolated 3D game weapon',
  },
  {
    filename: 'awp.glb',
    prompt: 'Heavy military bolt-action sniper rifle with tactical scope and bipod, matte black and dark crimson finish, game-ready 3D asset',
  },
  {
    filename: 'operator_garam.glb',
    prompt: 'Elite special forces tactical operator in matte black ballistic vest, crimson shoulder insignia, carbon fiber helmet with tinted visor, A-pose full body character',
  },
];

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTripoTask(prompt) {
  const res = await fetch('https://api.tripo3d.ai/v2/openapi/task', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TRIPO_API_KEY}`,
    },
    body: JSON.stringify({
      type: 'text_to_model',
      prompt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tripo3D API create task failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  if (data.code !== 0 || !data.data?.task_id) {
    throw new Error(`Tripo3D API error: ${JSON.stringify(data)}`);
  }
  return data.data.task_id;
}

async function pollTripoTask(taskId, maxWaitMs = 300000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    const res = await fetch(`https://api.tripo3d.ai/v2/openapi/task/${taskId}`, {
      headers: {
        'Authorization': `Bearer ${TRIPO_API_KEY}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[Poll ${taskId}] Warning: HTTP ${res.status}: ${text}`);
      await sleep(5000);
      continue;
    }

    const json = await res.json();
    const task = json.data;
    const status = task?.status;

    if (status === 'success') {
      const glbUrl = task.output?.pbr_model || task.output?.model;
      if (!glbUrl) {
        throw new Error(`Task succeeded but no model URL returned: ${JSON.stringify(task.output)}`);
      }
      return glbUrl;
    } else if (status === 'failed' || status === 'cancelled') {
      throw new Error(`Tripo3D task ${taskId} ended with status: ${status}`);
    }

    const progress = task?.progress || 0;
    process.stdout.write(`Task ${taskId} in progress: ${progress}%...\r`);
    await sleep(4000);
  }

  throw new Error(`Timed out waiting for task ${taskId}`);
}

async function downloadFile(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
}

async function run() {
  console.log('=== GARAM: ZERO HOUR — Tripo3D Asset Generation Pipeline ===\n');

  for (const item of ASSET_TASKS) {
    const dest = path.join(MODELS_DIR, item.filename);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
      console.log(`[Skip] ${item.filename} already exists (${(fs.statSync(dest).size / 1024).toFixed(1)} KB).`);
      continue;
    }

    console.log(`[Generating] ${item.filename}... Prompt: "${item.prompt.slice(0, 50)}..."`);
    try {
      const taskId = await createTripoTask(item.prompt);
      console.log(`[Created] Task ID: ${taskId}. Polling for completion...`);
      const glbUrl = await pollTripoTask(taskId);
      console.log(`\n[Downloading] ${glbUrl.slice(0, 60)}...`);
      await downloadFile(glbUrl, dest);
      console.log(`[Complete] Saved -> ${dest} (${(fs.statSync(dest).size / 1024).toFixed(1)} KB)\n`);
    } catch (err) {
      console.error(`[Error generating ${item.filename}]:`, err.message);
    }
  }

  console.log('=== Asset Generation Pipeline Finished ===');
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
