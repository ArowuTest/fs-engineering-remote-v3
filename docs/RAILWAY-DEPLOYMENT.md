# Railway deployment

The control plane is designed to run continuously on Railway; local execution nodes are optional and are only required for access to a user computer.

## Required variables

- `DATABASE_URL` - Railway PostgreSQL connection string.
- `FS_PUBLIC_BASE_URL` - public HTTPS URL of this service.
- `FS_HOSTED_ENGINEERING_SECRET` - random secret for hosted worker submission.
- `FS_PROVIDER_SECRET_KEY` - 32-byte/base64 encryption key for per-user provider credentials.
- `FS_GPT_OAUTH_CLIENT_ID` - OAuth client id configured in the Custom GPT.
- `FS_GPT_OAUTH_CLIENT_SECRET` - OAuth client secret configured in the Custom GPT.
- `FS_GPT_OAUTH_REDIRECT_URIS` - comma-separated exact ChatGPT OAuth callback URI(s).
- `FS_HOSTED_GITHUB_TOKEN` - GitHub token used only by the hosted Git executor.
- `FS_HOSTED_REPOSITORIES` - comma-separated allow-list, e.g. `ArowuTest/fs-engineering-remote-v3`.

Keep all secrets in Railway variables; do not put them in GPT instructions, job payloads, or the repository. Startup runs the database migrations before accepting traffic. Railway should deploy from `main`; `/health` is the deployment health check.

## GPT connection

Import `/openapi.json` as the GPT Action schema. Configure OAuth authorization URL as `<FS_PUBLIC_BASE_URL>/oauth/authorize` and token URL as `<FS_PUBLIC_BASE_URL>/oauth/token`. Each user signs in to FS during OAuth and receives workspace-scoped permissions. The legacy Actions bearer secret remains compatibility-only.

## Execution nodes

A user can enroll Windows, macOS, or Linux from `/portal/settings`. Enrollment tokens expire after 15 minutes and are single-use. Node credentials bind subsequent heartbeat/claim/complete calls to the enrolled workspace.
