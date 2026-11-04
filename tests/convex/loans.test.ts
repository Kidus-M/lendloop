import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { isOverdue, isValidIsoDate, LIMITS, rangesOverlap } from "../../convex/lib/domain";
import {
  addPerson,
  failsWith,
  listTool,
  NOW,
  requestLoan,
  startBackend,
} from "./harness";

afterEach(() => {
  vi.useRealTimers();
});

async function scene() {
  const t = startBackend();
  const owner = await addPerson(t, "Ana");
  const borrower = await addPerson(t, "Ben");
  const toolId = await listTool(owner);
  return { t, owner, borrower, toolId };
}

describe("dates", () => {
  it("rejects impossible calendar days", () => {
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("June 3")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
  });

  it("treats ranges as inclusive on both ends", () => {
    const a = { startDate: "2026-06-10", endDate: "2026-06-12" };
    expect(rangesOverlap(a, { startDate: "2026-06-12", endDate: "2026-06-13" })).toBe(true);
    expect(rangesOverlap(a, { startDate: "2026-06-13", endDate: "2026-06-14" })).toBe(false);
  });

  it("calls a loan overdue only after its last day", () => {
    const loan = { status: "approved" as const, endDate: "2026-06-14" };
    expect(isOverdue(loan, "2026-06-14")).toBe(false);
    expect(isOverdue(loan, "2026-06-15")).toBe(true);
    expect(isOverdue({ ...loan, status: "returned" }, "2026-06-15")).toBe(false);
  });
});

describe("requesting", () => {
  it("refuses bad ranges", async () => {
    const { borrower, toolId } = await scene();

    await failsWith(requestLoan(borrower, toolId, "2026-06-22", "2026-06-20"), "invalid");
    await failsWith(requestLoan(borrower, toolId, "2026-06-01", "2026-06-02"), "invalid");
    await failsWith(requestLoan(borrower, toolId, "2026-02-31", "2026-03-01"), "invalid");
    await failsWith(requestLoan(borrower, toolId, "2026-06-20", "2026-08-20"), "invalid");
    await failsWith(requestLoan(borrower, toolId, "2027-06-20", "2027-06-21"), "invalid");
  });

  it("refuses your own tool", async () => {
    const { owner, toolId } = await scene();
    await failsWith(requestLoan(owner, toolId), "invalid");
  });

  it("refuses a duplicate request and dates already booked", async () => {
    const { t, owner, borrower, toolId } = await scene();
    const other = await addPerson(t, "Cy");

    const loanId = await requestLoan(borrower, toolId);
    await failsWith(requestLoan(borrower, toolId), "conflict");

    await owner.as.mutation(api.loans.approve, { loanId });
    await failsWith(requestLoan(other, toolId, "2026-06-21", "2026-06-23"), "conflict");
  });

  it("caps how many requests one person can have waiting", async () => {
    const { t, owner, borrower } = await scene();
    for (let i = 0; i < LIMITS.maxPendingRequestsPerBorrower; i += 1) {
      await requestLoan(borrower, await listTool(owner, `Tool number ${i}`));
    }
    await failsWith(
      requestLoan(borrower, await listTool(owner, "One too many")),
      "limit_reached",
    );
    expect(await t.run((ctx) => ctx.db.query("loans").collect())).toHaveLength(
      LIMITS.maxPendingRequestsPerBorrower,
    );
  });
});

