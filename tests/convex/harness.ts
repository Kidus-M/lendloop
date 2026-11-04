/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "../../convex/**/*.js",
  "!../../convex/**/*.d.ts",
]);

export const TODAY = "2026-06-15";
export const NOW = Date.parse(`${TODAY}T12:00:00Z`);

export type Backend = ReturnType<typeof convexTest>;

/** Scheduled functions run on timers, so tests fix the clock and release them on purpose. */
export function startBackend(): Backend {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  return convexTest(schema, modules);
}

export type Person = {
  id: Id<"users">;
  as: ReturnType<Backend["withIdentity"]>;
};

export async function addPerson(
  t: Backend,
  name: string,
  role: "user" | "admin" = "user",
): Promise<Person> {
  const tokenIdentifier = `test|${name}`;
  const id = await t.run((ctx) =>
    ctx.db.insert("users", {
      tokenIdentifier,
      clerkId: `clerk_${name}`,
      name,
      email: `${name.toLowerCase()}@example.com`,
      role,
      trustedLender: false,
    }),
  );
  return { id, as: t.withIdentity({ tokenIdentifier, subject: `clerk_${name}` }) };
}

export function listTool(owner: Person, name = "Cordless drill") {
  return owner.as.mutation(api.tools.create, {
    name,
    category: "power_tools",
    condition: "good",
    description: "18V drill with two batteries and a charger.",
  });
}

export function requestLoan(
  borrower: Person,
  toolId: Id<"tools">,
  startDate = "2026-06-20",
  endDate = "2026-06-22",
) {
  return borrower.as.mutation(api.loans.request, { toolId, startDate, endDate });
}

/** Asserts on the app's error code rather than on wording. */
export async function failsWith(call: Promise<unknown>, code: string): Promise<boolean> {
  try {
    await call;
  } catch (error) {
    const data = (error as { data?: { code?: string } | string }).data;
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    if (parsed?.code === code) return true;
    throw error;
  }
  throw new Error(`Expected the call to fail with "${code}", but it succeeded.`);
}
