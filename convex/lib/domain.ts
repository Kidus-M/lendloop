/**
 * Domain vocabulary and pure rules. This file has no server imports, so the
 * Next.js app can share the same labels and date logic as the backend.
 */

export const CATEGORIES = [
  "power_tools",
  "hand_tools",
  "garden",
  "kitchen",
  "camping",
  "cleaning",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  power_tools: "Power tools",
  hand_tools: "Hand tools",
  garden: "Garden",
  kitchen: "Kitchen",
  camping: "Camping",
  cleaning: "Cleaning",
  other: "Other",
};

export const CONDITIONS = ["like_new", "good", "fair", "worn"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const CONDITION_LABELS: Record<Condition, string> = {
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
  worn: "Well used",
};

export const TOOL_STATUSES = ["available", "on_loan", "removed"] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

export const LOAN_STATUSES = [
  "pending",
  "approved",
  "declined",
  "cancelled",
  "returned",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const LOAN_EVENT_TYPES = [
  "loan.requested",
  "loan.approved",
  "loan.declined",
  "loan.cancelled",
  "loan.returned",
] as const;
export type LoanEventType = (typeof LOAN_EVENT_TYPES)[number];

export const LIMITS = {
  toolName: { min: 2, max: 60 },
  toolDescription: { min: 10, max: 280 },
  maxLoanDays: 30,
  maxAdvanceDays: 180,
  /** Caps abuse of the notification pipeline, since each request sends an email. */
  maxPendingRequestsPerBorrower: 10,
  maxListingsPerOwner: 50,
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Dates are stored as UTC calendar days ("YYYY-MM-DD"): a loan is a range of days, not instants. */
export function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function todayUtc(now: number = Date.now()): string {
  return toIsoDate(now);
}

export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  // Date.parse rolls 2026-02-31 forward, so the round trip catches impossible days.
  return !Number.isNaN(ms) && toIsoDate(ms) === value;
}

export function addDays(date: string, days: number): string {
  return toIsoDate(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

export type DateRange = { startDate: string; endDate: string };

/** Inclusive on both ends: a tool due back on the 5th cannot go out again on the 5th. */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** A loan is overdue from the day after its end date until the lender confirms the return. */
export function isOverdue(
  loan: { status: LoanStatus; endDate: string },
  today: string,
): boolean {
  return loan.status === "approved" && loan.endDate < today;
}
