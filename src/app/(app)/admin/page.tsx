"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { TriangleAlert } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS } from "@convex/lib/domain";
import { useMe } from "@/components/AccountGate";
import { formatRange, timeAgo } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { useNow } from "@/lib/useNow";

type Health = FunctionReturnType<typeof api.admin.automationHealth>;

/** The check runs daily, so two missed hours past a day means the schedule stopped. */
const SCHEDULE_STALE_AFTER_MS = 26 * 60 * 60 * 1000;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 first:mt-0">
      <h2 className="mb-4 text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function ScheduleStatus({ lastSeenAt, now }: { lastSeenAt: number | null; now: number }) {
  const stale = lastSeenAt === null || now - lastSeenAt > SCHEDULE_STALE_AFTER_MS;
  const label = lastSeenAt === null ? "has not run yet" : `last ran ${timeAgo(lastSeenAt, now)}`;
  return (
    <p className={stale ? "font-bold text-signal" : ""}>
      {stale && <TriangleAlert className="mr-1 inline size-4" aria-hidden="true" />}
      Overdue check {label}
    </p>
  );
}

function AutomationHealth({ health }: { health: Health }) {
  const retry = useMutation(api.admin.retryDelivery);
  const { pending, run } = useAction();
  const now = useNow();
  const allClear = health.failedDeliveries.length === 0 && health.failedRuns.length === 0;

  return (
    <div className="grid gap-4">
      <div>
        <ScheduleStatus lastSeenAt={health.overduePollLastSeenAt} now={now} />
        <p>
          {health.queued} waiting to send, {health.awaitingConfirmation} waiting for
          confirmation
        </p>
      </div>

      {allClear && <p className="text-go">No failed notifications or runs.</p>}

      {health.failedDeliveries.length > 0 && (
        <ul className="ledger">
          {health.failedDeliveries.map((delivery) => (
            <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <p className="font-bold">{delivery.type}</p>
                <p>{delivery.error}</p>
                <p className="text-sm text-ink-soft">
                  {delivery.attempts} attempts, {timeAgo(delivery.at, now)}
                </p>
              </div>
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => run(() => retry({ outboxId: delivery.id }), "Sending again")}
              >
                Retry
              </button>
            </li>
          ))}
        </ul>
      )}

      {health.failedRuns.length > 0 && (
        <ul className="ledger">
          {health.failedRuns.map((failure) => (
            <li key={failure.id} className="p-4">
              <p className="font-bold">{failure.workflow}</p>
              <p>{failure.message}</p>
              <p className="text-sm text-ink-soft">
                {failure.node ? `At ${failure.node}, ` : ""}
                {timeAgo(failure.at, now)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AdminPanels() {
  const health = useQuery(api.admin.automationHealth);
  const listings = useQuery(api.admin.listings);
  const lenders = useQuery(api.admin.lenders);
  const loans = useQuery(api.admin.loans);
  const removeListing = useMutation(api.admin.removeListing);
  const setTrusted = useMutation(api.admin.setTrustedLender);
  const { pending, run } = useAction();

  function confirmRemove(toolId: Id<"tools">, name: string) {
    if (window.confirm(`Remove ${name} from the wall? Waiting requests will be declined.`)) {
      void run(() => removeListing({ toolId }), "Listing removed");
    }
  }

  return (
    <>
      <Section title="Automation">
        {health ? <AutomationHealth health={health} /> : <p>Loading.</p>}
      </Section>

      <Section title="Lenders">
        <ul className="ledger">
          {lenders?.map((lender) => (
            <li key={lender.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p>
                <span className="font-bold">{lender.name}</span>
                {lender.role === "admin" && ", admin"}
                {lender.trustedLender && ", Trusted Lender"}
              </p>
              <button
                type="button"
                className="btn"
                disabled={pending}
                aria-pressed={lender.trustedLender}
                onClick={() =>
                  run(
                    () => setTrusted({ userId: lender.id, trusted: !lender.trustedLender }),
                    lender.trustedLender ? "Trusted Lender removed" : "Marked as Trusted Lender",
                  )
                }
              >
                {lender.trustedLender ? "Remove Trusted Lender" : "Mark as Trusted Lender"}
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="All listings">
        <ul className="ledger">
          {listings?.map((tool) => (
            <li key={tool.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <p>
                <span className="font-bold">{tool.name}</span>
                <br />
                {CATEGORY_LABELS[tool.category]}, from {tool.ownerName}
              </p>
              <button
                type="button"
                className="btn btn-danger"
                disabled={pending}
                onClick={() => confirmRemove(tool.id, tool.name)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="All loans">
        <div className="overflow-x-auto rounded-[3px] border border-line bg-panel">
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b-2 border-ink">
              <tr>
                <th scope="col" className="p-3">Tool</th>
                <th scope="col" className="p-3">Lender</th>
                <th scope="col" className="p-3">Borrower</th>
                <th scope="col" className="p-3">Dates</th>
                <th scope="col" className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loans?.map((loan) => (
                <tr key={loan.id} className="border-t border-line">
                  <td className="p-3 font-bold">{loan.toolName}</td>
                  <td className="p-3">{loan.lenderName}</td>
                  <td className="p-3">{loan.borrowerName}</td>
                  <td className="p-3 whitespace-nowrap">
                    {formatRange(loan.startDate, loan.endDate)}
                  </td>
                  <td className="p-3 capitalize">{loan.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

export default function AdminPage() {
  const me = useMe();

  return (
    <>
      <h1 className="mb-8 text-5xl">Admin</h1>
      {me.role === "admin" ? (
        <AdminPanels />
      ) : (
        <p>This page is for admins. Ask an admin if you need something changed.</p>
      )}
    </>
  );
}
