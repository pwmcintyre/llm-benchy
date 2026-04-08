#!/usr/bin/env node
/**
 * Fixed benchmark runner — disables Qwen thinking mode
 */

import { createWriteStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENDPOINT = 'http://localhost:11434/v1';
const RUNS = 2;
const MAX_OUTPUT_TOKENS = 512;

const models = [
  { id: 'qwen35-9b', label: 'Qwen3.5 9B', model: 'qwen3.5:9b', disableThinking: true },
  { id: 'gemma4-e4b', label: 'Gemma 4 E4B', model: 'gemma4:e4b' }
];

const prompts = JSON.parse(readFileSync(join(__dirname, 'prompts.json'), 'utf8')).slice(0, 5);

console.log(`Benchmark: ${models.length} models × ${prompts.length} prompts × ${RUNS} runs`);
console.log(`Endpoint: ${ENDPOINT}\n`);

const resultsFile = `results_${Date.now()}.jsonl`;
const stream = createWriteStream(resultsFile, { flags: 'a' });

async function testModel(modelInfo, prompt, run) {
  const { model, id, disableThinking } = modelInfo;
  const { id: promptId } = prompt;
  
  let systemPrompt = prompt.system;
  if (disableThinking) {
    systemPrompt += '\n\n[IMPORTANT: Respond directly without internal reasoning or thinking tags. Do not include chain-of-thought.]';
  }
  
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt.user }
  ];

  const ttftStart = Date.now();
  let ttft = null;
  let tokenCount = 0;
  let output = '';
  let error = null;

  try {
    const response = await fetch(`${ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,  // Use non-streaming to avoid hanging on thinking tokens
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS
      }),
      timeout: 180000
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    ttft = Date.now() - ttftStart;
    
    const content = data.choices?.[0]?.message?.content || '';
    const reasoning = data.choices?.[0]?.message?.reasoning || '';
    
    // Extract actual content (skip reasoning)
    output = content.trim();
    tokenCount = data.usage?.completion_tokens || 0;
    
    const tg_tps = tokenCount / (ttft / 1000);
    
    console.log(`[${id}] ${promptId} run ${run}: TTFT=${ttft}ms, TG=${tg_tps.toFixed(2)} t/s, tokens=${tokenCount}`);
    
    stream.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      model: id,
      prompt: promptId,
      run,
      ttft_ms: ttft,
      total_time_ms: ttft,
      tokens: tokenCount,
      tg_tps: parseFloat(tg_tps.toFixed(2)),
      output_length: output.length,
      success: true
    }) + '\n');
    
  } catch (e) {
    error = e.message;
    console.error(`[${id}] ${promptId} run ${run}: ERROR - ${error}`);
    
    stream.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      model: id,
      prompt: promptId,
      run,
      error,
      success: false
    }) + '\n');
  }
}

async function run() {
  for (const model of models) {
    console.log(`\n=== ${model.label} ===`);
    for (const prompt of prompts) {
      for (let run = 1; run <= RUNS; run++) {
        await testModel(model, prompt, run);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  stream.end();
  console.log(`\n✓ Results saved to ${resultsFile}`);
}

run().catch(console.error);
