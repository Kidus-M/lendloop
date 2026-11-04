/** Internal mutations behind the signed HTTP routes in `http.ts`. Each is safe to replay. */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
  HEARTBEAT_OVERDUE_POLL,
  notificationKey,
  parseReminderKey,
  recordActivity,
  recordFailure,
  reminderKey,
} from "./lib/automation";
import { daysBetween, isValidIsoDate, todayUtc } from "./lib/domain";

const OVERDUE_BATCH = 200;

/**
 * A mutation rather than a query, because each poll also records the heartbeat
 * that shows admins the daily schedule is still alive. Loans already reminded
 * today are left out, so re-running the workflow sends nothing twice.
 */
export const pollOverdue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const today = todayUtc(now);

    const heartbeat = await ctx.db
      .query("heartbeats")
      .withIndex("by_name", (q) => q.eq("name", HEARTBEAT_OVERDUE_POLL))
      .unique();
    if (heartbeat) {
      await ctx.db.patch(heartbeat._id, { lastSeenAt: now });
    } else {
      await ctx.db.insert("heartbeats", {
        name: HEARTBEAT_OVERDUE_POLL,
        lastSeenAt: now,
      });
    }

    const overdue = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) =>
        q.eq("status", "approved").lt("endDate", today),
      )
      .take(OVERDUE_BATCH);

    const loans = [];
    for (const loan of overdue) {
      const key = reminderKey(loan._id, today);
      const sent = await ctx.db
        .query("loanActivity")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (sent?.status === "sent") continue;

      const [borrower, tool] = await Promise.all([
        ctx.db.get(loan.borrowerId),
        ctx.db.get(loan.toolId),
      ]);
      if (!borrower?.email || !tool) continue;

      // Only what the reminder needs. The lender's identity is not included.
      loans.push({
        reminderKey: key,
        recipient: { firstName: borrower.name, email: borrower.email },
        toolName: tool.name,
        dueDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
      });
    }
    return { date: today, loans };
  },
});

export const recordReminder = internalMutation({
  args: {
    reminderKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, { reminderKey: key, status }) => {
    const parsed = parseReminderKey(key);
    const loanId = parsed ? ctx.db.normalizeId("loans", parsed.loanId) : null;
    if (!parsed || !loanId || !isValidIsoDate(parsed.date)) {
      return { result: "unknown" as const };
    }
    if (!(await ctx.db.get(loanId))) return { result: "unknown" as const };

    const result = await recordActivity(ctx, {
      loanId,
      kind: "reminder",
      status,
      idempotencyKey: key,
    });

    if (status === "failed") {
      await recordFailure(ctx, {
        key,
        workflow: "Overdue reminders",
        message: "A reminder could not be sent to the borrower.",
      });
    }
    return { result };
  },
});

export const recordNotification = internalMutation({
  args: {
    eventId: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, { eventId, status }) => {
    const row = await ctx.db
      .query("outbox")
      .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
      .unique();
    if (!row) return { result: "unknown" as const };

    const result = await recordActivity(ctx, {
      loanId: row.loanId,
      kind: "notification",
      eventType: row.type,
      status,
      idempotencyKey: notificationKey(eventId),
    });

    if (status === "sent" && row.status !== "confirmed") {
      await ctx.db.patch(row._id, {
        status: "confirmed",
        settledAt: Date.now(),
        nextAttemptAt: undefined,
        lastError: undefined,
      });
    } else if (status === "failed" && row.status !== "confirmed") {
      await ctx.db.patch(row._id, {
        status: "failed",
        settledAt: Date.now(),
        nextAttemptAt: undefined,
        lastError: "n8n could not send the notification.",
      });
    }
    return { result };
  },
});

export const recordRunFailure = internalMutation({
  args: {
    key: v.string(),
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
  },
  handler: async (ctx, failure) => ({
    result: await recordFailure(ctx, failure),
  }),
});