describe("the loan lifecycle", () => {
  it("runs from request to return and frees the tool", async () => {
    const { owner, borrower, toolId } = await scene();
    const loanId = await requestLoan(borrower, toolId, "2026-06-15", "2026-06-18");

    await owner.as.mutation(api.loans.approve, { loanId });
    expect((await borrower.as.query(api.tools.board, {}))[0].status).toBe("on_loan");

    await owner.as.mutation(api.loans.markReturned, { loanId });
    expect((await borrower.as.query(api.tools.board, {}))[0].status).toBe("available");

    const [request] = await borrower.as.query(api.loans.myRequests, {});
    expect(request.status).toBe("returned");
  });

  it("rejects moves the state machine doesn't allow", async () => {
    const { owner, borrower, toolId } = await scene();
    const loanId = await requestLoan(borrower, toolId);

    await failsWith(owner.as.mutation(api.loans.markReturned, { loanId }), "conflict");
    await owner.as.mutation(api.loans.decline, { loanId });
    await failsWith(owner.as.mutation(api.loans.approve, { loanId }), "conflict");
    await failsWith(borrower.as.mutation(api.loans.cancel, { loanId }), "conflict");
  });

  it("keeps a future booking available until its start date", async () => {
    const { t, owner, borrower, toolId } = await scene();
    const loanId = await requestLoan(borrower, toolId, "2026-06-20", "2026-06-22");
    await owner.as.mutation(api.loans.approve, { loanId });

    expect((await borrower.as.query(api.tools.board, {}))[0].status).toBe("available");

    vi.setSystemTime(Date.parse("2026-06-20T01:00:00Z"));
    await t.mutation(internal.maintenance.syncAvailability, {});
    expect((await borrower.as.query(api.tools.board, {}))[0].status).toBe("on_loan");
  });

  it("declines overlapping requests when one is approved", async () => {
    const { t, owner, borrower, toolId } = await scene();
    const other = await addPerson(t, "Cy");
    const clash = await requestLoan(other, toolId, "2026-06-21", "2026-06-23");
    const clear = await requestLoan(other, toolId, "2026-07-01", "2026-07-02");
    const winner = await requestLoan(borrower, toolId, "2026-06-20", "2026-06-22");

    await owner.as.mutation(api.loans.approve, { loanId: winner });

    const statusOf = async (id: typeof clash) =>
      (await t.run((ctx) => ctx.db.get(id)))?.status;
    expect(await statusOf(clash)).toBe("declined");
    expect(await statusOf(clear)).toBe("pending");
  });

  it("won't approve dates that clash with an overdue loan still out", async () => {
    const { t, owner, borrower, toolId } = await scene();
    const other = await addPerson(t, "Cy");
    const late = await requestLoan(borrower, toolId, "2026-06-15", "2026-06-16");
    await owner.as.mutation(api.loans.approve, { loanId: late });

    vi.setSystemTime(NOW + 10 * 86_400_000);
    const next = await requestLoan(other, toolId, "2026-06-26", "2026-06-27");
    vi.setSystemTime(NOW + 12 * 86_400_000);

    await failsWith(owner.as.mutation(api.loans.approve, { loanId: next }), "conflict");
  });

  it("lets a borrower back out of an approved loan only before it starts", async () => {
    const { owner, borrower, toolId } = await scene();
    const future = await requestLoan(borrower, toolId, "2026-06-20", "2026-06-21");
    await owner.as.mutation(api.loans.approve, { loanId: future });
    await borrower.as.mutation(api.loans.cancel, { loanId: future });

    const started = await requestLoan(borrower, toolId, "2026-06-15", "2026-06-16");
    await owner.as.mutation(api.loans.approve, { loanId: started });
    await failsWith(borrower.as.mutation(api.loans.cancel, { loanId: started }), "conflict");
  });

  it("shares booked dates without saying who booked them", async () => {
    const { t, owner, borrower, toolId } = await scene();
    const other = await addPerson(t, "Cy");
    const loanId = await requestLoan(borrower, toolId);
    await owner.as.mutation(api.loans.approve, { loanId });

    expect(await other.as.query(api.tools.bookings, { toolId })).toEqual([
      { startDate: "2026-06-20", endDate: "2026-06-22" },
    ]);
  });
});

describe("board filters", () => {
  it("filters by category on the server", async () => {
    const { owner, borrower } = await scene();
    await owner.as.mutation(api.tools.create, {
      name: "Two-person tent",
      category: "camping",
      condition: "good",
      description: "Waterproof tent with pegs and a groundsheet.",
    });

    const camping = await borrower.as.query(api.tools.board, { category: "camping" });
    expect(camping.map((tool) => tool.name)).toEqual(["Two-person tent"]);
    expect(await borrower.as.query(api.tools.board, {})).toHaveLength(2);
  });
});
