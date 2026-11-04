import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { approvedLoans } from "./lib/availability";
import { audit } from "./lib/audit";
import { LIMITS, type Category, type ToolStatus } from "./lib/domain";
import { fail } from "./lib/errors";
import { publicQuery, userMutation, userQuery } from "./lib/functions";
import { assertToolOwner } from "./lib/policies";
import { cleanText } from "./lib/text";
import { categoryValidator, conditionValidator } from "./lib/validators";
import { withdrawTool } from "./lib/withdraw";

const MAX_LISTED = 200;
const PUBLIC_LIMIT = 60;

function cleanName(value: string): string {
  return cleanText(value, "Name", LIMITS.toolName);
}

function cleanDescription(value: string): string {
  return cleanText(value, "Description", LIMITS.toolDescription);
}

async function getActiveTool(
  ctx: QueryCtx,
  toolId: Id<"tools">,
): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.status === "removed") {
    fail("not_found", "This tool is no longer listed.");
  }
  return tool;
}

function listByStatus(ctx: QueryCtx, status: ToolStatus, category?: Category) {
  const query = category
    ? ctx.db
        .query("tools")
        .withIndex("by_category_status", (q) =>
          q.eq("category", category).eq("status", status),
        )
    : ctx.db.query("tools").withIndex("by_status", (q) => q.eq("status", status));
  return query.order("desc").take(MAX_LISTED);
}

/**
 * The signed-out view. It maps to an explicit shape instead of returning the
 * document, so adding a field to `tools` can never leak it here.
 */
export const listPublic = publicQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_status", (q) => q.eq("status", "available"))
      .order("desc")
      .take(PUBLIC_LIMIT);
    return tools.map(({ _id, name, category }) => ({ id: _id, name, category }));
  },
});

export const board = userQuery({
  args: { category: v.optional(categoryValidator) },
  handler: async (ctx, { category }) => {
    const [available, onLoan] = await Promise.all([
      listByStatus(ctx, "available", category),
      listByStatus(ctx, "on_loan", category),
    ]);

    const owners = new Map<Id<"users">, Doc<"users"> | null>();
    const ownerOf = async (ownerId: Id<"users">) => {
      if (!owners.has(ownerId)) owners.set(ownerId, await ctx.db.get(ownerId));
      return owners.get(ownerId) ?? null;
    };

    return Promise.all(
      [...available, ...onLoan].map(async (tool) => {
        const owner = await ownerOf(tool.ownerId);
        return {
          id: tool._id,
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
          status: tool.status,
          isMine: tool.ownerId === ctx.user._id,
          owner: {
            name: owner?.name ?? "Neighbor",
            trustedLender: owner?.trustedLender ?? false,
          },
        };
      }),
    );
  },
});

/** Booked dates for the request form. Dates only: who booked them is not shared. */
export const bookings = userQuery({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await getActiveTool(ctx, toolId);
    const loans = await approvedLoans(ctx, tool._id);
    return loans
      .map(({ startDate, endDate }) => ({ startDate, endDate }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));
  },
});

export const mine = userQuery({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.user._id))
      .order("desc")
      .collect();

    return Promise.all(
      tools
        .filter((tool) => tool.status !== "removed")
        .map(async (tool) => {
          const pending = await ctx.db
            .query("loans")
            .withIndex("by_tool_status", (q) =>
              q.eq("toolId", tool._id).eq("status", "pending"),
            )
            .collect();
          return {
            id: tool._id,
            name: tool.name,
            category: tool.category,
            condition: tool.condition,
            description: tool.description,
            status: tool.status,
            pendingRequests: pending.length,
          };
        }),
    );
  },
});

export const create = userMutation({
  args: {
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const owned = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", ctx.user._id))
      .collect();
    const listed = owned.filter((tool) => tool.status !== "removed").length;
    if (listed >= LIMITS.maxListingsPerOwner) {
      fail(
        "limit_reached",
        `You can list up to ${LIMITS.maxListingsPerOwner} tools. Remove one to add another.`,
      );
    }

    const toolId = await ctx.db.insert("tools", {
      ownerId: ctx.user._id,
      name: cleanName(args.name),
      category: args.category,
      condition: args.condition,
      description: cleanDescription(args.description),
      status: "available",
    });
    await audit(ctx, ctx.user, "tool.created", { table: "tools", id: toolId });
    return toolId;
  },
});

export const update = userMutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
  },
  handler: async (ctx, { toolId, ...fields }) => {
    const tool = await getActiveTool(ctx, toolId);
    assertToolOwner(ctx.user, tool);

    await ctx.db.patch(tool._id, {
      name: cleanName(fields.name),
      category: fields.category,
      condition: fields.condition,
      description: cleanDescription(fields.description),
    });
    await audit(ctx, ctx.user, "tool.updated", { table: "tools", id: tool._id });
  },
});

export const remove = userMutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const tool = await getActiveTool(ctx, toolId);
    assertToolOwner(ctx.user, tool);

    const loans = await approvedLoans(ctx, tool._id);
    if (loans.length > 0) {
      fail(
        "conflict",
        "This tool has an approved loan. Mark it returned or cancel it first.",
      );
    }
    await withdrawTool(ctx, tool, ctx.user, "tool.removed");
  },
});
