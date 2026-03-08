# Qwen 3.5 Matrix Summary

| slug | model | status | startup_s | max_len | max_seqs | notes |
|---|---|---:|---:|---:|---:|---|
qwen35_0p8b|Qwen/Qwen3.5-0.8B|ready|106|4096|8|ok; mean_tps=168.15, mean_quality=0.146, mean_latency=4.198s
qwen35_2b|Qwen/Qwen3.5-2B|ready|112|4096|8|ok; mean_tps=83.78, mean_quality=0.271, mean_latency=5.086s
qwen35_4b|Qwen/Qwen3.5-4B|ready|126|4096|4|ok; mean_tps=40.65, mean_quality=0.181, mean_latency=7.17s
qwen35_9b|Qwen/Qwen3.5-9B|failed|600|2048|1|not ready within 600s; model load observed at 17.66 GiB (above 12GB VRAM)
qwen35_9b_awq4|cyankiwi/Qwen3.5-9B-AWQ-4bit|failed|600|1024|1|4:(EngineCore_DP0 pid=78) ERROR 03-08 05:57:37 [core.py:1100] ValueError: No available memory for the cache blocks. Try increasing `gpu_memory_utilization` when initializing the engine. See https://docs.vllm.ai/en/latest/configuration/conserving_memory/ for more details.;5:(EngineCore_DP0 pid=78) Traceback (most recent call last):;33:(EngineCore_DP0 pid=78) ValueError: No available memory for the cache blocks. Try increasing `gpu_memory_utilization` when initializing the engine. See https://docs.vllm.ai/en/latest/configuration/conserving_memory/ for more details.;35:(APIServer pid=1) Traceback (most recent call last):;
