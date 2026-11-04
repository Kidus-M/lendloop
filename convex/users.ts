import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { audit } from "./lib/audit";
import { fail } from "./lib/errors";
import { identityMutation, userQuery } from "./lib/functions";
import { withdrawTool } from "./lib/withdraw";

const MAX_NAME_LENGTH = 40;
const FALLBACK_NAME = "Neighbor";
const DELETED_NAME = "Former neighbor";

function firstName(name?: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first.slice(0, MAX_NAME_LENGTH) : FALLBACK_NAME;
}

/**
 * Creates or refreshes the signed-in user's row from their verified Clerk
 * token. Every value comes from the token, not from arguments, and `role` and
 * `trustedLender` are never touched here, so a client cannot promote itself.
 */
export const ensureCurrent = identityMutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) fail("unauthenticated", "Sign in to continue.");

    const name = firstName(identity.givenName ?? identity.name);
    const tokenEmail =
      identity.emailVerified === false ? undefined : identity.email;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) =>
        q.eq("tokenIdentifier", identity.tokenIdentifier),
      )
      .unique();

    if (existing) {
      // Falls back to the stored address: patching `undefined` would delete the field.
      const email = tokenEmail ?? existing.email;
      if (existing.name !== name || existing.email !== email) {
        await ctx.db.patch(existing._id, { name, email });
      }
      return existing._id;
    }

    return ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkId: identity.subject,
      name,
      email: tokenEmail,
      role: "user",
      trustedLender: false,
    });
  },
});

export const me = userQuery({
  args: {},
  handler: async (ctx) => ({
    id: ctx.user._id,
    name: ctx.user.name,
    role: ctx.user.role,
    trustedLender: ctx.user.trustedLender,
  }),
});

export const applyClerkUpdate = internalMutation({
  args: {
    clerkId: v.string(),
    firstName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { clerkId, firstName: given, email }) => {
    const user = await findByClerkId(ctx, clerkId);
    if (!user || user.deletedAt !== undefined) return;
    // Without a verified address, keep the one on file rather than erase it.
    await ctx.db.patch(user._id, {
      name: firstName(given),
      email: email ?? user.email,
    });
  },
});

/**
 * Honors account deletion. Personal data is erased while the anonymous row
 * stays, so other people's loan history still makes sense. Replayed webhooks
 * find `deletedAt` set and stop.
 */
export const applyClerkDeletion = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const user = await findByClerkId(ctx, clerkId);
    if (!user || user.deletedAt !== undefined) return;

    await ctx.db.patch(user._id, {
      name: DELETED_NAME,
      email: undefined,
      tokenIdentifier: `deleted:${user._id}`,
      trustedLender: false,
      role: "user",
      deletedAt: Date.now(),
    });

    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    for (const tool of tools) {
      if (tool.status !== "removed") {
        await withdrawTool(ctx, tool, "system", "tool.removed_account_deleted");
      }
    }

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_borrower_status", (q) =>
        q.eq("borrowerId", user._id).eq("status", "pending"),
      )
      .collect();
    for (const loan of pending) {
      await ctx.db.patch(loan._id, { status: "cancelled" });
    }

    await audit(ctx, "system", "user.deleted", { table: "users", id: user._id });
  },
});

function findByClerkId(ctx: MutationCtx, clerkId: string) {
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}
