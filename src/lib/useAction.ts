"use client";

import { ConvexError } from "convex/values";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { AppErrorData } from "@convex/lib/errors";

const FALLBACK = "That didn't go through. Check your connection and try again.";

/** Server rules are the source of truth, so their message is what the user sees. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    return (error.data as AppErrorData).message ?? FALLBACK;
  }
  return FALLBACK;
}

/** Runs a mutation with a pending state, so buttons can't be double-submitted. */
export function useAction() {
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setPending(true);
      try {
        await action();
        if (success) toast.success(success);
        return true;
      } catch (error) {
        toast.error(errorMessage(error));
        return false;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  return { pending, run };
}
