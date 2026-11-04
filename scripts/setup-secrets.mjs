#!/usr/bin/env node
// Creates .env with strong random secrets, then gives Convex its half of them.
// Values are never printed. Existing values are kept, so this is safe to re-run.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const ENV_FILE = ".env";
const CONVEX_CLI = "node_modules/convex/bin/main.js";

const GENERATED = [
  "N8N_ENCRYPTION_KEY",
  "N8N_RUNNERS_AUTH_TOKEN",
  "LENDLOOP_TO_N8N_SECRET",
  "N8N_TO_LENDLOOP_SECRET",
];

function readEnv() {
  if (!existsSync(ENV_FILE)) return new Map();
  const lines = readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
  return new Map(
    lines
      .filter((line) => line.includes("=") && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const env = readEnv();
for (const name of GENERATED) {
  if (!env.get(name)) env.set(name, randomBytes(32).toString("hex"));
}
if (!env.get("LENDLOOP_CONVEX_SITE_URL")) {
  env.set("LENDLOOP_CONVEX_SITE_URL", "http://host.docker.internal:3211");
}

writeFileSync(
  ENV_FILE,
  [...env].map(([name, value]) => `${name}=${value}`).join("\n") + "\n",
  { mode: 0o600 },
);
console.log(`Wrote ${ENV_FILE}.`);

const convexVariables = {
  LENDLOOP_TO_N8N_SECRET: env.get("LENDLOOP_TO_N8N_SECRET"),
  N8N_TO_LENDLOOP_SECRET: env.get("N8N_TO_LENDLOOP_SECRET"),
  N8N_WEBHOOK_URL:
    process.env.N8N_WEBHOOK_URL ?? "http://127.0.0.1:5678/webhook/lendloop-events",
};

for (const [name, value] of Object.entries(convexVariables)) {
  // Runs the CLI directly: a shell would put these values through command parsing.
  execFileSync(process.execPath, [CONVEX_CLI, "env", "set", name, value], {
    stdio: ["ignore", "ignore", "inherit"],
  });
  console.log(`Set ${name} on Convex.`);
}
