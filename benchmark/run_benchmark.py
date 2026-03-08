#!/usr/bin/env python3
import argparse
import json
import statistics
import time
import urllib.request


def call_chat(base_url, model, prompt, max_tokens, temperature, timeout):
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a pragmatic Linux+Docker troubleshooting assistant. Be concrete."},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/v1/chat/completions",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    start = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    elapsed = time.perf_counter() - start
    out = json.loads(body)
    text = out["choices"][0]["message"]["content"]
    usage = out.get("usage", {})
    completion_tokens = usage.get("completion_tokens", 0)
    prompt_tokens = usage.get("prompt_tokens", 0)
    tps = (completion_tokens / elapsed) if elapsed > 0 else 0.0
    return text, elapsed, tps, prompt_tokens, completion_tokens


def norm(s):
    return s.lower()


def score_answer(answer, task):
    a = norm(answer)
    req = task.get("required", [])
    pref = task.get("preferred", [])
    forb = task.get("forbidden", [])

    req_hits = sum(1 for k in req if norm(k) in a)
    pref_hits = sum(1 for k in pref if norm(k) in a)
    forb_hits = sum(1 for k in forb if norm(k) in a)

    req_score = (req_hits / len(req)) if req else 1.0
    pref_score = (pref_hits / len(pref)) if pref else 1.0

    score = 0.75 * req_score + 0.25 * pref_score
    if forb_hits:
        score -= 0.2 * forb_hits
    score = max(0.0, min(1.0, score))
    return {
        "score": score,
        "required_hits": req_hits,
        "required_total": len(req),
        "preferred_hits": pref_hits,
        "preferred_total": len(pref),
        "forbidden_hits": forb_hits,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://localhost:8000")
    ap.add_argument("--model", default="qwen-local")
    ap.add_argument("--tasks", default="benchmark/tasks.json")
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-tokens", type=int, default=280)
    ap.add_argument("--temperature", type=float, default=0.1)
    ap.add_argument("--timeout", type=int, default=120)
    args = ap.parse_args()

    with open(args.tasks, "r", encoding="utf-8") as f:
        tasks = json.load(f)

    rows = []
    for t in tasks:
        ans, elapsed, tps, ptk, ctk = call_chat(
            args.base_url,
            args.model,
            t["prompt"],
            args.max_tokens,
            args.temperature,
            args.timeout,
        )
        q = score_answer(ans, t)
        row = {
            "id": t["id"],
            "elapsed_s": round(elapsed, 3),
            "tokens_per_s": round(tps, 2),
            "prompt_tokens": ptk,
            "completion_tokens": ctk,
            "quality": q,
            "answer": ans,
        }
        rows.append(row)

    overall = {
        "tasks": len(rows),
        "mean_elapsed_s": round(statistics.mean(r["elapsed_s"] for r in rows), 3),
        "mean_tokens_per_s": round(statistics.mean(r["tokens_per_s"] for r in rows), 2),
        "mean_quality": round(statistics.mean(r["quality"]["score"] for r in rows), 3),
        "pass_rate_at_0_70": round(
            sum(1 for r in rows if r["quality"]["score"] >= 0.7) / len(rows), 3
        ),
    }

    result = {
        "model": args.model,
        "base_url": args.base_url,
        "overall": overall,
        "rows": rows,
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(json.dumps({"out": args.out, "overall": overall}, indent=2))


if __name__ == "__main__":
    main()
