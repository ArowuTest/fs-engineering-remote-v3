# Railway deployment

The control plane is designed to run continuously on Railway; local execution nodes are optional and are only required for access to a user computer.

## Required variables

- `DATABASE_URL` - Railway PostgreSQL connection string.
- `FS_REMOTE_ENDPOINT_SECRET` - 32+ character private MCP endpoint capability.
- `FS_REMOTE_ACTIONS_SECRET` - separate 32+ character legacy Actions secret; must differ from the endpoint secret.
- `FS_PUBLIC_BASE_URL` - public HTTPS URL of this service.
- `FS_HOSTED_ENGINEERING_SECRET` - random secret for hosted worker submission.
- `FS_PROVIDER_SECRET_KEY` - 32-byte/base64 encryption key for per-user provider credentials.
- `FS_GPT_OAUTH_CLIENT_ID` - OAuth client id configured in the Custom GPT.
- `FS_GPT_OAUTH_CLIENT_SECRET` - OAuth client secret configured in the Custom GPT.
- `FS_GPT_OAUTH_REDIRECT_URIS` - comma-separated exact ChatGPT OAuth callback URI(s).
- `GITHUB_TOKEN` - GitHub token used by the hosted Git executor and GitHub provider. Store it only as a Railway secret.
- `FS_HOSTED_GIT_REPOSITORIES` - comma-separated allow-list, e.g. `ArowuTest/fs-engineering-remote-v3`.
- `FS_BOOTSTRAP_OWNER_USERNAME` and `FS_BOOTSTRAP_OWNER_PASSWORD` - required only while creating the first account on a fresh database. The password must be 12+ characters.
- `FS_BOOTSTRAP_WORKSPACE_NAME` / `FS_BOOTSTRAP_WORKSPACE_SLUG` - optional initial workspace identity.

On a fresh database, startup atomically creates the initial owner/workspace from the bootstrap variables. After the owner can sign in, remove `FS_BOOTSTRAP_OWNER_PASSWORD` from Railway; subsequent startups do not use it. Keep all secrets in Railway variables; do not put them in GPT instructions, job payloads, or the repository. Startup runs the database migrations before accepting traffic. Railway should deploy from `main`; `/healthz` is the deployment health check.

## GPT connection

Import `/openapi.json` as the GPT Action schema. Configure OAuth authorization URL as `<FS_PUBLIC_BASE_URL>/oauth/authorize` and token URL as `<FS_PUBLIC_BASE_URL>/oauth/token`. Each user signs in to FS during OAuth and receives workspace-scoped permissions. The legacy Actions bearer secret remains compatibility-only.

## Execution nodes

A user can enroll Windows, macOS, or Linux from `/portal/settings`. Enrollment tokens expire after 15 minutes and are single-use. Start the node once with `FS_REMOTE_CONTROL_PLANE_URL=https://<your-service> FS_REMOTE_NODE_ENROLLMENT_TOKEN=<token> npm run node:agent`; the enrollment exchange returns the long-lived node credential. Persist that returned credential as `FS_REMOTE_NODE_SECRET` in the machine's secret store/environment before subsequent restarts. Node credentials bind heartbeat/claim/complete calls to the enrolled workspace.
