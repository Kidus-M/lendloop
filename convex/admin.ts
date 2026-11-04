import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { audit } from "./lib/audit";
import { fail } from "./lib/errors";
import { adminMutation, adminQuery } from "./lib/functions";
import { HEARTBEAT_OVERDUE_POLL } from "./lib/automation";
import { roleValidator } from "./lib/validators";
import { withdrawTool } from "./lib/withdraw";

const MAX_LISTED = 200;
const RECENT_LIMIT = 25;
const COUNT_LIMIT = 500;

export const loans = adminQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("loans").order("desc").take(MAX_LISTED);
    return Promise.all(
      rows.map(async (loan) => {
        const [tool, lender, borrower] = await Promise.all([
          ctx.db.get(loan.toolId),
          ctx.db.get(loan.lenderId),
          ctx.db.get(loan.borrowerId),
        ]);
        return {
          id: loan._id,
          toolName: tool?.name ?? "Removed tool",
          lenderName: lender?.name ?? "Neighbor",
          borrowerName: borrower?.name ?? "Neighbor",
          startDate: loan.startDate,
          endDate: loan.endDate,
          status: loan.status,
        };
      }),
    );
  },
});

export const listings = adminQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(MAX_LISTED);
    return Promise.all(
      tools
        .filter((tool) => tool.status !== "removed")
        .map(async (tool) => {
          const owner = await ctx.db.get(tool.ownerId);
          return {
            id: tool._id,
            name: tool.name,
            category: tool.category,
            status: tool.status,
            ownerName: owner?.name ?? "Neighbor",
          };
        }),
    );
  },
});

/** Lenders for the Trusted Lender control. Emails stay out because the task doesn't need them. */
export const lenders = adminQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(MAX_LISTED);
    return users
      .filter((user) => user.deletedAt === undefined)
      .map((user) => ({
        id: user._id,
        name: user.name,
        role: user.role,
        trustedLender: user.trustedLender,
      }));
  },
});

export const setTrustedLender = adminMutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const lender = await ctx.db.get(userId);
    if (!lender || lender.deletedAt !== undefined) {
      fail("not_found", "This person no longer has an account.");
    }
    await ctx.db.patch(lender._id, { trustedLender: trusted });
    await audit(
      ctx,
      ctx.user,
      trusted ? "user.trusted_lender_granted" : "user.trusted_lender_revoked",
      { table: "users", id: lender._id },
    );
  },
});

export const removeListing = adminMutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status === "removed") {
      fail("not_found", "This listing was already removed.");
    }
    await withdrawTool(ctx, tool, ctx.user, "tool.removed_by_admin");
  },
});

/** Everything that went wrong in automation, in one place, so failures are never silent. */
export const automationHealth = adminQuery({
  args: {},
  handler: async (ctx) => {
    const [pending, accepted, failed, failures, heartbeat] = await Promise.all([
      ctx.db
        .query("outbox")
        .withIndex("by_status_next_attempt", (q) => q.eq("status", "pending"))
        .take(COUNT_LIMIT),
      ctx.db
        .query("outbox")
        .withIndex("by_status_accepted", (q) => q.eq("status", "accepted"))
        .take(COUNT_LIMIT),
      ctx.db
        .query("outbox")
        .withIndex("by_status_settled", (q) => q.eq("status", "failed"))
        .order("desc")
        .take(RECENT_LIMIT),
      ctx.db
        .query("automationFailures")
        .withIndex("by_at")
        .order("desc")
        .take(RECENT_LIMIT),
      ctx.db
        .query("heartbeats")
        .withIndex("by_name", (q) => q.eq("name", HEARTBEAT_OVERDUE_POLL))
        .unique(),
    ]);

    return {
      queued: pending.length,
      awaitingConfirmation: accepted.length,
      overduePollLastSeenAt: heartbeat?.lastSeenAt ?? null,
      failedDeliveries: failed.map((row) => ({
        id: row._id,
        type: row.type,
        attempts: row.attempts,
        error: row.lastError ?? "Unknown error",
        at: row.settledAt ?? row._creationTime,
      })),
      failedRuns: failures.map((row) => ({
        id: row._id,
        workflow: row.workflow,
        node: row.node,
        message: row.message,
        at: row.at,
      })),
    };
  },
});

export const retryDelivery = adminMutation({
  args: { outboxId: v.id("outbox") },
  handler: async (ctx, { outboxId }) => {
    const row = await ctx.db.get(outboxId);
    if (!row) fail("not_found", "This delivery no longer exists.");
    if (row.status !== "failed") {
      fail("conflict", "Only failed deliveries can be retried.");
    }

    await ctx.db.patch(row._id, {
      status: "pending",
      attempts: 0,
      generation: row.generation + 1,
      nextAttemptAt: Date.now(),
      lastError: undefined,
      acceptedAt: undefined,
      settledAt: undefined,
    });
    await ctx.scheduler.runAfter(0, internal.outbox.deliver, { outboxId });
    await audit(ctx, ctx.user, "outbox.retried", { table: "outbox", id: row._id });
  },
});

/**
 * Deliberately internal: there is no way to grant a role through the app or
 * from a browser. It runs only with deployment credentials:
 *   npx convex run admin:setRole '{"clerkId":"user_abc123","role":"admin"}'
 *
 * The target is the immutable Clerk user ID, not an email. Emails can change
 * and be reused, which makes them the wrong key for granting privilege.
 */
export const setRole = internalMutation({
  args: { clerkId: v.string(), role: roleValidator },
  handler: async (ctx, { clerkId, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
      .unique();
    if (!user || user.deletedAt !== undefined) {
      throw new Error("No active user with that Clerk ID has signed in yet.");
    }

    await ctx.db.patch(user._id, { role });
    await audit(ctx, "cli", "user.role_set", { table: "users", id: user._id }, role);
    return { id: user._id, role };
  },
});
