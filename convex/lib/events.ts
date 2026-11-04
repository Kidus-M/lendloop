import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { LoanEventType } from "./domain";

/**
 * Records a notification in the caller's transaction. The insert and the
 * scheduled delivery commit or roll back together with the loan change.
 */
export async function enqueueLoanEvent(
  ctx: MutationCtx,
  type: LoanEventType,
  loan: Doc<"loans">,
  recipientId: Id<"users">,
): Promise<void> {
  const outboxId = await ctx.db.insert("outbox", {
    eventId: crypto.randomUUID(),
    type,
    loanId: loan._id,
    recipientId,
    status: "pending",
    attempts: 0,
    generation: 0,
    nextAttemptAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.outbox.deliver, { outboxId });
}
