import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyRequest,
} from "./signing";

const MAX_BODY_BYTES = 16 * 1024;

export function json(status: number, data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * Verifies an inbound n8n request. On failure it returns the response to send,
 * and every rejection looks the same so a caller learns nothing about why.
 */
export async function verifyN8nRequest(
  request: Request,
): Promise<{ body: string } | { rejected: Response }> {
  const secret = process.env.N8N_TO_LENDLOOP_SECRET;
  if (!secret) {
    console.error("N8N_TO_LENDLOOP_SECRET isn't set; rejecting automation request.");
    return { rejected: json(503, { error: "unavailable" }) };
  }

  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) {
    return { rejected: json(413, { error: "too_large" }) };
  }

  const result = await verifyRequest(
    secret,
    request.headers.get(SIGNATURE_HEADER),
    {
      timestamp: request.headers.get(TIMESTAMP_HEADER) ?? "",
      method: request.method,
      path: new URL(request.url).pathname,
      body,
    },
  );

  if (!result.ok) {
    console.warn(`Rejected automation request: ${result.reason}`);
    return { rejected: json(401, { error: "unauthorized" }) };
  }
  return { body };
}
