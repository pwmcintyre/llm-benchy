#!/usr/bin/env python3
"""
Analyze benchmark results and compare to documented baselines
"""

import json
import sys
from pathlib import Path
from collections import defaultdict

def load_results(filepath):
    """Load JSONL results file"""
    results = []
    with open(filepath) as f:
        for line in f:
            if line.strip():
                results.append(json.loads(line))
    return results

def summarize_results(results):
    """Aggregate results by model and prompt"""
    by_model = defaultdict(list)
    by_prompt = defaultdict(list)

    for result in results:
        if 'error' in result or not result.get('success', True):
            continue

        model = result['model']
        prompt = result['prompt']

        by_model[model].append(result)
        by_prompt[prompt].append(result)

    return by_model, by_prompt

def format_stats(values):
    """Calculate min/median/max"""
    if not values:
        return "N/A"
    values = sorted(values)
    return f"{min(values):.1f} / {values[len(values)//2]:.1f} / {max(values):.1f}"

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 analyze_results.py <results_file.jsonl>")
        sys.exit(1)

    filepath = sys.argv[1]
    results = load_results(filepath)
    by_model, by_prompt = summarize_results(results)

    print(f"\n{'='*70}")
    print(f"Benchmark Analysis: {filepath}")
    print(f"Total results: {len(results)}")
    print(f"{'='*70}\n")

    # By model
    print("SPEED BY MODEL (min / median / max)")
    print(f"{'Model':<20} {'TTFT (ms)':<20} {'TG (t/s)':<20}")
    print("-" * 60)

    for model in sorted(by_model.keys()):
        entries = by_model[model]
        ttfts = [e['ttft_ms'] for e in entries]
        tg_tps = [e['tg_tps'] for e in entries]

        print(f"{model:<20} {format_stats(ttfts):<20} {format_stats(tg_tps):<20}")

    # By prompt
    print("\n\nSPEED BY PROMPT")
    print(f"{'Prompt':<25} {'TTFT (ms)':<20} {'TG (t/s)':<20} {'Avg tokens':<15}")
    print("-" * 80)

    for prompt in sorted(by_prompt.keys()):
        entries = by_prompt[prompt]
        ttfts = [e['ttft_ms'] for e in entries]
        tg_tps = [e['tg_tps'] for e in entries]
        tokens = [e['tokens'] for e in entries]

        avg_tokens = sum(tokens) / len(tokens) if tokens else 0
        print(f"{prompt:<25} {format_stats(ttfts):<20} {format_stats(tg_tps):<20} {avg_tokens:.0f}          ")

    # Baseline comparison
    print("\n\n" + "="*70)
    print("COMPARISON TO M1 PRO BASELINE (from findings.md)")
    print("="*70)

    baselines = {
        'qwen35-9b': {'tg_tps': None, 'ttft': None, 'note': 'Not in original benchmark (custom edge model)'},
        'gemma4-e4b': {'tg_tps': None, 'ttft': None, 'note': 'Not in original benchmark (custom edge model)'},
        'Phi-4 14B (M1)': {'tg_tps': 13.2, 'ttft': 1798, 'note': '9.1 GB'},
        'Qwen3 30B (M1)': {'tg_tps': 40.8, 'ttft': 1176, 'note': '18 GB'},
        'Gemma4 26B MoE (M1)': {'tg_tps': 27.7, 'ttft': 31774, 'note': 'Due to 256k context overhead'},
    }

    print("\nNote: These are edge models (9B/8B), not in the original benchmark.")
    print("Comparison is for relative performance understanding, not direct parity.\n")

    for model in sorted(by_model.keys()):
        entries = by_model[model]
        median_tg = sorted([e['tg_tps'] for e in entries])[len(entries)//2]
        median_ttft = sorted([e['ttft_ms'] for e in entries])[len(entries)//2]

        print(f"\n{model.upper()}")
        print(f"  TG speed: {median_tg:.2f} t/s (median)")
        print(f"  TTFT: {median_ttft:.0f} ms (median)")
        print(f"  Assessment: {'FAST' if median_tg > 15 else 'SLOW'}, "
              f"{'RESPONSIVE' if median_ttft < 5000 else 'SLOW FIRST TOKEN'}")

if __name__ == '__main__':
    main()
