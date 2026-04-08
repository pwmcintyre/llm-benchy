#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const __dir = new URL('.', import.meta.url).pathname;
const resultsRoot = join(__dir, 'results');

const openaiKey = process.env.OPENAI_API_KEY;
if (!openaiKey) {
  console.error('OPENAI_API_KEY not set — cannot run judge.');
  process.exit(1);
}

function latestDir(root) {
  const entries = readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
  if (entries.length === 0) return null;
  const sorted = entries.map(e => e.name).sort();
  return join(root, sorted[sorted.length - 1]);
}

const outDir = latestDir(resultsRoot);
if (!outDir) {
  console.error('No results/ directories found.');
  process.exit(1);
}

const rawDir = join(outDir, 'raw');

const prompts = JSON.parse(readFileSync(join(__dir, 'prompts.json'), 'utf8'));
const getPromptById = id => prompts.find(p => p.id === id);

const JUDGE_SYSTEM = `You are an impartial evaluator assessing AI assistant responses.
Score the response on three dimensions, each 1–10:
- accuracy: factually correct, no hallucinations, technically sound
- completeness: addresses all parts of the prompt
- conciseness: no unnecessary padding, repetition, or filler

Respond ONLY with valid JSON (no markdown, no code fences):
{"accuracy": <1-10>, "completeness": <1-10>, "conciseness": <1-10>, "rationale": "<one sentence>"}`;

async function judgeSingle(promptText, responseText, criteria) {
  const userMsg = `## Evaluation criteria\n${criteria}\n\n## Original prompt\n${promptText}\n\n## Response to evaluate\n${responseText}`;

  const body = {
    model: 'gpt-5-mini',
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: userMsg },
    ],
    stream: false,
    max_tokens: 256,
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI judge HTTP ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`No JSON object found in judge response: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

async function main() {
  console.log('Judging saved results in', outDir);
  const files = readdirSync(rawDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const path = join(rawDir, file);
      const data = JSON.parse(readFileSync(path, 'utf8'));
      if (data.evaluation) {
        console.log(file, 'already judged — skipping');
        continue;
      }
      const promptId = data.prompt?.id;
      const promptDef = getPromptById(promptId);
      if (!promptDef) {
        console.warn(file, 'prompt id not found in prompts.json — skipping');
        continue;
      }
      console.log('Judging', file);
      const evalRes = await judgeSingle(promptDef.user, data.response, promptDef.judge_criteria || '');
      data.evaluation = evalRes;
      writeFileSync(path, JSON.stringify(data, null, 2));
      // small delay
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      console.warn('Failed to judge', file, err.message);
    }
  }
  console.log('Judging complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
