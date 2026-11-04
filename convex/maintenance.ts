import { internalMutation } from "./_generated/server";
import { syncToolAvailability } from "./lib/availability";
import { todayUtc } from "./lib/domain";

const DAY_MS = 86_400_000;
const OUTBOX_RETENTION_MS = 30 * DAY_MS;
const FAILURE_RETENTION_MS = 90 * DAY_MS;
const PURGE_BATCH = 500;

/** Moves tools to "on loan" when a booked loan's start date arrives. */
export const syncAvailability = internalMutation({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved"))
      .collect();

    const toolIds = new Set(loans.map((loan) => loan.toolId));
    for (const toolId of toolIds) {
      const tool = await ctx.db.get(toolId);
      if (tool) await syncToolAvailability(ctx, tool, today);
    }
  },
});

/** Operational records are kept only as long as they help with debugging. */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    for (const status of ["confirmed", "skipped"] as const) {
      const rows = await ctx.db
        .query("outbox")
        .withIndex("by_status_settled", (q) =>
          q.eq("status", status).lt("settledAt", now - OUTBOX_RETENTION_MS),
        )
        .take(PURGE_BATCH);
      await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
    }

    const failures = await ctx.db
      .query("automationFailures")
      .withIndex("by_at", (q) => q.lt("at", now - FAILURE_RETENTION_MS))
      .take(PURGE_BATCH);
    await Promise.all(failures.map((row) => ctx.db.delete(row._id)));
  },
});
