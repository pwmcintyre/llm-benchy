# Local LLM Benchmark: Failure Analysis

**Date:** 2026-04-08  
**Task:** Implement a detailed Node.js Pi generator from a structured plan  
**Hardware:** WSL2/x86-64, CPU-only  
**Test Model:** Gemma4 E4B (8B params) vs Qwen3.5 9B (9.7B params)

---

## Executive Summary

**Both models completely failed** the task in different ways. Neither could:
- Read a file correctly
- Execute a multi-step plan
- Create files
- Run tests
- Provide meaningful output

**Verdict:** ❌ Local models are **NOT VIABLE** for agent/tool-use tasks on this hardware.

---

## Test Setup

**Plan File:** `/tmp/llm-local/pi/plan.md` (detailed, 300+ lines, explicit structure)

**Task:** 
1. Read the plan
2. Create 3 files exactly as specified (package.json, index.js, lib/pi.js)
3. Run test.js to validate
4. Show output

**Prompt:**
```
I have a detailed plan at /tmp/llm-local/pi/plan.md

Please:
1. Read the entire plan
2. Create all three files exactly as specified
3. Run test.js to validate
4. Show me the test output

Start now.
```

---

## Session 1: Gemma4 E4B

**Session ID:** `ses_29377b566ffe17lXnnMe9Pj7OK`  
**Model:** `ollama/gemma4:e4b` (8B params, 9.6 GB)  
**TTFT:** ~21s  
**Gen Speed:** 24.4 t/s

### What Happened

**Step 1:** User asks to read plan + create files + run tests

**Step 2 (FAILURE):** Model attempted to call tool `read_file`
```
Error: Model tried to call unavailable tool 'read_file'. 
Available tools: invalid, bash, read, glob, grep, edit, write, task, webfetch, todowrite, skill, question.
```

**Step 3:** Model gave up instead of retrying with correct `read` tool
```
I apologize for the error in my previous response. It seems I incorrectly tried to call 
a tool that was not available or properly framed. 

Please let me know what you would like me to do next, or if you could rephrase your request, 
I will do my best to assist you!
```

### Root Causes

1. **Tool name confusion** — Called `read_file` instead of `read`
2. **No error recovery** — Error message explicitly listed available tools, model ignored it
3. **Immediate surrender** — Didn't attempt alternative approaches
4. **Blame shifting** — Told user to "rephrase" when the request was clear

### Assessment

- **Tool use:** ❌ Completely failed
- **Error recovery:** ❌ None
- **Persistence:** ❌ Gave up immediately
- **User experience:** Frustrating and useless

---

## Session 2: Qwen3.5 9B

**Session ID:** `ses_29375a3bdffeUXV0NwCYbE6DUv`  
**Model:** `ollama/qwen3.5:9b` (9.7B params, 6.6 GB)  
**TTFT:** ~60s  
**Gen Speed:** 8.6 t/s

### What Happened

**Step 1:** User asks to read plan + create files + run tests

**Step 2 (FAILURE):** Model attempted to read the file but **hallucinated completely different content**

The model claimed to read `/tmp/llm-local/pi/plan.md` but the content returned was:

```
# Plan: Implement AI Agent Dashboard and Analytics Service Layer

## Overview
This plan details the implementation of the AI Agent Dashboard and Analytics Service Layer 
for the local-first AI agent system...
```

**This is COMPLETELY WRONG.** The actual plan is about a Pi generator in Node.js, not an AI agent dashboard.

The model then started describing an entirely different project:
```
Create the service layer with these key functions:
- authenticateAgent
- generateMetrics  
- analyzeAgentHistory
- calculateCosts
- getRecommendedConfig
- generateAlerts
```

And a different file structure:
```
src/index.js
src/agent-dashboard.ts
test.js
```

### Root Causes

1. **Hallucination** — Model fabricated file contents instead of reading
2. **Tool misuse** — Called `read_file` (wrong name) but somehow still got a response
3. **No validation** — Accepted hallucinated content without questioning
4. **Followed wrong plan** — Would have created 100% incorrect files

### Assessment

- **Tool use:** ❌ Called wrong tool name
- **File reading:** ❌ Hallucinated instead of reading
- **Accuracy:** ❌ Zero (completely wrong project)
- **Self-awareness:** ❌ Didn't realize content was wrong
- **User experience:** Dangerous (would create wrong files silently)

---

## Comparative Analysis

| Aspect | Gemma4 E4B | Qwen3.5 9B | Winner |
|---|---|---|---|
| **Tool name accuracy** | ❌ Wrong (`read_file`) | ❌ Wrong (`read_file`) | Tie (both failed) |
| **Error recovery** | ❌ None, gave up | ❌ None, hallucinated | N/A |
| **Speed** | ✅ 21s TTFT, 24 t/s | ❌ 60s TTFT, 8.6 t/s | Gemma4 |
| **Transparency** | ✅ Admitted error | ❌ Hid hallucination | Gemma4 |
| **Safety** | ✅ Failed safely | ❌ Would corrupt | Gemma4 |
| **Usability** | ❌ Completely useless | ❌ Completely useless | Tie |

**Overall:** Both completely failed, but Gemma4 E4B is slightly safer (failed loudly rather than silently).

