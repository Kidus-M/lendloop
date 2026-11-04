"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BadgeCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { api } from "@convex/_generated/api";
import {
  addDays,
  CATEGORY_LABELS,
  CONDITION_LABELS,
  LIMITS,
  todayUtc,
} from "@convex/lib/domain";
import { formatRange } from "@/lib/format";
import { useAction } from "@/lib/useAction";
import { useNow } from "@/lib/useNow";
import { Sheet } from "./Sheet";

type BoardTool = FunctionReturnType<typeof api.tools.board>[number];

function BookedDates({ tool }: { tool: BoardTool }) {
  const today = todayUtc(useNow());
  const bookings = useQuery(api.tools.bookings, { toolId: tool.id });
  const upcoming = bookings?.filter((booking) => booking.endDate >= today) ?? [];
  if (upcoming.length === 0) return null;

  return (
    <div className="field__hint">
      <p className="font-bold">Already booked</p>
      <ul>
        {upcoming.map((booking) => (
          <li key={booking.startDate}>{formatRange(booking.startDate, booking.endDate)}</li>
        ))}
      </ul>
    </div>
  );
}

function RequestForm({ tool, onDone }: { tool: BoardTool; onDone: () => void }) {
  const request = useMutation(api.loans.request);
  const { pending, run } = useAction();

  const today = todayUtc(useNow());
  const [startDate, setStartDate] = useState(addDays(today, 1));
  const [endDate, setEndDate] = useState(addDays(today, 3));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const sent = await run(
      () => request({ toolId: tool.id, startDate, endDate }),
      `Request sent to ${tool.owner.name}`,
    );
    if (sent) onDone();
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-4 border-t border-line pt-6">
      <h3 className="text-2xl">Ask to borrow it</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="field">
          <span className="field__label">From</span>
          <input
            className="input"
            type="date"
            required
            min={today}
            max={addDays(today, LIMITS.maxAdvanceDays)}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Until</span>
          <input
            className="input"
            type="date"
            required
            min={startDate}
            max={addDays(startDate, LIMITS.maxLoanDays - 1)}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
      </div>
      <BookedDates tool={tool} />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Sending request" : "Send request"}
      </button>
    </form>
  );
}

export function RequestSheet({ tool, onClose }: { tool: BoardTool; onClose: () => void }) {
  return (
    <Sheet title={tool.name} onClose={onClose}>
      <p>{tool.description}</p>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-bold">Category</dt>
        <dd>{CATEGORY_LABELS[tool.category]}</dd>
        <dt className="font-bold">Condition</dt>
        <dd>{CONDITION_LABELS[tool.condition]}</dd>
        <dt className="font-bold">Lender</dt>
        <dd className="flex flex-wrap items-center gap-x-2">
          {tool.isMine ? "You" : tool.owner.name}
          {tool.owner.trustedLender && (
            <span className="inline-flex items-center gap-1 text-go">
              <BadgeCheck className="size-4" aria-hidden="true" />
              Trusted Lender
            </span>
          )}
        </dd>
        <dt className="font-bold">Status</dt>
        <dd>{tool.status === "available" ? "Available" : "On loan"}</dd>
      </dl>

      {tool.isMine ? (
        <p className="mt-6 border-t border-line pt-6">
          This is your tool. Change it from My listings.
        </p>
      ) : (
        <RequestForm tool={tool} onDone={onClose} />
      )}
    </Sheet>
  );
}
