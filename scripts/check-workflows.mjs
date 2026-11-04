#!/usr/bin/env node
// Fails CI if an exported workflow holds a secret or loses a reliability setting.
// A re-export from the n8n editor is the easiest way for either to slip in.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIRECTORY = "n8n/workflows";
const ERROR_WORKFLOW_ID = "lendloopErrors01";

const SECRET_PATTERNS = [
  [/\bwhsec_[A-Za-z0-9+/=]{16,}/, "a Clerk webhook secret"],
  [/\bsk_(?:test|live)_[A-Za-z0-9]{16,}/, "a Clerk secret key"],
  [/\b[a-f0-9]{48,}\b/i, "a long hex string that looks like a secret"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/\b(?:hmacSecret|password|apiKey)"\s*:\s*"[^"=]/i, "an inline credential value"],
];

const problems = [];

function checkNode(file, node) {
  for (const [type, reference] of Object.entries(node.credentials ?? {})) {
    const fields = Object.keys(reference).sort().join();
    if (fields !== "id,name") {
      problems.push(`${file}: "${node.name}" embeds ${type} credential data.`);
    }
  }

  const callsOut =
    node.type === "n8n-nodes-base.httpRequest" ||
    node.type === "n8n-nodes-base.emailSend";
  if (callsOut && node.retryOnFail !== true) {
    problems.push(`${file}: "${node.name}" has no retry policy.`);
  }
}

function checkWorkflow(file, workflow) {
  const raw = JSON.stringify(workflow);
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(raw)) problems.push(`${file}: contains ${label}.`);
  }

  if (Object.keys(workflow.pinData ?? {}).length > 0) {
    problems.push(`${file}: pinned data can hold real personal data.`);
  }
  if (workflow.settings?.saveDataSuccessExecution !== "none") {
    problems.push(`${file}: successful runs must not store their data.`);
  }
  if (
    workflow.id !== ERROR_WORKFLOW_ID &&
    workflow.settings?.errorWorkflow !== ERROR_WORKFLOW_ID
  ) {
    problems.push(`${file}: isn't connected to the error workflow.`);
  }

  for (const node of workflow.nodes) checkNode(file, node);
}

const files = readdirSync(DIRECTORY).filter((file) => file.endsWith(".json"));
if (files.length < 3) problems.push(`Expected 3 workflows, found ${files.length}.`);

for (const file of files) {
  checkWorkflow(file, JSON.parse(readFileSync(join(DIRECTORY, file), "utf8")));
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Checked ${files.length} workflows: no secrets, retries and error handling in place.`);
