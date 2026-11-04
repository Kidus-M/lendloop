import { ConvexError } from "convex/values";

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "limit_reached";

export type AppErrorData = { code: ErrorCode; message: string };

/** Messages reach the browser, so they say what to do and carry no internal detail. */
export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError<AppErrorData>({ code, message });
}
