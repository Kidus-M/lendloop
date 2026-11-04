import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { audit } from "./audit";
import { enqueueLoanEvent } from "./events";

/**
 * Takes a listing off the board and declines its open requests, so nobody is
 * left waiting on a tool that no longer exists. The row stays because past
 * loans still refer to it.
 */
export async function withdrawTool(
  ctx: MutationCtx,
  tool: Doc<"tools">,
  actor: Doc<"users"> | "system",
  action: string,
): Promise<void> {
  await ctx.db.patch(tool._id, {
    status: "removed",
    removedAt: Date.now(),
    removedBy: typeof actor === "string" ? undefined : actor._id,
  });

  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", tool._id).eq("status", "pending"),
    )
    .collect();

  for (const loan of pending) {
    await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, "loan.declined", loan, loan.borrowerId);
  }

  await audit(ctx, actor, action, { table: "tools", id: tool._id });
}
