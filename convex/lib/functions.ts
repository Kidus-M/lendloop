/**
 * The access-control boundary. Every public Convex function is built from one
 * of these wrappers, so its access level is part of its declaration. ESLint
 * bans importing the raw `query` and `mutation` builders outside this file.
 */
import {
  customCtx,
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import type { Doc } from "../_generated/dataModel";
import { mutation, query, type QueryCtx } from "../_generated/server";
import { fail } from "./errors";

export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) fail("unauthenticated", "Sign in to continue.");

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();

  if (!user || user.deletedAt !== undefined) {
    fail("unauthenticated", "Your account isn't ready yet. Refresh the page.");
  }
  return user;
}

async function requireAdmin(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") fail("forbidden", "Only admins can do this.");
  return user;
}

/** No sign-in needed. Must return only data that is safe for anyone on the internet. */
export const publicQuery = query;

/** Signed in, but the user row may not exist yet. Only `users.ensureCurrent` needs this. */
export const identityMutation = mutation;

export const userQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ user: await requireUser(ctx) })),
);

export const userMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ user: await requireUser(ctx) })),
);

export const adminQuery = customQuery(
  query,
  customCtx(async (ctx) => ({ user: await requireAdmin(ctx) })),
);

export const adminMutation = customMutation(
  mutation,
  customCtx(async (ctx) => ({ user: await requireAdmin(ctx) })),
);
