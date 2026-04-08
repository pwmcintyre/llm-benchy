#!/usr/bin/env node
/*
  Serial benchmark coordinator
  - Runs benchmarks model-by-model, ensuring MLX server is started only for the MLX model under test
  - Prevents parallel MLX / benchmark processes to avoid memory exhaustion
*/
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';

const __dir = dirname(new URL(import.meta.url).pathname);
const models = JSON.parse(readFileSync(join(__dir, 'models.json'), 'utf8'));

const args = process.argv.slice(2);
const RUNS = args.includes('--runs') ? parseInt(args[args.indexOf('--runs') + 1], 10) : 2;
const NO_JUDGE = args.includes('--no-judge') ? true : true; // always no-judge for now

function sh(cmd) {
  try {
    return spawnSync(cmd, { shell: true, stdio: 'inherit' });
  } catch (err) {
    console.error('shell error', err.message);
  }
}

function isMlxServerRunning() {
  const r = spawnSync("pgrep -f mlx_lm.server || true", { shell: true, encoding: 'utf8' });
  return (r.stdout || '').trim().length > 0;
}

function killMlxServer() {
  // best-effort
  spawnSync('pkill -f mlx_lm.server || true', { shell: true });
}

function startMlxServer(modelId, logPath) {
  const pythonPath = `${process.env.HOME}/.venvs/mlx/bin/mlx_lm.server`;
  const args = [
    '--model', modelId,
    '--host', '127.0.0.1',
    '--port', '8080',
    '--max-tokens', '8000',
    '--prompt-cache-size', '8192',
    '--prompt-cache-bytes', '8589934592',
    '--chat-template-args', "{'enable_thinking':false}"
  ];

  const out = createWriteStream(logPath + '.out.log', { flags: 'a' });
  const err = createWriteStream(logPath + '.err.log', { flags: 'a' });

  const child = spawn(pythonPath, args, { detached: true, stdio: ['ignore', out, err] });
  child.unref();
  return child.pid;
}

function waitForMlx(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = spawnSync("curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/v1/models || true", { shell: true, encoding: 'utf8' });
      const code = (r.stdout || '').trim();
      if (code === '200' || code === '404' || code === '400') return true;
    } catch (e) {}
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
  return false;
}

async function runForModel(m) {
  console.log('\n=== Running:', m.id, m.label, m.engine, 'model:', m.model);

  if (!m.installed) {
    console.log('  SKIP not installed:', m.pull || 'no pull command');
    return;
  }

  if (m.engine === 'mlx') {
    console.log('  Ensuring no stray MLX server');
    killMlxServer();
    console.log('  Starting MLX server for', m.model);
    const pid = startMlxServer(m.model, `/tmp/mlx-${m.id}`);
    console.log('  MLX server pid', pid);
    const ready = waitForMlx(90000);
    if (!ready) {
      console.error('  MLX server did not become ready in time; aborting this model');
      killMlxServer();
      return;
    }
  } else {
    // ensure MLX server is not running to free memory
    if (isMlxServerRunning()) {
      console.log('  Killing existing MLX server to free memory');
      killMlxServer();
    }
  }

  // Run the benchmark runner for this single model
  const cmd = `node ${join(__dir, 'run.mjs')} --model ${m.id} --runs ${RUNS} --no-judge`;
  console.log('  Running command:', cmd);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit' });

  if (m.engine === 'mlx') {
    console.log('  Stopping MLX server for', m.model);
    killMlxServer();
  }
}

async function main() {
  console.log('Serial benchmark coordinator starting — runs per model:', RUNS);
  for (const m of models) {
    try {
      await runForModel(m);
    } catch (err) {
      console.error('Error running model', m.id, err.message);
      // ensure MLX stopped
      killMlxServer();
    }
  }
  console.log('\nAll models processed.');
}

main().catch(err => { console.error(err); process.exit(1); });
