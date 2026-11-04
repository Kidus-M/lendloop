/**
 * Who may do what, as plain functions. `functions.ts` answers "are you signed
 * in, and are you an admin?"; this file answers "is this record yours to touch?".
 */
import type { Doc } from "../_generated/dataModel";
import type { LoanStatus } from "./domain";
import { fail } from "./errors";

export function assertToolOwner(user: Doc<"users">, tool: Doc<"tools">): void {
  if (tool.ownerId !== user._id) {
    fail("forbidden", "You can only change your own listings.");
  }
}

export function assertLender(user: Doc<"users">, loan: Doc<"loans">): void {
  if (loan.lenderId !== user._id) {
    fail("forbidden", "Only the tool's owner can do this.");
  }
}

export function assertBorrower(user: Doc<"users">, loan: Doc<"loans">): void {
  if (loan.borrowerId !== user._id) {
    fail("forbidden", "Only the person who asked to borrow can do this.");
  }
}

export type LoanAction = "approve" | "decline" | "cancel" | "return";

/** The loan state machine. Anything not listed here is rejected. */
const TRANSITIONS: Partial<
  Record<LoanStatus, Partial<Record<LoanAction, LoanStatus>>>
> = {
  pending: { approve: "approved", decline: "declined", cancel: "cancelled" },
  approved: { return: "returned", cancel: "cancelled" },
};

export function nextStatus(current: LoanStatus, action: LoanAction): LoanStatus {
  const next = TRANSITIONS[current]?.[action];
  if (!next) {
    fail("conflict", `This request is already ${current}, so it can't be changed.`);
  }
  return next;
}
