# Agent Capability Testing

**Status:** ❌ Local models fail all agent/tool-use tests  
**Date:** 2026-04-08  
**Hardware:** WSL2/x86-64 (CPU-only)  
**Purpose:** Test whether local models can execute multi-step plans with tool use

---

## Overview

This directory contains tests for **agent capabilities** — the ability of local models to:
1. Read and understand detailed instructions
2. Use available tools (bash, file I/O, etc.) correctly
3. Recover from errors
4. Execute multi-step workflows
5. Validate results

**Speed benchmarks** (in `../benchmark/`) measure throughput. These tests measure **usability as agents**.

---

## Test Scenario: Pi Generator in Node.js

### The Task

Given a detailed 300+ line plan (`scenarios/pi-generator/plan.md`), implement:
1. Read the plan
2. Create 3 files exactly as specified:
   - `package.json` (metadata)
   - `lib/pi.js` (Pi calculation module)
   - `index.js` (CLI entry point)
3. Run test suite to validate
4. Report results

**Complexity:** Medium
- Requires file reading
- Requires file creation (3 files)
- Requires code generation (valid Node.js + JSON)
- Requires bash execution (run tests)
- Requires output validation

**Expected to test:**
- Instruction following
- Tool use accuracy
- Error recovery
- Multi-step reasoning

---

## Results

### Gemma4 E4B (8B params)

**Session:** `ses_29377b566ffe17lXnnMe9Pj7OK`  
**Summary:** Failed at tool use; transparent failure

```
Speed metrics (from ../RESULTS_SUMMARY.md):
- TTFT: 21s
- Gen: 24.4 t/s
- Status: FAST, but BROKEN

Agent capability:
- Tool naming: ❌ Called read_file (wrong)
- Error recovery: ❌ None
- Transparency: ✅ Admitted failure
- Safety: ✅ Failed cleanly
- Usability: ❌ NONE
```

**Failure mode:** Tool-calling error → immediate surrender  
**Damage:** None (didn't create files)  
**See:** `sessions/gemma4-e4b_ses_29377b566ffe17lXnnMe9Pj7OK.md`

---

### Qwen3.5 9B (9.7B params)

**Session:** `ses_29375a3bdffeUXV0NwCYbE6DUv`  
**Summary:** Failed at tool use; silent hallucination (worse)

```
Speed metrics (from ../RESULTS_SUMMARY.md):
- TTFT: 60s
- Gen: 8.6 t/s
- Status: SLOW, and BROKEN

Agent capability:
- Tool naming: ❌ Called read_file (wrong)
- File reading: ❌ Hallucinated entire contents
- Error recovery: ❌ None, continued confidently
- Transparency: ❌ Hid hallucination
- Safety: ❌ Would corrupt directory with wrong code
- Usability: ❌ DANGEROUS
```

**Failure mode:** Tool error → silent hallucination → confident continuation  
**Damage:** Would create 100% wrong implementation silently  
**See:** `sessions/qwen35-9b_ses_29375a3bdffeUXV0NwCYbE6DUv.md`

---

## Key Findings

### Both Models Failed Identically at First Step

Both called `read_file` instead of `read`:
- Error message listed correct tools explicitly
- Both ignored the information
- Both could not self-correct

**Implication:** Tool calling is fundamentally broken at 8–10B parameters.

### Silent Hallucination is Worse Than Transparent Failure

| Model | Failure Mode | Impact |
|---|---|---|
| **Gemma4 E4B** | Tool error → surrender | Safe, frustrating |
| **Qwen3.5 9B** | Tool error → hallucinate | Dangerous, insidious |

Qwen3.5's larger size (9.7B vs 8B) made it **worse**, not better.

### Speed ≠ Capability

| Model | Speed | Capability |
|---|---|---|
| **Gemma4 E4B** | ✅ 21s TTFT, 24 t/s | ❌ Broken tools |
| **Qwen3.5 9B** | ❌ 60s TTFT, 8.6 t/s | ❌ Broken tools, hallucinating |

Gemma4 is **3× faster** but **equally useless**.

### Error Recovery is Missing

Neither model:
- Attempted retry with corrected tool name
- Parsed error messages for guidance
- Tried alternative approaches
- Continued with available information

**Both gave up after single error.**

---

## Comparison to Speed Benchmarks

### Speed Benchmark Results
```
Model         | TTFT    | TG t/s | Use Case
Gemma4 E4B    | 21 sec  | 24.4   | "Interactive use viable?"
Qwen3.5 9B    | 60 sec  | 8.6    | "Batch use viable?"
```

### Agent Capability Results
```
Model         | Tool Use | Error Recovery | Safety  | Agent Use?
Gemma4 E4B    | ❌ BROKEN | ❌ NONE        | ✅ SAFE | ❌ NO
Qwen3.5 9B    | ❌ BROKEN | ❌ NONE        | ❌ DANGEROUS | ❌ NO
```

### Conclusion

**Speed metrics are misleading.** A fast model that halluccinates is worse than a slow model that fails transparently.

---

## What Would Be Needed

### To Make Local Models Work as Agents

1. **Larger models (30B+)**
   - Requires GPU acceleration
   - Still uncertain if would fix hallucination

2. **Fine-tuning on tool schemas**
   - Specific training on OpenCode tools
   - Error recovery examples
   - Hallucination reduction

3. **Structured tool calling**
   - JSON schema validation
   - Tool name enforcement
   - Mandatory parameter verification

4. **Agent scaffolding**
   - Explicit task breakdown
   - Step verification
   - Rollback capability

### Practical Path Forward

**Don't invest in local models as agents.** Instead:

1. **Use Claude Sonnet 4.6** (cloud) — for actual agent work
2. **Use local models only for** — code explanation, style fixes
3. **Use offline tools** — compiled binaries, shell scripts for automation

---

## Detailed Session Records

- **Gemma4 E4B:** `sessions/gemma4-e4b_ses_29377b566ffe17lXnnMe9Pj7OK.md`
- **Qwen3.5 9B:** `sessions/qwen35-9b_ses_29375a3bdffeUXV0NwCYbE6DUv.md`

## Plan Used

- **Pi Generator Plan:** `scenarios/pi-generator/plan.md`

## Complete Analysis

- **Full Results:** `RESULTS.md` (comprehensive failure analysis)

---

## Recommendations

### For Your Setup

1. **Keep speed benchmark results** — useful for simple tasks
2. **Abandon agent-use experiments** — not viable without GPU
3. **Use local models for:**
   - Code explanation (with code in prompt)
   - Simple transformations
   - Not tool use, not planning

4. **Use Claude for:**
   - Multi-step workflows
   - File operations
   - Real agent tasks

### For Future Testing

If you add GPU support later:
- Re-test with 30B+ models
- Measure tool-calling accuracy
- Validate hallucination rates
- Compare to cloud baseline

---

## Metadata

| Property | Value |
|---|---|
| Test date | 2026-04-08 |
| Hardware | WSL2/x86-64 (CPU-only) |
| Models tested | Gemma4 E4B, Qwen3.5 9B |
| Task | Pi generator implementation |
| Pass rate | 0% |
| Files created | 0/6 expected |
| Hallucinations | 1 |
| Silent failures | 1 |
| Transparent failures | 1 |
