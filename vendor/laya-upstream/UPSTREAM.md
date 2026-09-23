# Laya upstream provenance

This directory records the reviewed upstream used to inform the FS Decision research lane. V3 does **not** currently execute or import Laya code.

- Upstream: https://github.com/NandhaKishorM/laya
- Reviewed source release: `v0.3.6`
- Reviewed source commit: `417089775fe45df662ec10e66746579b172eff2a`
- License: Apache-2.0 (verbatim copy in `LICENSE`)
- Hugging Face model repository: `convaiinnovations/laya`
- Reviewed model revision: `1c5edc17a7acd8701df6fc341c0d179f1c62c982`
- Typed-decisions dataset: `LocalLLaMA/typed-decisions`
- Reviewed dataset revision: `c76749ec58bd8c3d2ea706b31c333a9059c38f90`

## Policy

No runtime dependency may resolve upstream `main`. Before a Laya-derived shadow runtime is enabled, source and required model/tokenizer artifacts must be snapshotted or mirrored under FS control, cryptographically hashed, dependency-locked and license-reviewed. The runtime must remain optional and shadow-only until FS-specific held-out evaluation passes.

The source itself is not copied here yet: we are deliberately avoiding vendoring executable upstream code before the shadow-runtime design and artifact manifest are accepted. This provenance record prevents the research target from drifting meanwhile.
