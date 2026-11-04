import { Webhook } from "svix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
  verifyRequest,
} from "../../convex/lib/signing";
import {
  addPerson,
  type Backend,
  listTool,
  NOW,
  requestLoan,
  startBackend,
  TODAY,
} from "./harness";

const INBOUND_SECRET = "test-inbound-secret";
const OUTBOUND_SECRET = "test-outbound-secret";
const CLERK_SECRET = `whsec_${btoa("clerk-webhook-test-secret")}`;
const WEBHOOK_URL = "https://n8n.test/webhook/lendloop-events";

beforeEach(() => {
  vi.stubEnv("N8N_TO_LENDLOOP_SECRET", INBOUND_SECRET);
  vi.stubEnv("LENDLOOP_TO_N8N_SECRET", OUTBOUND_SECRET);
  vi.stubEnv("N8N_WEBHOOK_URL", WEBHOOK_URL);
  vi.stubEnv("CLERK_WEBHOOK_SECRET", CLERK_SECRET);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function signed(
  t: Backend,
  method: string,
  path: string,
  body = "",
  options: { secret?: string; timestamp?: number; signedPath?: string } = {},
) {
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const signature = await signRequest(options.secret ?? INBOUND_SECRET, {
    timestamp,
    method,
    path: options.signedPath ?? path,
    body,
  });
  return t.fetch(path, {
    method,
    headers: { [SIGNATURE_HEADER]: signature, [TIMESTAMP_HEADER]: timestamp },
    body: method === "GET" ? undefined : body,
  });
}

async function overdueLoan(t: Backend) {
  const owner = await addPerson(t, "Ana");
  const borrower = await addPerson(t, "Ben");
  const toolId = await listTool(owner);
  const loanId = await requestLoan(borrower, toolId, TODAY, "2026-06-16");
  await owner.as.mutation(api.loans.approve, { loanId });
  vi.setSystemTime(NOW + 4 * 86_400_000);
  return { owner, borrower, loanId };
}

describe("request signatures", () => {
  const request = { timestamp: "1781524800", method: "POST", path: "/a", body: "{}" };
  const nowMs = 1781524800_000;

  it("accepts a valid signature", async () => {
    const signature = await signRequest("secret", request);
    expect(await verifyRequest("secret", signature, request, nowMs)).toEqual({ ok: true });
  });

  it.each([
    ["a changed body", { body: '{"a":1}' }],
    ["another path", { path: "/b" }],
    ["another method", { method: "GET" }],
  ])("rejects %s", async (_name, change) => {
    const signature = await signRequest("secret", request);
    const result = await verifyRequest("secret", signature, { ...request, ...change }, nowMs);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects the wrong secret", async () => {
    const signature = await signRequest("other", request);
    const result = await verifyRequest("secret", signature, request, nowMs);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an old timestamp, even with a valid signature", async () => {
    const signature = await signRequest("secret", request);
    const result = await verifyRequest("secret", signature, request, nowMs + 301_000);
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects malformed signatures", async () => {
    for (const bad of [null, "", "v1=zz", "v2=abcd", "v1=abcd"]) {
      const result = await verifyRequest("secret", bad, request, nowMs);
      expect(result).toEqual({ ok: false, reason: "malformed" });
    }
  });
});

describe("signed endpoints", () => {
  it("rejects unsigned, wrongly signed and redirected requests", async () => {
    const t = startBackend();

    const unsigned = await t.fetch("/n8n/overdue-loans", { method: "GET" });
    expect(unsigned.status).toBe(401);

    const wrongSecret = await signed(t, "GET", "/n8n/overdue-loans", "", { secret: "nope" });
    expect(wrongSecret.status).toBe(401);

    const otherEndpoint = await signed(t, "POST", "/n8n/reminders", "{}", {
      signedPath: "/n8n/notifications",
    });
    expect(otherEndpoint.status).toBe(401);

    const replayed = await signed(t, "GET", "/n8n/overdue-loans", "", {
      timestamp: Math.floor(NOW / 1000) - 3600,
    });
    expect(replayed.status).toBe(401);
  });

  it("fails closed when the secret isn't configured", async () => {
    const t = startBackend();
    vi.stubEnv("N8N_TO_LENDLOOP_SECRET", "");
    const response = await signed(t, "GET", "/n8n/overdue-loans");
    expect(response.status).toBe(503);
  });

  it("rejects bodies that don't match the contract", async () => {
    const t = startBackend();
    const notJson = await signed(t, "POST", "/n8n/reminders", "not json");
    expect(notJson.status).toBe(400);
    const wrongShape = await signed(t, "POST", "/n8n/reminders", '{"status":"maybe"}');
    expect(wrongShape.status).toBe(400);
  });
});

describe("overdue reminders", () => {
  it("returns only the fields a reminder needs", async () => {
    const t = startBackend();
    const { loanId } = await overdueLoan(t);

    const response = await signed(t, "GET", "/n8n/overdue-loans");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      date: "2026-06-19",
      loans: [
        {
          reminderKey: `reminder:${loanId}:2026-06-19`,
          recipient: { firstName: "Ben", email: "ben@example.com" },
          toolName: "Cordless drill",
          dueDate: "2026-06-16",
          daysOverdue: 3,
        },
      ],
    });
  });

  it("writes one record however many times n8n retries", async () => {
    const t = startBackend();
    const { loanId } = await overdueLoan(t);
    const body = JSON.stringify({
      reminderKey: `reminder:${loanId}:2026-06-19`,
      status: "sent",
    });

    const first = await signed(t, "POST", "/n8n/reminders", body);
    const second = await signed(t, "POST", "/n8n/reminders", body);

    expect((await first.json()).result).toBe("created");
    expect((await second.json()).result).toBe("duplicate");
    expect(await t.run((ctx) => ctx.db.query("loanActivity").collect())).toHaveLength(1);
  });

  it("doesn't return a loan again the same day, but does the next day", async () => {
    const t = startBackend();
    const { loanId } = await overdueLoan(t);
    await t.mutation(internal.automation.recordReminder, {
      reminderKey: `reminder:${loanId}:2026-06-19`,
      status: "sent",
    });

    const sameDay = await t.mutation(internal.automation.pollOverdue, {});
    expect(sameDay.loans).toEqual([]);

    vi.setSystemTime(NOW + 5 * 86_400_000);
    const nextDay = await t.mutation(internal.automation.pollOverdue, {});
    expect(nextDay.loans).toHaveLength(1);
  });

  it("retries a failed reminder and shows the failure to admins", async () => {
    const t = startBackend();
    const { loanId } = await overdueLoan(t);
    const admin = await addPerson(t, "Root", "admin");
    const reminderKey = `reminder:${loanId}:2026-06-19`;

    await t.mutation(internal.automation.recordReminder, { reminderKey, status: "failed" });
    expect((await t.mutation(internal.automation.pollOverdue, {})).loans).toHaveLength(1);

    const health = await admin.as.query(api.admin.automationHealth, {});
    expect(health.failedRuns).toHaveLength(1);

    const result = await t.mutation(internal.automation.recordReminder, {
      reminderKey,
      status: "sent",
    });
    expect(result.result).toBe("updated");
  });

  it("never lets a late failure overwrite a success", async () => {
    const t = startBackend();
    const { loanId } = await overdueLoan(t);
    const reminderKey = `reminder:${loanId}:2026-06-19`;

    await t.mutation(internal.automation.recordReminder, { reminderKey, status: "sent" });
    await t.mutation(internal.automation.recordReminder, { reminderKey, status: "failed" });

    const [activity] = await t.run((ctx) => ctx.db.query("loanActivity").collect());
    expect(activity.status).toBe("sent");
  });

  it("refuses a reminder key for a loan that doesn't exist", async () => {
    const t = startBackend();
    const body = JSON.stringify({ reminderKey: "reminder:nope:2026-06-19", status: "sent" });
    const response = await signed(t, "POST", "/n8n/reminders", body);
    expect(response.status).toBe(404);
  });

  it("shows admins when the schedule last ran", async () => {
    const t = startBackend();
    const admin = await addPerson(t, "Root", "admin");
    expect(
      (await admin.as.query(api.admin.automationHealth, {})).overduePollLastSeenAt,
    ).toBeNull();

    await signed(t, "GET", "/n8n/overdue-loans");
    expect(
      (await admin.as.query(api.admin.automationHealth, {})).overduePollLastSeenAt,
    ).toBe(NOW);
  });

  it("shows activity on the loan for both sides", async () => {
    const t = startBackend();
    const { owner, borrower, loanId } = await overdueLoan(t);
    await t.mutation(internal.automation.recordReminder, {
      reminderKey: `reminder:${loanId}:2026-06-19`,
      status: "sent",
    });

    const [mine] = await borrower.as.query(api.loans.myRequests, {});
    expect(mine.activity[0]).toMatchObject({ kind: "reminder", status: "sent" });
    const [theirs] = await owner.as.query(api.loans.incoming, {});
    expect(theirs.activity).toHaveLength(1);
  });
});

