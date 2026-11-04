/**
 * Demo data. Internal, so it runs only with deployment credentials:
 *   npx convex run seed:demo
 *
 * It creates fictional neighbors and sends one real request through the outbox,
 * so a fresh setup shows a full board, an overdue loan and a delivered email.
 */
import { internalMutation } from "./_generated/server";
import type { Category, Condition } from "./lib/domain";
import { addDays, todayUtc } from "./lib/domain";
import { enqueueLoanEvent } from "./lib/events";

const NEIGHBORS = ["Maya", "Theo", "Priya", "Sam"];

type SeedTool = [string, Category, Condition, string];

const TOOLS: SeedTool[] = [
  ["Cordless drill", "power_tools", "good", "18V drill with two batteries, a charger and a bit set."],
  ["Orbital sander", "power_tools", "like_new", "Quiet random-orbit sander. Comes with a box of 120 grit discs."],
  ["Circular saw", "power_tools", "fair", "Cuts straight and true. The guard sticks a little, so go gently."],
  ["Claw hammer", "hand_tools", "good", "16 oz with a wood handle. It has built three fences so far."],
  ["Socket wrench set", "hand_tools", "good", "Metric and imperial sockets in a hard case. All sizes present."],
  ["Spirit level", "hand_tools", "like_new", "Four-foot aluminum level for shelves, doors and picture rails."],
  ["Hedge trimmer", "garden", "good", "Battery trimmer with a 24 inch blade and one spare battery."],
  ["Garden spade", "garden", "fair", "Solid steel spade. The handle is worn smooth but very strong."],
  ["Wheelbarrow", "garden", "good", "Holds about six cubic feet. The tire was replaced last spring."],
  ["Stand mixer", "kitchen", "like_new", "Five-quart mixer with a dough hook, whisk and paddle."],
  ["Pressure canner", "kitchen", "good", "23-quart canner with a new gasket and a tested gauge."],
  ["Four-person tent", "camping", "good", "Waterproof tent with footprint and pegs. It packs down small."],
  ["Camp stove", "camping", "good", "Two-burner propane stove. Bring your own fuel canister."],
  ["Carpet cleaner", "cleaning", "fair", "Upright steam cleaner. Rinse the tank before you return it."],
  ["Pressure washer", "cleaning", "good", "1800 PSI electric washer with two nozzles and a 25 foot hose."],
];

export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("tools").first();
    if (existing) throw new Error("Seed data is only for an empty deployment.");

    const today = todayUtc();

    const people = await Promise.all(
      NEIGHBORS.map((name) =>
        ctx.db.insert("users", {
          tokenIdentifier: `seed|${name.toLowerCase()}`,
          clerkId: `seed_${name.toLowerCase()}`,
          name,
          email: `${name.toLowerCase()}@lendloop.test`,
          role: "user",
          trustedLender: name === "Maya",
        }),
      ),
    );

    const tools = await Promise.all(
      TOOLS.map(([name, category, condition, description], index) =>
        ctx.db.insert("tools", {
          ownerId: people[index % people.length],
          name,
          category,
          condition,
          description,
          status: "available",
        }),
      ),
    );

    // Hedge trimmer: out on loan and three days overdue, for the reminder workflow.
    const overdueTool = tools[6];
    const overdueOwner = people[6 % people.length];
    await ctx.db.insert("loans", {
      toolId: overdueTool,
      lenderId: overdueOwner,
      borrowerId: people[1],
      startDate: addDays(today, -7),
      endDate: addDays(today, -3),
      status: "approved",
      decidedAt: Date.now(),
    });
    await ctx.db.patch(overdueTool, { status: "on_loan" });

    // Stand mixer: a live request, delivered through the real outbox.
    const requestedTool = tools[9];
    const lenderId = people[9 % people.length];
    const loanId = await ctx.db.insert("loans", {
      toolId: requestedTool,
      lenderId,
      borrowerId: people[2],
      startDate: addDays(today, 3),
      endDate: addDays(today, 5),
      status: "pending",
    });
    const loan = await ctx.db.get(loanId);
    if (loan) await enqueueLoanEvent(ctx, "loan.requested", loan, lenderId);

    return { neighbors: people.length, tools: tools.length };
  },
});
