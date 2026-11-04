import { BadgeCheck } from "lucide-react";
import { CATEGORY_LABELS, type Category } from "@convex/lib/domain";
import { ToolIcon } from "./ToolIcon";

type HungTool = {
  id: string;
  name: string;
  category: Category;
  out?: boolean;
  note?: string;
  trusted?: boolean;
};

function PegContents({ tool }: { tool: HungTool }) {
  return (
    <>
      <span className="tool-peg__hook" aria-hidden="true" />
      <span className="tool-peg__shape">
        <ToolIcon name={tool.name} category={tool.category} />
      </span>
      <span className="tool-tag">
        <span className="tool-tag__name">{tool.name}</span>
        <span className="tool-tag__meta">
          {tool.note ?? CATEGORY_LABELS[tool.category]}
        </span>
        {tool.trusted && (
          <span className="tool-tag__trust">
            <BadgeCheck className="size-4" aria-hidden="true" />
            Trusted Lender
          </span>
        )}
      </span>
    </>
  );
}

/** The tool wall. A tool on loan keeps its place as a dashed outline, like a shop shadow board. */
export function ToolWall({
  tools,
  onSelect,
}: {
  tools: HungTool[];
  onSelect?: (id: string) => void;
}) {
  return (
    <ul className="tool-wall">
      {tools.map((tool) => (
        <li key={tool.id}>
          {onSelect ? (
            <button
              type="button"
              className="tool-peg"
              data-out={tool.out ?? false}
              onClick={() => onSelect(tool.id)}
            >
              <PegContents tool={tool} />
            </button>
          ) : (
            <div className="tool-peg" data-out={tool.out ?? false}>
              <PegContents tool={tool} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function EmptyWall({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md rounded-[3px] border border-line bg-panel p-6">{children}</div>
  );
}
