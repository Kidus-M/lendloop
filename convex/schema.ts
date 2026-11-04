import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  activityStatusValidator,
  categoryValidator,
  conditionValidator,
  loanEventTypeValidator,
  loanStatusValidator,
  outboxStatusValidator,
  roleValidator,
  toolStatusValidator,
} from "./lib/validators";

export default defineSchema({
  /**
   * Convex is the source of truth for authorization. Clerk proves who someone
   * is; `role` here decides what they may do, and no public mutation writes it.
   * Only a first name and an email are kept, because nothing needs more.
   */
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: roleValidator,
    trustedLender: v.boolean(),
    deletedAt: v.optional(v.number()),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_clerk_id", ["clerkId"])
    .index("by_email", ["email"]),

  /**
   * `status` is stored rather than derived at read time. A Convex query is only
   * re-run when its data changes, not when the clock passes midnight, so an
   * hourly cron moves tools to `on_loan` when a booked loan starts.
   */
  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: categoryValidator,
    condition: conditionValidator,
    description: v.string(),
    status: toolStatusValidator,
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_category_status", ["category", "status"]),

  /** A borrow request and the loan it becomes are one record moving through statuses. */
  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatusValidator,
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_status", ["toolId", "status"])
    .index("by_lender", ["lenderId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_borrower_status", ["borrowerId", "status"])
    .index("by_status_end", ["status", "endDate"]),

  /**
   * Transactional outbox. A row is written in the same transaction as the state
   * change, so an event cannot be lost or sent for a change that rolled back.
   * It holds ids only: the email address is read at delivery time, so no
   * personal data sits in the queue and a later account deletion is respected.
   */
  outbox: defineTable({
    eventId: v.string(),
    type: loanEventTypeValidator,
    loanId: v.id("loans"),
    recipientId: v.id("users"),
    status: outboxStatusValidator,
    attempts: v.number(),
    /** Raised by a manual retry so n8n's de-duplication lets the event through again. */
    generation: v.number(),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    acceptedAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
  })
    .index("by_event_id", ["eventId"])
    .index("by_status_next_attempt", ["status", "nextAttemptAt"])
    .index("by_status_accepted", ["status", "acceptedAt"])
    .index("by_status_settled", ["status", "settledAt"]),

  /** What automation did for a loan. Unique on `idempotencyKey`, so retries change nothing. */
  loanActivity: defineTable({
    loanId: v.id("loans"),
    kind: v.union(v.literal("notification"), v.literal("reminder")),
    eventType: v.optional(loanEventTypeValidator),
    status: activityStatusValidator,
    idempotencyKey: v.string(),
    at: v.number(),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),

  /** Failed n8n runs reported by the error workflow. Never holds payloads. */
  automationFailures: defineTable({
    key: v.string(),
    workflow: v.string(),
    node: v.optional(v.string()),
    message: v.string(),
    at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_at", ["at"]),

  /** Dead man's switch: a schedule that stops firing raises no error, so admins see its last run. */
  heartbeats: defineTable({
    name: v.string(),
    lastSeenAt: v.number(),
  }).index("by_name", ["name"]),

  /** Append-only record of privileged and state-changing actions. */
  auditLog: defineTable({
    actorId: v.optional(v.id("users")),
    actorType: v.union(
      v.literal("user"),
      v.literal("system"),
      v.literal("n8n"),
      v.literal("cli"),
    ),
    action: v.string(),
    targetTable: v.string(),
    targetId: v.string(),
    detail: v.optional(v.string()),
  }).index("by_target", ["targetTable", "targetId"]),
});
