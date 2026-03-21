import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const rootDir = __dirname;
const stateDir = path.resolve(rootDir, "../../.tmp/console-e2e-state");
const dbPath = path.join(stateDir, "e2e.sqlite");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: "list",
  use: {
    baseURL: "http://localhost:3009",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node ./e2e/support/seed-state.mjs && npm run build && npm run start -- --port 3009",
    url: "http://localhost:3009",
    reuseExistingServer: false,
    cwd: rootDir,
    env: {
      ...process.env,
      LAC_STATE_DIR: stateDir,
      LAC_DB_PATH: dbPath,
      LAC_SOCKET_PATH: path.join(stateDir, "daemon.sock"),
      LAC_MODEL_NAME: "qwen2.5-coder:7b",
      LAC_MODEL_BASE_URL: "http://127.0.0.1:11434",
      LAC_SUGGEST_TIMEOUT_MS: "900",
      LAC_OLLAMA_LIBRARY_MODELS: "qwen2.5-coder,llama3.2,mistral-small,gemma3,phi4,alfred",
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
