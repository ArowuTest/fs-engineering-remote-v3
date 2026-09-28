import { defineRailway, github, image, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const autonomousWorker = service("autonomous-worker", {
    source: github("ArowuTest/fs-engineering-remote-v3", { branch: "main", checkSuites: true }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "npm run worker",
    replicas: { "ams": 1 },
    deploy: { restartPolicyMaxRetries: 10 },
    env: { DATABASE_URL: preserve(), FS_BUILD_REVISION: preserve(), FS_REMOTE_ACTIONS_SECRET: preserve(), FS_REMOTE_ENDPOINT_SECRET: preserve(), FS_REMOTE_ENVIRONMENT: preserve(), FS_REMOTE_INSTANCE_ID: preserve(), FS_REMOTE_STATE_ROOT: preserve(), GITHUB_TOKEN: preserve(), OPENROUTER_API_KEY: preserve() },
  });
  const Postgres = service("Postgres", {
    source: image("postgres:17"),
    replicas: { "ams": 1 },
    deploy: { restartPolicyMaxRetries: 5 },
    networking: { privateNetworkEndpoint: "postgres" },
    env: { PGDATA: preserve(), POSTGRES_DB: preserve(), POSTGRES_PASSWORD: preserve(), POSTGRES_USER: preserve() },
  });
  const controlPlane = service("control-plane", {
    source: github("ArowuTest/fs-engineering-remote-v3", { branch: "main", checkSuites: true }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "npm start",
    healthcheck: "/readyz",
    healthcheckTimeout: 120,
    replicas: { "ams": 1 },
    deploy: { restartPolicyMaxRetries: 10 },
    env: { DATABASE_URL: preserve(), FS_BUILD_REVISION: preserve(), FS_REMOTE_ACTIONS_SECRET: preserve(), FS_REMOTE_ENDPOINT_SECRET: preserve(), FS_REMOTE_ENVIRONMENT: preserve(), FS_REMOTE_HOSTED: preserve(), FS_REMOTE_INSTANCE_ID: preserve(), FS_REMOTE_PUBLIC_BASE_URL: preserve(), FS_REMOTE_STATE_ROOT: preserve() },
  });

  return project("FS Engineering Remote v3", {
    resources: [autonomousWorker, Postgres, controlPlane],
  });
});
