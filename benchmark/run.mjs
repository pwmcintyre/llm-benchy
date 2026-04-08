#!/usr/bin/env node
/**
 * Local LLM Benchmark Runner
 *
 * Measures TTFT, TG t/s, and total time for each model × prompt combination.
 * Optionally scores responses using claude-sonnet-4.6 via GitHub Copilot API as judge.
 *
 * Usage:
 *   node run.mjs                              # all models, all prompts, 3 runs each
 *   node run.mjs --model qwen3:30b            # single model
 *   node run.mjs --prompt code-write          # single prompt
 *   node run.mjs --runs 1                     # reduce run count
 *   node run.mjs --no-judge                   # skip LLM-as-judge scoring
 *   node run.mjs --engine ollama              # filter by engine
 *   node run.mjs --endpoint http://localhost:8080/v1 --model mlx-community/Qwen3-30B-4bit
 *   node run.mjs --timeout-ttft 120           # seconds to wait for first token (default 120)
 *   node run.mjs --timeout-token 45           # seconds allowed between tokens (default 45)
 *
 * Requirements:
 *   - Node 22+ (uses built-in fetch and --input-type flag)
 *   - Ollama running at localhost:11434 (or specify --endpoint)
 *   - gh CLI authenticated (for LLM judge via Copilot API)
 *   - models.json and prompts.json in the same directory as this script
 */

import { execSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Config & CLI args
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const RUNS = parseInt(args['runs'] ?? '3', 10);
const NO_JUDGE = args['no-judge'] === true;
const FILTER_MODEL = args['model'];
const FILTER_PROMPT = args['prompt'];
const FILTER_ENGINE = args['engine'];
const ENDPOINT_OVERRIDE = args['endpoint'];
const TIMEOUT_TTFT_MS = parseInt(args['timeout-ttft'] ?? '120', 10) * 1000;  // ms to first token
const TIMEOUT_TOKEN_MS = parseInt(args['timeout-token'] ?? '45', 10) * 1000; // ms between tokens (reset each token)
const MAX_OUTPUT_TOKENS = parseInt(args['max-tokens'] ?? '2048', 10);         // hard cap — stops runaway reasoning models
// Judge configuration: prefer OpenAI GPT-5 mini when OPENAI_API_KEY is set,
// otherwise fall back to GitHub Copilot (claude-sonnet) if GH auth is available.
const JUDGE_MODEL = process.env.OPENAI_API_KEY ? 'gpt-5-mini' : 'claude-sonnet-4.6';
const OPENAI_JUDGE_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const COPILOT_JUDGE_ENDPOINT = 'https://api.githubcopilot.com/chat/completions';
const COPILOT_INTEGRATION_HEADER = 'vscode-chat';

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        result[key] = true;
      } else {
        result[key] = next;
        i++;
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Load benchmark data
// ---------------------------------------------------------------------------

const models = JSON.parse(readFileSync(join(__dirname, 'models.json'), 'utf8'));
const prompts = JSON.parse(readFileSync(join(__dirname, 'prompts.json'), 'utf8'));

const selectedModels = models.filter(m => {
  if (FILTER_ENGINE && m.engine !== FILTER_ENGINE) return false;
  if (FILTER_MODEL && m.model !== FILTER_MODEL && m.id !== FILTER_MODEL) return false;
  return true;
});

const selectedPrompts = prompts.filter(p => {
  if (FILTER_PROMPT && p.id !== FILTER_PROMPT) return false;
  return true;
});

if (selectedModels.length === 0) {
  console.error('No models matched the filter. Check --model / --engine flags.');
  process.exit(1);
}
if (selectedPrompts.length === 0) {
  console.error('No prompts matched the filter. Check --prompt flag.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output directory
// ---------------------------------------------------------------------------

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(__dirname, 'results', timestamp);
const rawDir = join(outDir, 'raw');
mkdirSync(rawDir, { recursive: true });

console.log(`\nBenchmark run: ${timestamp}`);
console.log(`Models: ${selectedModels.length}  Prompts: ${selectedPrompts.length}  Runs: ${RUNS}`);
console.log(`Judge: ${NO_JUDGE ? 'disabled' : JUDGE_MODEL}`);
console.log(`Output: ${outDir}\n`);

// ---------------------------------------------------------------------------
// GitHub Copilot auth
// ---------------------------------------------------------------------------

let copilotToken = null;

function getCopilotToken() {
  if (copilotToken) return copilotToken;
  try {
    copilotToken = execSync('gh auth token', { encoding: 'utf8' }).trim();
    return copilotToken;
  } catch {
    console.warn('Warning: could not get GitHub token via `gh auth token`. Judge will be skipped.');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core: streaming chat completion with metrics
// ---------------------------------------------------------------------------

/**
 * Run a single chat completion request against an OpenAI-compatible endpoint.
 * Returns { content, ttft_ms, tg_tps, total_ms, output_tokens, truncated }.
 *
 * Timeouts are enforced by racing reader.read() against a deadline Promise on
 * every iteration — AbortController alone does NOT cancel an in-flight stream.
 *
 *   TIMEOUT_TTFT_MS  — how long to wait for the first token (cold model load)
 *   TIMEOUT_TOKEN_MS — max silence allowed between consecutive tokens
 *   MAX_OUTPUT_TOKENS — hard cap on output length (stops runaway reasoning traces)
 */
async function runCompletion(endpoint, model, messages, numCtx) {
  const body = {
    model,
    messages,
    stream: true,
    ...(numCtx ? { options: { num_ctx: numCtx } } : {}),
  };

  const startMs = Date.now();
  let ttftMs = null;
  let content = '';         // final answer (delta.content only) — sent to judge
  let reasoning = '';       // thinking trace (delta.reasoning) — excluded from judge
  let outputTokens = 0;     // total tokens (reasoning + content) — for TG t/s metric
  let contentTokens = 0;    // content-only tokens — for judge quality assessment
  let truncated = false;

  // Deadline helper — returns a Promise that rejects after `ms` milliseconds.
  // Calling cancel() prevents the rejection (used to disarm after each token).
  function makeDeadline(ms, label) {
    let cancel;
    const promise = new Promise((_, reject) => {
      const h = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
      cancel = () => clearTimeout(h);
    });
    return { promise, cancel };
  }

  // Progress ticker every 5s so the terminal shows life
  const ticker = setInterval(() => {
    const elapsedS = ((Date.now() - startMs) / 1000).toFixed(0);
    const phase = ttftMs === null ? 'loading' : 'generating';
    const tokenInfo = reasoning.length > 0 ? `${outputTokens} tokens (${contentTokens} content)` : `${outputTokens} tokens`;
    process.stdout.write(`\r    [${elapsedS}s ${phase} ${tokenInfo}] `);
  }, 5000);

  try {
    // --- connection + TTFT timeout ---
    const connectDeadline = makeDeadline(
      TIMEOUT_TTFT_MS,
      `no first token within ${TIMEOUT_TTFT_MS / 1000}s`
    );

    let resp;
    try {
      resp = await Promise.race([
        fetch(`${endpoint}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
        connectDeadline.promise,
      ]);
    } finally {
      connectDeadline.cancel();
    }

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`HTTP ${resp.status} from ${endpoint}: ${err.slice(0, 200)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Arm the TTFT deadline — will fire if the stream opens but no tokens arrive
    let tokenDeadline = makeDeadline(
      TIMEOUT_TTFT_MS,
      `no first token within ${TIMEOUT_TTFT_MS / 1000}s`
    );

    while (true) {
      // Race every read() against the current deadline
      let readResult;
      try {
        readResult = await Promise.race([reader.read(), tokenDeadline.promise]);
      } catch (err) {
        // Deadline fired — cancel the reader so the underlying TCP connection closes
        reader.cancel().catch(() => {});
        throw err;
      }

      const { done, value } = readResult;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        let chunk;
        try { chunk = JSON.parse(data); } catch { continue; }

        // Some models (e.g. Gemma 4 via MLX) emit thinking tokens in delta.reasoning
        // rather than delta.content. Track separately: reasoning counts toward TG t/s
        // metrics but only delta.content is sent to the judge.
        const deltaContent = chunk.choices?.[0]?.delta?.content ?? '';
        const deltaReasoning = chunk.choices?.[0]?.delta?.reasoning ?? '';
        const delta = deltaContent || deltaReasoning;
        if (delta) {
          if (ttftMs === null) {
            ttftMs = Date.now() - startMs;
          }
          if (deltaContent) {
            content += deltaContent;
            contentTokens++;
          }
          if (deltaReasoning) {
            reasoning += deltaReasoning;
          }
          outputTokens++;

          // Disarm current deadline, arm inter-token deadline for next read
          tokenDeadline.cancel();
          tokenDeadline = makeDeadline(
            TIMEOUT_TOKEN_MS,
            `no token for ${TIMEOUT_TOKEN_MS / 1000}s mid-stream`
          );

          // Hard cap — stop reading but record that we truncated
          if (outputTokens >= MAX_OUTPUT_TOKENS) {
            truncated = true;
            reader.cancel().catch(() => {});
            tokenDeadline.cancel();
            break;
          }
        }
      }

      if (truncated) break;
    }

    // Clean up final deadline
    tokenDeadline.cancel();

  } finally {
    clearInterval(ticker);
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
  }

  const totalMs = Date.now() - startMs;
  const tgMs = ttftMs !== null ? totalMs - ttftMs : totalMs;
  const tgTps = tgMs > 0 ? (outputTokens / tgMs) * 1000 : 0;

  return {
    content,
    reasoning_tokens: reasoning.length > 0 ? outputTokens - contentTokens : 0,
    ttft_ms: ttftMs ?? totalMs,
    tg_tps: Math.round(tgTps * 10) / 10,
    total_ms: totalMs,
    output_tokens: outputTokens,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// LLM-as-judge
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM = `You are an impartial evaluator assessing AI assistant responses.
Score the response on three dimensions, each 1–10:
- accuracy: factually correct, no hallucinations, technically sound
- completeness: addresses all parts of the prompt
- conciseness: no unnecessary padding, repetition, or filler

Respond ONLY with valid JSON (no markdown, no code fences):
{"accuracy": <1-10>, "completeness": <1-10>, "conciseness": <1-10>, "rationale": "<one sentence>"}`;

async function judgeResponse(prompt, response, criteria) {
  // Prefer OpenAI GPT-5 mini if OPENAI_API_KEY is present
  const openaiKey = process.env.OPENAI_API_KEY;
  const ghToken = getCopilotToken();

  const userMsg = `## Evaluation criteria\n${criteria}\n\n## Original prompt\n${prompt}\n\n## Response to evaluate\n${response}`;

  if (openaiKey) {
    const body = {
      model: JUDGE_MODEL, // gpt-5-mini
      messages: [
        { role: 'system', content: JUDGE_SYSTEM },
        { role: 'user', content: userMsg },
      ],
      stream: false,
      max_tokens: 256,
    };

    try {
      const resp = await fetch(OPENAI_JUDGE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const err = await resp.text();
        console.warn(`  OpenAI judge error HTTP ${resp.status}: ${err.slice(0, 200)}`);
        return null;
      }
      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error(`No JSON object found in judge response: ${text.slice(0, 80)}`);
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      console.warn(`  OpenAI Judge parse error: ${err.message}`);
      return null;
    }
  }

  // Fallback: GitHub Copilot judge
  if (!ghToken) return null;
  const body = {
    model: 'claude-sonnet-4.6',
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: userMsg },
    ],
    stream: false,
    max_tokens: 256,
  };

  try {
    const resp = await fetch(COPILOT_JUDGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ghToken}`,
        'Copilot-Integration-Id': COPILOT_INTEGRATION_HEADER,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.warn(`  Copilot judge error HTTP ${resp.status}: ${err.slice(0, 100)}`);
      return null;
    }

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON object found in judge response: ${text.slice(0, 80)}`);
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.warn(`  Judge parse error: ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Exact-match / parse evaluators
// ---------------------------------------------------------------------------

function evaluateExact(promptDef, response) {
  const expected = promptDef.expected_answer?.trim().toLowerCase();
  const got = response.trim().toLowerCase();
  const match = expected && got.includes(expected);
  return {
    type: 'exact-match',
    expected: promptDef.expected_answer,
    matched: match,
    score: match ? 10 : 0,
  };
}

function evaluateJsonParse(response) {
  try {
    // Strip possible code fences if model disobeys
    const cleaned = response.replace(/```[a-z]*\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const hasRequired = 'answer' in parsed && 'confidence' in parsed && 'reasoning' in parsed;
    const noExtra = Object.keys(parsed).length === 3;
    const validConfidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1;
    return {
      type: 'exact-parse',
      valid_json: true,
      has_required_keys: hasRequired,
      no_extra_keys: noExtra,
      valid_confidence: validConfidence,
      score: hasRequired && noExtra && validConfidence ? 10 : hasRequired ? 5 : 0,
      parsed,
    };
  } catch {
    return { type: 'exact-parse', valid_json: false, score: 0 };
  }
}

// ---------------------------------------------------------------------------
// Main benchmark loop
// ---------------------------------------------------------------------------

const allResults = [];

for (const model of selectedModels) {
  const endpoint = ENDPOINT_OVERRIDE ?? model.endpoint;

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Model: ${model.label}`);
  console.log(`Endpoint: ${endpoint}  Model ID: ${model.model}`);

  if (!model.installed && !ENDPOINT_OVERRIDE) {
    console.log(`  SKIPPED — not installed. Pull with: ${model.pull}`);
    continue;
  }

  for (const prompt of selectedPrompts) {
    console.log(`\n  Prompt: [${prompt.id}] ${prompt.title}`);

    const runResults = [];

    for (let run = 1; run <= RUNS; run++) {
      process.stdout.write(`    Run ${run}/${RUNS} ... `);

      const messages = [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ];

      let metrics;
      try {
        metrics = await runCompletion(endpoint, model.model, messages, model.num_ctx);
      } catch (err) {
        // Distinguish timeout from other errors for clarity
        const isTimeout = err.name === 'AbortError' || err.message?.startsWith('Timeout');
        const label = isTimeout ? `TIMEOUT: ${err.message ?? err.cause?.message}` : `ERROR: ${err.message}`;
        console.log(label);
        runResults.push({ run, error: label });
        continue;
      }

      const reasoningNote = metrics.reasoning_tokens > 0 ? `  [${metrics.reasoning_tokens} thinking]` : '';
      console.log(
        `TTFT ${metrics.ttft_ms}ms  TG ${metrics.tg_tps} t/s  total ${(metrics.total_ms / 1000).toFixed(1)}s  tokens ${metrics.output_tokens}${reasoningNote}${metrics.truncated ? '  [TRUNCATED]' : ''}`
      );

      // Evaluation
      let evaluation = null;
      if (!NO_JUDGE) {
        if (prompt.eval === 'exact-match') {
          evaluation = evaluateExact(prompt, metrics.content);
          console.log(`    Eval: ${evaluation.matched ? '✓' : '✗'} exact match (expected: ${evaluation.expected})`);
        } else if (prompt.eval === 'exact-parse') {
          evaluation = evaluateJsonParse(metrics.content);
          console.log(`    Eval: JSON valid=${evaluation.valid_json} keys_ok=${evaluation.has_required_keys} score=${evaluation.score}/10`);
        } else if (prompt.eval === 'llm-judge') {
          process.stdout.write('    Judge ... ');
          evaluation = await judgeResponse(prompt.user, metrics.content, prompt.judge_criteria);
          if (evaluation) {
            const composite = ((evaluation.accuracy + evaluation.completeness + evaluation.conciseness) / 3).toFixed(1);
            console.log(
              `accuracy=${evaluation.accuracy} completeness=${evaluation.completeness} conciseness=${evaluation.conciseness} → ${composite}/10`
            );
            console.log(`    "${evaluation.rationale}"`);
          } else {
            console.log('failed');
          }
          // Small delay between judge calls to avoid Copilot API rate limiting
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      const result = {
        run,
        model: { id: model.id, label: model.label, engine: model.engine, model: model.model },
        prompt: { id: prompt.id, category: prompt.category, title: prompt.title },
        metrics,
        evaluation,
        response: metrics.content,
        timestamp: new Date().toISOString(),
      };

      runResults.push(result);

      // Write raw result immediately
      const filename = `${model.id}__${prompt.id}__run${run}.json`;
      writeFileSync(join(rawDir, filename), JSON.stringify(result, null, 2));
    }

    allResults.push({ model, prompt, runs: runResults });
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'═'.repeat(60)}`);
console.log('Generating summary...\n');

const summary = buildSummary(allResults);
const summaryPath = join(outDir, 'summary.md');
writeFileSync(summaryPath, summary);
console.log(`Summary written to: ${summaryPath}`);
console.log('\n' + summary);

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(allResults) {
  const lines = [];
  lines.push(`# Benchmark Results — ${timestamp}`);
  lines.push('');
  lines.push(`**Runs per combination:** ${RUNS}  **Judge:** ${NO_JUDGE ? 'disabled' : JUDGE_MODEL}`);
  lines.push('');

  // Aggregate per model × prompt (median across runs)
  const byModelPrompt = new Map();
  for (const { model, prompt, runs } of allResults) {
    const key = `${model.id}__${prompt.id}`;
    const successRuns = runs.filter(r => !r.error && r.metrics);
    if (successRuns.length === 0) continue;

    const ttfts = successRuns.map(r => r.metrics.ttft_ms).sort((a, b) => a - b);
    const tgTps = successRuns.map(r => r.metrics.tg_tps).sort((a, b) => a - b);
    const totals = successRuns.map(r => r.metrics.total_ms).sort((a, b) => a - b);

    const median = arr => arr[Math.floor(arr.length / 2)];

    const judgeScores = successRuns
      .map(r => r.evaluation)
      .filter(e => e && (e.score !== undefined || e.accuracy !== undefined));

    let compositeScore = null;
    if (judgeScores.length > 0) {
      const scores = judgeScores.map(e => {
        if (e.type === 'exact-match' || e.type === 'exact-parse') return e.score;
        return (e.accuracy + e.completeness + e.conciseness) / 3;
      });
      compositeScore = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
    }

    byModelPrompt.set(key, {
      model,
      prompt,
      ttft_ms: median(ttfts),
      tg_tps: median(tgTps),
      total_ms: median(totals),
      score: compositeScore,
      runs: successRuns.length,
    });
  }

  // Group by prompt category
  const categories = [...new Set(prompts.map(p => p.category))];

  for (const category of categories) {
    const catPrompts = prompts.filter(p => p.category === category && (!FILTER_PROMPT || p.id === FILTER_PROMPT));
    if (catPrompts.length === 0) continue;

    lines.push(`## ${category}`);
    lines.push('');

    for (const prompt of catPrompts) {
      lines.push(`### ${prompt.title} (\`${prompt.id}\`)`);
      lines.push('');
      lines.push('| Model | Engine | TTFT (ms) | TG (t/s) | Total (s) | Score /10 |');
      lines.push('|---|---|---|---|---|---|');

      const rows = [];
      for (const model of selectedModels) {
        const key = `${model.id}__${prompt.id}`;
        const d = byModelPrompt.get(key);
        if (!d) continue;
        rows.push(d);
      }

      // Sort by composite score desc, then TG t/s desc
      rows.sort((a, b) => {
        const sa = parseFloat(a.score ?? 0);
        const sb = parseFloat(b.score ?? 0);
        if (sb !== sa) return sb - sa;
        return b.tg_tps - a.tg_tps;
      });

      for (const d of rows) {
        const totalS = (d.total_ms / 1000).toFixed(1);
        const score = d.score ?? '—';
        lines.push(`| ${d.model.label} | ${d.model.engine} | ${d.ttft_ms} | ${d.tg_tps} | ${totalS} | ${score} |`);
      }

      lines.push('');
    }
  }

  // Speed leaderboard (median TG t/s across all prompts per model)
  lines.push('## Speed Leaderboard (median TG t/s across all prompts)');
  lines.push('');
  lines.push('| Model | Engine | Median TG t/s | Median TTFT (ms) |');
  lines.push('|---|---|---|---|');

  const speedByModel = new Map();
  for (const [, d] of byModelPrompt) {
    const key = d.model.id;
    if (!speedByModel.has(key)) speedByModel.set(key, { model: d.model, tgSamples: [], ttftSamples: [] });
    speedByModel.get(key).tgSamples.push(d.tg_tps);
    speedByModel.get(key).ttftSamples.push(d.ttft_ms);
  }

  const speedRows = [...speedByModel.values()].map(v => {
    const sorted = v.tgSamples.sort((a, b) => a - b);
    const medianTg = sorted[Math.floor(sorted.length / 2)];
    const sortedTtft = v.ttftSamples.sort((a, b) => a - b);
    const medianTtft = sortedTtft[Math.floor(sortedTtft.length / 2)];
    return { ...v, medianTg, medianTtft };
  });
  speedRows.sort((a, b) => b.medianTg - a.medianTg);

  for (const r of speedRows) {
    lines.push(`| ${r.model.label} | ${r.model.engine} | ${r.medianTg} | ${r.medianTtft} |`);
  }

  lines.push('');

  // Quality leaderboard (average composite score across all judged prompts)
  if (!NO_JUDGE) {
    lines.push('## Quality Leaderboard (average composite score across judged prompts)');
    lines.push('');
    lines.push('| Model | Engine | Avg Score /10 | Prompts judged |');
    lines.push('|---|---|---|---|');

    const qualityByModel = new Map();
    for (const [, d] of byModelPrompt) {
      if (d.score === null) continue;
      const key = d.model.id;
      if (!qualityByModel.has(key)) qualityByModel.set(key, { model: d.model, scores: [] });
      qualityByModel.get(key).scores.push(parseFloat(d.score));
    }

    const qualityRows = [...qualityByModel.values()].map(v => ({
      ...v,
      avg: (v.scores.reduce((a, b) => a + b, 0) / v.scores.length).toFixed(1),
    }));
    qualityRows.sort((a, b) => parseFloat(b.avg) - parseFloat(a.avg));

    for (const r of qualityRows) {
      lines.push(`| ${r.model.label} | ${r.model.engine} | ${r.avg} | ${r.scores.length} |`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push(`*Generated by benchmark/run.mjs — ${new Date().toISOString()}*`);

  return lines.join('\n');
}
