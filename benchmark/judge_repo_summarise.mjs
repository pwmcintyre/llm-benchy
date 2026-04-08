#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const resultsRoot = join(new URL('.', import.meta.url).pathname, 'results');

function findFiles(dir) {
  const res = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      res.push(...findFiles(p));
    } else if (entry.isFile() && entry.name.includes('repo-summarise') && entry.name.endsWith('.json')) {
      res.push(p);
    }
  }
  return res;
}

function scoreRepoSummarise(text) {
  const t = (text || '').toLowerCase();
  const keywords = ['llm-benchy', 'opencode', 'benchmark', 'mlx', 'ollama', 'findings', 'setup', 'runner', 'models', 'prompts'];
  let found = 0;
  for (const k of keywords) if (t.includes(k)) found++;

  const accuracy = Math.min(10, 4 + found); // baseline 4
  const completeness = Math.min(10, 4 + Math.round((found / keywords.length) * 6));
  const len = (text || '').length;
  const conciseness = len < 200 ? 9 : len < 600 ? 8 : len < 1200 ? 7 : len < 2400 ? 6 : 5;
  const rationale = `Found ${found}/${keywords.length} key terms; len=${len}`;
  return { accuracy, completeness, conciseness, rationale };
}

function composite(ev) {
  if (!ev) return null;
  return Math.round(((ev.accuracy + ev.completeness + ev.conciseness) / 3) * 10) / 10;
}

const files = findFiles(resultsRoot);
if (files.length === 0) {
  console.error('No repo-summarise results found under', resultsRoot);
  process.exit(1);
}

const rows = [];
for (const f of files) {
  try {
    const raw = JSON.parse(readFileSync(f, 'utf8'));
    const model = raw.model?.id || raw.model?.label || 'unknown';
    const engine = raw.model?.engine || 'unknown';
    const run = raw.run ?? 0;
    const ttft = raw.metrics?.ttft_ms ?? null;
    const tg = raw.metrics?.tg_tps ?? null;
    const total_s = raw.metrics?.total_ms ? (raw.metrics.total_ms / 1000).toFixed(1) : '—';
    const content = raw.metrics?.content ?? raw.response ?? '';
    const ev = scoreRepoSummarise(content);
    const score = composite(ev);
    rows.push({ file: f, model, engine, run, ttft, tg, total_s, score, ev, content });
  } catch (err) {
    console.warn('Failed to read', f, err.message);
  }
}

rows.sort((a, b) => (b.score || 0) - (a.score || 0));

const lines = [];
lines.push('# Repo-summarise — Comparative Judgement');
lines.push('');
lines.push('| Model | Engine | Run | TTFT ms | TG t/s | Total s | Score | Rationale | File |');
lines.push('|---|---|---:|---:|---:|---:|---:|---|');
for (const r of rows) {
  const short = relative(process.cwd(), r.file);
  lines.push(`| ${r.model} | ${r.engine} | ${r.run} | ${r.ttft ?? '—'} | ${r.tg ?? '—'} | ${r.total_s} | ${r.score ?? '—'} | ${r.ev.rationale} | ${short} |`);
}

const out = join(resultsRoot, 'repo-summarise-comparison.md');
writeFileSync(out, lines.join('\n'));
console.log('Wrote comparative judgement to', out);
console.log('Top 5:');
for (const r of rows.slice(0, 5)) console.log(`${r.model} (${r.engine}) run ${r.run} → score ${r.score} — ${r.ev.rationale}`);
