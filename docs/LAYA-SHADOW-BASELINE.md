# Pinned Laya shadow baseline

Observed on the FS Windows development host using the pinned `v0.3.6` source and pinned typed-decisions checkpoint. This is an engineering baseline, not a claim about Laya generally.

## Host

- CPU: Intel Core i7-1255U
- RAM: ~16 GB
- GPU: Intel Iris Xe (~2 GB reported); reference run used CPU
- PyTorch: 2.8.0 CPU
- Transformers: 4.57.1
- Checkpoint: `typed-decisions/model.safetensors`, 842,609,220 bytes, SHA-256 `4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e`

## Warm worker measurements

Model load: ~10.0 s. First request wall time including startup: ~15.8 s. Once resident, a batch of three FS questions (`retry`, `executor`, `risk`) takes about 3.2-3.3 s per request on this CPU. Repeated identical states produced stable outputs.

The upstream typed-decisions checkpoint is not competent enough on these unseen FS schemas to control execution. Across three hand-constructed smoke cases it repeatedly disagreed with deterministic FS expectations on retry/executor and showed very low confidence on multi-way choices. This validates shadow-only use and the need for FS-specific training/evaluation.

## Interpretation

Warm persistence removes roughly 10 seconds of model-loading overhead but does not make CPU inference low-latency on this host. Future experiments should compare ONNX/quantized execution and an FS-specific checkpoint. Deterministic policy remains authoritative.
