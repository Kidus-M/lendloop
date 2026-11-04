"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@convex/lib/domain";
import { ToolFormSheet, type EditableTool } from "@/components/ToolFormSheet";
import { useAction } from "@/lib/useAction";

type SheetState = { mode: "closed" } | { mode: "new" } | { mode: "edit"; tool: EditableTool };

export default function ListingsPage() {
  const tools = useQuery(api.tools.mine);
  const remove = useMutation(api.tools.remove);
  const { pending, run } = useAction();
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });

  function confirmRemove(toolId: Id<"tools">, name: string) {
    if (window.confirm(`Remove ${name}? Anyone waiting on it will be told it's declined.`)) {
      void run(() => remove({ toolId }), "Listing removed");
    }
  }

  return (
    <>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-5xl">My listings</h1>
        <button type="button" className="btn btn-primary" onClick={() => setSheet({ mode: "new" })}>
          List a tool
        </button>
      </div>

      {tools === undefined && <p className="text-ink-soft">Loading your listings.</p>}

      {tools?.length === 0 && (
        <p className="max-w-md">
          You haven&rsquo;t listed anything yet. Hang up a tool you rarely use, and a
          neighbor can borrow it instead of buying one.
        </p>
      )}

      {tools && tools.length > 0 && (
        <ul className="ledger">
          {tools.map((tool) => (
            <li key={tool.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h2 className="text-2xl">{tool.name}</h2>
                <p className="text-ink-soft">
                  {CATEGORY_LABELS[tool.category]}, {CONDITION_LABELS[tool.condition].toLowerCase()},{" "}
                  {tool.status === "on_loan" ? "on loan" : "available"}
                </p>
                {tool.pendingRequests > 0 && (
                  <Link href="/incoming" className="font-bold underline">
                    {tool.pendingRequests === 1
                      ? "1 request waiting"
                      : `${tool.pendingRequests} requests waiting`}
                  </Link>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSheet({ mode: "edit", tool })}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={pending}
                  onClick={() => confirmRemove(tool.id, tool.name)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {sheet.mode !== "closed" && (
        <ToolFormSheet
          tool={sheet.mode === "edit" ? sheet.tool : undefined}
          onClose={() => setSheet({ mode: "closed" })}
        />
      )}
    </>
  );
}
