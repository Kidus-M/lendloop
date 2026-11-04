import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import {
  addPerson,
  failsWith,
  listTool,
  requestLoan,
  startBackend,
} from "./harness";

afterEach(() => {
  vi.useRealTimers();
});

describe("public access", () => {
  it("exposes only id, name and category", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    await listTool(owner);

    const [tool] = await t.query(api.tools.listPublic, {});
    expect(Object.keys(tool).sort()).toEqual(["category", "id", "name"]);
  });

  it("leaves out tools that are on loan or removed", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const lent = await listTool(owner, "Lent saw");
    const removed = await listTool(owner, "Removed rake");
    await listTool(owner, "Free ladder");

    const loanId = await requestLoan(borrower, lent, "2026-06-15", "2026-06-16");
    await owner.as.mutation(api.loans.approve, { loanId });
    await owner.as.mutation(api.tools.remove, { toolId: removed });

    const names = (await t.query(api.tools.listPublic, {})).map((tool) => tool.name);
    expect(names).toEqual(["Free ladder"]);
  });

  it("refuses every signed-in function without an identity", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const toolId = await listTool(owner);

    await failsWith(t.query(api.tools.board, {}), "unauthenticated");
    await failsWith(t.query(api.tools.mine, {}), "unauthenticated");
    await failsWith(t.query(api.loans.myRequests, {}), "unauthenticated");
    await failsWith(t.query(api.loans.incoming, {}), "unauthenticated");
    await failsWith(t.query(api.admin.loans, {}), "unauthenticated");
    await failsWith(
      t.mutation(api.tools.remove, { toolId }),
      "unauthenticated",
    );
  });
});

describe("account provisioning", () => {
  it("creates new accounts as ordinary users", async () => {
    const t = startBackend();
    const person = t.withIdentity({
      tokenIdentifier: "test|new",
      subject: "clerk_new",
      givenName: "Noor",
      email: "noor@example.com",
    });

    await person.mutation(api.users.ensureCurrent, {});
    const me = await person.query(api.users.me, {});
    expect(me).toMatchObject({ name: "Noor", role: "user", trustedLender: false });
  });

  it("keeps a granted role when the profile refreshes", async () => {
    const t = startBackend();
    const admin = await addPerson(t, "Ana", "admin");

    await admin.as.mutation(api.users.ensureCurrent, {});
    expect((await admin.as.query(api.users.me, {})).role).toBe("admin");
  });

  it("stores only the first name", async () => {
    const t = startBackend();
    const person = t.withIdentity({
      tokenIdentifier: "test|full",
      subject: "clerk_full",
      name: "Noor Haddad",
    });
    await person.mutation(api.users.ensureCurrent, {});
    expect((await person.query(api.users.me, {})).name).toBe("Noor");
  });
});

describe("listings", () => {
  it("lets only the owner edit or delete a listing", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const other = await addPerson(t, "Ben");
    const toolId = await listTool(owner);

    await failsWith(
      other.as.mutation(api.tools.update, {
        toolId,
        name: "Stolen drill",
        category: "other",
        condition: "worn",
        description: "This edit must never be applied.",
      }),
      "forbidden",
    );
    await failsWith(other.as.mutation(api.tools.remove, { toolId }), "forbidden");

    await owner.as.mutation(api.tools.remove, { toolId });
    expect(await owner.as.query(api.tools.mine, {})).toEqual([]);
  });

  it("rejects text outside the allowed length", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    await failsWith(
      owner.as.mutation(api.tools.create, {
        name: "x",
        category: "garden",
        condition: "good",
        description: "Long enough description.",
      }),
      "invalid",
    );
  });

  it("won't delete a tool that is out on an approved loan", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const toolId = await listTool(owner);
    const loanId = await requestLoan(borrower, toolId);
    await owner.as.mutation(api.loans.approve, { loanId });

    await failsWith(owner.as.mutation(api.tools.remove, { toolId }), "conflict");
  });
});

