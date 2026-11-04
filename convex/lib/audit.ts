import type { Doc, TableNames } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type Actor = Doc<"users"> | "system" | "n8n" | "cli";

export async function audit(
  ctx: MutationCtx,
  actor: Actor,
  action: string,
  target: { table: TableNames; id: string },
  detail?: string,
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorId: typeof actor === "string" ? undefined : actor._id,
    actorType: typeof actor === "string" ? actor : "user",
    action,
    targetTable: target.table,
    targetId: target.id,
    detail,
  });
}
