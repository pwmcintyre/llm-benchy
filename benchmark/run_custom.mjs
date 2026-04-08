#!/usr/bin/env node
/**
 * Custom benchmark runner for available models
 * Adapted for qwen3.5:9b and gemma4:e4b
 */

import { execSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ENDPOINT = 'http://localhost:11434/v1';
const RUNS = 2;  // 2 runs per model/prompt combo
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_TTFT_MS = 120000;    // 120s to first token
const TIMEOUT_TOKEN_MS = 45000;    // 45s between tokens

const models = [
  { id: 'qwen35-9b', label: 'Qwen3.5 9B', model: 'qwen3.5:9b' },
  { id: 'gemma4-e4b', label: 'Gemma 4 E4B', model: 'gemma4:e4b' }
];

const prompts = JSON.parse(readFileSync(join(__dirname, 'prompts.json'), 'utf8')).slice(0, 5);  // First 5 prompts

console.log(`Benchmark: ${models.length} models × ${prompts.length} prompts × ${RUNS} runs`);
console.log(`Endpoint: ${ENDPOINT}\n`);

const resultsFile = `results_${new Date().toISOString().replace(/:/g, '-').slice(0, -5)}.jsonl`;
const stream = createWriteStream(resultsFile, { flags: 'a' });

async function testModel(modelInfo, prompt, run) {
  const { model, id, label } = modelInfo;
  const { id: promptId, title } = prompt;
  
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user }
  ];

  const ttftStart = Date.now();
  let ttft = null;
  let ttftReached = false;
  let tokenCount = 0;
  let endTime = null;
  let output = '';

  try {
    const response = await fetch(`${ENDPOINT}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          
          if (delta?.content) {
            if (!ttftReached) {
              ttft = Date.now() - ttftStart;
              ttftReached = true;
            }
            output += delta.content;
            tokenCount++;
          }
        } catch (e) {
          // skip parse errors
        }
      }
    }

    endTime = Date.now() - ttftStart;
    const tg_tps = (endTime - ttft) > 0 ? tokenCount / ((endTime - ttft) / 1000) : 0;

    const result = {
      timestamp: new Date().toISOString(),
      model: id,
      prompt: promptId,
      run,
      ttft_ms: ttft,
      total_time_ms: endTime,
      tokens: tokenCount,
      tg_tps: parseFloat(tg_tps.toFixed(2)),
      output_length: output.length
    };

    console.log(`[${id}] ${promptId}: TTFT=${ttft}ms, TG=${tg_tps.toFixed(2)} t/s, total=${endTime}ms, tokens=${tokenCount}`);
    stream.write(JSON.stringify(result) + '\n');
    
    return result;
  } catch (e) {
    console.error(`[${id}] ${promptId}: ERROR - ${e.message}`);
    stream.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      model: id,
      prompt: promptId,
      run,
      error: e.message
    }) + '\n');
    return null;
  }
}

async function run() {
  for (const model of models) {
    console.log(`\n=== ${model.label} ===`);
    for (const prompt of prompts) {
      for (let run = 1; run <= RUNS; run++) {
        await testModel(model, prompt, run);
        // Small delay between requests
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  stream.end();
  console.log(`\n✓ Results saved to ${resultsFile}`);
}

run().catch(console.error);
