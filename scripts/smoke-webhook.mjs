#!/usr/bin/env node
// Attacks the running n8n webhook and checks it holds. Start the stack first:
//   docker compose up -d && npm run smoke:webhook
//
// The valid event has an id Convex has never seen, so its write-back gets a 404.
// That failed run is expected, and it also exercises the error workflow.
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const MAILPIT = "http://127.0.0.1:8025/api/v1/search";
const URL_ = process.env.N8N_WEBHOOK_URL ?? "http://127.0.0.1:5678/webhook/lendloop-events";
const PATH = new URL(URL_).pathname;

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
);
const SECRET = env.LENDLOOP_TO_N8N_SECRET;

const sign = (secret, timestamp, body, path = PATH) =>
  `v1=${createHmac("sha256", secret).update(`${timestamp}.POST.${path}.${body}`).digest("hex")}`;

const now = () => String(Math.floor(Date.now() / 1000));

const toolName = `Smoke drill ${randomUUID().slice(0, 8)}`;

function event() {
  const eventId = randomUUID();
  return {
    version: 1,
    eventId,
    deliveryKey: `${eventId}:0`,
    type: "loan.approved",
    occurredAt: new Date().toISOString(),
    recipient: { firstName: "Smoke", email: "smoke@lendloop.test" },
    loan: { toolName, startDate: "2030-01-01", endDate: "2030-01-02" },
  };
}

async function post(body, headers = {}) {
  const response = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  return response.status;
}

const headers = (signature, timestamp) => ({
  "x-lendloop-signature": signature,
  "x-lendloop-timestamp": timestamp,
});

const body = JSON.stringify(event());
const fresh = now();
const stale = String(Number(fresh) - 3600);

const cases = [
  ["no signature", 401, () => post(body)],
  ["wrong secret", 401, () => post(body, headers(sign("wrong", fresh, body), fresh))],
  [
    "tampered body",
    401,
    () => post(body.replace("Smoke drill", "Other tool"), headers(sign(SECRET, fresh, body), fresh)),
  ],
  ["replayed old timestamp", 401, () => post(body, headers(sign(SECRET, stale, body), stale))],
  [
    "signature for another path",
    401,
    () => post(body, headers(sign(SECRET, fresh, body, "/webhook/other"), fresh)),
  ],
  ["valid request", 202, () => post(body, headers(sign(SECRET, fresh, body), fresh))],
  ["same delivery again", 202, () => post(body, headers(sign(SECRET, fresh, body), fresh))],
];

let failed = 0;
for (const [name, expected, run] of cases) {
  const status = await run();
  const ok = status === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${status} (expected ${expected})`);
}
// A signed retry is accepted, but de-duplication must stop a second email.
await new Promise((resolve) => setTimeout(resolve, 5000));
const search = await fetch(`${MAILPIT}?query=${encodeURIComponent(`subject:"${toolName}"`)}`);
const { messages_count: emails } = await search.json();
const oneEmail = emails === 1;
if (!oneEmail) failed += 1;
console.log(`${oneEmail ? "ok  " : "FAIL"} emails sent for two deliveries: ${emails} (expected 1)`);

process.exit(failed ? 1 : 0);
