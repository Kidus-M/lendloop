import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  approvedLoans,
  occupiedRange,
  syncToolAvailability,
} from "./lib/availability";
import { audit } from "./lib/audit";
import {
  addDays,
  daysBetween,
  isValidIsoDate,
  LIMITS,
  rangesOverlap,
  todayUtc,
  type DateRange,
} from "./lib/domain";
import { fail } from "./lib/errors";
import { enqueueLoanEvent } from "./lib/events";
import { userMutation, userQuery } from "./lib/functions";
import {
  assertBorrower,
  assertLender,
  nextStatus,
} from "./lib/policies";

const MAX_LISTED = 100;
const ACTIVITY_PER_LOAN = 5;

function assertValidRange(range: DateRange, today: string): void {
  const { startDate, endDate } = range;
  if (!isValidIsoDate(startDate) || !isValidIsoDate(endDate)) {
    fail("invalid", "Choose valid start and end dates.");
  }
  if (endDate < startDate) {
    fail("invalid", "The end date must be on or after the start date.");
  }
  // One day of grace, because "today" is UTC and the browser may be a day behind it.
  if (startDate < addDays(today, -1)) {
    fail("invalid", "The start date can't be in the past.");
  }
  if (startDate > addDays(today, LIMITS.maxAdvanceDays)) {
    fail("invalid", `Book no more than ${LIMITS.maxAdvanceDays} days ahead.`);
  }
  if (daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays) {
    fail("invalid", `Loans can last up to ${LIMITS.maxLoanDays} days.`);
  }
}

async function getLoan(ctx: QueryCtx, loanId: Id<"loans">): Promise<Doc<"loans">> {
  const loan = await ctx.db.get(loanId);
  if (!loan) fail("not_found", "This request no longer exists.");
  return loan;
}

async function getLoanTool(
  ctx: QueryCtx,
  loan: Doc<"loans">,
): Promise<Doc<"tools">> {
  const tool = await ctx.db.get(loan.toolId);
  if (!tool) fail("not_found", "This tool no longer exists.");
  return tool;
}

/** Shapes a loan for one side of it. The other person appears by first name only. */
export async function toLoanView(
  ctx: QueryCtx,
  loan: Doc<"loans">,
  counterpartId: Id<"users">,
) {
  const [tool, counterpart, activity] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(counterpartId),
    ctx.db
      .query("loanActivity")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .take(ACTIVITY_PER_LOAN),
  ]);

  return {
    id: loan._id,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    requestedAt: loan._creationTime,
    tool: {
      name: tool?.name ?? "Removed tool",
      category: tool?.category ?? ("other" as const),
    },
    counterpart: {
      name: counterpart?.name ?? "Neighbor",
      trustedLender: counterpart?.trustedLender ?? false,
    },
    activity: activity.map(({ _id, kind, eventType, status, at }) => ({
      id: _id,
      kind,
      eventType,
      status,
      at,
    })),
  };
}

export const myRequests = userQuery({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", ctx.user._id))
      .order("desc")
      .take(MAX_LISTED);
    return Promise.all(loans.map((loan) => toLoanView(ctx, loan, loan.lenderId)));
  },
});

export const incoming = userQuery({
  args: {},
  handler: async (ctx) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", ctx.user._id))
      .order("desc")
      .take(MAX_LISTED);
    return Promise.all(
      loans.map((loan) => toLoanView(ctx, loan, loan.borrowerId)),
    );
  },
});

