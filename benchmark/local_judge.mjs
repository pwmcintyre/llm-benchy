#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const __dir = new URL('.', import.meta.url).pathname;
const resultsRoot = join(__dir, 'results');

function latestDir(root) {
  const entries = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
  if (entries.length === 0) return null;
  const sorted = entries.map(e => e.name).sort();
  return join(root, sorted[sorted.length - 1]);
}

const outDir = latestDir(resultsRoot);
if (!outDir) {
  console.error('No results/ directories found. Run benchmark first.');
  process.exit(1);
}

const rawDir = join(outDir, 'raw');
const prompts = JSON.parse(readFileSync(join(__dir, 'prompts.json'), 'utf8'));
const getPrompt = id => prompts.find(p => p.id === id) || {};

function scoreLLMJudge(promptId, response) {
  // basic heuristics per prompt family — presence of keywords
  const text = response.toLowerCase();
  let accuracy = 5, completeness = 5, conciseness = 7;
  let rationale = '';

  const checks = {
    'code-explain': ['generator', 'yield', 'slice', 'page', 'next'],
    'code-write': ['headers', 'quoted', 'coerce', 'schema', 'throws', 'parse'],
    'code-debug': ['race', 'redis', 'increment', 'atomic', 'mutex', 'transaction', 'watch', 'incr'],
    'repo-summarise': ['llm-benchy', 'benchmark', 'opencode', 'ollama', 'mlx'],
    'knowledge-local': ['mlx', 'ollama', 'quant', 'quantization', 'metal', 'apple', 'context'],
    'knowledge-trends': ['gemma', 'qwen', 'mlx', 'apple', '2025', '2026'],
  };

  const kws = checks[promptId] || [];
  let found = 0;
  for (const k of kws) if (text.includes(k)) found++;
  accuracy = Math.min(10, 4 + found); // more keywords → higher accuracy
  completeness = Math.min(10, 4 + Math.round((found / Math.max(1, kws.length)) * 6));

  // conciseness: penalise overly long responses but allow detail
  const len = response.length;
  if (len < 200) conciseness = 9;
  else if (len < 800) conciseness = 8;
  else if (len < 2000) conciseness = 6;
  else conciseness = 4;

  rationale = `Found ${found}/${kws.length} key terms; length=${len} chars.`;
  return { accuracy, completeness, conciseness, rationale };
}

function scoreExactMatch(promptDef, response) {
  const expected = (promptDef.expected_answer || '').toLowerCase();
  const got = response.toLowerCase();
  const matched = expected && got.includes(expected);
  return {
    accuracy: matched ? 10 : 0,
    completeness: matched ? 10 : 0,
    conciseness: matched ? 10 : 0,
    rationale: matched ? 'Exact match found.' : `Did not find expected string: ${promptDef.expected_answer}`,
  };
}

function scoreExactParse(promptDef, response) {
  // expected keys depend on prompt — instruction-follow requires answer,confidence,reasoning
  try {
    const cleaned = response.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const keys = Object.keys(parsed);
    const required = ['answer', 'confidence', 'reasoning'];
    const hasAll = required.every(k => k in parsed);
    const validConfidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1;
    const score = hasAll && validConfidence ? 10 : hasAll ? 5 : 0;
    return {
      accuracy: score,
      completeness: score,
      conciseness: 10 - Math.min(5, Math.floor((JSON.stringify(parsed).length) / 1000)),
      rationale: hasAll ? (validConfidence ? 'Valid JSON with required keys.' : 'Missing or invalid confidence value.') : 'Missing required keys or invalid JSON.',
    };
  } catch (err) {
    return { accuracy: 0, completeness: 0, conciseness: 0, rationale: 'Invalid JSON.' };
  }
}

function compositeScore(ev) {
  if (!ev) return null;
  const avg = ((ev.accuracy + ev.completeness + ev.conciseness) / 3);
  return Math.round(avg * 10) / 10;
}

// Process files
const files = readdirSync(rawDir).filter(f => f.endsWith('.json'));
const results = [];
for (const file of files) {
  const path = join(rawDir, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.evaluation) {
    results.push(data);
    continue;
  }
  const promptId = data.prompt?.id;
  const promptDef = getPrompt(promptId);
  const resp = data.metrics?.content ?? data.response ?? '';
  let ev = null;
  if (promptDef.eval === 'exact-match') {
    ev = scoreExactMatch(promptDef, resp);
  } else if (promptDef.eval === 'exact-parse') {
    ev = scoreExactParse(promptDef, resp);
  } else {
    ev = scoreLLMJudge(promptId, resp);
  }

  data.evaluation = ev;
  writeFileSync(path, JSON.stringify(data, null, 2));
  results.push(data);
  console.log('Judged', file, '→', compositeScore(ev));
}

// Build a simple summary.md
const lines = [];
lines.push(`# Local Judge Summary — ${new Date().toISOString()}`);
lines.push('');
const byModelPrompt = new Map();
for (const d of results) {
  const key = `${d.model.id}__${d.prompt.id}`;
  const score = compositeScore(d.evaluation);
  const entry = {
    model: d.model,
    prompt: d.prompt,
    ttft_ms: d.metrics?.ttft_ms ?? null,
    tg_tps: d.metrics?.tg_tps ?? null,
    total_ms: d.metrics?.total_ms ?? null,
    score,
  };
  byModelPrompt.set(key, entry);
}

const models = [...new Set(results.map(r => r.model.id))];
for (const m of models) {
  lines.push(`## Model: ${m}`);
  lines.push('');
  lines.push('| Prompt | TTFT ms | TG t/s | Total s | Score |');
  lines.push('|---|---:|---:|---:|---:');
  for (const [k, v] of byModelPrompt) {
    if (v.model.id !== m) continue;
    const totalS = v.total_ms ? (v.total_ms / 1000).toFixed(1) : '—';
    const score = v.score ?? '—';
    lines.push(`| ${v.prompt.id} | ${v.ttft_ms ?? '—'} | ${v.tg_tps ?? '—'} | ${totalS} | ${score} |`);
  }
  lines.push('');
}

const summaryPath = join(outDir, 'summary.md');
writeFileSync(summaryPath, lines.join('\n'));
console.log('Wrote summary to', summaryPath);
