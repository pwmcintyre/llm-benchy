#!/usr/bin/env node
/**
 * Quick validation test — single prompt, single model
 */

const endpoint = 'http://localhost:11434/v1';
const model = 'qwen3.5:9b';

console.log(`Testing ${model} at ${endpoint}...`);

const prompt = {
  system: "You are a helpful assistant.",
  user: "Explain what a generator function is in 2 sentences."
};

const payload = {
  model,
  messages: [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user }
  ],
  stream: false,
  temperature: 0.7,
  max_tokens: 256
};

const startTime = Date.now();

fetch(`${endpoint}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
  .then(r => r.json())
  .then(data => {
    const totalTime = Date.now() - startTime;
    if (data.error) {
      console.error('Error:', data.error);
      process.exit(1);
    }
    const content = data.choices?.[0]?.message?.content || '';
    const tokens = data.usage?.completion_tokens || 0;
    const tg_tps = tokens / (totalTime / 1000);
    
    console.log('\n✓ Response received');
    console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);
    console.log(`Tokens: ${tokens}`);
    console.log(`TG t/s: ${tg_tps.toFixed(2)}`);
    console.log(`\nOutput: "${content.slice(0, 150)}..."`);
  })
  .catch(e => {
    console.error('Failed:', e.message);
    process.exit(1);
  });