describe("loan participants", () => {
  it("lets only the lender approve, decline or mark returned", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const stranger = await addPerson(t, "Cy");
    const loanId = await requestLoan(borrower, await listTool(owner));

    for (const person of [borrower, stranger]) {
      await failsWith(person.as.mutation(api.loans.approve, { loanId }), "forbidden");
      await failsWith(person.as.mutation(api.loans.decline, { loanId }), "forbidden");
      await failsWith(
        person.as.mutation(api.loans.markReturned, { loanId }),
        "forbidden",
      );
    }
  });

  it("lets only the borrower cancel", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const loanId = await requestLoan(borrower, await listTool(owner));

    await failsWith(owner.as.mutation(api.loans.cancel, { loanId }), "forbidden");
    await borrower.as.mutation(api.loans.cancel, { loanId });
  });

  it("gives an admin no power over someone else's loan", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const admin = await addPerson(t, "Root", "admin");
    const loanId = await requestLoan(borrower, await listTool(owner));

    await failsWith(admin.as.mutation(api.loans.approve, { loanId }), "forbidden");
  });

  it("shows each side only its own loans, without emails", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const stranger = await addPerson(t, "Cy");
    await requestLoan(borrower, await listTool(owner));

    const [incoming] = await owner.as.query(api.loans.incoming, {});
    expect(incoming.counterpart.name).toBe("Ben");
    expect(JSON.stringify(incoming)).not.toContain("@");

    expect(await stranger.as.query(api.loans.incoming, {})).toEqual([]);
    expect(await stranger.as.query(api.loans.myRequests, {})).toEqual([]);
  });
});

describe("admin", () => {
  it("refuses admin functions to ordinary users", async () => {
    const t = startBackend();
    const user = await addPerson(t, "Ana");
    const toolId = await listTool(user);

    await failsWith(user.as.query(api.admin.loans, {}), "forbidden");
    await failsWith(user.as.query(api.admin.lenders, {}), "forbidden");
    await failsWith(user.as.query(api.admin.automationHealth, {}), "forbidden");
    await failsWith(
      user.as.mutation(api.admin.removeListing, { toolId }),
      "forbidden",
    );
    await failsWith(
      user.as.mutation(api.admin.setTrustedLender, {
        userId: user.id,
        trusted: true,
      }),
      "forbidden",
    );
  });

  it("removes any listing and tells waiting borrowers", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const admin = await addPerson(t, "Root", "admin");
    const toolId = await listTool(owner);
    await requestLoan(borrower, toolId);

    await admin.as.mutation(api.admin.removeListing, { toolId });

    const [request] = await borrower.as.query(api.loans.myRequests, {});
    expect(request.status).toBe("declined");
    const events = await t.run((ctx) => ctx.db.query("outbox").collect());
    expect(events.map((event) => event.type)).toContain("loan.declined");
  });

  it("views all loans and grants Trusted Lender, with an audit trail", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    const borrower = await addPerson(t, "Ben");
    const admin = await addPerson(t, "Root", "admin");
    await requestLoan(borrower, await listTool(owner));

    expect(await admin.as.query(api.admin.loans, {})).toHaveLength(1);

    await admin.as.mutation(api.admin.setTrustedLender, {
      userId: owner.id,
      trusted: true,
    });

    const [tool] = await borrower.as.query(api.tools.board, {});
    expect(tool.owner.trustedLender).toBe(true);

    const entries = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(entries.map((entry) => entry.action)).toContain(
      "user.trusted_lender_granted",
    );
  });

  it("grants roles only through the internal function", async () => {
    const t = startBackend();
    const person = await addPerson(t, "Ana");

    await t.mutation(internal.admin.setRole, {
      email: "ana@example.com",
      role: "admin",
    });
    expect((await person.as.query(api.users.me, {})).role).toBe("admin");
  });
});

describe("account deletion", () => {
  it("erases personal data and withdraws the person's listings", async () => {
    const t = startBackend();
    const owner = await addPerson(t, "Ana");
    await listTool(owner);

    await t.mutation(internal.users.applyClerkDeletion, { clerkId: "clerk_Ana" });
    await t.mutation(internal.users.applyClerkDeletion, { clerkId: "clerk_Ana" });

    const user = await t.run((ctx) => ctx.db.get(owner.id));
    expect(user).toMatchObject({ name: "Former neighbor" });
    expect(user?.email).toBeUndefined();
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
    await failsWith(owner.as.query(api.users.me, {}), "unauthenticated");
  });
});
