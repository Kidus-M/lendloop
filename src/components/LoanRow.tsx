import type { FunctionReturnType } from "convex/server";
import { BadgeCheck, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { daysBetween, isOverdue, todayUtc } from "@convex/lib/domain";
import { formatRange, timeAgo } from "@/lib/format";
import { useNow } from "@/lib/useNow";

export type LoanView = FunctionReturnType<typeof api.loans.myRequests>[number];
type Activity = LoanView["activity"][number];

const NOTIFICATION_LABELS: Record<NonNullable<Activity["eventType"]>, string> = {
  "loan.requested": "Owner notified",
  "loan.approved": "Approval sent",
  "loan.declined": "Decline sent",
  "loan.cancelled": "Cancellation sent",
  "loan.returned": "Return confirmation sent",
};

function statusLabel(loan: LoanView, today: string): { text: string; urgent?: boolean } {
  if (isOverdue(loan, today)) {
    const days = daysBetween(loan.endDate, today);
    return { text: `Overdue by ${days === 1 ? "1 day" : `${days} days`}`, urgent: true };
  }
  if (loan.status === "approved") {
    return { text: loan.startDate <= today ? "Out on loan" : "Booked" };
  }
  return {
    pending: { text: "Waiting for a reply" },
    declined: { text: "Declined" },
    cancelled: { text: "Cancelled" },
    returned: { text: "Returned" },
  }[loan.status];
}

function activityLabel(activity: Activity, now: number): string {
  const when = timeAgo(activity.at, now);
  if (activity.kind === "reminder") {
    return activity.status === "sent"
      ? `Reminder sent ${when}`
      : `Reminder couldn't be sent ${when}`;
  }
  const label = activity.eventType ? NOTIFICATION_LABELS[activity.eventType] : "Notification sent";
  return activity.status === "sent" ? `${label} ${when}` : `Notification failed ${when}`;
}

export function LoanRow({
  loan,
  counterpartLabel,
  actions,
}: {
  loan: LoanView;
  counterpartLabel: string;
  actions?: ReactNode;
}) {
  const now = useNow();
  const status = statusLabel(loan, todayUtc(now));

  return (
    <li className={`p-4 ${status.urgent ? "bg-signal-wash" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl">{loan.tool.name}</h2>
          <p>
            {formatRange(loan.startDate, loan.endDate)}. {counterpartLabel} {loan.counterpart.name}
            {loan.counterpart.trustedLender && (
              <BadgeCheck
                className="ml-1 inline size-4 text-go"
                role="img"
                aria-label="Trusted Lender"
              />
            )}
          </p>
          <p className={`font-bold ${status.urgent ? "text-signal" : ""}`}>
            {status.urgent && (
              <TriangleAlert className="mr-1 inline size-4" aria-hidden="true" />
            )}
            {status.text}
          </p>
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {loan.activity.length > 0 && (
        <ul className="mt-2 text-sm text-ink-soft">
          {loan.activity.map((activity) => (
            <li key={activity.id} className={activity.status === "failed" ? "text-signal" : ""}>
              {activityLabel(activity, now)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
