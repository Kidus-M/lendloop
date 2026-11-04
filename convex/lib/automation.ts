import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { LoanEventType } from "./domain";

export const HEARTBEAT_OVERDUE_POLL = "overdue_poll";

/** One reminder per loan per day, whichever retry or re-run asks for it. */
export function reminderKey(loanId: Id<"loans">, date: string): string {
  return `reminder:${loanId}:${date}`;
}

export function parseReminderKey(
  key: string,
): { loanId: string; date: string } | null {
  const [prefix, loanId, date, ...rest] = key.split(":");
  if (prefix !== "reminder" || !loanId || !date || rest.length > 0) return null;
  return { loanId, date };
}

export function notificationKey(eventId: string): string {
  return `notification:${eventId}`;
}

type ActivityEntry = Pick<
  Doc<"loanActivity">,
  "loanId" | "kind" | "status" | "idempotencyKey"
> & { eventType?: LoanEventType };

/**
 * The single idempotent write for automation results. Replays change nothing,
 * and "sent" is terminal: a late failure report can't overwrite a success,
 * while a retry that succeeds does upgrade an earlier failure.
 */
export async function recordActivity(
  ctx: MutationCtx,
  entry: ActivityEntry,
): Promise<"created" | "updated" | "duplicate"> {
  const existing = await ctx.db
    .query("loanActivity")
    .withIndex("by_key", (q) => q.eq("idempotencyKey", entry.idempotencyKey))
    .unique();

  if (!existing) {
    await ctx.db.insert("loanActivity", { ...entry, at: Date.now() });
    return "created";
  }
  if (existing.status === "failed" && entry.status === "sent") {
    await ctx.db.patch(existing._id, { status: "sent", at: Date.now() });
    return "updated";
  }
  return "duplicate";
}

export async function recordFailure(
  ctx: MutationCtx,
  failure: { key: string; workflow: string; node?: string; message: string },
): Promise<"created" | "duplicate"> {
  const existing = await ctx.db
    .query("automationFailures")
    .withIndex("by_key", (q) => q.eq("key", failure.key))
    .unique();
  if (existing) return "duplicate";

  await ctx.db.insert("automationFailures", { ...failure, at: Date.now() });
  return "created";
}
