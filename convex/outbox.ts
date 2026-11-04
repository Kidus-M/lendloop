/**
 * Delivers loan events to n8n, with retries.
 *
 * pending -> accepted (n8n verified the signature and took the event)
 *         -> confirmed (n8n reported the notification went out)
 *         -> failed    (retries ran out, n8n reported failure, or no report came)
 *
 * A failed row appears on the admin page and can be retried from there.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { notificationKey, recordActivity } from "./lib/automation";
import {
  SIGNATURE_HEADER,
  signRequest,
  TIMESTAMP_HEADER,
} from "./lib/signing";

/** Delay before attempts 2 to 6, about 7 hours in total, to ride out an n8n outage. */
const RETRY_DELAYS_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

const REQUEST_TIMEOUT_MS = 10_000;
/** Long enough for a delivery in flight to finish, so the sweep never sends it twice. */
const LEASE_MS = 2 * 60_000;
const SWEEP_GRACE_MS = 60_000;
const CONFIRMATION_TIMEOUT_MS = 15 * 60_000;
const SWEEP_BATCH = 50;

export type NotificationPayload = {
  version: 1;
  eventId: string;
  /** n8n de-duplicates on this. A manual retry changes it; an automatic one doesn't. */
  deliveryKey: string;
  type: Doc<"outbox">["type"];
  occurredAt: string;
  recipient: { firstName: string; email: string };
  loan: { toolName: string; startDate: string; endDate: string };
};

/** The only personal data that leaves Convex for a notification. */
function buildPayload(
  row: Doc<"outbox">,
  recipient: Doc<"users"> & { email: string },
  loan: Doc<"loans">,
  tool: Doc<"tools">,
): NotificationPayload {
  return {
    version: 1,
    eventId: row.eventId,
    deliveryKey: `${row.eventId}:${row.generation}`,
    type: row.type,
    occurredAt: new Date(row._creationTime).toISOString(),
    recipient: { firstName: recipient.name, email: recipient.email },
    loan: {
      toolName: tool.name,
      startDate: loan.startDate,
      endDate: loan.endDate,
    },
  };
}

async function settleFailed(
  ctx: MutationCtx,
  row: Doc<"outbox">,
  error: string,
): Promise<void> {
  await ctx.db.patch(row._id, {
    status: "failed",
    lastError: error,
    nextAttemptAt: undefined,
    settledAt: Date.now(),
  });
  await recordActivity(ctx, {
    loanId: row.loanId,
    kind: "notification",
    eventType: row.type,
    status: "failed",
    idempotencyKey: notificationKey(row.eventId),
  });
}

/** Takes a time-limited lease on the row and builds the payload from current data. */
export const claimDelivery = internalMutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = await ctx.db.get(outboxId);
    const now = Date.now();
    if (!row || row.status !== "pending") return null;
    if (row.nextAttemptAt !== undefined && row.nextAttemptAt > now) return null;

    const [recipient, loan] = await Promise.all([
      ctx.db.get(row.recipientId),
      ctx.db.get(row.loanId),
    ]);
    const tool = loan ? await ctx.db.get(loan.toolId) : null;
    const email = recipient?.email;

    if (!recipient || !email || recipient.deletedAt !== undefined || !loan || !tool) {
      await ctx.db.patch(row._id, {
        status: "skipped",
        lastError: "The recipient has no email address.",
        nextAttemptAt: undefined,
        settledAt: now,
      });
      return null;
    }

    await ctx.db.patch(row._id, {
      attempts: row.attempts + 1,
      nextAttemptAt: now + LEASE_MS,
    });
    return buildPayload(row, { ...recipient, email }, loan, tool);
  },
});

export const markAccepted = internalMutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = await ctx.db.get(outboxId);
    if (!row || row.status !== "pending") return;
    await ctx.db.patch(row._id, {
      status: "accepted",
      acceptedAt: Date.now(),
      nextAttemptAt: undefined,
      lastError: undefined,
    });
  },
});

export const markAttemptFailed = internalMutation({
  args: { outboxId: v.id("outbox"), error: v.string() },
  handler: async (ctx, { outboxId, error }) => {
    const row = await ctx.db.get(outboxId);
    if (!row || row.status !== "pending") return;

    if (row.attempts >= MAX_ATTEMPTS) {
      await settleFailed(ctx, row, error);
      return;
    }

    const delay = RETRY_DELAYS_MS[row.attempts - 1];
    await ctx.db.patch(row._id, {
      lastError: error,
      nextAttemptAt: Date.now() + delay,
    });
    await ctx.scheduler.runAfter(delay, internal.outbox.deliver, { outboxId });
  },
});

export const deliver = internalAction({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const payload = await ctx.runMutation(internal.outbox.claimDelivery, {
      outboxId,
    });
    if (!payload) return;

    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.outbox.markAttemptFailed, {
        outboxId,
        error: "N8N_WEBHOOK_URL or LENDLOOP_TO_N8N_SECRET isn't set.",
      });
      return;
    }

    const error = await send(url, secret, payload);
    if (error) {
      await ctx.runMutation(internal.outbox.markAttemptFailed, { outboxId, error });
    } else {
      await ctx.runMutation(internal.outbox.markAccepted, { outboxId });
    }
  },
});

/** Returns an error message, or null on success. Errors never include the URL or payload. */
async function send(
  url: string,
  secret: string,
  payload: NotificationPayload,
): Promise<string | null> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signRequest(secret, {
    timestamp,
    method: "POST",
    path: new URL(url).pathname,
    body,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: timestamp,
      },
      body,
      signal: controller.signal,
      redirect: "error",
    });
    return response.ok ? null : `n8n responded with ${response.status}.`;
  } catch {
    return "n8n could not be reached.";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Safety net run by cron. The scheduler runs an action at most once, so a crash
 * mid-delivery could strand a row. This also fails events n8n accepted but
 * never reported on, which is how a crash inside n8n becomes visible.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const stranded = await ctx.db
      .query("outbox")
      .withIndex("by_status_next_attempt", (q) =>
        q.eq("status", "pending").lte("nextAttemptAt", now - SWEEP_GRACE_MS),
      )
      .take(SWEEP_BATCH);
    for (const row of stranded) {
      await redispatch(ctx, row._id);
    }

    const unconfirmed = await ctx.db
      .query("outbox")
      .withIndex("by_status_accepted", (q) =>
        q
          .eq("status", "accepted")
          .lte("acceptedAt", now - CONFIRMATION_TIMEOUT_MS),
      )
      .take(SWEEP_BATCH);
    for (const row of unconfirmed) {
      await settleFailed(ctx, row, "n8n accepted this but never confirmed it.");
    }
  },
});

async function redispatch(ctx: MutationCtx, outboxId: Id<"outbox">): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.outbox.deliver, { outboxId });
}
