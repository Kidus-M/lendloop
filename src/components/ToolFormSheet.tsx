"use client";

import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CONDITION_LABELS,
  CONDITIONS,
  LIMITS,
  type Category,
  type Condition,
} from "@convex/lib/domain";
import { useAction } from "@/lib/useAction";
import { Sheet } from "./Sheet";

export type EditableTool = {
  id: Id<"tools">;
  name: string;
  category: Category;
  condition: Condition;
  description: string;
};

export function ToolFormSheet({
  tool,
  onClose,
}: {
  tool?: EditableTool;
  onClose: () => void;
}) {
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const { pending, run } = useAction();

  const [name, setName] = useState(tool?.name ?? "");
  const [category, setCategory] = useState<Category>(tool?.category ?? "power_tools");
  const [condition, setCondition] = useState<Condition>(tool?.condition ?? "good");
  const [description, setDescription] = useState(tool?.description ?? "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const fields = { name, category, condition, description };
    const saved = await run(
      () => (tool ? update({ toolId: tool.id, ...fields }) : create(fields)),
      tool ? "Changes saved" : "Tool listed",
    );
    if (saved) onClose();
  }

  return (
    <Sheet title={tool ? "Edit listing" : "List a tool"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="input"
            required
            minLength={LIMITS.toolName.min}
            maxLength={LIMITS.toolName.max}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Category</span>
          <select
            className="input"
            value={category}
            onChange={(event) => setCategory(event.target.value as Category)}
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Condition</span>
          <select
            className="input"
            value={condition}
            onChange={(event) => setCondition(event.target.value as Condition)}
          >
            {CONDITIONS.map((value) => (
              <option key={value} value={value}>
                {CONDITION_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Short description</span>
          <textarea
            className="input"
            required
            minLength={LIMITS.toolDescription.min}
            maxLength={LIMITS.toolDescription.max}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <span className="field__hint">
            What&rsquo;s included, and anything a borrower should know. Neighbors see this
            once they sign in.
          </span>
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {tool ? "Save changes" : "List tool"}
        </button>
      </form>
    </Sheet>
  );
}