describe("the outbox", () => {
  async function requested(t: Backend) {
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    await requestLoan(borrower, await listTool(owner));
    const [row] = await t.run((ctx) => ctx.db.query("outbox").collect());
    return { owner, borrower, row };
  }

  it("rolls back with the change that caused it", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const toolId = await listTool(owner);
    await requestLoan(owner, toolId).catch(() => undefined);
    expect(await t.run((ctx) => ctx.db.query("outbox").collect())).toEqual([]);
  });

  it("stores ids, not personal data", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    expect(JSON.stringify(row)).not.toContain("example.com");
  });

  it("notifies the lender about a request and the borrower about a decision", async () => {
    const t = startBackend();
    const { owner, borrower, row } = await requested(t);
    expect(row).toMatchObject({ type: "loan.requested", recipientId: owner.id });

    await owner.as.mutation(api.loans.approve, { loanId: row.loanId });
    const rows = await t.run((ctx) => ctx.db.query("outbox").collect());
    expect(rows[1]).toMatchObject({ type: "loan.approved", recipientId: borrower.id });
  });

  it("sends a signed, minimal payload that n8n can verify", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.outbox.deliver, { outboxId: row._id });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);

    const headers = init.headers as Record<string, string>;
    const verdict = await verifyRequest(OUTBOUND_SECRET, headers[SIGNATURE_HEADER], {
      timestamp: headers[TIMESTAMP_HEADER],
      method: "POST",
      path: "/webhook/lendloop-events",
      body: init.body as string,
    });
    expect(verdict).toEqual({ ok: true });

    const payload = JSON.parse(init.body as string);
    expect(Object.keys(payload).sort()).toEqual([
      "deliveryKey",
      "eventId",
      "loan",
      "occurredAt",
      "recipient",
      "type",
      "version",
    ]);
    expect(payload.recipient).toEqual({ firstName: "Ana", email: "ana@example.com" });
    expect(payload.loan).toEqual({
      toolName: "Cordless drill",
      startDate: "2026-06-20",
      endDate: "2026-06-22",
    });

    const updated = await t.run((ctx) => ctx.db.get(row._id));
    expect(updated?.status).toBe("accepted");
  });

  it("backs off when n8n is down, then gives up visibly", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    const admin = await addPerson(t, "Root", "admin");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await t.run((ctx) => ctx.db.patch(row._id, { nextAttemptAt: Date.now() }));
      await t.action(internal.outbox.deliver, { outboxId: row._id });
    }

    const settled = await t.run((ctx) => ctx.db.get(row._id));
    expect(settled).toMatchObject({ status: "failed", attempts: 6 });

    const health = await admin.as.query(api.admin.automationHealth, {});
    expect(health.failedDeliveries).toHaveLength(1);
    expect(health.failedDeliveries[0].error).toBe("n8n responded with 503.");
  });

  it("doesn't send again while a delivery holds the lease", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.outbox.deliver, { outboxId: row._id });
    await t.action(internal.outbox.deliver, { outboxId: row._id });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives a manual retry a new delivery key but the same event id", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    const admin = await addPerson(t, "Root", "admin");
    await t.run((ctx) =>
      ctx.db.patch(row._id, { status: "failed", settledAt: Date.now() }),
    );

    await admin.as.mutation(api.admin.retryDelivery, { outboxId: row._id });

    const payload = await t.mutation(internal.outbox.claimDelivery, { outboxId: row._id });
    expect(payload?.eventId).toBe(row.eventId);
    expect(payload?.deliveryKey).toBe(`${row.eventId}:1`);
  });

  it("confirms once and treats a repeat write-back as a duplicate", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    const body = JSON.stringify({ eventId: row.eventId, status: "sent" });

    const first = await signed(t, "POST", "/n8n/notifications", body);
    const second = await signed(t, "POST", "/n8n/notifications", body);

    expect((await first.json()).result).toBe("created");
    expect((await second.json()).result).toBe("duplicate");
    expect((await t.run((ctx) => ctx.db.get(row._id)))?.status).toBe("confirmed");
  });

  it("fails events n8n accepted but never confirmed", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    await t.mutation(internal.outbox.markAccepted, { outboxId: row._id });

    vi.setSystemTime(NOW + 16 * 60_000);
    await t.mutation(internal.outbox.sweep, {});

    const settled = await t.run((ctx) => ctx.db.get(row._id));
    expect(settled?.status).toBe("failed");
    expect(settled?.lastError).toContain("never confirmed");
  });

  it("skips a recipient whose account was deleted", async () => {
    const t = startBackend();
    const { row } = await requested(t);
    await t.mutation(internal.users.applyClerkDeletion, { clerkId: "clerk_Ana" });

    expect(await t.mutation(internal.outbox.claimDelivery, { outboxId: row._id })).toBeNull();
    expect((await t.run((ctx) => ctx.db.get(row._id)))?.status).toBe("skipped");
  });

  it("records n8n run failures once", async () => {
    const t = startBackend();
    const admin = await addPerson(t, "Root", "admin");
    const body = JSON.stringify({
      key: "execution:42",
      workflow: "Request notifications",
      node: "Send email",
      message: "Connection refused",
    });

    await signed(t, "POST", "/n8n/failures", body);
    await signed(t, "POST", "/n8n/failures", body);

    const health = await admin.as.query(api.admin.automationHealth, {});
    expect(health.failedRuns).toHaveLength(1);
  });
});

