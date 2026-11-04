import { literals } from "convex-helpers/validators";
import {
  CATEGORIES,
  CONDITIONS,
  LOAN_EVENT_TYPES,
  LOAN_STATUSES,
  TOOL_STATUSES,
} from "./domain";

export const categoryValidator = literals(...CATEGORIES);
export const conditionValidator = literals(...CONDITIONS);
export const toolStatusValidator = literals(...TOOL_STATUSES);
export const loanStatusValidator = literals(...LOAN_STATUSES);
export const loanEventTypeValidator = literals(...LOAN_EVENT_TYPES);
export const roleValidator = literals("user", "admin");
export const outboxStatusValidator = literals(
  "pending", // Waiting to be delivered, or waiting for its next retry.
  "accepted", // n8n verified the signature; waiting for the send to be confirmed.
  "confirmed", // n8n reported that the notification went out.
  "failed", // Retries ran out or n8n reported a failure. Shown to admins.
  "skipped", // The recipient has no usable address, for example a deleted account.
);
export const activityStatusValidator = literals("sent", "failed");
