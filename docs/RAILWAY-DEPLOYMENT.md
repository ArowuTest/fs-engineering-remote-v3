# Railway production deployment

Railway is the production control plane for FS Remote V3. The production project contains three resources: `control-plane`, `autonomous-worker`, and `Postgres`. App deployment is CI-gated from `main`; Postgres is never mutated by the app rollout workflow.

## Source of truth

Railway infrastructure is defined in `.railway/railway.ts`. The legacy `railway.json` Config-as-Code file has been retired because Railway deprecates that format after 2026-12-01.

The intended topology is:

- `control-plane`: GitHub repo `ArowuTest/fs-engineering-remote-v3`, default/main branch, Dockerfile build, `npm start`, `/readyz` health check, one `ams` replica.
- `autonomous-worker`: same repo/revision, Dockerfile build, `npm run worker`, one `ams` replica, no HTTP health check.
- `Postgres`: `postgres:17`, preserved and excluded from app-rollout changes by the Railway plan guard.

## Railway runtime variables

Required control-plane variables currently used for production boot:

- `DATABASE_URL`
- `FS_REMOTE_ENDPOINT_SECRET`
- `FS_REMOTE_ACTIONS_SECRET`
- `FS_REMOTE_ENVIRONMENT`
- `FS_REMOTE_HOSTED`
- `FS_REMOTE_INSTANCE_ID`
- `FS_REMOTE_PUBLIC_BASE_URL`
- `FS_REMOTE_STATE_ROOT`

Required autonomous-worker variables:

- `DATABASE_URL`
- `FS_REMOTE_ENDPOINT_SECRET`
- `FS_REMOTE_ACTIONS_SECRET`
- `FS_REMOTE_ENVIRONMENT`
- `FS_REMOTE_INSTANCE_ID`
- `FS_REMOTE_STATE_ROOT`
- `GITHUB_TOKEN`
- `OPENROUTER_API_KEY`

`FS_BUILD_REVISION` is stamped by the deployment workflow on both app services before deployment and preserved by IaC. `/healthz` and `/readyz` expose the non-secret deployment revision and Railway deployment ID.

Optional product features may require additional variables such as `FS_HOSTED_ENGINEERING_SECRET`, `FS_PROVIDER_SECRET_KEY`, OAuth client settings, `FS_HOSTED_GIT_REPOSITORIES` for the hosted Git allow-list, and bootstrap-owner variables. These are feature-specific and should not be invented during deployment; configure them only when the corresponding capability is intentionally enabled.

`FS_PUBLIC_BASE_URL` is **not** a Railway runtime variable. It is a GitHub Actions secret used by the deployment workflow to verify the public control-plane endpoint after rollout. The runtime variable is `FS_REMOTE_PUBLIC_BASE_URL`.

## Current namespace caveat

The existing Railway production services were originally created with `FS_REMOTE_ENVIRONMENT=staging` and `FS_REMOTE_INSTANCE_ID=v3-staging` even though the Railway environment is named `production`. `FS_REMOTE_INSTANCE_ID` scopes durable database rows and must not be renamed casually. A future rename to `v3-production` requires an explicit database namespace migration. Deployment identity prefers Railway's real environment name for observability, so new health/readiness responses correctly report `production` without changing the durable instance namespace.

## Safe rollout sequence

The GitHub workflow `.github/workflows/deploy-railway.yml` is restricted to `main` and deploys the exact CI-verified SHA.

1. Check out the exact verified SHA and run `npm ci` + `npm run validate`.
2. Link the Railway production project/environment.
3. Verify required variable **names** for both app services without printing values.
4. Stamp `FS_BUILD_REVISION=<verified SHA>` on both app services with `--skip-deploys`.
5. Deploy `control-plane` first while Railway still uses the pre-migration health policy. This ordering matters for the first IaC rollout because the old August production revision serves `/healthz` but not `/readyz`.
6. Poll public `/readyz` until it reports HTTP 200, `ready:true`, and the exact expected revision.
7. Generate a pinned Railway IaC plan and run `scripts/railway-plan-guard.mts`. The guard rejects adds/deletes, Postgres changes, and changes outside `control-plane`/`autonomous-worker`.
8. Apply the pinned IaC plan, which moves Railway's control-plane health check to fail-closed `/readyz`, aligns app sources with main, and applies the intended restart policy.
9. Re-verify `/readyz` and exact revision after the infrastructure change.
10. Deploy `autonomous-worker` from the same checked-out SHA.
11. Verify the latest worker deployment is `SUCCESS` and its Railway commit/message metadata matches the expected SHA.
12. Run a final IaC plan and require zero remaining changes.

This ordering keeps the existing worker compatible while the control plane is upgraded first. Node protocol compatibility remains backward-compatible for legacy nodes, so the rollout can be staged safely.

## Readiness and revision verification

- `/healthz` is liveness/diagnostic information.
- `/readyz` is fail-closed deployment readiness and must return HTTP 200 before rollout succeeds.
- Both endpoints expose a `deployment` object containing service version, environment, Railway deployment ID when available, and the serving revision.
- The deployment workflow fails if `/readyz` does not report the exact `DEPLOY_SHA`.

## Local Railway validation

Use the repository-pinned `railway` IaC SDK and Railway CLI 5.42.1 or newer. On Windows, Railway's SDK version check may require invoking the native `@railway/cli/bin/railway.exe` binary because PowerShell/npm shims do not behave like native executables when the SDK probes `process.env._`.

Before applying anything:

1. `railway config pull --json` to inspect live state without decrypting variables.
2. `railway config plan --json` to generate a machine-readable diff.
3. Run `scripts/railway-plan-guard.mts` on the plan.
4. Confirm the plan reports no resource additions/deletions and no Postgres changes.

Do not run `railway config apply`, `railway up`, `git push`, or any production mutation until the intended revision and rollout window are explicitly approved.
