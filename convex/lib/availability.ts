import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { DateRange } from "./domain";

export async function approvedLoans(
  ctx: QueryCtx,
  toolId: Id<"tools">,
): Promise<Doc<"loans">[]> {
  return ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", toolId).eq("status", "approved"),
    )
    .collect();
}

/** An overdue tool is still out, so its booking runs at least until today. */
export function occupiedRange(loan: Doc<"loans">, today: string): DateRange {
  return {
    startDate: loan.startDate,
    endDate: loan.endDate < today ? today : loan.endDate,
  };
}

export async function syncToolAvailability(
  ctx: MutationCtx,
  tool: Doc<"tools">,
  today: string,
): Promise<void> {
  if (tool.status === "removed") return;
  const loans = await approvedLoans(ctx, tool._id);
  const isOut = loans.some((loan) => loan.startDate <= today);
  const status = isOut ? "on_loan" : "available";
  if (status !== tool.status) await ctx.db.patch(tool._id, { status });
}
