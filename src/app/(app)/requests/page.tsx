"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { todayUtc } from "@convex/lib/domain";
import { LoanRow, type LoanView } from "@/components/LoanRow";
import { useAction } from "@/lib/useAction";
import { useNow } from "@/lib/useNow";

function canCancel(loan: LoanView, today: string): boolean {
  return (
    loan.status === "pending" || (loan.status === "approved" && loan.startDate > today)
  );
}

export default function RequestsPage() {
  const loans = useQuery(api.loans.myRequests);
  const cancel = useMutation(api.loans.cancel);
  const { pending, run } = useAction();
  const today = todayUtc(useNow());

  return (
    <>
      <h1 className="mb-8 text-5xl">My requests</h1>

      {loans === undefined && <p className="text-ink-soft">Loading your requests.</p>}

      {loans?.length === 0 && (
        <p className="max-w-md">
          You haven&rsquo;t asked to borrow anything yet.{" "}
          <Link href="/board" className="font-bold underline">
            See what&rsquo;s on the wall
          </Link>
          .
        </p>
      )}

      {loans && loans.length > 0 && (
        <ul className="ledger">
          {loans.map((loan) => (
            <LoanRow
              key={loan.id}
              loan={loan}
              counterpartLabel="Lent by"
              actions={
                canCancel(loan, today) && (
                  <button
                    type="button"
                    className="btn"
                    disabled={pending}
                    onClick={() => run(() => cancel({ loanId: loan.id }), "Request cancelled")}
                  >
                    Cancel request
                  </button>
                )
              }
            />
          ))}
        </ul>
      )}
    </>
  );
}
