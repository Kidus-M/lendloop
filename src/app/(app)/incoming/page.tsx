"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { LoanRow } from "@/components/LoanRow";
import { useAction } from "@/lib/useAction";

export default function IncomingPage() {
  const loans = useQuery(api.loans.incoming);
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);
  const { pending, run } = useAction();

  return (
    <>
      <h1 className="mb-8 text-5xl">Incoming requests</h1>

      {loans === undefined && <p className="text-ink-soft">Loading requests.</p>}

      {loans?.length === 0 && (
        <p className="max-w-md">
          No one has asked to borrow your tools yet. Requests show up here as soon as
          they&rsquo;re sent.
        </p>
      )}

      {loans && loans.length > 0 && (
        <ul className="ledger">
          {loans.map((loan) => (
            <LoanRow
              key={loan.id}
              loan={loan}
              counterpartLabel="Requested by"
              actions={
                <>
                  {loan.status === "pending" && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={pending}
                        onClick={() => run(() => approve({ loanId: loan.id }), "Request approved")}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={pending}
                        onClick={() => run(() => decline({ loanId: loan.id }), "Request declined")}
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {loan.status === "approved" && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending}
                      onClick={() =>
                        run(() => markReturned({ loanId: loan.id }), "Marked as returned")
                      }
                    >
                      Mark as returned
                    </button>
                  )}
                </>
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}