describe("the Clerk webhook", () => {
  function signClerk(body: string, id = "msg_1") {
    const timestamp = new Date();
    return {
      "svix-id": id,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
      "svix-signature": new Webhook(CLERK_SECRET).sign(id, timestamp, body),
    };
  }

  it("rejects an unsigned event", async () => {
    const t = startBackend();
    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      body: JSON.stringify({ type: "user.deleted", data: { id: "clerk_Ana" } }),
    });
    expect(response.status).toBe(401);
  });

  it("erases a deleted user's data", async () => {
    const t = startBackend();
    const person = await addPerson(t, "Ana");
    const body = JSON.stringify({ type: "user.deleted", data: { id: "clerk_Ana" } });

    const response = await t.fetch("/clerk/webhook", {
      method: "POST",
      headers: signClerk(body),
      body,
    });

    expect(response.status).toBe(200);
    expect((await t.run((ctx) => ctx.db.get(person.id)))?.email).toBeUndefined();
  });

  it("keeps names and emails current", async () => {
    const t = startBackend();
    const person = await addPerson(t, "Ana");
    const body = JSON.stringify({
      type: "user.updated",
      data: {
        id: "clerk_Ana",
        first_name: "Anabel",
        primary_email_address_id: "e1",
        email_addresses: [
          {
            id: "e1",
            email_address: "anabel@example.com",
            verification: { status: "verified" },
          },
        ],
      },
    });

    await t.fetch("/clerk/webhook", { method: "POST", headers: signClerk(body), body });

    expect(await t.run((ctx) => ctx.db.get(person.id))).toMatchObject({
      name: "Anabel",
      email: "anabel@example.com",
    });
  });

  it("ignores an unverified primary email", async () => {
    const t = startBackend();
    const person = await addPerson(t, "Ana");
    const body = JSON.stringify({
      type: "user.updated",
      data: {
        id: "clerk_Ana",
        first_name: "Ana",
        primary_email_address_id: "e1",
        email_addresses: [
          {
            id: "e1",
            email_address: "someone-else@example.com",
            verification: { status: "unverified" },
          },
        ],
      },
    });

    await t.fetch("/clerk/webhook", { method: "POST", headers: signClerk(body), body });

    expect((await t.run((ctx) => ctx.db.get(person.id)))?.email).toBe(
      "ana@example.com",
    );
  });
});