export const request = userMutation({
  args: {
    toolId: v.id("tools"),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const today = todayUtc();
    const range = { startDate, endDate };
    assertValidRange(range, today);

    const tool = await ctx.db.get(toolId);
    if (!tool || tool.status === "removed") {
      fail("not_found", "This tool is no longer listed.");
    }
    if (tool.ownerId === ctx.user._id) {
      fail("invalid", "You can't borrow your own tool.");
    }

    const myPending = await ctx.db
      .query("loans")
      .withIndex("by_borrower_status", (q) =>
        q.eq("borrowerId", ctx.user._id).eq("status", "pending"),
      )
      .collect();
    if (myPending.length >= LIMITS.maxPendingRequestsPerBorrower) {
      fail(
        "limit_reached",
        `You have ${myPending.length} requests waiting. Cancel one or wait for a reply.`,
      );
    }
    if (
      myPending.some(
        (loan) => loan.toolId === tool._id && rangesOverlap(loan, range),
      )
    ) {
      fail("conflict", "You already asked to borrow this tool for those dates.");
    }

    const booked = await approvedLoans(ctx, tool._id);
    if (booked.some((loan) => rangesOverlap(occupiedRange(loan, today), range))) {
      fail("conflict", "This tool is booked for some of those dates.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId: tool._id,
      lenderId: tool.ownerId,
      borrowerId: ctx.user._id,
      startDate,
      endDate,
      status: "pending",
    });
    const loan = await getLoan(ctx, loanId);

    await enqueueLoanEvent(ctx, "loan.requested", loan, loan.lenderId);
    await audit(ctx, ctx.user, "loan.requested", { table: "loans", id: loanId });
    return loanId;
  },
});

/** Requests that overlap the approved dates can no longer happen, so they are declined now. */
async function declineConflicting(
  ctx: MutationCtx,
  approved: Doc<"loans">,
): Promise<void> {
  const pending = await ctx.db
    .query("loans")
    .withIndex("by_tool_status", (q) =>
      q.eq("toolId", approved.toolId).eq("status", "pending"),
    )
    .collect();

  for (const loan of pending) {
    if (loan._id !== approved._id && rangesOverlap(loan, approved)) {
      await ctx.db.patch(loan._id, { status: "declined", decidedAt: Date.now() });
      await enqueueLoanEvent(ctx, "loan.declined", loan, loan.borrowerId);
    }
  }
}

export const approve = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertLender(ctx.user, loan);
    const status = nextStatus(loan.status, "approve");

    const tool = await getLoanTool(ctx, loan);
    if (tool.status === "removed") {
      fail("conflict", "This tool is no longer listed.");
    }

    // Convex mutations are serializable, so two approvals can't both pass this check.
    const today = todayUtc();
    const booked = await approvedLoans(ctx, tool._id);
    if (booked.some((other) => rangesOverlap(occupiedRange(other, today), loan))) {
      fail("conflict", "Those dates clash with a loan you already approved.");
    }

    await ctx.db.patch(loan._id, { status, decidedAt: Date.now() });
    await declineConflicting(ctx, loan);
    await syncToolAvailability(ctx, tool, today);

    await enqueueLoanEvent(ctx, "loan.approved", loan, loan.borrowerId);
    await audit(ctx, ctx.user, "loan.approved", { table: "loans", id: loan._id });
  },
});

export const decline = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertLender(ctx.user, loan);
    const status = nextStatus(loan.status, "decline");

    await ctx.db.patch(loan._id, { status, decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, "loan.declined", loan, loan.borrowerId);
    await audit(ctx, ctx.user, "loan.declined", { table: "loans", id: loan._id });
  },
});

/** A borrower can withdraw a request, or back out of an approved loan before it starts. */
export const cancel = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertBorrower(ctx.user, loan);
    const status = nextStatus(loan.status, "cancel");

    const today = todayUtc();
    if (loan.status === "approved" && loan.startDate <= today) {
      fail("conflict", "This loan has started. Ask the owner to mark it returned.");
    }

    await ctx.db.patch(loan._id, { status });
    const tool = await getLoanTool(ctx, loan);
    await syncToolAvailability(ctx, tool, today);

    await enqueueLoanEvent(ctx, "loan.cancelled", loan, loan.lenderId);
    await audit(ctx, ctx.user, "loan.cancelled", { table: "loans", id: loan._id });
  },
});

/**
 * Lender only. Only the owner can see that the tool came back, and a borrower
 * who could mark it returned could also switch off their own overdue reminders.
 */
export const markReturned = userMutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await getLoan(ctx, loanId);
    assertLender(ctx.user, loan);
    const status = nextStatus(loan.status, "return");

    await ctx.db.patch(loan._id, { status, returnedAt: Date.now() });
    const tool = await getLoanTool(ctx, loan);
    await syncToolAvailability(ctx, tool, todayUtc());

    await enqueueLoanEvent(ctx, "loan.returned", loan, loan.borrowerId);
    await audit(ctx, ctx.user, "loan.returned", { table: "loans", id: loan._id });
  },
});
