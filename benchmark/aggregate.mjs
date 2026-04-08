#!/usr/bin/env node
/**
 * aggregate.mjs — Merge all per-run raw JSON results into a single benchmark/summary.md
 *
 * Scans all results/TIMESTAMP/raw/*.json files, aggregates metrics per model×prompt,
 * and writes benchmark/summary.md with the combined leaderboard.
 *
 * Usage:
 *   node local-llm/benchmark/aggregate.mjs
 *   node local-llm/benchmark/aggregate.mjs --dir local-llm/benchmark/results/2026-04-07T10-00-00
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const r = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      r[argv[i].slice(2)] = argv[i + 1] ?? true;
      if (argv[i + 1] && !argv[i + 1].startsWith('--')) i++;
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Collect raw result files
// ---------------------------------------------------------------------------

const resultsRoot = join(__dirname, 'results');

function getRunDirs(root) {
  try {
    return readdirSync(root)
      .map(name => join(root, name))
      .filter(p => {
        try { return statSync(p).isDirectory(); } catch { return false; }
      })
      .sort();
  } catch {
    return [];
  }
}

const targetDir = args['dir'] ? [args['dir']] : getRunDirs(resultsRoot);

if (targetDir.length === 0) {
  console.error('No results directories found. Run the benchmark first.');
  process.exit(1);
}

console.log(`Aggregating from ${targetDir.length} run director${targetDir.length === 1 ? 'y' : 'ies'}...`);

const allRuns = [];

for (const runDir of targetDir) {
  const rawDir = join(runDir, 'raw');
  let files;
  try {
    files = readdirSync(rawDir).filter(f => f.endsWith('.json'));
  } catch {
    continue;
  }
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(rawDir, file), 'utf8'));
      allRuns.push(data);
    } catch {
      console.warn(`  Skipping unreadable file: ${file}`);
    }
  }
}

console.log(`Loaded ${allRuns.length} individual run records.`);

if (allRuns.length === 0) {
  console.error('No run records found.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Load prompt + model metadata for display
// ---------------------------------------------------------------------------

const prompts = JSON.parse(readFileSync(join(__dirname, 'prompts.json'), 'utf8'));
const models = JSON.parse(readFileSync(join(__dirname, 'models.json'), 'utf8'));

// ---------------------------------------------------------------------------
// Aggregate: group by model-id × prompt-id, compute median metrics
// ---------------------------------------------------------------------------

const grouped = new Map(); // key: "modelId__promptId"

for (const run of allRuns) {
  if (run.error) continue;
  const modelId = run.model?.id;
  const promptId = run.prompt?.id;
  if (!modelId || !promptId) continue;

  const key = `${modelId}__${promptId}`;
  if (!grouped.has(key)) {
    grouped.set(key, {
      model: run.model,
      prompt: run.prompt,
      runs: [],
    });
  }
  grouped.get(key).runs.push(run);
}

const median = arr => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

const aggregated = new Map();
for (const [key, { model, prompt, runs }] of grouped) {
  const ttfts = runs.map(r => r.metrics?.ttft_ms).filter(Number.isFinite);
  const tgTps = runs.map(r => r.metrics?.tg_tps).filter(Number.isFinite);
  const totals = runs.map(r => r.metrics?.total_ms).filter(Number.isFinite);

  // Score: prefer latest runs (last timestamp) if multiple runs exist for same model×prompt
  const scored = runs.filter(r => {
    const e = r.evaluation;
    return e && (e.score !== undefined || e.accuracy !== undefined);
  });

  let compositeScore = null;
  if (scored.length > 0) {
    const scores = scored.map(r => {
      const e = r.evaluation;
      if (e.type === 'exact-match' || e.type === 'exact-parse') return e.score;
      return (e.accuracy + e.completeness + e.conciseness) / 3;
    });
    compositeScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  }

  // Grab a sample rationale from most recent scored run
  const latestScored = scored.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))[0];
  const rationale = latestScored?.evaluation?.rationale ?? null;

  aggregated.set(key, {
    model,
    prompt,
    ttft_ms: median(ttfts),
    tg_tps: median(tgTps),
    total_ms: median(totals),
    score: compositeScore,
    n_runs: runs.length,
    rationale,
  });
}

// ---------------------------------------------------------------------------
// Build summary markdown
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const lines = [];

lines.push('# Local LLM Benchmark — Aggregate Summary');
lines.push('');
lines.push(`> Auto-generated by \`aggregate.mjs\` — ${now}`);
lines.push(`> Aggregated from **${allRuns.length}** runs across **${targetDir.length}** benchmark session(s).`);
lines.push(`> Metrics shown are **medians** across all runs for each model × prompt combination.`);
lines.push('');
lines.push('---');
lines.push('');

// ---------------------------------------------------------------------------
// Section 1: Speed leaderboard
// ---------------------------------------------------------------------------

lines.push('## Speed Leaderboard');
lines.push('');
lines.push('Median TG t/s and TTFT across all prompts per model. Higher TG = more responsive.');
lines.push('');
lines.push('| Model | Engine | Median TG (t/s) | Median TTFT (ms) | Prompts run |');
lines.push('|---|---|---|---|---|');

const speedByModel = new Map();
for (const [, d] of aggregated) {
  const k = d.model.id;
  if (!speedByModel.has(k)) speedByModel.set(k, { model: d.model, tg: [], ttft: [], prompts: new Set() });
  if (d.tg_tps !== null) speedByModel.get(k).tg.push(d.tg_tps);
  if (d.ttft_ms !== null) speedByModel.get(k).ttft.push(d.ttft_ms);
  speedByModel.get(k).prompts.add(d.prompt.id);
}

const speedRows = [...speedByModel.values()]
  .map(v => ({
    model: v.model,
    medianTg: median(v.tg),
    medianTtft: median(v.ttft),
    promptCount: v.prompts.size,
  }))
  .sort((a, b) => (b.medianTg ?? 0) - (a.medianTg ?? 0));

for (const r of speedRows) {
  lines.push(`| ${r.model.label} | ${r.model.engine} | ${r.medianTg ?? '—'} | ${r.medianTtft ?? '—'} | ${r.promptCount} |`);
}
lines.push('');

// ---------------------------------------------------------------------------
// Section 2: Quality leaderboard
// ---------------------------------------------------------------------------

lines.push('## Quality Leaderboard');
lines.push('');
lines.push('Average composite score (1–10) across all judged prompts. Judge: `claude-sonnet-4.6`.');
lines.push('Exact-match and exact-parse prompts score 0 or 10 based on pass/fail.');
lines.push('');
lines.push('| Model | Engine | Avg Score /10 | Prompts judged |');
lines.push('|---|---|---|---|');

const qualByModel = new Map();
for (const [, d] of aggregated) {
  if (d.score === null) continue;
  const k = d.model.id;
  if (!qualByModel.has(k)) qualByModel.set(k, { model: d.model, scores: [] });
  qualByModel.get(k).scores.push(parseFloat(d.score));
}

const qualRows = [...qualByModel.values()]
  .map(v => ({
    model: v.model,
    avg: (v.scores.reduce((a, b) => a + b, 0) / v.scores.length).toFixed(1),
    n: v.scores.length,
  }))
  .sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg));

for (const r of qualRows) {
  lines.push(`| ${r.model.label} | ${r.model.engine} | ${r.avg} | ${r.n} |`);
}
lines.push('');

// ---------------------------------------------------------------------------
// Section 3: Per-category breakdowns
// ---------------------------------------------------------------------------

lines.push('## Results by Category');
lines.push('');

const categories = [...new Set(prompts.map(p => p.category))];

for (const category of categories) {
  const catPrompts = prompts.filter(p => p.category === category);
  const catKeys = [...aggregated.keys()].filter(k => {
    const d = aggregated.get(k);
    return d.prompt.category === category;
  });
  if (catKeys.length === 0) continue;

  lines.push(`### ${category}`);
  lines.push('');

  for (const prompt of catPrompts) {
    const rows = [...aggregated.values()].filter(d => d.prompt.id === prompt.id);
    if (rows.length === 0) continue;

    lines.push(`#### ${prompt.title} (\`${prompt.id}\`)`);
    lines.push('');
    lines.push('| Model | Engine | TTFT (ms) | TG (t/s) | Total (s) | Score /10 | Runs |');
    lines.push('|---|---|---|---|---|---|---|');

    rows.sort((a, b) => {
      const sa = parseFloat(a.score ?? 0);
      const sb = parseFloat(b.score ?? 0);
      if (sb !== sa) return sb - sa;
      return (b.tg_tps ?? 0) - (a.tg_tps ?? 0);
    });

    for (const d of rows) {
      const totalS = d.total_ms !== null ? (d.total_ms / 1000).toFixed(1) : '—';
      lines.push(`| ${d.model.label} | ${d.model.engine} | ${d.ttft_ms ?? '—'} | ${d.tg_tps ?? '—'} | ${totalS} | ${d.score ?? '—'} | ${d.n_runs} |`);
    }

    // Show best rationale if available
    const best = rows.find(d => d.rationale);
    if (best) {
      lines.push('');
      lines.push(`> **Best response** (${best.model.label}): *${best.rationale}*`);
    }
    lines.push('');
  }
}

// ---------------------------------------------------------------------------
// Section 4: MLX vs Ollama head-to-head
// ---------------------------------------------------------------------------

const mlxRows = [...aggregated.values()].filter(d => d.model.engine === 'mlx');
const hasMLX = mlxRows.length > 0;

if (hasMLX) {
  lines.push('## MLX vs Ollama Head-to-Head');
  lines.push('');
  lines.push('Same model, different inference engine. Δ TG = MLX minus Ollama t/s.');
  lines.push('');
  lines.push('| Model | Prompt | Ollama TG (t/s) | MLX TG (t/s) | Δ TG | Ollama Score | MLX Score |');
  lines.push('|---|---|---|---|---|---|---|');

  // Find matching pairs
  for (const mlxEntry of mlxRows) {
    // Look for Ollama counterpart: same base model name
    const mlxModelBase = mlxEntry.model.model.replace('mlx-community/', '').replace('-it-4bit', '').replace('-a4b', '').toLowerCase();
    const ollamaMatch = [...aggregated.values()].find(d =>
      d.model.engine === 'ollama' &&
      d.prompt.id === mlxEntry.prompt.id &&
      (d.model.model.replace(':', '-').replace('.', '-').toLowerCase().includes(mlxModelBase.split('-').slice(0, 3).join('-')) ||
       mlxModelBase.includes(d.model.model.split(':')[0].replace('.', '-').toLowerCase()))
    );

    if (!ollamaMatch) continue;
    const delta = (mlxEntry.tg_tps !== null && ollamaMatch.tg_tps !== null)
      ? `${mlxEntry.tg_tps > ollamaMatch.tg_tps ? '+' : ''}${(mlxEntry.tg_tps - ollamaMatch.tg_tps).toFixed(1)}`
      : '—';

    lines.push(`| ${mlxEntry.model.label.replace(' (MLX)', '')} | ${mlxEntry.prompt.id} | ${ollamaMatch.tg_tps ?? '—'} | ${mlxEntry.tg_tps ?? '—'} | ${delta} | ${ollamaMatch.score ?? '—'} | ${mlxEntry.score ?? '—'} |`);
  }
  lines.push('');
}

// ---------------------------------------------------------------------------
// Section 5: Raw run log
// ---------------------------------------------------------------------------

lines.push('## Run Log');
lines.push('');
lines.push('All benchmark sessions included in this summary:');
lines.push('');
for (const dir of targetDir) {
  const parts = dir.split('/');
  lines.push(`- \`${parts[parts.length - 1]}\``);
}
lines.push('');
lines.push('---');
lines.push('');
lines.push(`*To regenerate: \`node local-llm/benchmark/aggregate.mjs\`*`);

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

const outputPath = join(__dirname, 'summary.md');
writeFileSync(outputPath, lines.join('\n'));
console.log(`\nWritten: ${outputPath}`);
console.log(`Models covered: ${speedRows.map(r => r.model.label).join(', ')}`);
