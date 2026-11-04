import { fail } from "./errors";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Trims free text and enforces its length. Convex validators check only the type. */
export function cleanText(
  value: string,
  field: string,
  { min, max }: { min: number; max: number },
): string {
  const text = value.trim();
  if (CONTROL_CHARS.test(text)) {
    fail("invalid", `${field} contains characters that aren't allowed.`);
  }
  if (text.length < min || text.length > max) {
    fail("invalid", `${field} must be ${min} to ${max} characters.`);
  }
  return text;
}
