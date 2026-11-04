import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { json, verifyN8nRequest } from "./lib/httpAuth";

const http = httpRouter();

const deliveryStatus = z.enum(["sent", "failed"]);

const notificationResult = z.object({
  eventId: z.string().min(1).max(64),
  status: deliveryStatus,
});

const reminderResult = z.object({
  reminderKey: z.string().min(1).max(120),
  status: deliveryStatus,
});

const runFailure = z.object({
  key: z.string().min(1).max(120),
  workflow: z.string().min(1).max(120),
  node: z.string().max(120).optional(),
  message: z.string().min(1).max(300),
});

/** Wraps a write-back route: verify the signature first, then validate the body. */
function signedPost<T>(
  schema: z.ZodType<T>,
  handler: (ctx: ActionCtx, input: T) => Promise<{ result: string }>,
) {
  return httpAction(async (ctx, request) => {
    const verified = await verifyN8nRequest(request);
    if ("rejected" in verified) return verified.rejected;

    let raw: unknown;
    try {
      raw = JSON.parse(verified.body);
    } catch {
      return json(400, { error: "invalid_json" });
    }

    const parsed = schema.safeParse(raw);
    if (!parsed.success) return json(400, { error: "invalid_body" });

    const { result } = await handler(ctx, parsed.data);
    return result === "unknown"
      ? json(404, { error: "unknown_reference" })
      : json(200, { ok: true, result });
  });
}

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const verified = await verifyN8nRequest(request);
    if ("rejected" in verified) return verified.rejected;
    return json(200, await ctx.runMutation(internal.automation.pollOverdue, {}));
  }),
});

http.route({
  path: "/n8n/reminders",
  method: "POST",
  handler: signedPost(reminderResult, (ctx, input) =>
    ctx.runMutation(internal.automation.recordReminder, input),
  ),
});

http.route({
  path: "/n8n/notifications",
  method: "POST",
  handler: signedPost(notificationResult, (ctx, input) =>
    ctx.runMutation(internal.automation.recordNotification, input),
  ),
});

http.route({
  path: "/n8n/failures",
  method: "POST",
  handler: signedPost(runFailure, (ctx, input) =>
    ctx.runMutation(internal.automation.recordRunFailure, input),
  ),
});

const clerkEvent = z.object({
  type: z.string(),
  data: z.object({
    id: z.string().optional(),
    first_name: z.string().nullish(),
    primary_email_address_id: z.string().nullish(),
    email_addresses: z
      .array(
        z.object({
          id: z.string(),
          email_address: z.string(),
          verification: z.object({ status: z.string() }).nullish(),
        }),
      )
      .optional(),
  }),
});

/** Keeps names and emails current, and erases personal data when an account is deleted. */
http.route({
  path: "/clerk/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    if (!secret) return json(503, { error: "unavailable" });

    const body = await request.text();
    try {
      new Webhook(secret).verify(body, {
        "svix-id": request.headers.get("svix-id") ?? "",
        "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
        "svix-signature": request.headers.get("svix-signature") ?? "",
      });
    } catch {
      return json(401, { error: "unauthorized" });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      return json(400, { error: "invalid_json" });
    }

    const parsed = clerkEvent.safeParse(raw);
    if (!parsed.success) return json(400, { error: "invalid_body" });

    const { type, data } = parsed.data;
    const clerkId = data.id;
    if (!clerkId) return json(200, { ok: true });

    if (type === "user.deleted") {
      await ctx.runMutation(internal.users.applyClerkDeletion, { clerkId });
    } else if (type === "user.updated") {
      const primary = data.email_addresses?.find(
        (address) => address.id === data.primary_email_address_id,
      );
      await ctx.runMutation(internal.users.applyClerkUpdate, {
        clerkId,
        firstName: data.first_name ?? undefined,
        email:
          primary?.verification?.status === "verified"
            ? primary.email_address
            : undefined,
      });
    }
    return json(200, { ok: true });
  }),
});

export default http;
