import { clerkMiddleware } from "@clerk/nextjs/server";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

/**
 * Sets up Clerk's request context and the CSP. It makes no access decisions:
 * path matching here can diverge from Next.js routing, so the check lives in
 * the (app) layout, and the real boundary is in Convex.
 */
export default clerkMiddleware({
  contentSecurityPolicy: {
    strict: true,
    directives: {
      "connect-src": [convexUrl, convexUrl.replace(/^http/, "ws")],
      "font-src": ["'self'"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"],
    },
  },
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
