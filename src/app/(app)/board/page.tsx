"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { CATEGORIES, CATEGORY_LABELS, type Category } from "@convex/lib/domain";
import { RequestSheet } from "@/components/RequestSheet";
import { EmptyWall, ToolWall } from "@/components/ToolWall";

function CategoryFilter({
  value,
  onChange,
}: {
  value: Category | undefined;
  onChange: (category: Category | undefined) => void;
}) {
  const options = [undefined, ...CATEGORIES];
  return (
    <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option ?? "all"}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`btn ${value === option ? "bg-ink! text-panel!" : ""}`}
        >
          {option ? CATEGORY_LABELS[option] : "All tools"}
        </button>
      ))}
    </div>
  );
}

export default function BoardPage() {
  const [category, setCategory] = useState<Category>();
  const [selectedId, setSelectedId] = useState<string>();
  const tools = useQuery(api.tools.board, { category });
  const selected = tools?.find((tool) => tool.id === selectedId);

  return (
    <div className="pegboard -mx-4 -my-8 min-h-[calc(100dvh-74px)] px-4 py-8 sm:-mx-8 sm:-my-10 sm:px-8 sm:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">Tool wall</h1>
          <p>A dashed outline means the tool is out on loan.</p>
        </div>
      </div>

      <div className="mb-10">
        <CategoryFilter value={category} onChange={setCategory} />
      </div>

      {tools === undefined && <p className="text-ink-soft">Checking the wall.</p>}

      {tools?.length === 0 && (
        <EmptyWall>
          <p className="font-bold">
            {category
              ? `No ${CATEGORY_LABELS[category].toLowerCase()} on the wall yet.`
              : "Nothing is hanging here yet."}
          </p>
          <p>List a tool from My listings to get things started.</p>
        </EmptyWall>
      )}

      {tools && tools.length > 0 && (
        <ToolWall
          onSelect={setSelectedId}
          tools={tools.map((tool) => ({
            id: tool.id,
            name: tool.name,
            category: tool.category,
            out: tool.status === "on_loan",
            note: tool.status === "on_loan" ? "On loan" : `From ${tool.isMine ? "you" : tool.owner.name}`,
            trusted: tool.owner.trustedLender,
          }))}
        />
      )}

      {selected && <RequestSheet tool={selected} onClose={() => setSelectedId(undefined)} />}
    </div>
  );
}