---

## Root Cause Analysis: Why Both Failed

### 1. Tool Ecosystem Confusion
Both models called `read_file` instead of `read`. This suggests:
- Models trained on different tool APIs
- No fine-tuning on OpenCode's specific tool interface
- Lack of instruction following on tool schemas

### 2. Insufficient Reasoning for Tool Use
Neither model could:
- Map their intent ("read a file") to available tools
- Recover from tool-calling errors
- Verify tool results against expectations
- Adapt when initial approach failed

### 3. Hallucination vs. Error Handling
- **Gemma4:** Transparent failure (acknowledged error)
- **Qwen3.5:** Silent failure (hallucinated and continued)

This suggests Qwen3.5 is *less calibrated* — higher tendency to confabulate.

### 4. Model Scale Limitations
At 8–10B parameters:
- No robust multi-tool coordination
- Weak error recovery
- Limited ability to follow structured instructions
- Insufficient reasoning capacity for agent tasks

### 5. Task Complexity
The task required:
- Reading a 300+ line document ✅ (within context)
- Following explicit structure ✅ (clear instructions)
- Creating 3 files ❌ (requires tool use)
- Running code ❌ (requires bash)
- Validating output ❌ (requires reasoning)

Models failed at steps 3+ (everything involving tool execution).

---

## Performance Baseline Comparison

### Speed (from earlier benchmark)
```
Gemma4 E4B:
  - TTFT: 21s (21,000 ms)
  - Gen: 24.4 t/s
  - Acceptable latency for interactive tasks

Qwen3.5 9B:
  - TTFT: 60s (60,000 ms)
  - Gen: 8.6 t/s
  - Unacceptable for interactive tasks
```

### Capability (from this test)
```
Gemma4 E4B:
  - Tool use: Broken
  - Error recovery: None
  - Transparency: Good (failed loudly)

Qwen3.5 9B:
  - Tool use: Broken
  - Error recovery: None
  - Transparency: Bad (hallucinated)
```

**Observation:** Faster model (Gemma4) is also slightly more capable at tool use, but both are far below usable threshold.

---

## Lessons Learned

### 1. Local Models Can't Do Agent Tasks Yet
At 8–10B parameters on CPU-only x86-64:
- Tool use is unreliable
- Error recovery is nonexistent
- Hallucination is uncontrolled
- Not suitable for any production use

### 2. Speed Doesn't Compensate for Capability Loss
- Gemma4 E4B is 3× faster than Qwen3.5 9B
- But both failed the same task equally
- **Speed without capability is worthless**

### 3. Hallucination is Silent and Dangerous
- Qwen3.5 9B silently hallucinated the entire plan
- User would have created wrong files without realizing
- Smaller models are *less calibrated* about uncertainty
- This is worse than Gemma4's transparent failure

### 4. Context Window Isn't the Bottleneck
- Both models had the 300-line plan in context
- Both failed to read or use it correctly
- Problem is **reasoning capacity**, not memory

### 5. Tool Interface Matters
- Both models called `read_file` instead of `read`
- This suggests training mismatch or lack of fine-tuning
- OpenCode's tool schema isn't native to these models

---

## What Would Be Needed to Fix This

### To Use Local Models Successfully

1. **30B+ parameters** (Qwen3 30B, Gemma4 31B)
   - Requires GPU acceleration (no CPU-only viable)
   - Would take 2–5 minutes TTFT on M1 Pro
   - Possibly viable on dedicated GPU hardware

2. **Fine-tuning on tool use**
   - Specific training on OpenCode tool interface
   - Error recovery examples
   - Hallucination reduction

3. **Structured tool calling**
   - JSON schema validation before execution
   - Tool name enforcement
   - Mandatory parameter validation

4. **Agent scaffolding**
   - Explicit task planning
   - Step-by-step verification
   - Human-in-the-loop for critical operations

### Practical Recommendation

**Don't use local models for agent tasks.** Use:
- **Claude Sonnet 4.6** (via cloud) — for real work
- **Offline tools** (shell scripts, compiled binaries) — for automation
- **Local models only for** — code explanation, simple transformations

---

## Sessions Documented

1. **ses_2938298a8ffeJMxQAyqJgBCjCE** — Gemma4 E4B asking repetitive questions (repo summarization)
2. **ses_29377b566ffe17lXnnMe9Pj7OK** — Gemma4 E4B failing at tool use (Pi generator)
3. **ses_29375a3bdffeUXV0NwCYbE6DUv** — Qwen3.5 9B hallucinating plan contents (Pi generator)

---

## Conclusion

**Local LLMs (8–10B parameters) are NOT ready for agent/tool-use tasks.**

The gap between cloud models (Claude Sonnet, GPT-4o) and local models is not speed — it's **fundamental reasoning capacity for tool coordination and error recovery**.

Investing time in local model workflows on CPU-only hardware is **not viable**. Either:
1. Invest in GPU hardware (expensive, complex)
2. Accept cloud model dependency (practical, immediate)
3. Use local models only for bounded, non-agentic tasks (limited utility)

**Recommendation:** Abandon local-model-as-agent experiments. Use Claude for real work, local models for code explanation only.
